# 瓜子漫画与腾讯视频的 Loon 插件

两份插件直接使用 Loon 原生配置和脚本 API，加载仓库已有去广告脚本，不依赖 Script Hub。

## 安装

需 Loon 3.5.1 (983) 或更新版本。进入 Loon 的插件管理，从 URL 添加并启用：

- 瓜子漫画：https://raw.githubusercontent.com/Feng-Feng1/surge/main/Loon/GuaziManhua.plugin
- 腾讯视频：https://raw.githubusercontent.com/Feng-Feng1/surge/main/Loon/TencentVideo-AdFilter.plugin

开启脚本、Rewrite 和 MitM，安装并在系统中信任 **Loon 自己的 MitM 证书**。相同接口已有其他去广告插件时，请避免同时启用重复脚本；Loon 同一请求或响应只运行第一条命中的 HTTP Script。

## 来源和对应关系

依据 `9dfe22c85592dd99d951a19d43e3b4a028a22cb0` 提交中的两个独立模块制作：

| 插件 | 原模块 | 直接复用的脚本 |
| --- | --- | --- |
| 瓜子漫画 | GuaziManhua.sgmodule | 原模块固定到 5fcbd533c94fc2632a11c46448859be16c91be61 的 guazi-clean.js |
| 腾讯视频 | TencentVideo-AdFilter.sgmodule | 当前来源提交中的 TencentVideo-PageClean-V1.txt、TenVideo-MVL-AdFilter-Test.js |

脚本 URL 固定到相应提交，保留原作者与脚本内许可证。今后脚本升级时需要明确更新插件中的提交版本。

瓜子保留原有 7 项域名规则、3 项广告资源拒绝，以及详情页/阅读页处理。腾讯保留 6 项域名规则、4 项广告素材的空正文 204 响应，以及首页/开屏和 getvinfo 请求、响应脚本。首页/开屏使用二进制正文，getvinfo 使用文本正文。

适配移除了 Surge 的 `extended-matching`、`%APPEND%`、`engine`、`max-size`、`script-update-interval` 配置项；MitM 列表的 IP 去掉 `:443` 端口标记，保留原主机。Loon 使用原生 `requires_body` 和 `binary_body_mode`。Loon 没有原模块的逐条 `max-size` 选项；腾讯首页/开屏脚本自身仍保留 2 MB 正文保护。

## 验证与范围

13 组离线样例检查通过：配置规则、URL 匹配、脚本来源和正文模式，以及 Loon API 上下文中的页面、播放数据和二进制响应处理。样例中的正常漫画图片、正常播放信息与未知响应均保留，脚本只结束一次。另用 Script Hub 官方解析器复核两份配置，未产生不兼容提示；运行时仍直接使用 Loon，不需要转换器。

没有进行 iPhone 真机去广告测试；实际效果受目标网站或腾讯视频版本、原脚本覆盖范围及其他启用插件影响。这里只移植两个原模块已有功能，不承诺移除所有广告，也不提供会员权益。

## 官方文档

- [Loon 插件](https://nsloon.app/docs/Plugin/)
- [Loon Script v2](https://nsloon.app/docs/Script/script_v2/)
- [Loon Script API](https://nsloon.app/docs/Script/script_api/)
- [Loon Rewrite](https://nsloon.app/docs/Rewrite/rewrite_v2/)
