// Portable Node 20 regression checks. Uses only synthetic endpoint/schema fixtures.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const splashFile = path.join(root, 'Bilibili-Splash-AdClean.js');
const viewFile = path.join(root, 'Bilibili-View-AdClean-V1.txt');
const splashSource = fs.readFileSync(splashFile, 'utf8');
const viewSource = fs.readFileSync(viewFile, 'utf8');
const splash = new vm.Script(splashSource, { filename: splashFile });
const view = new vm.Script(viewSource, { filename: viewFile });
const results = [];
function check(name, fn) { fn(); results.push({ name, passed: true }); }
function run(script, url, body, options = {}) {
  let calls = 0, result;
  const logs = [];
  const context = { Uint8Array, DataView, ArrayBuffer, console: { log: text => logs.push(String(text)) },
    $request: { url, method: options.method || 'GET' },
    $response: { status: options.status === undefined ? 200 : options.status,
      headers: options.headers || {}, body },
    $done: value => { calls++; result = value; } };
  if (options.noRequest) delete context.$request;
  if (options.noResponse) delete context.$response;
  script.runInNewContext(context, { timeout: 4000 });
  assert.equal(calls, 1, 'must finish once');
  // Serialized objects avoid VM-realm prototype differences; bytes stay bytes.
  return { result, logs };
}
function unchanged(output) { assert.deepEqual(Object.keys(output.result), []); }
function changed(output) { assert.equal(typeof output.result.body, 'string'); return JSON.parse(output.result.body); }
const primary = 'https://app.bilibili.com/x/v2/splash/list';
const fixture = message => ({ code: 0, message, ttl: 1,
  data: { max_time: 6, min_interval: 77, pull_interval: 1234, keep_ids: [1],
    list: [{ id: 1, thumb: 'https://example.com/splash.jpg' }],
    show: [{ id: 1, duration: 6 }], preload: { splash: [{ id: 2 }] },
    event_list: [{ id: 3 }], account: { splash: { id: 4 } },
    normal_init: { enabled: true, nested: ['preserved'], decimal: 1.25 },
    user_mid: '900719925474099312345' }, extra: { untouched: true } });
const hosts = ['app.bilibili.com', 'app.biliapi.net', 'app.biliapi.com'];
const routes = ['list', 'show', 'brand/list', 'event/list2'];
const positives = [];
for (const host of hosts) for (const route of routes) for (const scheme of ['https', 'http'])
  for (const tail of ['', '?test=fixture', '/?test=fixture']) {
    const url = `${scheme}://${host}/x/v2/splash/${route}${tail}`;
    positives.push(url);
    for (const message of ['0', 'OK', 'future-success-text']) check(`splash ${host} ${route} ${scheme} ${tail || 'no-query'} ${message}`, () => {
      const input = fixture(message), output = changed(run(splash, url, JSON.stringify(input)));
      for (const key of ['show', 'account', 'preload', 'event_list']) assert.equal(Object.hasOwn(output.data, key), false);
      assert.deepEqual(output.data.normal_init, input.data.normal_init);
      assert.deepEqual(output.extra, input.extra);
      assert.equal(output.message, message);
      assert.equal(output.data.user_mid, input.data.user_mid);
      assert.equal(output.data.min_interval, 77);
      assert.equal(output.data.pull_interval, 1234);
      if (route === 'list' || route === 'brand/list') {
        assert.deepEqual(output.data.list, []); assert.deepEqual(output.data.keep_ids, []); assert.equal(output.data.max_time, 0);
      } else {
        // Unspecified lists on the other two routes are preserved as unknown fields.
        assert.deepEqual(output.data.list, input.data.list);
        assert.deepEqual(output.data.keep_ids, input.data.keep_ids);
        assert.equal(output.data.max_time, input.data.max_time);
      }
      unchanged(run(splash, url, JSON.stringify(output)));
    });
  }
const negatives = [
  'https://app.bilibili.com/x/v2/splash/listed',
  'https://app.bilibili.com/x/v2/splash/showcase',
  'https://app.bilibili.com/x/v2/splash/brand/list/details',
  'https://app.bilibili.com/x/v2/splash/event/list20',
  'https://app.bilibili.com.evil.example/x/v2/splash/list',
  'https://evil.example/app.bilibili.com/x/v2/splash/list',
  'https://api.bilibili.com/x/v2/splash/list',
  'https://app.biliapi.net.evil.example/x/v2/splash/list',
  'https://app.bilibili.com/x/v2/feed/index?route=splash/list',
  'https://app.bilibili.com/x/v2/splash/list#fragment',
  'https://app.bilibili.com/x/v2/splash/list?fixture=1#fragment'
];
for (const url of negatives) check(`boundary ${url}`, () => unchanged(run(splash, url, JSON.stringify(fixture('OK')))));
const malformed = [undefined, '', '{', 'null', '[]', '{"code":-400,"data":{"show":[1]}}',
  '{"code":"0","data":{"show":[1]}}', '{"code":0,"data":null}', '{"code":0,"data":[]}',
  '{"code":0,"data":{"show":"unknown-representation","preload":[1]}}',
  '{"code":0,"data":{"show":[1],"list":{}}}',
  '{"code":0,"data":{"show":[1],"keep_ids":{}}}',
  '{"code":0,"data":{"show":[1],"max_time":"6"}}',
  '{"code":0,"data":{"unknown_field":{"banner":[{"ad":true}]}}}',
  new Uint8Array([123,125])];
