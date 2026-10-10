# 可莉链接转换 · Surge

将**公开明文 Loon `.plugin`** 地址或 `loon://import?plugin=…` 安装链接，包装为 Script Hub Beta 的 Surge 转换地址，并提供一键导入。

**当前限制：**截至 2026-10-10，可莉现行插件中心使用 `.lpx` 地址。Script Hub 不能读取加密私有插件；本助手仅接受明文 `.plugin`，遇到 `.lpx` 会显示说明。更改文件后缀不能解密插件，也不能解决上游 403。没有可读取的明文源地址时，不能生成具有相同功能的 Surge 模块。

## 安装和使用

1. 在 Surge 的「模块」中从 URL 安装并启用：

   `https://raw.githubusercontent.com/Feng-Feng1/surge/main/Kelee-Link-Converter.sgmodule`

2. 启用 Surge「脚本」和「MITM」，安装并信任 MITM 证书。已有 Script Hub 稳定版时，将本模块调整到它之前，避免先匹配到旧引擎。
3. 保持 Surge 运行，用 Safari 打开 **http://kelee.surge/**。这是本模块返回的本地页面，必须使用 `http://`。
4. 粘贴作者公开的明文 `.plugin` 链接，点击「生成安装链接」，再点「导入 Surge」。也可复制生成的模块地址，在 Surge 中从 URL 安装。
5. 安装后的插件需要启用。本转换模块应保持启用，供插件安装、脚本加载和后续更新调用。

本模块已接入 Script Hub Beta 的插件、规则集和脚本转换路由，无需另装 Script Hub。输入框编辑后会清除旧结果，避免导入上一次的地址。HTTP 页面无法自动复制时，可长按已选中的文本复制。

## 功能边界

- 链接生成并不代表原插件已成功转换。下载和实际转换发生在 Surge 安装或更新时；上游必须可访问，且提供明文内容。
- 使用 Beta 引擎与 `jqEnabled=true`，以便处理新式 Loon 配置和 jq 重写。实际功能兼容性仍取决于 Script Hub 和 Surge 版本，不保证 Loon 专属功能可以等价转换。
- 保留源链接的查询参数和已有百分号编码；不自动迁移旧可莉域名。带 `#` 参数、账号密码、控制字符或 Script Hub 保留分隔符（`/_start_/`、`/_end_/`、`😂`）的地址暂不接受。
- 页面由原创脚本本地生成，无需访问或改写可莉插件中心；输入时不请求源地址、不保存输入。安装和更新时，Surge/Script Hub 才会读取源地址及相关资源。
- 不包含可莉插件正文，不镜像、爬取或分发插件中心内容。

## 来源和许可

- 可莉作者仓库与当前入口：https://github.com/luestr/ProxyResource 、https://hub.kelee.one/
- 转换引擎：https://github.com/Script-Hub-Org/Script-Hub
- `.lpx` 读取限制：https://github.com/Script-Hub-Org/Script-Hub/blob/main/Rewrite-Parser.beta.js
- Surge 安装协议：https://manual.nssurge.com/tools/url-scheme.html
- Surge 请求脚本：https://manual.nssurge.com/scripting/http-request.html

原创模块和页面采用 MIT 许可，见 `Licenses/Kelee-Link-Converter-MIT.txt`。远程加载的 Script Hub 脚本归原作者所有，遵守其 GPL-3.0 许可，本仓库不复制这些脚本。

验证范围：链接编码、输入拒绝、页面请求模拟与仓库静态检查；当前工作环境无法进行 iPhone 上的 Surge 原生安装和去广告效果测试。
