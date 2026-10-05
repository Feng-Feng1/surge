/* SPDX-License-Identifier: MIT */
'use strict';
// Offline fixtures only. This does not emulate Surge's native HTTP engine.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function runRuntimeTests(root = path.resolve(__dirname, '..')) {
  const checks = [];
  let assertions = 0;
  const sources = new Map();
  const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  function normalized(value) {
    if (value === undefined) return undefined;
    if (value instanceof Uint8Array) return { binary: Array.from(value) };
    if (Array.isArray(value)) return value.map(normalized);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalized(entry)]));
    return value;
  }
  function source(file) {
    if (!sources.has(file)) sources.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
    return sources.get(file);
  }
  function sandbox(url, body, options = {}) {
    const calls = [];
    const globals = {
      Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, TextDecoder, TextEncoder, URL,
      $environment: { system: 'iOS', 'surge-version': '5.22.1' },
      $script: { type: options.requestOnly ? 'http-request' : 'http-response' },
      $request: { url, method: options.method || 'GET', headers: options.requestHeaders || {}, body: options.requestBody },
      $persistentStore: { read() { return null; }, write() { return true; } },
      $notification: { post() {} }, $httpClient: {},
      console: { log() {} }, setTimeout() { return 1; }, clearTimeout() {},
      $done(value) { calls.push(normalized(value)); }
    };
    if (options.argument !== undefined) globals.$argument = options.argument;
    if (!options.requestOnly) globals.$response = { status: options.status === undefined ? 200 : options.status, headers: options.responseHeaders || { 'Content-Type': 'application/json' }, body };
    return { globals, calls };
  }
  function replay(file, url, body, options) {
    const context = sandbox(url, body, options);
    new vm.Script(source(file), { filename: file }).runInNewContext(context.globals, { timeout: 3000 });
    equal(context.calls.length, 1, file + ' must finish exactly once');
    return context.calls[0];
  }
  async function check(name, action) { await action(); checks.push(name); }

  for (const file of ['guazi-clean.js', 'Guazi-Clean-V5.txt']) {
    const comic = 'https://www.guazimanhua.com/comic.php?id=1';
    const chapter = 'https://www.guazimanhua.com/chapter.php?id=1';
    await check(file + ': comic ad container removed and ordinary content retained', () => {
      const body = '<html><head></head><body><div class="mobile-comic-top-ad"><img src="/assets/ad/ad1.gif"></div><p id="normal">normal comic</p></body></html>';
      const result = replay(file, comic, body);
      ok(!result.body.includes('<div class="mobile-comic-top-ad">'));
      ok(result.body.includes('<p id="normal">normal comic</p>'));
      ok(result.body.includes('id="guazi-clean-fix"'));
      equal(Object.keys(result), ['body']);
    });
    await check(file + ': chapter ad scripts removed without changing unique reading images', () => {
      const images = '<section class="reader-images"><img class="reading-image" src="/260817/chapter_1.webp"><img class="reading-image" src="/260817/chapter_2.webp"></section>';
      const body = '<html><head></head><body><script src="/assets/reader/mobile-top-static-ad.js"></script><script src="/assets/reader/normal.js"></script><div class="mobile-reader-bottom-ad">ad</div>' + images + '</body></html>';
      const result = replay(file, chapter, body);
      ok(!result.body.includes('<script src="/assets/reader/mobile-top-static-ad.js">'));
      ok(!result.body.includes('<div class="mobile-reader-bottom-ad">'));
      ok(result.body.includes('<script src="/assets/reader/normal.js"></script>'));
      ok(result.body.includes(images));
    });
    await check(file + ': duplicate reading image removed and unknown image retained', () => {
      const body = '<html><head></head><body><section class="reader-images"><img class="reading-image" src="/260817/chapter_1.webp"><img class="reading-image" src="/260818/chapter_1.webp"><img class="reading-image" src="/260817/chapter_2.webp"><img class="reading-image" src="https://other.invalid/page"></section></body></html>';
      const result = replay(file, chapter, body);
      equal((result.body.match(/class="reading-image(?:\s|"|$)/g) || []).length, 3);
      ok(result.body.includes('/260818/chapter_1.webp'));
      ok(!result.body.includes('/260817/chapter_1.webp'));
      ok(result.body.includes('https://other.invalid/page'));
      ok(result.body.includes('chapter_2.webp'));
    });
    await check(file + ': unknown endpoint and unreadable binary pass through once', () => {
      equal(replay(file, 'https://www.guazimanhua.com/unmatched', '<p>normal</p>'), {});
      equal(replay(file, chapter, new Uint8Array([1, 2, 3])), {});
      replay(file, chapter, '');
    });
  }

  await check('Zymk: successful existing account fields and unknown content are preserved', () => {
    const input = { data: { Uname: 'original', isvip: 0, unknown: { preserve: true } }, keep: ['plain', 1] };
    const result = replay('zymk_surge.js', 'https://apigate.kaimanhua.com/zymk/getuserinfo', JSON.stringify(input));
    equal(JSON.parse(result.body), {
      data: { Uname: 'VIP用户', isvip: 1, unknown: { preserve: true }, vipdays: 9999, vipdate: 1, Uviptime: 9999999999999, Cgold: 999999, coins: 999999, Ulevel: 20, headpic: 'https://zdimg.lifeweek.com.cn/app/20240614/17183119665002415.jpg' }, keep: ['plain', 1]
    });
    equal(Object.keys(result), ['body']);
  });
  await check('Zymk: successful existing chapter status behavior is retained', () => {
    const input = { status: 7, chapters: [{ id: 1, title: 'normal' }], unknown: { preserve: true } };
    equal(JSON.parse(replay('zymk_surge.js', 'https://apigate.kaimanhua.com/zymk/paychapters', JSON.stringify(input)).body), { ...input, status: 0 });
    equal(replay('zymk_surge.js', 'https://apigate.kaimanhua.com/zymk/other', '{"normal":1}'), {});
  });
  await check('Zymk: empty, missing, binary, malformed and null chapter bodies pass through once', () => {
    for (const body of ['', undefined, null, new Uint8Array([123, 125]), '{bad json', 'null']) {
      equal(replay('zymk_surge.js', 'https://apigate.kaimanhua.com/zymk/paychapters', body), {});
    }
  });

  function exposeYouTube(file, options = {}) {
    const context = sandbox('https://youtubei.googleapis.com/youtubei/v1/browse', new Uint8Array(), options);
    const marker = 'try{Ki()}catch(l){console.log(String(l)),F.exit()}';
    const code = source(file);
    equal(code.split(marker).length, 2, 'Expected one reviewed YouTube entry point');
    // Only the in-memory test copy is instrumented. The real compiled adapter
    // and parameter/UA functions are exposed without the response entry point.
    const instrumented = code.replace(marker, 'globalThis.__adapter=F;globalThis.__ua=vi;globalThis.__params=ai;');
    vm.createContext(context.globals);
    new vm.Script(instrumented, { filename: file }).runInContext(context.globals, { timeout: 3000 });
    return context;
  }
  async function clientProbe(file, body, error, response, data) {
    const context = exposeYouTube(file);
    let callback, request, settlements = 0;
    context.globals.$httpClient.post = (options, completion) => { request = options; callback = completion; };
    const promise = context.globals.__adapter.fetch({ url: 'https://audit.invalid/client', method: 'POST', ...(body instanceof Uint8Array ? { bodyBytes: body } : { body }) });
    ok(typeof callback === 'function');
    let callbackError = null;
    try { callback(error, response, data); } catch (exception) { callbackError = exception.name; }
    const settled = await promise.then(value => {
      settlements++; context.globals.__adapter.exit(); return { kind: 'resolved', value: normalized(value) };
    }, failure => {
      settlements++; context.globals.__adapter.exit(); return { kind: 'rejected', error: String(failure) };
    });
    equal(callbackError, null, 'Surge callback must return without throwing');
    equal(settlements, 1, 'Client promise must settle once');
    equal(context.calls, [{}], 'Caller completion after settlement must happen once');
    return { settled, request: normalized(request) };
  }
  for (const file of ['YouTube-AdFilter.js', 'YouTube-AdFilter-V2.txt']) {
    await check(file + ': real Surge HTTP client error rejects safely and settles once', async () => {
      const result = await clientProbe(file, 'request body', 'offline-audit', null, null);
      equal(result.settled, { kind: 'rejected', error: 'offline-audit' });
      equal(result.request, { url: 'https://audit.invalid/client', body: 'request body', 'binary-mode': false });
    });
    await check(file + ': real Surge HTTP client text and binary success are retained', async () => {
      const headers = { 'Content-Type': 'application/octet-stream' };
      for (const body of ['text', new Uint8Array([1, 2, 3])]) {
        const result = await clientProbe(file, body, null, { status: 201, headers }, body);
        const binary = body instanceof Uint8Array;
        equal(result.settled, { kind: 'resolved', value: { status: 201, headers, [binary ? 'bodyBytes' : 'body']: normalized(body) } });
        equal(result.request, { url: 'https://audit.invalid/client', body: normalized(body), 'binary-mode': binary });
      }
    });
    await check(file + ': explicit ad-only parameters retain all four existing values', () => {
      const expected = { captionLang: 'off', blockUpload: false, blockImmersive: false, blockShorts: false };
      equal(normalized(exposeYouTube(file, { argument: JSON.stringify(expected) }).globals.__params()), expected);
    });
    await check(file + ': absent User-Agent and malformed response complete once', () => {
      equal(exposeYouTube(file).globals.__ua(), false);
      equal(replay(file, 'https://youtubei.googleapis.com/youtubei/v1/browse', new Uint8Array([255, 255, 255])), {});
      equal(replay(file, 'https://youtubei.googleapis.com/youtubei/v1/unmatched', new Uint8Array()), {});
    });
  }
  await check('YouTube: existing version-specific User-Agent classification is retained', () => {
    for (const [ua, legacy, v2] of [['YouTube music/1', true, true], ['YouTube/1', false, false], ['YouTube Music/1', false, true]]) {
      equal(exposeYouTube('YouTube-AdFilter.js', { requestHeaders: { 'User-Agent': ua } }).globals.__ua(), legacy);
      equal(exposeYouTube('YouTube-AdFilter-V2.txt', { requestHeaders: { 'user-agent': ua } }).globals.__ua(), v2);
    }
  });

  const feedURL = 'https://app.bilibili.com/x/v2/feed/index?device=synthetic';
  await check('Shared cleanup: modified JSON removes stale framing/validators and preserves duplicate cookies', () => {
    const headers = [
      { field: 'Content-Length', value: '9999' }, { field: 'cOnTeNt-LeNgTh', value: '9999' },
      { field: 'ETag', value: 'synthetic-tag' }, { field: 'Digest', value: 'synthetic-digest' },
      { field: 'Set-Cookie', value: 'synthetic-a' }, { field: 'Set-Cookie', value: 'synthetic-b' },
      { field: 'Content-Encoding', value: 'gzip' }, { field: 'Content-Type', value: 'application/json' }
    ];
    const input = '{"data":{"items":[{"is_ad":true},{"card_goto":"av","id":9223372036854775807,"ad_info":{"normal":true}}]}}';
    const result = replay('AdBlock-AppClean-V5.txt', feedURL, input, { argument: 'bili', responseHeaders: headers });
    equal(result.headers, headers.slice(4));
    equal(result.body, '{"data":{"items":[{"card_goto":"av","id":9223372036854775807,"ad_info":{"normal":true}}]}}');
  });
  await check('Shared cleanup: object header case variations preserve ordinary headers', () => {
    const headers = { 'cOnTeNt-LeNgTh': '9999', 'Content-MD5': 'synthetic', 'Content-Type': 'application/json', 'Set-Cookie': 'synthetic', 'X-Normal': 'keep' };
    const result = replay('AdBlock-AppClean-V5.txt', feedURL, '{"data":{"items":[{"is_ad":true},{"card_goto":"av"}]}}', { argument: 'bili', responseHeaders: headers });
    equal(result.headers, { 'Content-Type': 'application/json', 'Set-Cookie': 'synthetic', 'X-Normal': 'keep' });
    equal(JSON.parse(result.body), { data: { items: [{ card_goto: 'av' }] } });
  });
  await check('Shared cleanup: unchanged, malformed and non-JSON responses do not replace headers', () => {
    const headers = [{ field: 'Content-Length', value: '9999' }, { field: 'Set-Cookie', value: 'synthetic-a' }, { field: 'Set-Cookie', value: 'synthetic-b' }, { field: 'Content-Type', value: 'application/json' }];
    equal(replay('AdBlock-AppClean-V5.txt', feedURL, '{"data":{"items":[{"card_goto":"av","ad_info":{"normal":true}}]}}', { argument: 'bili', responseHeaders: headers }), {});
    equal(replay('AdBlock-AppClean-V5.txt', feedURL, '{bad json', { argument: 'bili', responseHeaders: headers }), {});
    equal(replay('AdBlock-AppClean-V5.txt', feedURL, '{"data":{"items":[{"is_ad":true}]}}', { argument: 'bili', responseHeaders: { 'Content-Type': 'image/png', 'Content-Length': '9999' } }), {});
  });
  return { passed: true, checks: checks.length, assertions, names: checks, scope: 'Offline synthetic VM and actual-adapter instrumentation; no network, HAR, previous source copies or mobile-runtime claims.' };
}

module.exports = { runRuntimeTests };
if (require.main === module) runRuntimeTests().then(result => console.log(JSON.stringify(result))).catch(error => { console.error('Runtime regression failed: ' + error.message); process.exitCode = 1; });
