/*
 * Baidu Tieba Ad Filter Test V2
 *
 * HAR verified: 2026-09-04 23:49
 *
 * Dedicated ad endpoints only:
 *   /c/f/ad/getFeedAd   -> valid empty protobuf response
 *   /c/f/ad/getSplashAd -> preserve response envelope, clear data[]
 *   /c/b/ad/adBid       -> valid empty protobuf response
 *
 * Mixed response, schema-confirmed field only:
 *   /c/f/excellent/personalized
 *     response.data field #9 is the ad message. Clean HAR responses carry the
 *     same field with length zero. V2 rebuilds only this field as empty when
 *     strong ad markers are present.
 *
 * Dedicated commerce promotion:
 *   /c/f/forum/shopGoodsFeed -> preserve envelope, clear shop_list[]
 *
 * No shared image CDN, account, forum, thread or user API is modified.
 */

(function () {
  const url = ($request && $request.url) || "";

  function readVarint(buf, pos) {
    let value = 0;
    let shift = 0;

    for (let i = 0; i < 10 && pos < buf.length; i++, pos++) {
      const b = buf[pos];
      value += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) return { value, next: pos + 1 };
      shift += 7;
    }

    return null;
  }

  function encodeVarint(value) {
    const out = [];
    let n = value;

    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);

    return new Uint8Array(out);
  }

  function joinBytes(parts) {
    let size = 0;
    for (const p of parts) size += p.length;
    const out = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  function asciiBytes(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  function containsBytes(buf, text) {
    const needle = asciiBytes(text);
    outer:
    for (let i = 0; i <= buf.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (buf[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  function parseFields(buf) {
    const fields = [];
    let pos = 0;

    while (pos < buf.length) {
      const start = pos;
      const tagInfo = readVarint(buf, pos);
      if (!tagInfo || tagInfo.value === 0) return null;
      const tag = tagInfo.value;
      const fieldNo = Math.floor(tag / 8);
      const wire = tag & 7;
      pos = tagInfo.next;
      let payloadStart = -1;
      let payloadEnd = -1;

      if (wire === 0) {
        const valueInfo = readVarint(buf, pos);
        if (!valueInfo) return null;
        pos = valueInfo.next;
      } else if (wire === 1) {
        pos += 8;
      } else if (wire === 2) {
        const lenInfo = readVarint(buf, pos);
        if (!lenInfo) return null;
        payloadStart = lenInfo.next;
        payloadEnd = payloadStart + lenInfo.value;
        pos = payloadEnd;
      } else if (wire === 5) {
        pos += 4;
      } else {
        return null;
      }

      if (pos > buf.length) return null;
      fields.push({ start, end: pos, tag, fieldNo, wire, payloadStart, payloadEnd });
    }

    return fields;
  }

  function emptyPersonalizedAdField(buf) {
    if (!(buf instanceof Uint8Array) || buf.length === 0) return null;
    const top = parseFields(buf);
    if (!top) return null;
    let changed = false;
    const topParts = [];

    for (const field of top) {
      if (field.fieldNo !== 2 || field.wire !== 2) {
        topParts.push(buf.slice(field.start, field.end));
        continue;
      }

      const data = buf.slice(field.payloadStart, field.payloadEnd);
      const inner = parseFields(data);
      if (!inner) return null;
      const innerParts = [];

      for (const item of inner) {
        const payload =
          item.wire === 2
            ? data.slice(item.payloadStart, item.payloadEnd)
            : null;

        const confirmedAd =
          item.fieldNo === 9 &&
          item.wire === 2 &&
          payload.length > 0 &&
          containsBytes(payload, "ad_source") &&
          containsBytes(payload, "ad_title") &&
          (containsBytes(payload, "pglstatp") ||
            containsBytes(payload, "ad_common") ||
            containsBytes(payload, "csjAPI"));

        if (confirmedAd) {
          innerParts.push(encodeVarint(item.tag));
          innerParts.push(new Uint8Array([0x00]));
          changed = true;
        } else {
          innerParts.push(data.slice(item.start, item.end));
        }
      }

      const newData = joinBytes(innerParts);
      topParts.push(encodeVarint(field.tag));
      topParts.push(encodeVarint(newData.length));
      topParts.push(newData);
    }

    return changed ? joinBytes(topParts) : null;
  }

  if (typeof $response === "undefined") {
    $done({});
    return;
  }

  try {
    if (
      /^https:\/\/tiebac\.baidu\.com\/c\/f\/ad\/getFeedAd(?:\?|$)/i.test(
        url
      )
    ) {
      /*
       * Tieba's successful protobuf envelope observed in every supplied
       * getFeedAd response:
       *
       *   field #1, length 6
       *     field #1 = 0
       *     field #2 = ""
       *     field #3 = ""
       *
       * Repeated field #2 ad items are intentionally omitted.
       */
      const emptyFeed = new Uint8Array([
        0x0a, 0x06, 0x08, 0x00, 0x12, 0x00, 0x1a, 0x00
      ]);

      console.log("Tieba V2: empty feed-ad protobuf returned");
      $done({ body: emptyFeed });
      return;
    }

    if (
      /^https:\/\/tiebac\.baidu\.com\/c\/b\/ad\/adBid(?:\?|$)/i.test(url)
    ) {
      const emptyBid = new Uint8Array([
        0x0a, 0x06, 0x08, 0x00, 0x12, 0x00, 0x1a, 0x00
      ]);
      console.log("Tieba V2: empty ad-bid protobuf returned");
      $done({ body: emptyBid });
      return;
    }

    if (
      /^https:\/\/tiebac\.baidu\.com\/c\/f\/excellent\/personalized(?:\?|$)/i.test(
        url
      )
    ) {
      const cleaned = emptyPersonalizedAdField($response.body);
      if (cleaned) {
        console.log("Tieba V2: personalized field #9 ad cleared");
        $done({ body: cleaned });
      } else {
        $done({});
      }
      return;
    }

    if (
      /^https:\/\/tiebac\.baidu\.com\/c\/f\/ad\/getSplashAd(?:\?|$)/i.test(
        url
      )
    ) {
      const body = $response.body;
      let obj;

      try {
        obj = JSON.parse(typeof body === "string" ? body : "");
      } catch (_) {
        obj = null;
      }

      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        obj = {
          ctime: "0",
          data: [],
          error_code: 0,
          logid: "",
          server_time: 0,
          time: Math.floor(Date.now() / 1000)
        };
      } else {
        obj.data = [];
        obj.error_code = 0;
      }

      console.log("Tieba V2: splash-ad list cleared");
      $done({ body: JSON.stringify(obj) });
      return;
    }

    if (
      /^https:\/\/tieba\.baidu\.com\/c\/f\/forum\/shopGoodsFeed(?:\?|$)/i.test(
        url
      )
    ) {
      const body = $response.body;
      const obj = JSON.parse(typeof body === "string" ? body : "");

      if (obj && obj.data && typeof obj.data === "object") {
        obj.data.shop_list = [];
        console.log("Tieba V2: forum shop promotion cleared");
        $done({ body: JSON.stringify(obj) });
      } else {
        $done({});
      }
      return;
    }

    $done({});
  } catch (e) {
    console.log("Tieba V2 error: " + e);
    $done({});
  }
})();
