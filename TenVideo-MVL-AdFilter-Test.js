/*
 * Tencent Video MVL ad block experimental filter V2
 * Target: Tencent Video iOS 9.04.40
 * Based on HAR captures: 2026-09-02
 *
 * V2 fixes:
 * - The ad block id is dynamic. One capture used ad_block_4,
 *   another used ad_block_2. V1 only handled ad_block_4.
 * - Also neutralize ad_focus, _ad_insert_mix_block and
 *   AdOpenAppAction that remained in the post-V1 response.
 *
 * Safety strategy:
 * - binary-body-mode=true
 * - only SAME-LENGTH byte substitutions
 * - never add/remove protobuf bytes
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
      throw new Error("replacement length mismatch: " + fromText + " -> " + toText);
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

    // Tencent Video MVL uses dynamic ad block numbers.
    // Captures have already shown ad_block_4 and ad_block_2.
    for (let i = 0; i <= 9; i++) {
      changed += replaceAllSameLength(
        body,
        "ad_block_" + i,
        "xx_block_" + i
      );
    }

    // Structural ad component identifiers observed in MVL protobuf.
    changed += replaceAllSameLength(body, "ad_focus", "xx_focus");
    changed += replaceAllSameLength(
      body,
      "_ad_insert_mix_block",
      "_xx_insert_mix_block"
    );
    changed += replaceAllSameLength(body, "feeds_ad_style", "feeds_xx_style");

    // Protobuf Any type URLs. Same-length substitutions preserve framing.
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
      ]
    ];

    for (const pair of typePairs) {
      changed += replaceAllSameLength(body, pair[0], pair[1]);
    }

    if (changed > 0) {
      console.log("TencentVideo MVL V2 neutralized markers: " + changed);
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo MVL V2 filter error: " + e);
    $done({});
  }
})();