malformed.forEach((body, i) => check(`unknown or malformed body ${i}`, () => unchanged(run(splash, primary, body))));
for (const status of [204, 301, 404, 500, '200', null]) check(`status ${status}`, () => unchanged(run(splash, primary, JSON.stringify(fixture('OK')), { status })));
for (const method of ['POST', 'OPTIONS', 'HEAD']) check(`method ${method}`, () => unchanged(run(splash, primary, JSON.stringify(fixture('OK')), { method })));
for (const field of ['noRequest', 'noResponse']) check(field, () => unchanged(run(splash, primary, '{}', { [field]: true })));
check('large splash response bypass', () => unchanged(run(splash, primary, ' '.repeat(2097153))));
for (const route of ['list', 'show']) check(`existing Map Local clean contract ${route}`, () => {
  const data = route === 'list' ? { max_time: 0, min_interval: 3600, pull_interval: 900, keep_ids: [], list: [], show: [], splash_request_id: '' } : { show: [], splash_request_id: '' };
  unchanged(run(splash, primary.replace('/list', `/${route}`), JSON.stringify({ code: 0, message: 'OK', ttl: 1, data })));
});
check('empty preload shell removed, normal initialization preserved', () => {
  const output = changed(run(splash, primary, '{"code":0,"data":{"preload":{},"show":[],"min_interval":17}}'));
  assert.deepEqual(output.data, { min_interval: 17 });
});
check('logs contain no URL, body or parse excerpt', () => {
  const out = run(splash, primary + '?credential=NEVER_LOG', '{"credential":"NEVER_LOG",INVALID');
  assert.equal(out.logs.some(line => /NEVER_LOG|credential|https:/.test(line)), false);
});
check('large numeric ad IDs removed while initialization raw lexemes survive', () => {
  const body = '{"code":0,"message":"OK","data":{"show":[{"adid":900719925474099312345}],"preload":{"accountid":9223372036854775807},"normal_init":{"large_integer":18446744073709551615,"negative_integer":-9223372036854775808,"huge_exponent":1e400,"negative_zero":-0,"precise_fraction":1.0000000000000001,"tiny_exponent":1e-400}}}';
  const output = run(splash, primary, body).result.body;
  assert.equal(typeof output, 'string');
  assert.equal(output.includes('"show"'), false);
  assert.equal(output.includes('"preload"'), false);
  for (const raw of ['18446744073709551615', '-9223372036854775808', '1e400', '-0', '1.0000000000000001', '1e-400']) assert.equal(output.includes(raw), true, raw);
  assert.equal(output.includes('__BN'), false);
});
check('numeric token collisions in escaped strings, values and keys avoided', () => {
  const body = '{"code":0,"data":{"show":[{"adid":18446744073709551615}],"normal_init":{"__BN0__":"__BN1__","escaped":"\\u005f\\u005fBN2__","quoted":"quote: \\"__BN3__\\"","real_id":9223372036854775807}}}';
  const output = run(splash, primary, body).result.body;
  const value = JSON.parse(output);
  assert.equal(value.data.normal_init.__BN0__, '__BN1__');
  assert.equal(value.data.normal_init.escaped, '__BN2__');
  assert.equal(value.data.normal_init.quoted, 'quote: "__BN3__"');
  assert.equal(output.includes('9223372036854775807'), true);
});
check('unknown schema with large numbers preserves original response bytes', () => unchanged(run(splash, primary, '{ "code": 0, "data": { "other": 1e400, "id": 18446744073709551615 } }')));
check('known empty response with noncanonical numbers remains untouched', () => unchanged(run(splash, primary, '{"code":0.0,"data":{"list":[],"keep_ids":[],"show":[],"max_time":-0,"normal_id":18446744073709551615}}')));
check('original invalid numeric grammar cannot be legalized by tokenization', () => {
  for (const body of ['{1e400:0,"code":0,"data":{"show":[1]}}', '{"code":0,"data":{"show":[1],"id":01e400}}', '{"code":0,"data":{"show":[1],"id":1e+}}']) unchanged(run(splash, primary, body));
});
check('changed output handles numeric code and duration lexemes', () => {
  const output = run(splash, primary, '{"code":0e400,"data":{"show":[1],"max_time":1e400,"normal_id":18446744073709551615}}').result.body;
  assert.equal(output.includes('"code":0e400'), true);
  assert.equal(output.includes('"max_time":0'), true);
  assert.equal(output.includes('18446744073709551615'), true);
});
check('pathological numeric-token count stays within bounded work', () => {
  const body = '{"code":0,"data":{"show":[1],"normal_init":[' + Array(65537).fill('1e1').join(',') + ']}}';
  unchanged(run(splash, primary, body));
});

