/*
 * Tencent Video Ad Filter Test V5
 * Keep the SAME GitHub path:
 *   TenVideo-MVL-AdFilter-Test.js
 *
 * HAR verified: 2026-09-02 23:44
 *
 * V5 key change:
 * Previous V1-V4 scripts DID modify the protobuf payload, but Tencent Video
 * still rendered the ads. The new HAR proves the actual ad is a complete
 * repeated protobuf item, not just a string/type marker.
 *
 * Example from the captured getMVLPage response:
 *   repeated field #1 item 0 : normal focus card, ~4.6 KB
 *   repeated field #1 item 1 : AD ITEM, ~26.7 KB
 *   repeated field #1 item 2+: normal focus cards
 *
 * The ad item contains:
 *   ad_block_*
 *   _ad_insert_mix_block
 *   AdFeedInfo / AdFocusPoster
 *   advertiser=...
 *   gdt_stats.fcg
 *
 * Another ~5.3 KB repeated item contains the detail/feed ad:
 *   feeds_ad_style
 *   AdResponseInfo
 *   advertiser=...
 *   business=ad
 *
 * Strategy:
 * - Find the smallest enclosing protobuf field #1 (wire type 2) larger than
 *   1 KB that contains a confirmed ad marker.
 * - Change ONLY that outer field tag from 0x0A (field #1) to 0x7A
 *   (field #15, same one-byte tag length).
 * - The original length and payload bytes stay intact, so protobuf framing
 *   is not shifted. A normal generated parser should skip the unknown field.
 *
 * This is much stronger than merely renaming AdFeedInfo/XdFeedInfo.
 */

(function () {
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

  /*
   * Find the smallest enclosing protobuf field:
   *
   *   0x0A <varint length> <payload>
   *
   * whose payload contains markerPos and is between 1 KB and 64 KB.
   *
   * In the supplied HAR this selects:
   *   - ~26730-byte top/focus ad item
   *   - ~5363-byte feed/detail ad item
   *
   * It does NOT select tiny inner string/message fields or huge page parents.
   */
  function findAdItemWrapper(buf, markerPos) {
    const scanStart = Math.max(0, markerPos - 65536);
    let best = null;

    for (let p = scanStart; p <= markerPos; p++) {
      // field #1, wire type 2
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

    // Require multiple independent ad signals to avoid suppressing a normal
    // protobuf item just because it contains one generic "ad" substring.
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
      "feeds_ad_style",
      "business"
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

    // First pass: identify whole ad items while the original markers exist.
    for (const marker of strongMarkers) {
      const positions = findAll(body, marker);

      for (const markerPos of positions) {
        const wrapper = findAdItemWrapper(body, markerPos);

        if (
          wrapper &&
          isConfirmedAdItem(body, wrapper)
        ) {
          wrapperPositions[String(wrapper.tagPos)] = wrapper;
        }
      }
    }

    let suppressed = 0;

    // Strong fix:
    // 0x0A = protobuf field #1, wire type 2
    // 0x7A = protobuf field #15, wire type 2
    //
    // Same one-byte tag size, therefore no offsets/lengths change.
    for (const k in wrapperPositions) {
      const wrapper = wrapperPositions[k];

      if (body[wrapper.tagPos] === 0x0a) {
        body[wrapper.tagPos] = 0x7a;
        suppressed++;
        console.log(
          "TencentVideo V5 suppressed protobuf ad item: pos=" +
          wrapper.tagPos +
          ", len=" +
          wrapper.len
        );
      }
    }

    // Secondary fallback markers. These remain same-length and are harmless
    // if the whole item was already moved to an unknown field.
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
        "TencentVideo AdFilter V5: suppressed=" +
        suppressed +
        ", renamed=" +
        renamed
      );
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo AdFilter V5 error: " + e);
    $done({});
  }
})();
