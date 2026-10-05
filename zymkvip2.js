#!version=6.5.0-manual.df6d4cad713a
#!name=知音漫客VIP解锁
#!desc=解锁会员与付费章节，兼容 Surge，移除混淆与不兼容语法
#!author=改写自 @WeiGiegie
#!update=2025-10-27

[Script]
# 解锁会员信息接口
知音漫客-会员解锁 = type=http-response,pattern=^https?:\/\/apigate\.kaimanhua\.com\/zymk.+getuserinfo,requires-body=true, script-path=https://raw.githubusercontent.com/Feng-Feng1/surge/main/Resources/AdBlock/fb1f4d1bdc15d026f85da5228644fb979afbc0eee531523347b6690959815820.txt, timeout=10

# 解锁付费章节接口
知音漫客-章节解锁 = type=http-response,pattern=^https?:\/\/apigate\.kaimanhua\.com\/zymk.+paychapters,requires-body=true, script-path=https://raw.githubusercontent.com/Feng-Feng1/surge/main/Resources/AdBlock/fb1f4d1bdc15d026f85da5228644fb979afbc0eee531523347b6690959815820.txt, timeout=10

# 屏蔽广告接口
[URL Rewrite]
^https?://api-cdn\.kaimanhua\.com/advertiseapi/app/advertise/getappadvertise _ reject

[MITM]
hostname = %APPEND% apigate.kaimanhua.com, api-cdn.kaimanhua.com

