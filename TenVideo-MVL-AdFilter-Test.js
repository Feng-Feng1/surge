/*
 * Tencent Video Ad Filter Test V11
 * Keep the SAME GitHub raw path:
 *   TenVideo-MVL-AdFilter-Test.js
 *
 * HAR verified: 2026-09-03 06:51
 *
 * What V11 changes
 * ---------------------------------------------------------
 * 1) The "70-second ad" is still requested through Tencent's dedicated RPC:
 *
 *      com.tencent.qqlive.protocol.pb.adService/getAdDetail
 *
 *    The latest HAR proves V8/V10 DID modify its outer protobuf tag to 0x7A,
 *    but the app still consumed the payload. So "move field #1 to field #15"
 *    was not strong enough.
 *
 *    V11 now does TWO things:
 *      A. request side:
 *         mod_trailer_ad -> mod_trailer_xx
 *      B. response side:
 *         keep the normal outer response field, but replace the complete
 *         ad sub-message payload with a valid protobuf message containing
 *         only one high-number UNKNOWN field.
 *
 *    This preserves every outer protobuf length while making the recognized
 *    ad message effectively empty.
 *
 * 2) Other detail pages use:
 *
 *      VideoDetailService/getPage
 *
 *    and still contain separate ad-card protobuf objects:
 *      mod_banner_ad
 *      AdFeedInfo
 *      AdResponseInfo
 *      mod_trailer_ad
 *      ep_list_ad
 *
 *    V11 blanks ONLY high-confidence sub-messages that contain those ad
 *    signatures. Normal episode/video/detail data is left untouched.
 *
 * 3) Existing V10 getMVLPage request-side no-ad layout remains.
 *
 * No shared Tencent CDN blocking.
 * No VIP spoofing.
 * No normal video URL blocking.
 */

