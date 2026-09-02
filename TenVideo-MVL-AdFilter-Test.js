/*
 * Tencent Video Ad Filter Test V3
 * Target: Tencent Video iOS
 * HAR verified: 2026-09-02
 *
 * IMPORTANT:
 * - Keep the SAME GitHub raw path.
 * - Overwrite the old TenVideo-MVL-AdFilter-Test.js with this file.
 * - Surge module does not need to change.
 *
 * Strategy:
 * Tencent Video detail-page ads are delivered inside protobuf/TRPC binary
 * responses from i.video.qq.com.  V3 keeps protobuf framing intact by doing
 * SAME-LENGTH byte substitutions only.  No bytes are inserted or removed.
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
    // 1. MVL dynamic ad block identifiers
    // -----------------------------------------------------
    // HAR has shown ad_block_2 / ad_block_4 and other dynamic indices.
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
    // 2. Tencent Video detail-page / trailer ad containers
    // -----------------------------------------------------
    // New HAR confirmed these remain AFTER V2 and are tied directly to
    // visible detail-page ads:
    //
    // mod_trailer_ad      -> top video/trailer advertisement container
    // outerPaster         -> outer/pre-roll ad type
    // mod_banner_ad       -> detail-page banner/feed ad module
    // ad_detail_feeds_spa -> detail-feed ad slot
    // ad_mod=ep_list_ad   -> episode-list ad slot
    //
    // Rename only the ad-specific identifiers.  Do NOT touch normal
    // trailer-item or video-module names.
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
    // 3. Protobuf Any ad payload/action types
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
      console.log("TencentVideo AdFilter V3 neutralized markers: " + changed);
      $done({ body });
    } else {
      // Non-ad i.video.qq.com RPCs are passed through unchanged.
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo AdFilter V3 error: " + e);
    $done({});
  }
})();
