/*
 * Tencent Video Ad Filter Test V10
 * Keep the SAME GitHub raw path:
 *   TenVideo-MVL-AdFilter-Test.js
 *
 * V10 adds request-side MVL ad-layout suppression:
 *   AdRequestContextInfo -> XdRequestContextInfo
 *
 * V8/V9 already removed the real ad payload/video, but the latest HAR shows
 * the empty card shell survives. V10 acts BEFORE getMVLPage is generated so
 * Tencent is asked for a naturally no-ad layout.
 *
 * HAR verified: 2026-09-03 00:44
 *
 * V10 target:
 *   The actual ad video is no longer rendered, but the empty/black ad cards
 *   still remain on the Tencent Video detail page.
 *
 * New HAR confirms those remaining cards are still present inside
 * getMVLPage as complete protobuf repeated items.
 *
 * Exact card items observed in this capture:
 *   - 26862 bytes : top/focus ad card
 *   - 26615 bytes : top/focus ad card
 *   - 27827 bytes : top/focus ad card
 *   -  7358 bytes : detail/feed ad card
 *
 * They contain strong combinations such as:
 *   _xx_insert_mix_block
 *   feeds_xx_style
 *   gdt_stats.fcg
 *   advertiser
 *   ad_request_id
 *   AdFeedInfo / AdFocusPoster / AdResponseInfo
 *
 * V9 suppresses the WHOLE confirmed card item by changing ONLY its
 * outer protobuf tag:
 *
 *   0x0A  (field #1, wire type 2)
 *     ->
 *   0x7A  (field #15, wire type 2)
 *
 * Same one-byte tag length.
 * No payload length changes.
 * No shared Tencent CDN blocking.
 */