(function () {
  const url = ($request && $request.url) || "";

  // =====================================================
  // Common helpers
  // =====================================================
  function asciiBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function asBytes(v) {
    if (v instanceof Uint8Array) return v;
    if (typeof v === "string") return asciiBytes(v);
    return null;
  }

  function containsBytes(buf, text, start, end) {
    if (!(buf instanceof Uint8Array)) return false;

    const needle = asciiBytes(text);
    const s = Math.max(0, start == null ? 0 : start);
    const e = Math.min(buf.length, end == null ? buf.length : end);

    if (needle.length === 0 || e - s < needle.length) return false;

    outer:
    for (let i = s; i <= e - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (buf[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  function findAllBytes(buf, text) {
    const needle = asciiBytes(text);
    const out = [];

    if (!(buf instanceof Uint8Array) || needle.length === 0) return out;

    outer:
    for (let i = 0; i <= buf.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (buf[i + j] !== needle[j]) continue outer;
      }
      out.push(i);
      i += needle.length - 1;
    }

    return out;
  }

  function replaceAllSameLength(buf, fromText, toText) {
    if (!(buf instanceof Uint8Array)) return 0;

    if (fromText.length !== toText.length) {
      throw new Error("length mismatch: " + fromText + " -> " + toText);
    }

    const from = asciiBytes(fromText);
    const to = asciiBytes(toText);
    let count = 0;

    outer:
    for (let i = 0; i <= buf.length - from.length; i++) {
      for (let j = 0; j < from.length; j++) {
        if (buf[i + j] !== from[j]) continue outer;
      }

      for (let j = 0; j < to.length; j++) {
        buf[i + j] = to[j];
      }

      count++;
      i += from.length - 1;
    }

    return count;
  }

  function readVarint(buf, pos) {
    let value = 0;
    let mul = 1;

    for (let i = 0; i < 10 && pos < buf.length; i++, pos++) {
      const b = buf[pos];
      value += (b & 0x7f) * mul;

      if ((b & 0x80) === 0) {
        return { value: value, next: pos + 1 };
      }

      mul *= 128;
    }

    return null;
  }

  function encodeVarint(value) {
    const a = [];

    do {
      let b = value % 128;
      value = Math.floor(value / 128);

      if (value > 0) b |= 0x80;
      a.push(b);
    } while (value > 0);

    return a;
  }

  /*
   * Replace a protobuf sub-message PAYLOAD with a valid message of EXACTLY
   * the same size.
   *
   * The replacement is:
   *   unknown field #999, wire type 2
   *   + opaque zero payload
   *
   * Generated Tencent parsers should ignore field #999, so all recognized
   * fields in the original ad object become absent/default.
   */
  function blankSubMessagePayload(buf, start, end) {
    const total = end - start;

    if (total < 8) return false;

    // field #999, wire type 2
    const tag = encodeVarint((999 * 8) + 2);

    let innerLen = total - tag.length - 1;
    let lenBytes = encodeVarint(innerLen);

    // Recalculate until total length is exact.
    for (let i = 0; i < 5; i++) {
      innerLen = total - tag.length - lenBytes.length;
      const next = encodeVarint(innerLen);

      if (next.length === lenBytes.length) {
        lenBytes = next;
        break;
      }

      lenBytes = next;
    }

    if (innerLen < 0) return false;
    if (tag.length + lenBytes.length + innerLen !== total) return false;

    let p = start;

    for (const b of tag) buf[p++] = b;
    for (const b of lenBytes) buf[p++] = b;

    while (p < end) buf[p++] = 0;

    return true;
  }

  function requestHas(text) {
    const b = asBytes($request && $request.body);
    return b ? containsBytes(b, text) : false;
  }

  // =====================================================
  // A. HTTP REQUEST mode
  // =====================================================
  if (typeof $response === "undefined") {
    try {
      // -------------------------------------------------
      // A1. i.video.qq.com binary RPC requests
      // -------------------------------------------------
      if (/^https:\/\/i\.video\.qq\.com\/$/i.test(url)) {
        const body = asBytes($request.body);

        if (!body || body.length === 0) {
          $done({});
          return;
        }

        let changed = 0;

        // V10: ask MVL service for a naturally no-ad layout.
        if (containsBytes(body, "getMVLPage")) {
          changed += replaceAllSameLength(
            body,
            "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdRequestContextInfo",
            "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdRequestContextInfo"
          );
        }

        // V11: dedicated trailer-ad request itself exposes this module name.
        if (containsBytes(body, "adService/getAdDetail")) {
          changed += replaceAllSameLength(
            body,
            "mod_trailer_ad",
            "mod_trailer_xx"
          );
        }

        if (changed > 0) {
          console.log("TencentVideo V11 request neutralized markers: " + changed);
          $done({ body });
        } else {
          $done({});
        }

        return;
      }

      // -------------------------------------------------
      // A2. getvinfo fallback
      // -------------------------------------------------
      if (/^https:\/\/(?:s)?vv\.video\.qq\.com\/getvinfo(?:\?|$)/i.test(url)) {
        let body = $request.body || "";

        if (typeof body !== "string" || body.length === 0) {
          $done({});
          return;
        }

        const before = body;

        body = body.replace(/(^|&)sppreviewtype=[^&]*/i, "$1sppreviewtype=0");
        body = body.replace(/(^|&)spsrt=[^&]*/i, "$1spsrt=0");

        if (body !== before) {
          console.log("TencentVideo V11 getvinfo request normalized");
          $done({ body });
        } else {
          $done({});
        }

        return;
      }

      $done({});
    } catch (e) {
      console.log("TencentVideo V11 request error: " + e);
      $done({});
    }

    return;
  }

  // =====================================================
  // B. getvinfo RESPONSE: remove vi.ad
  // =====================================================
  if (/^https:\/\/(?:s)?vv\.video\.qq\.com\/getvinfo(?:\?|$)/i.test(url)) {
    try {
      const text = $response.body;

      if (typeof text !== "string" || text.length === 0) {
        $done({});
        return;
      }

      const obj = JSON.parse(text);
      const list =
        obj &&
        obj.vl &&
        Array.isArray(obj.vl.vi)
          ? obj.vl.vi
          : [];

      let removed = 0;

      for (const vi of list) {
        if (
          vi &&
          typeof vi === "object" &&
          Object.prototype.hasOwnProperty.call(vi, "ad")
        ) {
          delete vi.ad;
          removed++;
        }
      }

      if (removed > 0) {
        console.log("TencentVideo V11 removed getvinfo ad objects: " + removed);
        $done({ body: JSON.stringify(obj) });
      } else {
        $done({});
      }
    } catch (e) {
      console.log("TencentVideo V11 getvinfo response error: " + e);
      $done({});
    }

    return;
  }

  // =====================================================
  // C. i.video.qq.com binary RESPONSE
  // =====================================================
  const body = $response.body;

  if (!(body instanceof Uint8Array) || body.length === 0) {
    $done({});
    return;
  }

  try {
    let changed = 0;

    // -------------------------------------------------
    // C1. STRONG FIX: adService/getAdDetail
    //
    // Latest HAR still has four calls. Their responses contain a complete
    // 11~13 KB trailer-ad payload. Previous versions changed its OUTER tag
    // from field #1 to field #15; HAR proves Tencent still consumed it.
    //
    // Now keep the expected field but blank its INNER message.
    // -------------------------------------------------
    const looksLikeAdDetail =
      requestHas("adService/getAdDetail") ||
      (
        containsBytes(body, "mod_trailer_ad") &&
        containsBytes(body, "gdt_stats.fcg") &&
        containsBytes(body, "ad_vid") &&
        containsBytes(body, "AdFeedImagePoster")
      );

    if (looksLikeAdDetail) {
      const markerPositions = findAllBytes(body, "mod_trailer_ad");
      let best = null;

      for (const markerPos of markerPositions) {
        const scanStart = Math.max(0, markerPos - 1024);

        for (let p = scanStart; p <= markerPos; p++) {
          // Server schema observed in every getAdDetail capture:
          // outer ad object = field #1, wire type 2.
          if (body[p] !== 0x0a) continue;

          const lenInfo = readVarint(body, p + 1);
          if (!lenInfo) continue;

          const payloadStart = lenInfo.next;
          const len = lenInfo.value;
          const payloadEnd = payloadStart + len;

          if (len < 8000 || len > 30000) continue;
          if (payloadStart > markerPos || payloadEnd <= markerPos) continue;
          if (payloadEnd > body.length) continue;

          let score = 0;

          if (containsBytes(body, "mod_trailer_ad", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "gdt_stats.fcg", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "ad_vid", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "AdFeedImagePoster", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "ad_request_id", payloadStart, payloadEnd)) score++;

          if (score >= 4 && (!best || len < best.len)) {
            best = {
              payloadStart: payloadStart,
              payloadEnd: payloadEnd,
              len: len,
              score: score
            };
          }
        }
      }

      if (best && blankSubMessagePayload(body, best.payloadStart, best.payloadEnd)) {
        changed++;

        console.log(
          "TencentVideo V11 blanked getAdDetail object: len=" +
          best.len +
          ", score=" +
          best.score
        );
      }
    }

    // -------------------------------------------------
    // C2. VideoDetailService/getPage:
    // remove remaining ad cards on pages that do NOT use the newer MVL route.
    // -------------------------------------------------
    const looksLikeOldDetailPage =
      requestHas("VideoDetailService/getPage") ||
      (
        containsBytes(body, "mod_banner_ad") &&
        containsBytes(body, "AdFeedInfo")
      );

    if (looksLikeOldDetailPage) {
      const candidates = {};

      function addCandidate(tagPos, payloadStart, payloadEnd, kind, score) {
        const len = payloadEnd - payloadStart;

        if (!candidates[String(tagPos)]) {
          candidates[String(tagPos)] = {
            tagPos: tagPos,
            payloadStart: payloadStart,
            payloadEnd: payloadEnd,
            len: len,
            kind: kind,
            score: score
          };
        }
      }

      // -----------------------------------------------
      // Banner/feed card objects:
      // Captures show 17.6 KB and 23~24 KB field #1 items.
      // -----------------------------------------------
      for (const marker of ["AdFeedInfo"]) {
        for (const markerPos of findAllBytes(body, marker)) {
          const scanStart = Math.max(0, markerPos - 40000);

          for (let p = scanStart; p <= markerPos; p++) {
            if (body[p] !== 0x0a) continue;

            const lenInfo = readVarint(body, p + 1);
            if (!lenInfo) continue;

            const payloadStart = lenInfo.next;
            const len = lenInfo.value;
            const payloadEnd = payloadStart + len;

            if (len < 10000 || len > 35000) continue;
            if (payloadStart > markerPos || payloadEnd <= markerPos) continue;
            if (payloadEnd > body.length) continue;

            let score = 0;

            if (containsBytes(body, "AdFeedInfo", payloadStart, payloadEnd)) score++;
            if (containsBytes(body, "gdt_stats.fcg", payloadStart, payloadEnd)) score++;
            if (containsBytes(body, "ad_request_id", payloadStart, payloadEnd)) score++;
            if (containsBytes(body, "mod_banner_ad", payloadStart, payloadEnd)) score++;
            if (containsBytes(body, "ad_detail_feeds_spa", payloadStart, payloadEnd)) score++;

            if (score >= 3) {
              addCandidate(
                p,
                payloadStart,
                payloadEnd,
                "detail-feed",
                score
              );
            }
          }
        }
      }

      // -----------------------------------------------
      // AdResponseInfo card: ~1.8~2.1 KB field #1.
      // -----------------------------------------------
      for (const markerPos of findAllBytes(body, "AdResponseInfo")) {
        const scanStart = Math.max(0, markerPos - 6000);

        for (let p = scanStart; p <= markerPos; p++) {
          if (body[p] !== 0x0a) continue;

          const lenInfo = readVarint(body, p + 1);
          if (!lenInfo) continue;

          const payloadStart = lenInfo.next;
          const len = lenInfo.value;
          const payloadEnd = payloadStart + len;

          if (len < 1000 || len > 5000) continue;
          if (payloadStart > markerPos || payloadEnd <= markerPos) continue;
          if (payloadEnd > body.length) continue;

          let score = 0;

          if (containsBytes(body, "AdResponseInfo", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "ad_request_id", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "advertiser", payloadStart, payloadEnd)) score++;
          if (containsBytes(body, "mod_banner_ad", payloadStart, payloadEnd)) score++;

          if (score >= 3) {
            addCandidate(
              p,
              payloadStart,
              payloadEnd,
              "response-card",
              score
            );
          }
        }
      }

      // -----------------------------------------------
      // Trailer card module:
      // captures show a dedicated field #7, ~818 bytes.
      // -----------------------------------------------
      for (const markerPos of findAllBytes(body, "mod_trailer_ad")) {
        const scanStart = Math.max(0, markerPos - 2500);

        for (let p = scanStart; p <= markerPos; p++) {
          if (body[p] !== 0x3a) continue; // field #7, wire type 2

          const lenInfo = readVarint(body, p + 1);
          if (!lenInfo) continue;

          const payloadStart = lenInfo.next;
          const len = lenInfo.value;
          const payloadEnd = payloadStart + len;

          if (len < 500 || len > 1500) continue;
          if (payloadStart > markerPos || payloadEnd <= markerPos) continue;
          if (payloadEnd > body.length) continue;

          if (containsBytes(body, "mod_trailer_ad", payloadStart, payloadEnd)) {
            addCandidate(
              p,
              payloadStart,
              payloadEnd,
              "trailer-card",
              1
            );
          }
        }
      }

      // -----------------------------------------------
      // Episode-list ad marker:
      // only blank its tiny dedicated sub-message, not the whole episode list.
      // -----------------------------------------------
      for (const markerPos of findAllBytes(body, "ep_list_ad")) {
        const scanStart = Math.max(0, markerPos - 256);
        let best = null;

        for (let p = scanStart; p <= markerPos; p++) {
          const tag = body[p];

          if (tag === 0 || tag >= 0x80 || (tag & 0x07) !== 2) continue;

          const lenInfo = readVarint(body, p + 1);
          if (!lenInfo) continue;

          const payloadStart = lenInfo.next;
          const len = lenInfo.value;
          const payloadEnd = payloadStart + len;

          if (len < 40 || len > 160) continue;
          if (payloadStart > markerPos || payloadEnd <= markerPos) continue;
          if (payloadEnd > body.length) continue;

          if (
            containsBytes(body, "ep_list_ad", payloadStart, payloadEnd) &&
            (!best || len < best.len)
          ) {
            best = {
              tagPos: p,
              payloadStart: payloadStart,
              payloadEnd: payloadEnd,
              len: len
            };
          }
        }

        if (best) {
          addCandidate(
            best.tagPos,
            best.payloadStart,
            best.payloadEnd,
            "episode-ad-marker",
            1
          );
        }
      }

      // Blank larger objects first. Candidate ranges are independent in the
      // supplied captures; dedupe by outer tag position.
      const list = Object.keys(candidates)
        .map(k => candidates[k])
        .sort((a, b) => b.len - a.len);

      let cards = 0;

      for (const c of list) {
        if (blankSubMessagePayload(body, c.payloadStart, c.payloadEnd)) {
          cards++;
          changed++;

          console.log(
            "TencentVideo V11 blanked " +
            c.kind +
            ": len=" +
            c.len +
            ", score=" +
            c.score
          );
        }
      }

      if (cards > 0) {
        console.log("TencentVideo V11 detail-page cards blanked: " + cards);
      }
    }

    // -------------------------------------------------
    // C3. Existing lightweight fallback marker neutralization.
    // -------------------------------------------------
    let renamed = 0;

    for (let i = 0; i <= 9; i++) {
      renamed += replaceAllSameLength(
        body,
        "ad_block_" + i,
        "xx_block_" + i
      );
    }

    renamed += replaceAllSameLength(body, "ad_focus", "xx_focus");
    renamed += replaceAllSameLength(
      body,
      "_ad_insert_mix_block",
      "_xx_insert_mix_block"
    );
    renamed += replaceAllSameLength(body, "feeds_ad_style", "feeds_xx_style");
    renamed += replaceAllSameLength(body, "mod_adfeed", "mod_xxfeed");

    if (renamed > 0) changed++;

    if (changed > 0) {
      console.log(
        "TencentVideo V11 response changed; fallback markers=" + renamed
      );
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo V11 binary response error: " + e);
    $done({});
  }
})();
