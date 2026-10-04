# 译读 · PDF 翻译阅读器

源码仓库：[yaoguaiyu123/Rosetta](https://github.com/yaoguaiyu123/Rosetta)。

在本机运行、通过浏览器使用的 PDF 阅读与翻译工具。Vue 3 提供界面，PDF.js 显示文档；全文翻译由 PDFMathTranslate-next 完成解析、翻译和排版。

## 功能

- **划词翻译**：选中英文后流式显示中文，也可用 Ctrl + Enter 触发；支持编辑原文、重试与缓存。
- **全文翻译**：支持 40 页及以下的文字型 PDF，生成中文单版（mono）和中英对照版（dual）；支持进度、取消、复用及重新翻译。
- **阅读**：暗色界面、页面色调、虚拟滚动、页码跳转和适应宽度。划词模式显示 PDF 自带的书签目录，无书签时不生成目录。
- **缩放**：Ctrl + 滚轮或 Shift + 滚轮缩放 PDF；按钮每档 5%，范围 25%–300%。
- **本地启动**：Windows 可通过启动脚本或桌面快捷方式打开，无需注册账号。
- **模型配置**：使用自己的 API Key，支持 DeepSeek 和其他 OpenAI 兼容接口。

## 环境要求

- 推荐 **Node.js 24 LTS**，最低 22.13.0（由当前 PDF.js 和构建工具决定）。
- 首次安装全文翻译引擎需要 [uv](https://docs.astral.sh/uv/getting-started/installation/) 和网络连接。
- 安装脚本会准备独立 Python 3.12 环境、引擎、版面模型及字体，无需手动安装系统 Python。
- 当前验证平台为 Windows + Edge/Chrome。全文翻译使用 CPU，论文评估中引擎峰值内存约 2–3 GB，实际用量随文档变化。

## 快速开始

在项目根目录执行：

```sh
npm ci
npm run setup:engine
npm run build
npm run serve
```

只使用划词阅读时，可跳过 `setup:engine`；已安装全文引擎无需重复安装。

Windows 也可双击 `启动.bat`，它会检查环境、必要时构建并打开浏览器。创建桌面快捷方式：

```sh
npm run shortcut:desktop
```

移动项目目录后需重新创建快捷方式。详见 [桌面启动说明](docs/desktop-shortcut.md)。

## 配置翻译服务

打开右上角「设置」，填写接口地址、API Key 和模型，测试连接后保存。DeepSeek 的 Key 可在 [DeepSeek 平台](https://platform.deepseek.com/) 申请，其他服务需提供兼容接口。

也可将 `.env.example` 复制为 `.env` 后编辑。磁盘配置优先于浏览器设置，设置页面保存时会写回 `.env`。

| 配置 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 5199；占用时尝试其他端口 |
| `BASE_URL` | 接口地址，默认 `https://api.deepseek.com/v1` |
| `API_KEY` | 自己的 Key，模板中为空 |
| `MODEL` | 模型名；以服务商和连接测试返回的可用列表为准 |
| `TEMPERATURE` | 默认 0.3，部分模型可能不支持 |
| `REASONING` | 默认 `none`；不支持该参数时使用 `omit` |
| `TRIGGER` | `auto` 选中即翻，或 `shortcut` 使用 Ctrl + Enter |
| `DEBOUNCE_MS` | 自动翻译等待时间，默认 1000 毫秒 |
| `DEFAULT_ZOOM` | 初始缩放，默认 1.5 |
| `PAGE_TINT` | `none` / `green` / `yellow` / `sepia` |
| `OUTPUT_DIR` | 译本目录；为空时使用用户目录下的 `PDF译文` |
| `SYSTEM_PROMPT` | 划词提示词，留空使用内置值 |

模型名称、参数支持及计费由服务商决定。项目不提供共享密钥，也不提供离线文字翻译模型。

## 全文翻译与保存

1. 打开英文 PDF，切换到「全文翻译」。超过 40 页时不能启动全文翻译。
2. 有原文指纹匹配的完整配对时，点击「打开已有译本」，无需再次翻译。
3. 点击「翻译全文」生成 mono 和 dual 两份 PDF。本机服务同时运行一个全文任务。
4. 「中英对照」显示 `.dual.pdf`，每页左英右中；「只看中文」显示 `.mono.pdf`。对照版是单个 PDF，不是两个独立滚动窗格。
5. 切换显示方式或切回划词模式后再返回，会保留译本。点击「重新翻译」才绕过文字缓存重新生成；成功后替换配对，失败或取消保留原有结果。
6. 默认目录为 `%USERPROFILE%\PDF译文`。可自定义其他目录，不可用时回退到用户目录；界面显示实际保存位置，也可下载当前版本。

文件名包含原文 SHA-256 的前 16 位，索引保存完整指纹，不同内容的同名文件不会被视为同一份文档。旧排版方式生成的单一中文文件不能作为新引擎的完整配对复用。

## 隐私与费用

- 阅读、全文解析和排版在本机完成。**待翻译文字会发送到配置的模型服务**，费用由用户承担，服务商的数据政策适用于这些请求。
- 版面识别使用本地 ONNX 模型，它不负责文字翻译；首次安装需要下载软件、模型及字体。
- API Key 保存在本机 `.env`，浏览器 `localStorage` 也保存设置副本，均为明文。请勿分享真实配置、浏览器配置目录或含密钥的日志。
- 文字缓存位于用户目录的 `.cache/pdf2zh_next`，模型与字体位于 `.cache/babeldoc`；缓存可能包含文档文字及译文。
- 独立环境在 `.runtime/pdf2zh-next/.venv`，Python 和安装缓存在 `.runtime/python`、`.runtime/uv-cache`。任务临时文件位于 `.runtime/pdf2zh-next/jobs`，任务结束后清理。
- `.env`、运行环境、输出论文及临时文件不纳入 Git。项目为本机使用设计，不应直接暴露到公网或作为多用户服务部署。

## 已知限制

- 不提供扫描件 OCR；划词需要文字层，全文翻译主要面向可提取英文文字的论文。
- PDF 提取可能损坏数学符号，公式保护不能保证所有行内公式正确，请对照原文。
- 引擎采用原位排版，复杂多栏、表格、图内文字、题名、作者和参考文献仍可能被误识别或重排；关闭表格文字翻译不代表整张表格不变。
- 不保证统一增大中文字号，也不提供允许增页的自由重排模式。
- 不提供云同步，Linux/macOS 的启动和快捷方式尚未完成验证。

详见 [论文评估](docs/pdf2zh-next-evaluation.md)、[引擎接入](docs/engine-integration.md)、[阅读控制](docs/reader-controls.md)。评估译本不随源码发布。

## 开发

```sh
npm run dev           # 开发
npm run type-check    # 类型检查
npm run test:engine   # 全文任务、保存、复用、取消与回退测试
npm run test:reader   # 缩放测试
npm run build         # 同步 PDF.js 资源并构建
npm run audit:release # 当前受跟踪文件和本地 Git 对象的密钥候选检查
```

上述单元测试不调用外部模型。浏览器验收工具在 `.workbuddy/tools/`，请配合独立服务配置、浏览器配置目录和 mock 接口使用。`scripts/evaluate-pdf2zh-next.py --input <文件.pdf>` 会调用真实翻译服务并产生费用。

| 路径 | 用途 |
| --- | --- |
| `src/` | Vue 界面、PDF.js、划词翻译及设置 |
| `server.mjs`、`server/` | 本地服务、全文任务及配对保存 |
| `scripts/` | 资源同步、引擎安装、Python worker、快捷方式及发布检查 |
| `tests/` | 无需真实模型的回归测试 |
| `docs/` | 接入、评估与操作记录 |
| `licenses/` | 第三方原始许可及依赖清单 |

应用需通过本地 HTTP 服务运行，不能直接双击构建后的 `index.html`；模块 Worker 和 PDF.js 资源需要正确的来源与 MIME 类型。

## 许可证

本项目原创代码采用 **GNU AGPL v3，仅第 3 版（SPDX: AGPL-3.0-only）**，见 [LICENSE](LICENSE) 和 [COPYRIGHT](COPYRIGHT)。修改或分发时应保留许可与声明；修改版本通过网络提供交互时，须按 AGPL 第 13 条提供对应源码的获取方式。

第三方组件保留各自许可，见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。模型权重、字体及论文有各自许可，不因本项目许可证而自动变为 AGPL。

发布检查范围和历史隐私说明见 [发布检查记录](docs/release-audit.md)。
