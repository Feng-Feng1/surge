// Tencent Video Ad Filter Recovery V22

(function () {
  const url = ($request && $request.url) || "";

  if (/^https:\/\/i\.video\.qq\.com\/$/i.test(url)) {
    console.log("TencentVideo V22 recovery: i.video bypassed");
    $done({});
    return;
  }

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

  if (typeof $response === "undefined") {
    try {

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

        changed += replaceAllSameLengthGlobal(body, fromType, toType);

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
            "TencentVideo V22 page ad request neutralized: " + changed
          );
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

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
          console.log("TencentVideo V22 getvinfo request normalized");
          $done({ body });
        } else {
          $done({});
        }
        return;
      }

      $done({});
    } catch (e) {
      console.log("TencentVideo V22 request error: " + e);
      $done({});
    }
    return;
  }

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
          "TencentVideo V22 getvinfo: adObjects=" +
          removedAdObjects +
          ", hlsAdBlocks=" +
          removedPlaylistBlocks
        );

        $done({ body: JSON.stringify(obj) });
      } else {
        $done({});
      }
    } catch (e) {
      console.log("TencentVideo V22 getvinfo response error: " + e);
      $done({});
    }
    return;
  }

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

  function isNestedCandidate(candidate, candidates) {
    for (const outer of candidates) {
      if (outer === candidate) continue;

      if (
        outer.tagPos < candidate.tagPos &&
        outer.payloadStart <= candidate.tagPos &&
        outer.payloadEnd >= candidate.payloadEnd &&
        outer.len > candidate.len
      ) {
        return true;
      }
    }

    return false;
  }

  let v16PromoCards = 0;
  let v16InnerAdEnvelopes = 0;
  let v17InnerAdTypes = 0;
  let v18PersonalCenterAds = 0;
  let v19PersonalRewardModules = 0;
  let v21PersonalAdCounts = 0;

  try {
    if (
      url === "https://i.video.qq.com/" &&
      containsText(body, 0, body.length, "/video/ad_profile/") &&
      containsText(body, 0, body.length, "txvideo://v.qq.com/rewardAd")
    ) {
      const candidates = [];

      for (let p = 0; p < body.length - 2; p++) {
        if (body[p] !== 0x0a && body[p] !== 0x7a) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (len < 512 || len > 5000) continue;
        if (payloadEnd > body.length || payloadStart >= payloadEnd) continue;

        if (
          containsText(body, payloadStart, payloadEnd, "/video/ad_profile/") &&
          containsText(
            body,
            payloadStart,
            payloadEnd,
            "txvideo://v.qq.com/rewardAd"
          )
        ) {
          candidates.push({
            tagPos: p,
            tag: body[p],
            len: len,
            payloadStart: payloadStart,
            payloadEnd: payloadEnd
          });
        }
      }

      for (const c of candidates) {
        if (isNestedCandidate(c, candidates)) continue;
        if (body[c.tagPos] !== 0x0a) continue;

        body[c.tagPos] = 0x7a;
        v19PersonalRewardModules++;

        console.log(
          "TencentVideo V21 removed personal reward module: len=" + c.len
        );
      }
    }
  } catch (e) {
    console.log("TencentVideo V21 personal reward error: " + e);
  }

  try {
    if (
      url === "https://i.video.qq.com/" &&
      $request &&
      $request.body instanceof Uint8Array &&
      containsBytesGlobal($request.body, "GetPersonalCenterAdData") &&
      containsText(body, 0, body.length, "AdFeedImagePoster") &&
      containsText(body, 0, body.length, "personal_center_page") &&
      containsText(body, 0, body.length, "gdt_stats.fcg") &&
      containsText(body, 0, body.length, "ad_request_id")
    ) {
      const candidates = [];

      for (let p = 0; p < body.length - 2; p++) {
        if (body[p] !== 0x0a && body[p] !== 0x7a) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (len < 4096 || len > 30000) continue;
        if (payloadEnd > body.length || payloadStart >= payloadEnd) continue;

        if (
          containsText(body, payloadStart, payloadEnd, "AdFeedImagePoster") &&
          containsText(body, payloadStart, payloadEnd, "personal_center_page") &&
          containsText(body, payloadStart, payloadEnd, "gdt_stats.fcg") &&
          containsText(body, payloadStart, payloadEnd, "ad_request_id")
        ) {
          candidates.push({
            tagPos: p,
            tag: body[p],
            len: len,
            payloadStart: payloadStart,
            payloadEnd: payloadEnd
          });
        }
      }

      for (const c of candidates) {
        if (isNestedCandidate(c, candidates)) continue;

        if (
          c.payloadEnd + 1 < body.length &&
          body[c.payloadEnd] === 0x28 &&
          body[c.payloadEnd + 1] === 0x01
        ) {
          body[c.payloadEnd + 1] = 0x00;
          v21PersonalAdCounts++;
        }

        if (v21PersonalAdCounts > 0) {
          console.log(
            "TencentVideo V21 personal-center no-ad: len=" +
            c.len +
            ", counts=" +
            v21PersonalAdCounts
          );
        }
      }
    }
  } catch (e) {
    console.log("TencentVideo V21 personal-center error: " + e);
  }

  try {
    if (url === "https://i.video.qq.com/") {
      const promoCandidates = [];
      const innerAdCandidates = [];

      const innerAdTypes = [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.InnerAdPromotionEventList",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.InnerAdPullRefreshEventList",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.InnerAdPullRefreshExtraDisplayInfo"
      ];

      for (let p = 0; p < body.length - 2; p++) {

        if (body[p] !== 0x0a && body[p] !== 0x7a) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (payloadEnd > body.length || payloadStart >= payloadEnd) continue;

        let hasInnerAdType = false;

        if (len >= 64 && len <= 12000) {
          for (const typeName of innerAdTypes) {
            if (containsText(body, payloadStart, payloadEnd, typeName)) {
              hasInnerAdType = true;
              break;
            }
          }

          if (hasInnerAdType) {
            innerAdCandidates.push({
              tagPos: p,
              tag: body[p],
              len: len,
              payloadStart: payloadStart,
              payloadEnd: payloadEnd
            });
          }
        }

        if (len < 512 || len > 12000 || hasInnerAdType) continue;

        const isIwanPromotion =
          containsText(
            body,
            payloadStart,
            payloadEnd,
            "s.iwan.qq.com/opengame"
          ) &&
          containsText(body, payloadStart, payloadEnd, "game_id") &&
          containsText(body, payloadStart, payloadEnd, "business") &&
          containsText(body, payloadStart, payloadEnd, "iwan");

        if (isIwanPromotion) {
          promoCandidates.push({
            tagPos: p,
            tag: body[p],
            len: len,
            payloadStart: payloadStart,
            payloadEnd: payloadEnd
          });
        }
      }

      for (const c of promoCandidates) {
        if (isNestedCandidate(c, promoCandidates)) continue;
        if (body[c.tagPos] !== 0x0a) continue;

        body[c.tagPos] = 0x7a;
        v16PromoCards++;

        console.log(
          "TencentVideo V21 removed iwan promotion card: len=" + c.len
        );
      }

      for (const c of innerAdCandidates) {
        if (isNestedCandidate(c, innerAdCandidates)) continue;
        if (body[c.tagPos] !== 0x0a) continue;

        body[c.tagPos] = 0x7a;
        v16InnerAdEnvelopes++;

        console.log(
          "TencentVideo V21 removed InnerAd extension: len=" + c.len
        );
      }
    }
  } catch (e) {
    console.log("TencentVideo V21 iwan/InnerAd error: " + e);
  }

  try {
    if (url === "https://i.video.qq.com/") {
      const innerParents = {};

      const evidence = [
        "gdt_stats.fcg",
        "ad_request_id",
        "advertiser",
        "mod_banner_ad",
        "ad_detail_feeds_spa",
        "outerPaster"
      ];

      for (let p = 0; p < body.length - 2; p++) {
        if (body[p] !== 0x0a) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (len < 10000 || len > 45000) continue;
        if (payloadEnd > body.length) continue;

        if (
          !containsText(
            body,
            payloadStart,
            payloadEnd,
            "AdFeedInfo"
          )
        ) {
          continue;
        }

        let score = 0;

        for (const x of evidence) {
          if (containsText(body, payloadStart, payloadEnd, x)) {
            score++;
          }
        }

        if (score < 2) continue;

        for (let q = Math.max(0, p - 8); q < p; q++) {
          if (body[q] !== 0x2a) continue;

          const parentLenInfo = readVarint(body, q + 1);
          if (!parentLenInfo) continue;

          const parentLen = parentLenInfo.value;
          const parentPayloadStart = parentLenInfo.next;
          const parentPayloadEnd = parentPayloadStart + parentLen;

          if (
            parentPayloadStart === p &&
            parentPayloadEnd === payloadEnd
          ) {
            innerParents[String(q)] = {
              tagPos: q,
              childPos: p,
              childLen: len,
              score: score
            };
            break;
          }
        }
      }

      let innerNeutralized = 0;

      for (const k in innerParents) {
        const c = innerParents[k];

        if (body[c.tagPos] === 0x2a) {

          body[c.tagPos] = 0x7a;
          innerNeutralized++;

          console.log(
            "TencentVideo V21 neutralized inner AdFeedInfo wrapper: len=" +
            c.childLen +
            ", score=" +
            c.score
          );
        }
      }

      function hasNeutralizedAdWrapper(start, end) {
        for (let q = start; q < end - 2; q++) {
          if (body[q] !== 0x7a) continue;

          const wrapLenInfo = readVarint(body, q + 1);
          if (!wrapLenInfo) continue;

          const wrapLen = wrapLenInfo.value;
          const wrapStart = wrapLenInfo.next;
          const wrapEnd = wrapStart + wrapLen;

          if (wrapEnd > end || wrapEnd > body.length) continue;
          if (wrapStart >= wrapEnd) continue;

          if (body[wrapStart] !== 0x0a) continue;

          const childLenInfo = readVarint(body, wrapStart + 1);
          if (!childLenInfo) continue;

          const childLen = childLenInfo.value;
          const childStart = childLenInfo.next;
          const childEnd = childStart + childLen;

          if (childEnd !== wrapEnd) continue;

          if (
            containsText(
              body,
              childStart,
              childEnd,
              "AdFeedInfo"
            )
          ) {
            return true;
          }
        }

        return false;
      }

      const shells = [];

      for (let p = 0; p < body.length - 2; p++) {
        if (body[p] !== 0x0a) continue;

        const lenInfo = readVarint(body, p + 1);
        if (!lenInfo) continue;

        const len = lenInfo.value;
        const payloadStart = lenInfo.next;
        const payloadEnd = payloadStart + len;

        if (len < 10000 || len > 45000) continue;
        if (payloadEnd > body.length) continue;

        if (
          !containsText(
            body,
            payloadStart,
            payloadEnd,
            "AdFeedInfo"
          )
        ) {
          continue;
        }

        let score = 0;

        for (const x of evidence) {
          if (containsText(body, payloadStart, payloadEnd, x)) {
            score++;
          }
        }

        if (score < 2) continue;

        if (!hasNeutralizedAdWrapper(payloadStart, payloadEnd)) {
          continue;
        }

        shells.push({
          tagPos: p,
          len: len,
          payloadStart: payloadStart,
          payloadEnd: payloadEnd,
          score: score
        });
      }

      let removedShells = 0;

      for (let i = 0; i < shells.length; i++) {
        const c = shells[i];
        let nested = false;

        for (let j = 0; j < shells.length; j++) {
          if (i === j) continue;

          const o = shells[j];

          if (
            o.tagPos < c.tagPos &&
            o.payloadStart <= c.tagPos &&
            o.payloadEnd >= c.payloadEnd &&
            o.len > c.len
          ) {
            nested = true;
            break;
          }
        }

        if (nested) continue;

        if (body[c.tagPos] === 0x0a) {

          body[c.tagPos] = 0x7a;
          removedShells++;

          console.log(
            "TencentVideo V21 removed whole AdFeedInfo card shell: len=" +
            c.len +
            ", score=" +
            c.score
          );
        }
      }

      if (removedShells > 0 || innerNeutralized > 0) {
        console.log(
          "TencentVideo V21 detail cards: shells=" +
          removedShells +
          ", inner=" +
          innerNeutralized
        );
        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V21 AdFeedInfo-card error: " + e);
  }

  try {
    if (url === "https://i.video.qq.com/") {
      const candidates = [];

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

        if ((topCard || feedCard) && score >= 2) {
          candidates.push({
            tagPos: p,
            len: len,
            score: score,
            type: topCard ? "top" : "feed"
          });
        }
      }

      const seen = {};
      let removedCards = 0;

      for (const c of candidates) {
        if (seen[c.tagPos]) continue;
        seen[c.tagPos] = true;

        if (body[c.tagPos] === 0x0a) {

          body[c.tagPos] = 0x7a;
          removedCards++;

          console.log(
            "TencentVideo V21 removed MVL ad card: type=" +
            c.type +
            ", len=" +
            c.len +
            ", score=" +
            c.score
          );
        }
      }

      if (removedCards > 0) {
        console.log("TencentVideo V21 removed MVL cards: " + removedCards);
        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V21 MVL-card error: " + e);
  }

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
          "TencentVideo V21 suppressed getAdDetail payload: len=" +
          best.len +
          ", score=" +
          best.score
        );

        $done({ body });
        return;
      }
    }
  } catch (e) {
    console.log("TencentVideo V21 getAdDetail error: " + e);
  }

  try {
    let renamed = 0;

    const innerAdTypePairs = [
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.InnerAdPromotionEventList",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XnnerAdPromotionEventList"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.InnerAdPullRefreshEventList",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XnnerAdPullRefreshEventList"
      ],
      [
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.InnerAdPullRefreshExtraDisplayInfo",
        "type.googleapis.com/com.tencent.qqlive.protocol.pb.XnnerAdPullRefreshExtraDisplayInfo"
      ]
    ];

    const hasCompleteInnerAdGroup =
      containsText(body, 0, body.length, innerAdTypePairs[0][0]) &&
      containsText(body, 0, body.length, innerAdTypePairs[1][0]) &&
      containsText(body, 0, body.length, innerAdTypePairs[2][0]) &&
      containsText(body, 0, body.length, "ad.pull");

    if (hasCompleteInnerAdGroup) {
      for (const pair of innerAdTypePairs) {
        v17InnerAdTypes += replaceAllSameLength(body, pair[0], pair[1]);
      }

      v17InnerAdTypes += replaceAllSameLength(body, "ad.pull", "xx.pull");
    }

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

    if (
      renamed > 0 ||
      v16PromoCards > 0 ||
      v16InnerAdEnvelopes > 0 ||
      v17InnerAdTypes > 0 ||
      v18PersonalCenterAds > 0 ||
      v19PersonalRewardModules > 0 ||
      v21PersonalAdCounts > 0
    ) {
      console.log(
        "TencentVideo V21 final: fallback=" +
        renamed +
        ", iwanCards=" +
        v16PromoCards +
        ", innerAd=" +
        v16InnerAdEnvelopes +
        ", innerAdTypes=" +
        v17InnerAdTypes +
        ", personalCenterAds=" +
        v18PersonalCenterAds +
        ", personalRewardModules=" +
        v19PersonalRewardModules +
        ", personalAdCounts=" +
        v21PersonalAdCounts
      );
      $done({ body });
    } else {
      $done({});
    }
  } catch (e) {
    console.log("TencentVideo V21 fallback error: " + e);

    if (
      v16PromoCards > 0 ||
      v16InnerAdEnvelopes > 0 ||
      v17InnerAdTypes > 0 ||
      v18PersonalCenterAds > 0 ||
      v19PersonalRewardModules > 0 ||
      v21PersonalAdCounts > 0
    ) {
      $done({ body });
    } else {
      $done({});
    }
  }
})();

