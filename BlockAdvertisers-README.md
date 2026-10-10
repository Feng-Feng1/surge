# 广告平台拦截器 · Surge 转换快照

原作者：可莉。来源：`https://kelee.one/Tool/Loon/Lpx/BlockAdvertisers.lpx`。

原插件日期为 2026-10-02；本快照于 2026-10-10 通过官方 Script Hub Beta 转换。源文件虽以 `.lpx` 结尾，但使用转换器默认的 `User-Agent: script-hub/1.0.0` 下载后提供可读的明文配置，未进行解密。

## 安装

在 Surge「模块」中从 URL 安装并启用：

`https://raw.githubusercontent.com/Feng-Feng1/surge/main/Modules/BlockAdvertisers.sgmodule`

适用 Surge iOS 5.9.1+ 或 Mac 5.5.1+。启用「重写」及「MITM」，安装并信任 MITM 证书，才能执行拼多多广告请求的本地 404 响应。将此模块排在其他去广告模块之前，遵循原插件的顺序要求。

此成品不含脚本，也不依赖 Script Hub 或转换助手运行。它是转换时的规则快照，上游后续内容不会自动进入该文件。此插件主要拦截广告平台，不能保证单独消除所有应用的广告。

## 验证

- 346 条原始分流规则逐条保留，顺序和重复项一致。
- 4 条 Loon Script v2 Rewrite `request … reject(404)` 转换为 Surge `[Map Local]` 空正文 404 响应，保留原正则及大小写不敏感标志。
- 3 个 MITM 域名保持不变，并用 `%APPEND%` 追加。
- 官方 Beta 引擎转换没有兼容警告；已完成静态格式检查。尚未在 iPhone 或 Surge 原生程序上实测效果。

来源项目：[可莉资源库](https://github.com/luestr/ProxyResource)。转换引擎：[Script Hub](https://github.com/Script-Hub-Org/Script-Hub)。格式依据：[Surge Map Local](https://manual.nssurge.com/http/map-local.html)。
