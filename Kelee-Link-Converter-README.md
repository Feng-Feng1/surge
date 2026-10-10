# 可莉插件中心 · Surge 安装按钮

在可莉插件中心点击原有“安装”按钮，直接打开 Surge，并由 **Script Hub 官方 Beta** 下载和转换原插件。搜索或筛选后生成的按钮同样有效。

## 使用

1. 在 Surge「模块」中从 URL 安装并启用：
   https://raw.githubusercontent.com/Feng-Feng1/surge/main/Kelee-Link-Converter.sgmodule
2. 开启 Surge 的「脚本」和「MITM」，安装并信任 MITM 证书。如果已有 Script Hub 模块，把本模块放到它之前。
3. 保持 Surge 运行，用 Safari 打开 https://hub.kelee.one/?surge=2 ，点击任意插件的“安装”，即可跳到 Surge 安装。此参数用于避开之前缓存的首页。

网页存在本地缓存；第一次仍打开 Loon 时，刷新插件中心后再重新打开页面。这里仅在自己的浏览器页面中添加按钮跳转逻辑，没有保存或复制插件中心的页面及插件内容。

## 转换方式

按钮将 `loon://import?plugin=…` 中的原始 HTTP 地址交给 Script Hub，生成以下参数的转换链接：

`type=loon-plugin&target=surge-module&del=true&jqEnabled=true`

再通过 Surge 官方的 `surge:///install-module?url=…` 协议导入。下载、转换、兼容性提示均由 Script Hub 官方脚本处理，本模块不自行解析插件内容。使用官方 Beta 是为了支持 Loon Script v2。

本模块接入 Script Hub 官方的插件、规则及脚本转换路由，应保持启用，供安装及后续更新使用。实际可转换范围由 Script Hub 决定。

## 来源和许可

- [可莉插件中心](https://hub.kelee.one/)
- [Script Hub 官方项目](https://github.com/Script-Hub-Org/Script-Hub)
- [Surge 安装协议](https://manual.nssurge.com/tools/url-scheme.html)
- [Surge 响应脚本](https://manual.nssurge.com/scripting/http-response.html)

原创按钮跳转脚本与模块使用 MIT 许可，见 [许可证](Licenses/Kelee-Link-Converter-MIT.txt)。远程加载的 Script Hub 脚本遵循原项目 GPL-3.0 许可。

验证范围：真实插件中心页面的注入、动态按钮点击、链接编码及响应处理；当前环境不能进行 iPhone 上的原生 Surge 点击测试。
