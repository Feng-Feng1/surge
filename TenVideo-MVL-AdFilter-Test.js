/*
 * Tencent Video Ad Filter Test V7
 * Keep the SAME GitHub raw path:
 *   TenVideo-MVL-AdFilter-Test.js
 *
 * HAR verified: 2026-09-03 00:21
 *
 * Key finding:
 * V6 DID hit at least one getvinfo request:
 *   sppreviewtype=0
 *   spsrt=0
 *
 * But Tencent's server STILL returned a complete ad object:
 *   vl.vi[0].ad.adsid
 *   vl.vi[0].ad.adpinfo
 *   vl.vi[0].ad.adsize
 *
 * The adpinfo explicitly contains:
 *   ad_vid
 *   ad_dura
 *   slot_index
 *   ad_time_begin / ad_time_end
 *
 * A parallel getvinfo response in the SAME HAR naturally had NO "ad"
 * property at all and otherwise kept the normal video payload.
 *
 * Therefore V7 no longer relies on old request parameters alone.
 * It makes ad-bearing getvinfo responses look like the naturally
 * occurring no-ad response by deleting ONLY vi.ad.
 *
 * No CDN blocking.
 * No normal video URL rewriting.
 * No VIP spoofing.
 */

(function () {
  const url = ($request && $request.url) || "";

  // =====================================================
  // A. Request mode: keep V6 request-side fallback
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
          console.log("TencentVideo V7 getvinfo request normalized");
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

      $done({});
    } catch (e) {
      console.log("TencentVideo V7 request error: " + e);
      $done({});
    }
    return;
  }

  // =====================================================
  // B. Response mode: getvinfo JSON ad-object removal
  // =====================================================
  if (/^https:\/\/(?:s)?vv\.video\.qq\.com\/getvinfo(?:\?|$)/i.test(url)) {
    try {
      let text = $response.body;

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
        console.log("TencentVideo V7 removed getvinfo ad objects: " + removed);
        $done({
          body: JSON.stringify(obj)
        });
      } else {
        $done({});
      }
    } catch (e) {
      console.log("TencentVideo V7 getvinfo response error: " + e);
      $done({});
    }
    return;
  }

  // =====================================================
  // C. Response mode: keep MVL protobuf fallback
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

  function findAll(buf, text) {
    const needle = asciiBytes(text);
    const out = [];

    if (needle.length === 0 || needle.length > buf.length) return out;

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

  function containsText(buf, start, end, text) {
    const needle = asciiBytes(text);
    if (needle.length === 0 || start < 0 || end > buf.length) return false;

    outer:
    for (let i = start; i <= end - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (buf[i + j] !== needle[j]) continue outer;
      }
      return true;
    }

    return false;
  }

  function findAdItemWrapper(buf, markerPos) {
    const scanStart = Math.max(0, markerPos - 65536);
    let best = null;

    for (let p = scanStart; p <= markerPos; p++) {
      if (buf[p] !== 0x0a) continue;

      const lenInfo = readVarint(buf, p + 1);
      if (!lenInfo) continue;

      const payloadStart = lenInfo.next;
      const len = lenInfo.value;
      const payloadEnd = payloadStart + len;

      if (len < 1024 || len > 65536) continue;
      if (payloadStart > markerPos || payloadEnd <= markerPos) continue;
      if (payloadEnd > buf.length) continue;

      if (!best || len < best.len) {
        best = {
          tagPos: p,
          payloadStart: payloadStart,
          payloadEnd: payloadEnd,
          len: len
        };
      }
    }

    return best;
  }

  function isConfirmedAdItem(buf, wrapper) {
    const s = wrapper.payloadStart;
    const e = wrapper.payloadEnd;

    const evidence = [
      "gdt_stats.fcg",
      "advertiser=",
      "ad_request_id",
      "ad_report_params",
      "AdFeedInfo",
      "AdFocusPoster",
      "AdResponseInfo",
      "ad_block_",
      "_ad_insert_mix_block",
      "feeds_ad_style"
    ];

    let score = 0;
    for (const x of evidence) {
      if (containsText(buf, s, e, x)) score++;
    }

    return score >= 2;
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

  try {
    const strongMarkers = [
      "_ad_insert_mix_block",
      "_xx_insert_mix_block",
      "feeds_ad_style",
      "feeds_xx_style",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdFeedInfo",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdFeedInfo",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdResponseInfo",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdResponseInfo"
    ];

    const wrapperPositions = {};

    for (const marker of strongMarkers) {
      const positions = findAll(body, marker);

      for (const markerPos of positions) {
        const wrapper = findAdItemWrapper(body, markerPos);

        if (wrapper && isConfirmedAdItem(body, wrapper)) {
          wrapperPositions[String(wrapper.tagPos)] = wrapper;
        }
      }
    }

    let suppressed = 0;

    for (const k in wrapperPositions) {
      const wrapper = wrapperPositions[k];

      if (body[wrapper.tagPos] === 0x0a) {
        body[wrapper.tagPos] = 0x7a;
        suppressed++;
      }
    }

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

    if (suppressed > 0 || renamed > 0) {
      console.log(
        "TencentVideo AdFilter V7 MVL: suppressed=" +
        suppressed +
        ", renamed=" +
        renamed
      );
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo V7 MVL response error: " + e);
    $done({});
  }
})();
