# 小米 MiMo 接入

在设置中点击「小米 MiMo」，填入自己在小米开放平台申请的 Key，测试连接、选择可用模型并保存。接口为 `https://api.xiaomimimo.com/v1`，示例模型 `mimo-v2.6-flash`；可修改为账号实际支持的文本模型。MiMo 使用独立的 `MIMO_API_KEY`、`MIMO_BASE_URL`、`MIMO_MODEL`、`MIMO_TEMPERATURE`、`MIMO_REASONING`；DeepSeek 对应 `DEEPSEEK_*`，不共用 Key。`ACTIVE_PROVIDER=mimo` 表示启用 MiMo。界面切换会恢复各自配置；取消设置不会修改已保存配置。

划词和全文翻译均使用 OpenAI 兼容协议及 Bearer 鉴权。默认显式发送 `thinking: {"type":"disabled"}`。开启思考时发送 `enabled`；MiMo 不接收 DeepSeek 的思考强度选项。选择「不发送此参数」时由服务商决定默认行为，可能开启思考。全文引擎通过其现有 `extra_body` 配置发送此参数，无需修改上游库。

MiMo 的 SDK 及流式协议已通过本地模拟接口验证。2026-10-15 经用户授权，使用临时测试 Key 完成官方模型列表、短词翻译和应用内 200 个英文单词的真实翻译；应用内切换及刷新后配置恢复成功，临时测试配置已清理。官方接口已检查允许浏览器从 localhost 跨域请求。模型可用性、费用和实际翻译质量需由用户的账号验证。

## 官方文档（2026-10-15 核对）

- [首次调用](https://mimo.mi.com/docs/quick-start/summary/first-api-call)
- [深度思考](https://mimo.mi.com/docs/quick-start/usage-guide/text-generation/deep-thinking)
- [OpenAI 兼容 API](https://mimo.mi.com/docs/api/chat/openai-api)
- [模型列表](https://mimo.mi.com/docs/api/model/list-models)

上述官网提供的原始文档索引为 https://mimo.mi.com/llms.txt 。
