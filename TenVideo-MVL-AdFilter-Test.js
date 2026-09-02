/*
 * Tencent Video MVL ad block experimental filter
 * Target: Tencent Video iOS 9.04.40 (HAR 2026-09-02)
 * Surge: http-response + requires-body=true + binary-body-mode=true
 *
 * Strategy:
 * The detail-page response from https://i.video.qq.com/ is protobuf/binary.
 * Do NOT decode it as UTF-8 or change protobuf lengths.
 * We only replace confirmed ad component/type identifiers with SAME-LENGTH
 * unknown identifiers, so every serialized length remains unchanged.
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
      throw new Error("replacement length mismatch");
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

    // MVL page ad block/style identifiers observed in the supplied HAR.
    changed += replaceAllSameLength(body, "ad_block_4", "xx_block_4");
    changed += replaceAllSameLength(body, "feeds_ad_style", "feeds_xx_style");

    // Protobuf Any type URLs observed in the same getMVLPage response.
    // Same-length substitutions keep the binary protobuf framing intact.
    changed += replaceAllSameLength(
      body,
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdFeedInfo",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdFeedInfo"
    );
    changed += replaceAllSameLength(
      body,
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdFocusPoster",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdFocusPoster"
    );
    changed += replaceAllSameLength(
      body,
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdResponseInfo",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdResponseInfo"
    );
    changed += replaceAllSameLength(
      body,
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.AdOpenWxProgramAction",
      "type.googleapis.com/com.tencent.qqlive.protocol.pb.XdOpenWxProgramAction"
    );

    if (changed > 0) {
      console.log("TencentVideo MVL ad markers neutralized: " + changed);
      $done({ body });
    } else {
      // Other i.video.qq.com RPCs are passed through untouched.
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo MVL filter error: " + e);
    $done({});
  }
})();
