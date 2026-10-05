/* SPDX-License-Identifier: MIT
 * Bilibili Splash AdClean 1.0.0 — Surge http-response, JSON only.
 * Independently implemented from these original-author endpoint/field references:
 * https://github.com/Biliverse/ADBlock/blob/1dbaef14d55006fb8c13d5b29dffb2977c10fa99/src/process/Response.mjs
 * https://github.com/Biliverse/ADBlock/blob/1dbaef14d55006fb8c13d5b29dffb2977c10fa99/template/surge.handlebars
 * https://github.com/app2smile/rules/blob/df6366a7024e0b3f0aa3510c5b791eea6f3cba89/js/bilibili-json.js
 * https://github.com/blackmatrix7/ios_rule_script/blob/5a61490ab88ddaff4e9dbd7740b881d75157a49f/script/startup/startup.js
 * Scope: the four known splash JSON endpoints on three exact app API hosts.
 * Keep initialization metadata, response status/headers, and unknown fields.
 * No message-text check, persistent storage, supplementary request, or account change.
 * MIT License — Copyright (c) 2026 Feng-Feng1 and contributors.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

(function () {
  "use strict";
  const pattern = /^https?:\/\/app\.(?:bilibili\.com|biliapi\.(?:net|com))\/x\/v2\/splash\/(list|show|brand\/list|event\/list2)\/?(?:\?[^#]*)?$/;
  const maxBodyCharacters = 2097152;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const container = value => value === null || typeof value === "object";

  // JSON.parse accepts large numeric literals but converts them to doubles.
  // Independently protect their original lexemes before parsing the working
  // copy. Check the original grammar first so numeric object keys and malformed
  // exponents cannot accidentally become valid JSON after token replacement.
  function losslessJSON(text) {
    const strings = new Set();
    JSON.parse(text, (key, value) => {
      // Only strings capable of colliding with our ASCII tokens need storage.
      // Avoid retaining all URLs, text values, and array-index keys in memory.
      if (key.indexOf("__BN") === 0) strings.add(key);
      if (typeof value === "string" && value.indexOf("__BN") === 0) strings.add(value);
      return value;
    });
    const prefix = "__BN";
    const literals = new Map(), parts = [];
    let position = 0, start = 0, nextToken = 0;
    while (position < text.length) {
      if (text[position] === '"') {
        position++;
        while (position < text.length) {
          if (text[position] === "\\") position += 2;
          else if (text[position++] === '"') break;
        }
      } else if (text[position] === "-" || /[0-9]/.test(text[position])) {
        const begin = position++;
        while (position < text.length && /[0-9.eE+\-]/.test(text[position])) position++;
        const raw = text.slice(begin, position);
        if (JSON.stringify(Number(raw)) !== raw) {
          if (literals.size >= 65536) throw Error("numeric token budget exceeded");
          let token;
          do { token = prefix + nextToken++ + "__"; } while (strings.has(token));
          literals.set(token, raw);
          parts.push(text.slice(start, begin), '"' + token + '"');
          start = position;
        }
      } else position++;
    }
    parts.push(text.slice(start));
    const value = JSON.parse(parts.join(""));
    parts.length = 0;
    strings.clear();
    function numeric(value) {
      if (typeof value === "number") return value;
      if (typeof value === "string" && literals.has(value)) return Number(literals.get(value));
      return undefined;
    }
    function stringify(value) {
      // Each token was checked against every decoded original key/value.
      // Replace complete JSON string tokens only. Quoted text inside ordinary
      // strings has escaped closing quotes and cannot match this expression.
      const tokenPattern = new RegExp('"' + prefix + '[0-9]+__"', "g");
      return JSON.stringify(value).replace(tokenPattern, token => {
        const key = token.slice(1, -1);
        return literals.has(key) ? literals.get(key) : token;
      });
    }
    return { value, numeric, stringify };
  }

  try {
    if (typeof $request === "undefined" || typeof $response === "undefined") { $done({}); return; }
    const match = pattern.exec($request.url || "");
    if (!match || $request.method !== "GET" || $response.status !== 200 ||
        typeof $response.body !== "string" || !$response.body.length ||
        $response.body.length > maxBodyCharacters) { $done({}); return; }

    const json = losslessJSON($response.body), body = json.value;
    if (!object(body) || json.numeric(body.code) !== 0 || !object(body.data)) { $done({}); return; }
    const data = body.data;
    const keys = ["account", "event_list", "preload", "show"];
    // A new scalar representation of a known container is an unknown schema.
    // Bypass the whole response rather than partially corrupting that schema.
    if (keys.some(key => own(data, key) && !container(data[key]))) { $done({}); return; }

    let changed = 0;
    const inventory = match[1] === "list" || match[1] === "brand/list";
    if (inventory) {
      if ((own(data, "list") && !Array.isArray(data.list)) ||
          (own(data, "keep_ids") && !Array.isArray(data.keep_ids)) ||
          (own(data, "max_time") && json.numeric(data.max_time) === undefined)) {
        $done({}); return;
      }
      // These arrays belong to the splash inventory, not normal app content.
      for (const key of ["list", "keep_ids"]) {
        if (Array.isArray(data[key]) && data[key].length) { data[key] = []; changed++; }
      }
      if (own(data, "max_time") && json.numeric(data.max_time) !== 0) { data.max_time = 0; changed++; }
    }

    // An already-empty show array is the existing Map Local success contract.
    // Leave that clean response unchanged; remove the shell when other splash
    // content is removed. Preload/event/account containers are removed whole.
    for (const key of keys) {
      if (!own(data, key)) continue;
      if (key === "show" && Array.isArray(data.show) && data.show.length === 0) continue;
      delete data[key]; changed++;
    }
    if (changed && own(data, "show")) delete data.show;

    if (changed) {
      console.log("Bilibili Splash AdClean: removed known splash fields=" + changed);
      $done({ body: json.stringify(body) });
    } else $done({});
  } catch (error) {
    // Do not log a request URL, response body, or parse-error excerpt.
    console.log("Bilibili Splash AdClean: unsupported response; kept original");
    $done({});
  }
})();
