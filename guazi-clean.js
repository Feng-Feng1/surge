let body = $response.body || "";

try {
  // 1. 删除移动端顶部广告
  body = body.replace(
    /<div[^>]*class=["'][^"']*mobile-comic-top-ad[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    ""
  );

  // 2. 删除 APP 专属阅读 / 下载卡片
  body = body.replace(
    /<section[^>]*class=["'][^"']*mobile-comic-app-card[^"']*["'][^>]*>[\s\S]*?<\/section>/gi,
    ""
  );

  // 3. CSS 兜底
  const css = `
<style id="guazi-clean-style">
.mobile-comic-top-ad,
.mobile-comic-app-card {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
}
</style>
`;

  if (/<\/head>/i.test(body)) {
    body = body.replace(/<\/head>/i, css + "</head>");
  } else {
    body = css + body;
  }

  $done({ body });
} catch (e) {
  console.log("Guazi Clean Error: " + e);
  $done({});
}
