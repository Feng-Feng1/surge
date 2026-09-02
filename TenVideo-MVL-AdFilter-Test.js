/*
 * Tencent Video Ad Filter Test V8
 * Keep the SAME GitHub raw path:
 *   TenVideo-MVL-AdFilter-Test.js
 *
 * HAR verified: 2026-09-03 00:31
 *
 * V8 key finding:
 *
 * V7 already worked on getvinfo:
 *   - requests are normalized to sppreviewtype=0 / spsrt=0
 *   - captured getvinfo responses no longer contain vl.vi[*].ad
 *
 * But the app STILL fetched a real ad MP4 from:
 *   ugchsy.gtimg.com/gzc_1000127_...f10215.mp4
 *
 * The same HAR exposes the real remaining source:
 *
 *   POST https://i.video.qq.com/
 *   RPC:
 *     com.tencent.qqlive.protocol.pb.adService/getAdDetail
 *
 * Its binary response contains an entire ad payload:
 *   mod_trailer_ad
 *   mod_trailer_item
 *   AdFeedImagePoster
 *   gdt_stats.fcg
 *   advertiser / ad_vid / ad_request_id
 *
 * In every captured getAdDetail response, that ad payload is wrapped by one
 * large top-level protobuf length-delimited field:
 *
 *   field #1 (tag 0x0A), about 11 KB ~ 20 KB
 *
 * V8 changes ONLY that outer ad payload field tag:
 *
 *   0x0A (field #1, wire type 2)
 *     ->
 *   0x7A (field #15, wire type 2)
 *
 * Same one-byte tag length. No protobuf byte count changes.
 * The response header remains intact, but a normal generated parser should
 * ignore the unknown field and therefore receive "successful response with
 * no recognized ad payload".
 *
 * This is more precise than blocking shared Tencent CDN domains.
 */

(function () {
  const url = ($request && $request.url) || "";

  // =====================================================
  // A. Request mode: keep getvinfo parameter normalization
  // =====================================================
  if (typeof $response === "undefined") {
    try {
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
          console.log("TencentVideo V8 getvinfo request normalized");
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

      $done({});
    } catch (e) {
      console.log("TencentVideo V8 request error: " + e);
      $done({});
    }
    return;
  }

  // =====================================================
  // B. Response mode: getvinfo JSON ad-object removal
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
        console.log("TencentVideo V8 removed getvinfo ad objects: " + removed);
        $done({ body: JSON.stringify(obj) });
      } else {
        $done({});
      }
    } catch (e) {
      console.log("TencentVideo V8 getvinfo response error: " + e);
      $done({});
    }
    return;
  }

  // =====================================================
  // C. Binary helpers for i.video.qq.com
  // =====================================================
  const body = $response.body;

  if (!(body instanceof Uint8Array) || body.length === 0) {
    $done({});
    return;
  }

  function asciiBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function containsText(buf, start, end, text) {
    const needle = asciiBytes(text);

    if (
      needle.length === 0 ||
      start < 0 ||
      end > buf.length ||
      start >= end
    ) {
      return false;
    }

    outer:
    for (let i = start; i <= end - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (buf[i + j] !== needle[j]) continue outer;
      }
      return true;
    }

    return false;
  }

  function readVarint(buf, pos) {
    let value = 0;
    let shift = 0;

    for (let i = 0; i < 10 && pos < buf.length; i++, pos++) {
      const b = buf[pos];
      value += (b & 0x7f) * Math.pow(2, shift);

      if ((b & 0x80) === 0) {
        return { value: value, next: pos + 1 };
      }

      shift += 7;
    }

    return null;
  }

  function replaceAllSameLength(buf, fromText, toText) {
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

  // =====================================================
  // D. Strong V8 fix:
  //    suppress the whole getAdDetail protobuf payload
  // =====================================================
  try {
    /*
     * Detection is based on RESPONSE evidence, so it does not depend on
     * whether Surge exposes the binary request body inside an http-response
     * script.
     *
     * Captured getAdDetail responses consistently contain all of:
     *   mod_trailer_ad
     *   gdt_stats.fcg
     *   ad_vid
     *
     * We scan one-byte protobuf length-delimited fields and select the
     * LARGEST field >= 4 KB containing at least 3 independent ad signals.
     * In the supplied HAR this selects exactly the outer ad payload:
     *
     *   11706 bytes / 11701 bytes / 20232 bytes
     */
    if (
      url === "https://i.video.qq.com/" &&
      containsText(body, 0, body.length, "mod_trailer_ad") &&
      containsText(body, 0, body.length, "gdt_stats.fcg") &&
      containsText(body, 0, body.length, "ad_vid")
    ) {
      let best = null;

      for (let p = 0; p < body.length - 2; p++) {
        const tag = body[p];

        // Only one-byte protobuf tags with wire type 2.
        if (tag === 0 || tag >= 0x80 || (tag & 0x07) !== 2) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (len < 4096 || payloadEnd > body.length) continue;

        let score = 0;

        if (containsText(body, payloadStart, payloadEnd, "mod_trailer_ad")) score++;
        if (containsText(body, payloadStart, payloadEnd, "gdt_stats.fcg")) score++;
        if (containsText(body, payloadStart, payloadEnd, "ad_vid")) score++;
        if (containsText(body, payloadStart, payloadEnd, "AdFeedImagePoster")) score++;
        if (containsText(body, payloadStart, payloadEnd, "advertiser")) score++;

        if (
          score >= 3 &&
          (!best || len > best.len)
        ) {
          best = {
            tagPos: p,
            tag: tag,
            len: len,
            score: score
          };
        }
      }

      if (best) {
        /*
         * Captured getAdDetail outer payload is field #1 / tag 0x0A.
         * Only replace that confirmed tag.  If Tencent changes the schema,
         * fail open instead of corrupting an unrelated field.
         */
        if (best.tag === 0x0a) {
          body[best.tagPos] = 0x7a;

          console.log(
            "TencentVideo V8 suppressed getAdDetail payload: pos=" +
            best.tagPos +
            ", len=" +
            best.len +
            ", score=" +
            best.score
          );

          $done({ body });
          return;
        }
      }
    }
  } catch (e) {
    console.log("TencentVideo V8 getAdDetail suppression error: " + e);
  }

  // =====================================================
  // E. Existing MVL fallback
  // =====================================================
  try {
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

    if (renamed > 0) {
      console.log("TencentVideo V8 MVL renamed markers: " + renamed);
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo V8 MVL error: " + e);
    $done({});
  }
})();