(function () {
  const url = ($request && $request.url) || "";

  function asciiBytesGlobal(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function containsBytesGlobal(buf, text) {
    const needle = asciiBytesGlobal(text);
    if (!(buf instanceof Uint8Array) || needle.length === 0) return false;

    outer:
    for (let i = 0; i <= buf.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (buf[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  function replaceAllSameLengthGlobal(buf, fromText, toText) {
    if (fromText.length !== toText.length) {
      throw new Error("length mismatch: " + fromText + " -> " + toText);
    }

    const from = asciiBytesGlobal(fromText);
    const to = asciiBytesGlobal(toText);
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
  // A. Request mode
  // =====================================================
  if (typeof $response === "undefined") {
    try {
      // -------------------------------------------------
      // A1. i.video.qq.com / getMVLPage
      //
      // Latest HAR after V9 proves the response-side ad item itself is
      // already moved to an unknown field, but Tencent Video still reserves
      // the visual ad slot. The same getMVLPage REQUEST contains:
      //
      // type.googleapis.com/com.tencent.qqlive.protocol.pb.AdRequestContextInfo
      //
      // This is the server-side ad-layout request context.  V10 neutralizes
      // ONLY that Any type URL before the request reaches Tencent:
      //
      // AdRequestContextInfo -> XdRequestContextInfo
      //
      // Same length; protobuf framing is unchanged.
      // The goal is to make the server generate a naturally no-ad layout,
      // instead of sending an ad layout and deleting its payload afterwards.
      // -------------------------------------------------
      if (/^https:\/\/i\.video\.qq\.com\/$/i.test(url)) {
        const body = $request.body;

        if (!(body instanceof Uint8Array) || body.length === 0) {
          $done({});
          return;
        }

        // Only touch getMVLPage calls. Other i.video.qq.com RPCs pass through.
        if (!containsBytesGlobal(body, "getMVLPage")) {
          $done({});
          return;
        }

        const fromType =
          "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdRequestContextInfo";
        const toType =
          "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdRequestContextInfo";

        const changed = replaceAllSameLengthGlobal(body, fromType, toType);

        if (changed > 0) {
          console.log(
            "TencentVideo V10 neutralized MVL AdRequestContextInfo: " + changed
          );
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

      // -------------------------------------------------
      // A2. svv/vv getvinfo fallback from V6+
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
          console.log("TencentVideo V10 getvinfo request normalized");
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

      $done({});
    } catch (e) {
      console.log("TencentVideo V10 request error: " + e);
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
        console.log("TencentVideo V10 removed getvinfo ad objects: " + removed);
        $done({ body: JSON.stringify(obj) });
      } else {
        $done({});
      }
    } catch (e) {
      console.log("TencentVideo V10 getvinfo response error: " + e);
      $done({});
    }
    return;
  }

  // =====================================================
  // C. Binary helpers
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
  // D. V9: suppress complete MVL ad-card items
  // =====================================================
  try {
    if (url === "https://i.video.qq.com/") {
      const candidates = [];

      /*
       * Scan only field #1 / wire type 2 (0x0A), because the supplied
       * getMVLPage capture shows every remaining ad card as that repeated
       * item type.
       *
       * Bound to 4 KB ~ 40 KB:
       * - avoids tiny inner protobuf strings/messages
       * - avoids giant page-level parent objects
       */
      for (let p = 0; p < body.length - 2; p++) {
        if (body[p] !== 0x0a) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (len < 4096 || len > 40000) continue;
        if (payloadEnd > body.length) continue;

        const topCard =
          containsText(body, payloadStart, payloadEnd, "_ad_insert_mix_block") ||
          containsText(body, payloadStart, payloadEnd, "_xx_insert_mix_block");

        const feedCard =
          containsText(body, payloadStart, payloadEnd, "feeds_ad_style") ||
          containsText(body, payloadStart, payloadEnd, "feeds_xx_style");

        let score = 0;

        const evidence = [
          "gdt_stats.fcg",
          "advertiser",
          "ad_request_id",
          "AdFeedInfo",
          "XdFeedInfo",
          "AdFocusPoster",
          "XdFocusPoster",
          "AdResponseInfo",
          "XdResponseInfo"
        ];

        for (const marker of evidence) {
          if (containsText(body, payloadStart, payloadEnd, marker)) {
            score++;
          }
        }

        /*
         * Require:
         * - a specific Tencent Video ad-card layout marker
         * - plus at least 2 independent advertising signals
         *
         * Current HAR matches exactly four items:
         * 26862 / 26615 / 27827 / 7358 bytes.
         */
        if ((topCard || feedCard) && score >= 2) {
          candidates.push({
            tagPos: p,
            len: len,
            score: score,
            type: topCard ? "top" : "feed"
          });
        }
      }

      /*
       * A genuine card may expose only one qualifying outer field in the
       * observed schema. Deduplicate by tag position before mutation.
       */
      const seen = {};
      let removedCards = 0;

      for (const c of candidates) {
        if (seen[c.tagPos]) continue;
        seen[c.tagPos] = true;

        if (body[c.tagPos] === 0x0a) {
          // field #1 -> unknown field #15, same one-byte tag length
          body[c.tagPos] = 0x7a;
          removedCards++;

          console.log(
            "TencentVideo V10 removed MVL ad card: type=" +
            c.type +
            ", len=" +
            c.len +
            ", score=" +
            c.score
          );
        }
      }

      if (removedCards > 0) {
        console.log("TencentVideo V10 removed MVL cards: " + removedCards);
        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V10 MVL-card error: " + e);
  }

  // =====================================================
  // E. Keep V8 getAdDetail whole-payload suppression
  // =====================================================
  try {
    if (
      url === "https://i.video.qq.com/" &&
      containsText(body, 0, body.length, "mod_trailer_ad") &&
      containsText(body, 0, body.length, "gdt_stats.fcg") &&
      containsText(body, 0, body.length, "ad_vid")
    ) {
      let best = null;

      for (let p = 0; p < body.length - 2; p++) {
        const tag = body[p];

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

        if (score >= 3 && (!best || len > best.len)) {
          best = {
            tagPos: p,
            tag: tag,
            len: len,
            score: score
          };
        }
      }

      if (best && best.tag === 0x0a) {
        body[best.tagPos] = 0x7a;

        console.log(
          "TencentVideo V10 suppressed getAdDetail payload: len=" +
          best.len +
          ", score=" +
          best.score
        );

        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V10 getAdDetail error: " + e);
  }

  // =====================================================
  // F. Marker fallback
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
      console.log("TencentVideo V10 renamed fallback markers: " + renamed);
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo V10 fallback error: " + e);
    $done({});
  }
})();
