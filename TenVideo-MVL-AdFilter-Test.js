/*
 * Tencent Video Ad Filter Test V13
 * Keep the SAME GitHub raw path:
 *   TenVideo-MVL-AdFilter-Test.js
 *
 * V12 is intentionally based on the V10 branch, NOT V11.
 *
 * V13 keeps the V12/V10 stable path and only extends REQUEST-side
 * suppression for the remaining image-ad cards.
 *
 * Latest HAR (2026-09-03 10:02) shows:
 * - getMVLPage responses are already clean.
 * - 70~80s QAD video is already gone through the module's media Fail-Fast.
 * - Remaining image cards now come mainly from:
 *     com.tencent.qqlive.protocol.pb.PageService/getPage
 *     com.tencent.qqlive.protocol.pb.VideoDetailService/getPage
 *
 * PageService/getPage still sends:
 *   AdRequestContextInfo
 *
 * VideoDetailService/getPage sometimes explicitly sends:
 *   "pg_type" : "net_ad"
 *
 * V13 acts BEFORE those page responses are generated:
 * - neutralize AdRequestContextInfo in ANY i.video.qq.com request
 * - for VideoDetailService/getPage only: net_ad -> net_xx
 *
 * Same-length byte replacements only.
 * No V11-style response protobuf surgery.
 *
 * Reason:
 * - V10 removed the large middle ad card.
 * - V11 added extra getAdDetail/getPage protobuf surgery and the large card
 *   came back, so those V11 changes are abandoned.
 *
 * New HAR (2026-09-03 07:31) exposes the persistent ~70s ad path:
 *
 *   svv.video.qq.com/getvinfo
 *
 * Even with sppreviewtype=0 and spsrt=0, the request still had spadseg=3.
 * One returned HLS playlist directly inserted a separate ad block:
 *
 *   #EXT-X-DISCONTINUITY
 *   ...defaultts.tc.qq.com/.../gzc_1000127_...mp4?...segmenttype=2...
 *   #EXTINF:8.042
 *   ...gzc_1000127_...mp4?...segmenttype=2...
 *   #EXT-X-DISCONTINUITY
 *
 * Normal program segments in the same playlist use the 1000102 family and
 * do not carry segmenttype=2.
 *
 * V12 therefore:
 * 1) request side: spadseg -> 0
 * 2) response fallback: delete only discontinuity blocks that simultaneously
 *    contain defaultts.tc.qq.com + /svp_ + segmenttype=2.
 *
 * V10's MVL card-removal logic remains unchanged.
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
      // A1. i.video.qq.com page-layout ad requests
      //
      // Latest HAR proves remaining image cards are first-party page data,
      // not just leaked image resources.
      //
      // Safe request-side strategy:
      //
      // 1) AdRequestContextInfo is itself an ad-specific protobuf Any type.
      //    Neutralize it wherever it appears on i.video.qq.com:
      //
      //    AdRequestContextInfo -> XdRequestContextInfo
      //
      //    This already worked for getMVLPage and now also covers
      //    PageService/getPage.
      //
      // 2) VideoDetailService/getPage has no AdRequestContextInfo in some
      //    captures, but explicitly requests:
      //
      //    "pg_type" : "net_ad"
      //
      //    Only for that RPC, change net_ad -> net_xx.
      //
      // All replacements are the same byte length.
      // -------------------------------------------------
      if (/^https:\/\/i\.video\.qq\.com\/$/i.test(url)) {
        const body = $request.body;

        if (!(body instanceof Uint8Array) || body.length === 0) {
          $done({});
          return;
        }

        let changed = 0;

        const fromType =
          "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdRequestContextInfo";
        const toType =
          "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdRequestContextInfo";

        // Ad-specific request context: safe to neutralize on any i.video RPC.
        changed += replaceAllSameLengthGlobal(body, fromType, toType);

        // Old detail-page route: remove the explicit network-ad page type.
        if (
          containsBytesGlobal(
            body,
            "com.tencent.qqlive.protocol.pb.VideoDetailService/getPage"
          )
        ) {
          changed += replaceAllSameLengthGlobal(body, "net_ad", "net_xx");
        }

        if (changed > 0) {
          console.log(
            "TencentVideo V13 page ad request neutralized: " + changed
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
        body = body.replace(/(^|&)spadseg=[^&]*/i, "$1spadseg=0");

        if (body !== before) {
          console.log("TencentVideo V13 getvinfo request normalized");
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

      $done({});
    } catch (e) {
      console.log("TencentVideo V13 request error: " + e);
      $done({});
    }
    return;
  }

  // =====================================================
  // B. Response mode: getvinfo JSON + HLS ad-segment removal
  // =====================================================
  if (/^https:\/\/(?:s)?vv\.video\.qq\.com\/getvinfo(?:\?|$)/i.test(url)) {
    try {
      const textBody = $response.body;

      if (typeof textBody !== "string" || textBody.length === 0) {
        $done({});
        return;
      }

      const obj = JSON.parse(textBody);
      const list =
        obj &&
        obj.vl &&
        Array.isArray(obj.vl.vi)
          ? obj.vl.vi
          : [];

      let removedAdObjects = 0;
      let removedPlaylistBlocks = 0;

      function cleanInjectedAdBlocks(m3u8) {
        if (typeof m3u8 !== "string" || m3u8.length === 0) {
          return { text: m3u8, removed: 0 };
        }

        const lines = m3u8.split("\n");
        const out = [];
        let removed = 0;

        for (let i = 0; i < lines.length; ) {
          if (lines[i] !== "#EXT-X-DISCONTINUITY") {
            out.push(lines[i]);
            i++;
            continue;
          }

          let j = i + 1;
          while (j < lines.length && lines[j] !== "#EXT-X-DISCONTINUITY") {
            j++;
          }

          if (j >= lines.length) {
            while (i < lines.length) out.push(lines[i++]);
            break;
          }

          const block = lines.slice(i + 1, j).join("\n");

          const isInjectedAd =
            block.indexOf("defaultts.tc.qq.com") !== -1 &&
            block.indexOf("/svp_") !== -1 &&
            block.indexOf("segmenttype=2") !== -1;

          if (isInjectedAd) {
            removed++;
            i = j + 1;
            continue;
          }

          for (let k = i; k <= j; k++) out.push(lines[k]);
          i = j + 1;
        }

        return {
          text: out.join("\n"),
          removed: removed
        };
      }

      for (const vi of list) {
        if (!vi || typeof vi !== "object") continue;

        if (Object.prototype.hasOwnProperty.call(vi, "ad")) {
          delete vi.ad;
          removedAdObjects++;
        }

        if (
          vi.ul &&
          typeof vi.ul === "object" &&
          typeof vi.ul.m3u8 === "string"
        ) {
          const cleaned = cleanInjectedAdBlocks(vi.ul.m3u8);

          if (cleaned.removed > 0) {
            vi.ul.m3u8 = cleaned.text;
            removedPlaylistBlocks += cleaned.removed;
          }
        }
      }

      if (removedAdObjects > 0 || removedPlaylistBlocks > 0) {
        console.log(
          "TencentVideo V13 getvinfo: adObjects=" +
          removedAdObjects +
          ", hlsAdBlocks=" +
          removedPlaylistBlocks
        );

        $done({ body: JSON.stringify(obj) });
      } else {
        $done({});
      }
    } catch (e) {
      console.log("TencentVideo V13 getvinfo response error: " + e);
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
            "TencentVideo V13 removed MVL ad card: type=" +
            c.type +
            ", len=" +
            c.len +
            ", score=" +
            c.score
          );
        }
      }

      if (removedCards > 0) {
        console.log("TencentVideo V13 removed MVL cards: " + removedCards);
        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V13 MVL-card error: " + e);
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
          "TencentVideo V13 suppressed getAdDetail payload: len=" +
          best.len +
          ", score=" +
          best.score
        );

        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V13 getAdDetail error: " + e);
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
      console.log("TencentVideo V13 renamed fallback markers: " + renamed);
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo V13 fallback error: " + e);
    $done({});
  }
})();
