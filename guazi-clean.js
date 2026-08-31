
/*
 * 瓜子漫画 Guazi Clean
 *
 * 功能：
 * 1. comic.php 详情页顶部广告
 * 2. chapter.php 阅读页顶部/底部广告
 * 3. 阅读页重复图片去重
 * 4. 自动恢复正确页数
 * 5. 重建跳页按钮
 * 6. 修复图片之间的空隙
 *
 * 原则：
 * - 正常章节没有重复图片时，不重建正文
 * - 不处理 img.guazicdn.com
 * - 出错直接返回原网页
 */

const url = $request.url || "";
let body = $response.body || "";

try {

  // ==========================================================
  // 公共函数
  // ==========================================================

  function injectStyle(css) {
    if (
      !body.includes('id="guazi-clean-fix"') &&
      /<\/head>/i.test(body)
    ) {
      body = body.replace(
        /<\/head>/i,
        '<style id="guazi-clean-fix">\n' +
          css +
          '\n</style>\n</head>'
      );
    }
  }


  function removeBlockByClass(className) {
    const re = new RegExp(
      '<div\\b[^>]*class=["\'][^"\']*\\b' +
        className +
        '\\b[^"\']*["\'][^>]*>[\\s\\S]*?<\\/div>',
      'gi'
    );

    body = body.replace(re, "");
  }


  // ==========================================================
  // 1. 漫画详情页 comic.php
  // ==========================================================

  if (/\/comic\.php(?:\?|$)/i.test(url)) {

    // 已确认源码中的：
    //
    // <div class="mobile-comic-top-ad">
    //   ...
    //   <img src="/assets/ad/ad1.gif">
    // </div>

    removeBlockByClass("mobile-comic-top-ad");
    removeBlockByClass("desktop-comic-top-ad");

    // 再删除明显的广告链接容器
    body = body.replace(
      /<a\b[^>]*href=["']https?:\/\/xhs794\.xhsqd12\.com[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
      ""
    );

    injectStyle(`
.mobile-comic-top-ad,
.desktop-comic-top-ad {
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
`);

    $done({
      body: body
    });

    return;
  }


  // ==========================================================
  // 2. 漫画阅读页 chapter.php
  // ==========================================================

  if (/\/chapter\.php(?:\?|$)/i.test(url)) {

    // ----------------------------------------------------------
    // 阅读页广告
    // ----------------------------------------------------------

    removeBlockByClass("mobile-reader-top-static-ad");
    removeBlockByClass("desktop-reader-top-ad");
    removeBlockByClass("mobile-reader-bottom-ad");
    removeBlockByClass("desktop-reader-bottom-ad");


    // 删除移动端顶部广告 JS
    body = body.replace(
      /<script\b[^>]*src=["']\/assets\/reader\/mobile-top-static-ad\.js[^"']*["'][^>]*><\/script>/gi,
      ""
    );


    // 删除移动端底部广告 JS
    body = body.replace(
      /<script\b[^>]*src=["']\/assets\/reader\/mobile-bottom-ad\.js[^"']*["'][^>]*><\/script>/gi,
      ""
    );


    // 删除 iOS 底部广告定位脚本
    body = body.replace(
      /<script\b[^>]*data-guazi-ios-ad-bottom[^>]*>[\s\S]*?<\/script>/gi,
      ""
    );


    // ==========================================================
    // 3. 找漫画正文
    // ==========================================================

    const sectionRE =
      /(<section\b[^>]*class=["'][^"']*\breader-images\b[^"']*["'][^>]*>)([\s\S]*?)(<\/section>)/i;

    const sectionMatch = body.match(sectionRE);


    if (sectionMatch) {

      const sectionContent = sectionMatch[2];

      const allImages =
        sectionContent.match(/<img\b[\s\S]*?>/gi) || [];


      // 只取正文图片
      const readingImages = allImages.filter(function (tag) {
        return /class=["'][^"']*\breading-image\b/i.test(tag);
      });


      if (readingImages.length > 0) {

        const chosen = {};
        let duplicateCount = 0;


        // ======================================================
        // 4. 分析图片
        // ======================================================

        readingImages.forEach(function (tag, index) {

          // 支持 src 和 data-src
          let srcMatch =
            tag.match(/\bsrc=["']([^"']+)["']/i);

          if (!srcMatch) {
            srcMatch =
              tag.match(/\bdata-src=["']([^"']+)["']/i);
          }


          let src = srcMatch ? srcMatch[1] : "";


          // 例如：
          //
          // /260817/303_123.webp

          const fileMatch = src.match(
            /\/(\d{6})\/([^/?#]+\.(?:webp|png|jpe?g))(?:[?#]|$)/i
          );


          let date = "000000";
          let filename = "";
          let pageNumber = index + 1;
          let dedupeKey = "__unknown_" + index;


          if (fileMatch) {

            date = fileMatch[1];
            filename = fileMatch[2];

            dedupeKey =
              filename.toLowerCase();


            // 优先从图片文件名获得页码：
            //
            // xxx_123.webp

            const numberMatch =
              filename.match(
                /_(\d+)\.(?:webp|png|jpe?g)$/i
              );


            if (numberMatch) {

              pageNumber =
                parseInt(numberMatch[1], 10);

            } else {

              // 文件名没有数字时
              // 尝试 data-page

              const dataPageMatch =
                tag.match(
                  /\bdata-page=["'](\d+)["']/i
                );

              if (dataPageMatch) {
                pageNumber =
                  parseInt(dataPageMatch[1], 10);
              }
            }
          }


          // 未识别图片：
          // 独立保留，不参与去重

          if (!fileMatch) {

            chosen[dedupeKey] = {
              date: date,
              filename: filename,
              number: pageNumber,
              index: index,
              tag: tag
            };

            return;
          }


          // 同 filename 已经出现
          if (chosen[dedupeKey]) {

            duplicateCount++;


            // 不同日期出现相同图片时
            // 保留日期较新的版本

            if (date > chosen[dedupeKey].date) {

              chosen[dedupeKey] = {
                date: date,
                filename: filename,
                number: pageNumber,
                index: index,
                tag: tag
              };
            }

          } else {

            chosen[dedupeKey] = {
              date: date,
              filename: filename,
              number: pageNumber,
              index: index,
              tag: tag
            };
          }
        });


        // ======================================================
        // 5. 只有真正发现重复时才修
        // ======================================================

        if (duplicateCount > 0) {

          let pages =
            Object.keys(chosen)
              .map(function (key) {
                return chosen[key];
              })
              .sort(function (a, b) {

                if (a.number !== b.number) {
                  return a.number - b.number;
                }

                return a.index - b.index;
              });


          const count = pages.length;


          // 安全保护
          //
          // 极端异常时不执行正文重建

          if (
            count >= 2 &&
            count < readingImages.length
          ) {

            // ==================================================
            // 6. 重建图片
            // ==================================================

            const fixedImages =
              pages.map(function (page, index) {

                const n = index + 1;

                let tag = page.tag;


                // id="page-X"

                if (
                  /\bid=["']page-\d+["']/i.test(tag)
                ) {

                  tag = tag.replace(
                    /\bid=["']page-\d+["']/i,
                    'id="page-' + n + '"'
                  );

                } else {

                  tag = tag.replace(
                    /<img/i,
                    '<img id="page-' + n + '"'
                  );
                }


                // data-page

                if (
                  /\bdata-page=["']\d+["']/i.test(tag)
                ) {

                  tag = tag.replace(
                    /\bdata-page=["']\d+["']/i,
                    'data-page="' + n + '"'
                  );

                } else {

                  tag = tag.replace(
                    /<img/i,
                    '<img data-page="' + n + '"'
                  );
                }


                // class / active

                tag = tag.replace(
                  /class=["']([^"']*\breading-image\b[^"']*)["']/i,
                  function (_, cls) {

                    cls = cls
                      .replace(/\bis-active\b/gi, "")
                      .replace(/\s+/g, " ")
                      .trim();


                    if (n === 1) {
                      cls += " is-active";
                    }


                    return (
                      'class="' +
                      cls +
                      '"'
                    );
                  }
                );


                // loading

                if (
                  /\bloading=["'](?:eager|lazy)["']/i.test(tag)
                ) {

                  tag = tag.replace(
                    /\bloading=["'](?:eager|lazy)["']/i,
                    'loading="' +
                      (n <= 3 ? "eager" : "lazy") +
                      '"'
                  );

                } else {

                  tag = tag.replace(
                    /<img/i,
                    '<img loading="' +
                      (n <= 3 ? "eager" : "lazy") +
                      '"'
                  );
                }


                // alt 页码

                tag = tag.replace(
                  /第\d+页(?=["'])/gi,
                  "第" + n + "页"
                );


                return tag;

              }).join("\n");


            // 替换 reader-images

            body = body.replace(
              sectionRE,
              function (_, open, oldContent, close) {

                return (
                  open +
                  "\n" +
                  fixedImages +
                  "\n" +
                  close
                );
              }
            );


            // ==================================================
            // 7. 修正顶部 23 / 805
            // ==================================================

            body = body.replace(
              /(<button[^>]*class=["'][^"']*\breader-page-index\b[^"']*["'][\s\S]*?<span[^>]*data-current-page[^>]*>\d+<\/span>\s*\/\s*<span>)\d+(<\/span>)/gi,
              "$1" + count + "$2"
            );


            // ==================================================
            // 8. 图片页 805 页
            // ==================================================

            body = body.replace(
              /(<strong>\s*图片页\s*<\/strong>\s*<span>)\d+(\s*页\s*<\/span>)/gi,
              "$1" + count + "$2"
            );


            // ==================================================
            // 9. data-total-pages 等
            // ==================================================

            body = body.replace(
              /\bdata-total-pages=["']\d+["']/gi,
              'data-total-pages="' +
                count +
                '"'
            );


            body = body.replace(
              /\bdata-page-count=["']\d+["']/gi,
              'data-page-count="' +
                count +
                '"'
            );


            // JS totalPages

            body = body.replace(
              /((?:const|let|var)\s+totalPages\s*=\s*)\d+/gi,
              "$1" + count
            );


            // JSON totalPages

            body = body.replace(
              /("totalPages"\s*:\s*)\d+/gi,
              "$1" + count
            );


            body = body.replace(
              /("pageCount"\s*:\s*)\d+/gi,
              "$1" + count
            );


            // SEO

            body = body.replace(
              /本章共\d+张漫画图片/g,
              "本章共" +
                count +
                "张漫画图片"
            );


            // 只在章节页中修改
            body = body.replace(
              /"numberOfItems"\s*:\s*\d+/g,
              '"numberOfItems":' +
                count
            );


            // ==================================================
            // 10. 重建所有跳页按钮
            // ==================================================

            let buttons = "";

            for (
              let i = 1;
              i <= count;
              i++
            ) {

              buttons +=
                '<button type="button" ' +
                'data-page-jump="' +
                i +
                '" class="' +
                (i === 1 ? "active" : "") +
                '">' +
                i +
                "</button>\n";
            }


            body = body.replace(
              /(<div\b[^>]*class=["'][^"']*\bpage-list\b[^"']*["'][^>]*>)[\s\S]*?(<\/div>)/gi,
              "$1\n" +
                buttons +
                "$2"
            );


            console.log(
              "Guazi: " +
              readingImages.length +
              " -> " +
              count +
              " pages, removed " +
              duplicateCount +
              " duplicates."
            );
          }
        }
      }
    }


    // ==========================================================
    // 11. 阅读页面 CSS
    // ==========================================================

    injectStyle(`

/* 漫画正文无缝 */

.reader-images {
  gap: 0 !important;
  row-gap: 0 !important;
  column-gap: 0 !important;

  line-height: 0 !important;
  font-size: 0 !important;

  margin-top: 0 !important;
  margin-bottom: 0 !important;

  padding-top: 0 !important;
  padding-bottom: 0 !important;
}


/* 正文图片 */

.reader-images .reading-image {

  display: block !important;

  margin-top: 0 !important;
  margin-bottom: 0 !important;

  margin-left: auto !important;
  margin-right: auto !important;

  padding: 0 !important;

  border: 0 !important;

  vertical-align: top !important;
}


/* 阅读页广告 */

.mobile-reader-top-static-ad,
.desktop-reader-top-ad,
.mobile-reader-bottom-ad,
.desktop-reader-bottom-ad {

  display: none !important;
  visibility: hidden !important;

  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;

  margin: 0 !important;
  padding: 0 !important;

  overflow: hidden !important;
}

`);


    $done({
      body: body
    });

    return;
  }


  // ==========================================================
  // 不是瓜子详情/章节页
  // ==========================================================

  $done({});


} catch (e) {

  console.log(
    "Guazi Clean Error: " +
    e
  );


  // 出问题直接返回原网页
  // 避免脚本错误导致漫画打不开

  $done({});
}
