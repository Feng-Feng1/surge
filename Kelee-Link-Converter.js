/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Feng-Feng1
 * Original local link helper. Conversion is performed by Script-Hub-Org.
 * This file contains no copied plugin-center pages or plugin contents.
 */
'use strict';

function convertKeleeLink(input) {
  var source = String(input || '').trim();
  if (!source) throw new Error('请先粘贴可莉的公开明文插件链接。');
  if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error('链接包含无效字符。');

  if (/^loon:\/\//i.test(source)) {
    // Decode the outer scheme parameter once only. Do not decode the source
    // URL again: %26 and %2B may be part of a signed URL or query value.
    var match = source.match(/^loon:\/\/import\/?\?plugin=(.+)$/i);
    if (!match) throw new Error('请使用 loon://import?plugin=… 链接，或直接粘贴 .plugin 地址。');
    source = match[1];
    if (/^https?%3a/i.test(source)) {
      try { source = decodeURIComponent(source); }
      catch (_) { throw new Error('Loon 安装链接的编码不完整，请重新复制。'); }
    }
  }

  if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error('链接包含无效字符。');
  if (!/^https?:\/\//i.test(source)) throw new Error('插件地址必须以 https:// 或 http:// 开头。');
  var url;
  try { url = new URL(source); }
  catch (_) { throw new Error('插件链接格式不正确，请重新复制完整地址。'); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('请使用不含账号密码的公开 HTTP 或 HTTPS 插件地址。');
  }
  if (url.hash) throw new Error('暂不支持含 # 参数的插件链接，请提供作者的明文源地址。');

  var filename;
  try { filename = decodeURIComponent(url.pathname.split('/').pop()); }
  catch (_) { throw new Error('插件文件名的编码不完整。'); }
  if (/\.lpx$/i.test(filename)) {
    throw new Error('此助手不支持 .lpx。可莉当前插件中心使用此格式；加密插件无法转换，请提供作者公开的明文 .plugin 链接。');
  }
  if (!/\.plugin$/i.test(filename)) throw new Error('请提供以 .plugin 结尾的公开明文 Loon 插件地址。');
  if (/[\/\\]/.test(filename)) throw new Error('插件文件名不正确。');
  // These strings delimit Script Hub's embedded source-URL format.
  if (/\/_end_\/|\/_start_\/|%f0%9f%98%82/i.test(url.href)) {
    throw new Error('此源地址包含转换器保留分隔符，暂不支持。');
  }

  var outputName = filename.replace(/\.plugin$/i, '.sgmodule');
  var moduleURL = 'http://script.hub/file/_start_/' + url.href + '/_end_/' +
    encodeURIComponent(outputName) + '?type=loon-plugin&target=surge-module&jqEnabled=true';
  return {
    sourceURL: url.href,
    moduleURL: moduleURL,
    installURL: 'surge:///install-module?url=' + encodeURIComponent(moduleURL)
  };
}

function startKeleePage() {
  var form = document.getElementById('converter');
  var input = document.getElementById('source');
  var message = document.getElementById('message');
  var result = document.getElementById('result');
  var output = document.getElementById('output');
  var install = document.getElementById('install');
  var copy = document.getElementById('copy');

  function resetResult() {
    result.hidden = true;
    output.value = '';
    install.removeAttribute('href');
    message.textContent = '';
    copy.textContent = '复制模块链接';
  }
  input.addEventListener('input', resetResult);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    resetResult();
    try {
      var links = convertKeleeLink(input.value);
      output.value = links.moduleURL;
      install.href = links.installURL;
      result.hidden = false;
      message.textContent = '链接已生成；安装时由 Script Hub 下载和转换原插件。';
    } catch (error) {
      message.textContent = error.message;
    }
  });
  copy.addEventListener('click', async function () {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(output.value);
      } else {
        // The helper is served over local HTTP; Safari's Clipboard API is
        // unavailable here. Keep a user-gesture copy fallback and manual select.
        output.focus();
        output.select();
        output.setSelectionRange(0, output.value.length);
        if (!document.execCommand('copy')) throw new Error('manual-copy');
      }
      copy.textContent = '已复制';
    } catch (_) {
      output.focus();
      output.select();
      output.setSelectionRange(0, output.value.length);
      message.textContent = '链接已选中，请长按复制。';
    }
  });
  try {
    var initial = new URL(window.location.href).searchParams.get('url');
    if (initial) input.value = initial;
  } catch (_) { /* The input remains usable without a query string. */ }
}

