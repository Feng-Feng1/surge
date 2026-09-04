/*
 * Baidu Tieba Ad Filter Test V1
 *
 * HAR verified: 2026-09-04 23:49
 *
 * Dedicated ad endpoints only:
 *   /c/f/ad/getFeedAd   -> valid empty protobuf response
 *   /c/f/ad/getSplashAd -> preserve response envelope, clear data[]
 *
 * No shared image CDN, account, forum, thread or user API is modified.
 */

(function () {
  const url = ($request && $request.url) || "";

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

      console.log("Tieba V1: empty feed-ad protobuf returned");
      $done({ body: emptyFeed });
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

      console.log("Tieba V1: splash-ad list cleared");
      $done({ body: JSON.stringify(obj) });
      return;
    }

    $done({});
  } catch (e) {
    console.log("Tieba V1 error: " + e);
    $done({});
  }
})();
