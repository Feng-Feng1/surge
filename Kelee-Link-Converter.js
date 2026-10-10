/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Feng-Feng1
 * Only changes installation-button navigation in the user's browser.
 * Plugin downloads and conversion are handled by official Script Hub scripts.
 */
'use strict';

function convertKeleeLink(input) {
  var source = String(input || '').trim();
  if (!source) throw new Error('安装链接为空。');
  if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error('链接包含无效字符。');

  // Recover the original resource from an existing Script Hub link, including
  // links that mistakenly embed a whole Loon installation scheme as the source.
  var wrapped = source.match(/^https?:\/\/script\.hub\/file\/_start_\/(.+?)\/_end_\/[^?]+(?:\?.*)?$/i);
  if (wrapped) source = wrapped[1];

  if (/^loon:\/\//i.test(source)) {
    // Decode the outer scheme parameter once only. Do not decode the source
    // URL again: %26 and %2B may be part of a signed URL or query value.
    var match = source.match(/^loon:\/\/import\/?\?plugin=(.+)$/i);
    if (!match) throw new Error('请使用 loon://import?plugin=… 链接，或直接粘贴 .plugin / .lpx 地址。');
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
  if (!/\.(?:plugin|lpx)$/i.test(filename)) throw new Error('请提供以 .plugin 或 .lpx 结尾的 Loon 插件地址。');
  if (/[\/\\]/.test(filename)) throw new Error('插件文件名不正确。');
  // These strings delimit Script Hub's embedded source-URL format.
  if (/\/_end_\/|\/_start_\/|%f0%9f%98%82/i.test(url.href)) {
    throw new Error('此源地址包含转换器保留分隔符，暂不支持。');
  }

  var outputName = filename.replace(/\.(?:plugin|lpx)$/i, '.sgmodule');
  var moduleURL = 'http://script.hub/file/_start_/' + url.href + '/_end_/' +
    encodeURIComponent(outputName) + '?type=loon-plugin&target=surge-module&del=true&jqEnabled=true';
  return {
    sourceURL: url.href,
    moduleURL: moduleURL,
    installURL: 'surge:///install-module?url=' + encodeURIComponent(moduleURL)
  };
}

function installKeleeJump() {
  if (window.__keleeSurgeJump) return;
  window.__keleeSurgeJump = true;
  // Delegation covers cards loaded later and cards rebuilt by search/filter.
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    var button = target && target.closest ? target.closest('a.plugin-install') : null;
    if (!button) return;
    var source = button.getAttribute('href') || '';
    if (!/^(?:loon:\/\/import\/?\?plugin=|https?:\/\/)/i.test(source)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      // Stay synchronous so Safari treats the Surge launch as a user action.
      window.location.href = convertKeleeLink(source).installURL;
    } catch (error) {
      window.alert('无法生成 Script Hub 安装链接：' + error.message);
    }
  }, true);
}

function rewriteKeleePage(body, headers) {
  var contentType = '';
  Object.keys(headers || {}).forEach(function (key) {
    if (/^content-type$/i.test(key)) contentType = String(headers[key]);
  });
  if (contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType)) return null;
  if (typeof body !== 'string' || !/<html(?:\s|>)/i.test(body) || !/<\/body\s*>/i.test(body) ||
      body.indexOf('id="kelee-surge-install"') !== -1) return null;
  var injection = '<script id="kelee-surge-install">\n' +
    convertKeleeLink.toString() + '\n' + installKeleeJump.toString() +
    '\ninstallKeleeJump();\n</script>\n';
  var changedHeaders = {};
  Object.keys(headers || {}).forEach(function (key) {
    if (!/^(?:content-length|content-encoding|etag|last-modified|cache-control|expires)$/i.test(key)) {
      changedHeaders[key] = headers[key];
    }
  });
  changedHeaders['Cache-Control'] = 'no-store';
  return {
    body: body.replace(/<\/body\s*>/i, function (closingTag) { return injection + closingTag; }),
    headers: changedHeaders
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { convertKeleeLink: convertKeleeLink, installKeleeJump: installKeleeJump, rewriteKeleePage: rewriteKeleePage };
}
if (typeof $done === 'function') {
  var changed = null;
  if (typeof $request !== 'undefined' && typeof $response !== 'undefined' &&
      /^https:\/\/hub\.kelee\.one\/(?:index\.html)?(?:\?.*)?$/i.test($request.url) &&
      Number($response.status) === 200) {
    changed = rewriteKeleePage($response.body, $response.headers);
  }
  $done(changed || {});
}
