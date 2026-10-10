# 可莉链接转换 · Surge

将**可读取明文的 Loon `.plugin` / `.lpx`** 地址或 `loon://import?plugin=…` 安装链接，包装为 Script Hub Beta 的 Surge 转换地址，并提供一键导入。也可粘贴已有 Script Hub 链接；若误把完整 Loon 安装协议放进源地址，会先提取真正的 HTTP 源地址。

**格式说明：**`.lpx` 后缀不能单独证明内容加密。2026-10-10 实测 `https://kelee.one/Tool/Loon/Lpx/BlockAdvertisers.lpx`：普通请求返回 403，而使用 Script Hub 自带的 `User-Agent: script-hub/1.0.0` 请求头返回 200，UTF-8 正文具有可读插件头和规则，因此可以交给 Beta 引擎转换。真正加密、没有可读配置的插件仍然不能转换；更改后缀不能解密。此助手不在输入阶段下载源文件，是否可读由安装时的转换引擎检查。

已转换的广告平台拦截器快照可直接安装：

`https://raw.githubusercontent.com/Feng-Feng1/surge/main/Modules/BlockAdvertisers.sgmodule`

## 安装和使用

1. 在 Surge 的「模块」中从 URL 安装并启用：

   `https://raw.githubusercontent.com/Feng-Feng1/surge/main/Kelee-Link-Converter.sgmodule`

2. 启用 Surge「脚本」和「MITM」，安装并信任 MITM 证书。已有 Script Hub 稳定版时，将本模块调整到它之前，避免先匹配到旧引擎。
3. 保持 Surge 运行，用 Safari 打开 **http://kelee.surge/**。这是本模块返回的本地页面，必须使用 `http://`。
4. 粘贴 `.plugin` / `.lpx` 源地址、Loon 安装链接或 Script Hub 链接，点击「生成安装链接」，再点「导入 Surge」。也可复制生成的模块地址，在 Surge 中从 URL 安装。
5. 安装后的插件需要启用。本转换模块应保持启用，供插件安装、脚本加载和后续更新调用。

本模块已接入 Script Hub Beta 的插件、规则集和脚本转换路由，无需另装 Script Hub。输入框编辑后会清除旧结果，避免导入上一次的地址。HTTP 页面无法自动复制时，可长按已选中的文本复制。

## 功能边界

- 链接生成并不代表原插件已成功转换。下载和实际转换发生在 Surge 安装或更新时；上游必须可访问，且提供明文内容。Script Hub 使用自己的请求头下载，普通浏览器访问返回 403 不一定代表它也下载失败。
- 使用 Beta 引擎与 `jqEnabled=true`，以便处理新式 Loon 配置和 jq 重写。实际功能兼容性仍取决于 Script Hub 和 Surge 版本，不保证 Loon 专属功能可以等价转换。
- 保留源链接的查询参数和已有百分号编码；不自动迁移旧可莉域名。带 `#` 参数、账号密码、控制字符或 Script Hub 保留分隔符（`/_start_/`、`/_end_/`、`😂`）的地址暂不接受。
- 页面由原创脚本本地生成，无需访问或改写可莉插件中心；输入时不请求源地址、不保存输入。安装和更新时，Surge/Script Hub 才会读取源地址及相关资源。
- 转换助手不包含插件中心副本；本仓库另提供用户指定 `BlockAdvertisers.lpx` 的 Surge 转换快照，保留作者与来源信息。

## 来源和许可

- 可莉作者仓库与当前入口：https://github.com/luestr/ProxyResource 、https://hub.kelee.one/
- 转换引擎：https://github.com/Script-Hub-Org/Script-Hub
- `.lpx` 读取限制：https://github.com/Script-Hub-Org/Script-Hub/blob/main/Rewrite-Parser.beta.js
- Surge 安装协议：https://manual.nssurge.com/tools/url-scheme.html
- Surge 请求脚本：https://manual.nssurge.com/scripting/http-request.html

原创模块和页面采用 MIT 许可，见 `Licenses/Kelee-Link-Converter-MIT.txt`。远程加载的 Script Hub 脚本归原作者所有，遵守其 GPL-3.0 许可，本仓库不复制这些脚本。

验证范围：链接编码、输入拒绝、页面请求模拟与仓库静态检查；当前工作环境无法进行 iPhone 上的 Surge 原生安装和去广告效果测试。
