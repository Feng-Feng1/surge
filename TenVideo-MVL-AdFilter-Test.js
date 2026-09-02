/*
 * Tencent Video Ad Filter Test V4
 * Same GitHub path: TenVideo-MVL-AdFilter-Test.js
 *
 * HAR verified: 2026-09-02 23:36
 *
 * Key finding:
 * V3 substitutions ARE taking effect (xx_block_*, XdFeedInfo,
 * XdFocusPoster, feeds_xx_style are visible in the captured response),
 * but Tencent Video still renders the ad because the outer protobuf Any
 * remains a valid generic pb.Block.
 *
 * V4 therefore neutralizes the OUTER ad Block type itself:
 *
 *   ...protocol.pb.Block
 *                -> ...protocol.pb.Xlock
 *
 * ONLY when that Block sits immediately after the confirmed ad container
 * marker (_ad_insert_mix_block / _xx_insert_mix_block).
 *
 * Safety:
 * - binary-body-mode=true
 * - same-length substitutions only
 * - no protobuf length changes
 * - normal i.video.qq.com RPCs pass through unchanged
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

  function findBytes(buf, needle, start, end) {
    const n = asciiBytes(needle);
    const s = Math.max(0, start || 0);
    const e = Math.min(buf.length, end == null ? buf.length : end);

    outer:
    for (let i = s; i <= e - n.length; i++) {
      for (let j = 0; j < n.length; j++) {
        if (buf[i + j] !== n[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  function replaceAt(buf, pos, fromText, toText) {
    if (fromText.length !== toText.length) {
      throw new Error("length mismatch: " + fromText + " -> " + toText);
    }
    const from = asciiBytes(fromText);
    const to = asciiBytes(toText);

    if (pos < 0 || pos + from.length > buf.length) return 0;

    for (let j = 0; j < from.length; j++) {
      if (buf[pos + j] !== from[j]) return 0;
    }
    for (let j = 0; j < to.length; j++) {
      buf[pos + j] = to[j];
    }
    return 1;
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
    let changed = 0;

    // -----------------------------------------------------
    // 1. Strong fix: neutralize the OUTER protobuf Block
    //    only when tied to the confirmed ad container.
    // -----------------------------------------------------
    const adContainerMarkers = [
      "_ad_insert_mix_block",
      "_xx_insert_mix_block"
    ];

    const blockType =
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.Block";
    const deadBlockType =
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.Xlock";

    for (const marker of adContainerMarkers) {
      let searchFrom = 0;

      while (searchFrom < body.length) {
        const markerPos = findBytes(body, marker, searchFrom, body.length);
        if (markerPos < 0) break;

        // In the supplied HAR the Any type follows the ad marker by only
        // a few dozen bytes.  Keep the search window tight so a normal
        // Block elsewhere in the response is not touched.
        const blockPos = findBytes(
          body,
          blockType,
          markerPos,
          Math.min(body.length, markerPos + 320)
        );

        if (blockPos >= 0) {
          changed += replaceAt(body, blockPos, blockType, deadBlockType);
        }

        searchFrom = markerPos + marker.length;
      }
    }

    // -----------------------------------------------------
    // 2. Existing MVL ad identifiers
    // -----------------------------------------------------
    for (let i = 0; i <= 9; i++) {
      changed += replaceAllSameLength(
        body,
        "ad_block_" + i,
        "xx_block_" + i
      );
    }

    changed += replaceAllSameLength(body, "ad_focus", "xx_focus");
    changed += replaceAllSameLength(
      body,
      "_ad_insert_mix_block",
      "_xx_insert_mix_block"
    );
    changed += replaceAllSameLength(body, "feeds_ad_style", "feeds_xx_style");
    changed += replaceAllSameLength(body, "mod_adfeed", "mod_xxfeed");

    // -----------------------------------------------------
    // 3. Detail/trailer ad identifiers from previous HARs
    // -----------------------------------------------------
    changed += replaceAllSameLength(body, "mod_trailer_ad", "mod_trailer_xx");
    changed += replaceAllSameLength(body, "outerPaster", "outerXaster");
    changed += replaceAllSameLength(body, "mod_banner_ad", "mod_banner_xx");
    changed += replaceAllSameLength(
      body,
      "ad_detail_feeds_spa",
      "xx_detail_feeds_spa"
    );
    changed += replaceAllSameLength(
      body,
      "ad_mod=ep_list_ad",
      "xx_mod=ep_list_xx"
    );

    // -----------------------------------------------------
    // 4. Protobuf Any ad payload/action type names
    // -----------------------------------------------------
    const typePairs = [
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdFeedInfo",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdFeedInfo"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdFocusPoster",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdFocusPoster"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdResponseInfo",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdResponseInfo"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdOpenWxProgramAction",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdOpenWxProgramAction"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdOpenAppAction",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdOpenAppAction"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdFeedImagePoster",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdFeedImagePoster"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdJumpAction",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdJumpAction"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdDownloadAction",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdDownloadAction"
      ]
    ];

    for (const pair of typePairs) {
      changed += replaceAllSameLength(body, pair[0], pair[1]);
    }

    if (changed > 0) {
      console.log("TencentVideo AdFilter V4 neutralized markers: " + changed);
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo AdFilter V4 error: " + e);
    $done({});
  }
})();