function varint(n) { const out = []; do { const b = n & 127; n = Math.floor(n / 128); out.push(n ? b | 128 : b); } while (n); return Buffer.from(out); }
function field(no, payload) { payload = Buffer.from(payload); return Buffer.concat([varint(no * 8 + 2), varint(payload.length), payload]); }
function frame(payload, flag = 0) { const header = Buffer.alloc(5); header[0] = flag; header.writeUInt32BE(payload.length, 1); return new Uint8Array(Buffer.concat([header, payload])); }
const any = field(1, 'type.googleapis.com/bilibili.test.AdContent');
const ordinary = field(2, 'ordinary_video_metadata');
const retainedCM = field(1, 'unknown_cm_field');
const cm = Buffer.concat([retainedCM, field(3, any), field(5, field(1, any))]);
const payload = Buffer.concat([ordinary, field(7, cm)]);
const expected = frame(Buffer.concat([ordinary, field(7, retainedCM)]));
const rpc = 'https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View';
check('view identity frame unchanged fields preserved', () => {
  const output = run(view, rpc, frame(payload), { method: 'POST' });
  assert.deepEqual(Buffer.from(output.result.body), Buffer.from(expected));
});
for (const headers of [{ 'grpc-encoding': 'gzip' }, [{ field: 'Grpc-Encoding', value: ' GZip ' }]])
  check(`view gzip header ${Array.isArray(headers) ? 'array' : 'object'}`, () => {
    const output = run(view, rpc, frame(zlib.gzipSync(payload), 1), { method: 'POST', headers });
    assert.deepEqual(Buffer.from(output.result.body), Buffer.from(expected));
    assert.equal(output.result.headers, undefined, 'leave compression header for untouched compressed frames');
  });
check('view all-ad CM container removed', () => {
  const output = run(view, rpc, frame(Buffer.concat([ordinary, field(7, field(3, any))])), { method: 'POST' });
  assert.deepEqual(Buffer.from(output.result.body), Buffer.from(frame(ordinary)));
});
check('view mixed frames retain byte-identical untouched compressed frame', () => {
  const untouched = frame(zlib.gzipSync(ordinary), 1);
  const output = run(view, rpc, new Uint8Array(Buffer.concat([untouched, frame(payload)])), { method: 'POST', headers: [{ field: 'grpc-encoding', value: 'gzip' }] });
  assert.deepEqual(Buffer.from(output.result.body), Buffer.concat([untouched, expected]));
});
check('view unknown Any or schema preserved', () => unchanged(run(view, rpc, frame(Buffer.concat([ordinary, field(7, field(3, field(1, 'not a type URL')))])), { method: 'POST' })));
check('view compressed frame without encoding preserved', () => unchanged(run(view, rpc, frame(zlib.gzipSync(payload), 1), { method: 'POST' })));
check('view unsupported compression preserved', () => unchanged(run(view, rpc, frame(zlib.gzipSync(payload), 1), { method: 'POST', headers: [{ field: 'grpc-encoding', value: 'br' }] })));
check('view invalid gzip preserved', () => unchanged(run(view, rpc, frame(Buffer.from([1,2,3]), 1), { method: 'POST', headers: [{ field: 'grpc-encoding', value: 'gzip' }] })));
check('view unsupported flag preserved', () => unchanged(run(view, rpc, frame(payload, 2), { method: 'POST' })));
check('view truncated frame preserved', () => unchanged(run(view, rpc, new Uint8Array([0,0,0,0,99,0]), { method: 'POST' })));
check('view unknown RPC preserved', () => unchanged(run(view, rpc + 'Extra', frame(payload), { method: 'POST' })));
check('view oversized compressed decoded frame preserved', () => unchanged(run(view, rpc, frame(zlib.gzipSync(Buffer.alloc(8388609)), 1), { method: 'POST', headers: [{ field: 'grpc-encoding', value: 'gzip' }] })));
console.log(JSON.stringify({ suite: 'bilibili-cleaners', cases: results.length, passed: results.length }));