function keleePageHTML() {
  return '<!doctype html><html lang="zh-CN"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><title>可莉链接转换 · Surge</title>' +
    '<style>body{font:16px/1.65 system-ui,-apple-system,sans-serif;margin:0;background:#f4f5f8;color:#202534}' +
    'main{max-width:640px;margin:7vh auto;padding:28px;background:#fff;border-radius:20px}' +
    'h1{font-size:26px;margin:0 0 8px}p{color:#606979}label{display:block;font-weight:600;margin:24px 0 8px}' +
    'textarea{box-sizing:border-box;width:100%;min-height:112px;padding:14px;border:1px solid #b8c1d1;border-radius:12px;font:15px/1.5 system-ui;resize:vertical}' +
    'button,.action{display:inline-block;padding:11px 18px;border:0;border-radius:10px;background:#2465df;color:#fff;font:600 16px/1.4 system-ui;cursor:pointer;text-decoration:none;margin:12px 8px 0 0}' +
    '#copy{background:#e9eef9;color:#244980}#message{white-space:pre-wrap;overflow-wrap:anywhere}#output{min-height:140px;font-size:13px}' +
    '.note{font-size:14px;border-top:1px solid #e5e8ef;padding-top:18px;margin-top:26px}[hidden]{display:none!important}' +
    '@media(max-width:700px){main{margin:18px;padding:22px}}' +
    '@media(prefers-color-scheme:dark){body{background:#11151d;color:#edf1fb}main{background:#1b2230}p{color:#b6c1d6}textarea{background:#111823;color:#edf1fb;border-color:#4b5870}.note{border-color:#3b465b}#copy{background:#313e56;color:#d9e4ff}}' +
    '</style></head><body><main><h1>可莉链接转换</h1>' +
    '<p>将公开明文 Loon 插件链接转为 Surge 模块安装链接。</p>' +
    '<form id="converter"><label for="source">插件链接</label>' +
    '<textarea id="source" placeholder="https://…/Example.plugin 或 loon://import?plugin=…" autocomplete="off" autocapitalize="off" spellcheck="false" required></textarea>' +
    '<button type="submit">生成安装链接</button></form><p id="message" role="status" aria-live="polite"></p>' +
    '<section id="result" hidden><label for="output">Surge 模块链接</label><textarea id="output" readonly spellcheck="false"></textarea>' +
    '<a class="action" id="install">导入 Surge</a><button type="button" id="copy">复制模块链接</button></section>' +
    '<p class="note">可莉当前插件中心使用 .lpx；此助手仅支持公开明文 .plugin，加密插件无法转换。原地址失效、返回 403 或含 Loon 专属功能时，转换可能失败。<br>' +
    '安装后请保持本模块启用，并启用 Surge 的脚本和 MITM、安装并信任证书。<br>' +
    '链接在本页生成，原插件在安装和更新时由 Surge 下载。转换引擎：' +
    '<a href="https://github.com/Script-Hub-Org/Script-Hub">Script Hub Beta</a>。</p>' +
    '</main><script>' + convertKeleeLink.toString() + '\n' + startKeleePage.toString() + '\nstartKeleePage();</script></body></html>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { convertKeleeLink: convertKeleeLink, keleePageHTML: keleePageHTML };
}
if (typeof $done === 'function' && typeof $request !== 'undefined') {
  if (/^http:\/\/kelee\.surge(?:\/|\?|$)/i.test($request.url || '')) {
    $done({ response: {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      body: keleePageHTML()
    } });
  } else {
    $done({});
  }
}
