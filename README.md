# Rosetta · 译读

在本机运行、通过浏览器使用的 PDF 阅读与翻译工具。支持划词翻译、全文中英对照，以及可以保存到 PDF 的文字高亮。

[下载 Release 便携版](https://github.com/yaoguaiyu123/Rosetta/releases) · [源码仓库](https://github.com/yaoguaiyu123/Rosetta) · [许可证](LICENSE)

> 只想使用：下载 Release 的 **Windows x64 完整便携版 ZIP**，解压后双击 `Rosetta.exe`。仅阅读 PDF 无需 API Key；翻译需填写自己的 Key 并联网。DeepSeek 和小米 MiMo 的配置分别保存，可直接切换。GitHub 自动生成的 **Source code ZIP 是源码，不是便携版**。

## 先分清你使用的版本

| | Release 便携版 | 源码版 |
| --- | --- | --- |
| 面向谁 | 想解压即用的 Windows 用户 | 想运行、修改或开发源码的用户 |
| 从哪里获取 | Releases 中的 `Rosetta-版本-windows-x64-portable.zip` | Git 克隆仓库，或下载 Source code |
| 如何启动 | 双击解压目录中的 `Rosetta.exe` | 安装依赖、构建后运行本地服务；也可用 `启动.bat` |
| 需要自己安装环境吗 | 不需要安装 Node.js、uv 或 Python，模型和字体已包含 | 需要 Node.js；全文翻译还需用 uv 准备引擎 |
| **真正使用的配置文件** | **EXE 同目录下的 `data/settings.env`** | **项目根目录下的 `.env`** |
| 界面里保存设置后写到哪里 | `data/settings.env` | `.env` |

**两种文件格式相同，位置不同。便携版不会读取根目录的 `.env`；把 Key 填在那里不会生效。** 以下配置路径均按默认启动方式说明，开发时可用 `--env` 指定其他文件。

## 目录

- [一、Release 便携版：解压即用](#一release-便携版解压即用)
- [二、源码版：安装与启动](#二源码版安装与启动)
- [三、配置 DeepSeek 或小米 MiMo](#三配置-deepseek-或小米-mimo)
- [四、阅读、翻译和高亮](#四阅读翻译和高亮)
- [五、文件位置、迁移和隐私](#五文件位置迁移和隐私)
- [六、常见问题](#六常见问题)
- [七、开发与打包](#七开发与打包)
- [八、许可证](#八许可证)

## 一、Release 便携版：解压即用

适用平台：**Windows 10/11 x64**，推荐使用 Edge 或 Chrome。

### 下载和启动

1. 打开 [GitHub Releases](https://github.com/yaoguaiyu123/Rosetta/releases)，选择需要的版本。
2. 下载名称包含 `windows-x64-portable.zip` 的完整便携包。
3. **完整解压**到可写文件夹，再双击 `Rosetta.exe`；不要在压缩包内直接运行。
4. 阅读器会在系统浏览器中打开。可直接打开 PDF 阅读；需要翻译时再配置 API Key。

不需要运行 npm 命令，不需要安装 Node.js、uv 或 Python，也不需要首次下载模型与字体。便携包较大，因为已包含这些运行文件。

### 便携版的配置在哪里？

```text
Rosetta-版本-windows-x64-portable/
├─ Rosetta.exe
├─ data/
│  ├─ settings.env    ← 唯一的便携版应用配置，首次启动自动创建
│  ├─ cache/          ← 模型、字体及翻译缓存
│  ├─ jobs/           ← 全文任务临时文件，运行时创建
│  └─ tmp/            ← 运行时临时文件
└─ source/            ← 随包提供的项目源码，普通用户无需操作
```

推荐在阅读器右上角的「设置」中填写并保存，程序会自动写入 `data/settings.env`。也可退出应用后手动编辑这个文件，再重新启动。

- 根目录的 `.env` **不参与便携版启动**。
- 新版启动器内置空 Key 的默认配置，根目录不再需要 `.env.example`。旧发布包可能仍带此模板，它也不是实际填写 Key 的位置。
- `source/.env.example` 属于随包提供的**源码模板**，不是便携版的配置入口。
- 可以在设置窗口的「配置文件」一项查看当前实际读取的完整路径。

### 怎样退出、迁移或升级？

- 关闭浏览器页面不会停止本地服务；在启动窗口或托盘菜单选择「退出 Rosetta」才会停止。
- 迁移时先退出，再移动**整个解压文件夹**。
- 升级时先解压新版本并退出旧版本。复制旧版的 `data/settings.env` 到新版同一位置，即可保留 API 设置；首次未启动过新版时，可自行创建 `data` 文件夹。
- 不要用旧 `data` 整体覆盖新版文件。模型、字体已经随新版提供；如需迁移其他缓存，请保留新版资源并单独处理。
- 默认输出的译本位于用户目录的 `PDF译文`，不在程序目录，迁移程序不会自动移动这些论文。

更多构建和许可细节见 [便携版说明](docs/portable-release.md)。

## 二、源码版：安装与启动

### 环境准备

- 推荐 **Node.js 24 LTS**，最低版本为 **22.13.0**；npm 随 Node.js 安装。
- 需要全文翻译时，先安装 [uv](https://docs.astral.sh/uv/getting-started/installation/)。引擎安装脚本会准备独立的 Python 3.12 环境，无需另行手动安装系统 Python。
- 首次安装依赖、引擎、模型和字体需要网络连接。

### 第一次运行

获取源码并准备环境。下面的命令会创建 `Rosetta` 文件夹；已有源码时，进入现有项目根目录，从 `npm ci` 开始：

```sh
git clone https://github.com/yaoguaiyu123/Rosetta.git
cd Rosetta
npm ci
npm run setup:engine
npm run build
npm run serve
```

| 命令 | 用途 | 什么时候运行 |
| --- | --- | --- |
| `npm ci` | 按锁定版本安装前端依赖 | 首次运行，或依赖变更后 |
| `npm run setup:engine` | 安装全文翻译环境并准备模型、字体 | 首次使用全文翻译；只有阅读和划词翻译时可跳过 |
| `npm run build` | 构建可运行的前端文件 | 首次运行，或更新前端源码后 |
| `npm run serve` | 启动本地服务并打开浏览器 | 每次使用时 |

准备完成后，日常只需在项目根目录执行 `npm run serve`，或双击 `启动.bat`。启动脚本负责检查 Node.js、必要时构建并启动服务；**它不代替首次的依赖安装和引擎准备**。更新源码后应重新运行 `npm run build`，避免继续使用旧构建结果。

运行 `npm run serve` 时，在服务终端按 Ctrl+C 可停止服务。

需要桌面快捷方式时执行 `npm run shortcut:desktop`；移动源码目录后需重新创建。详见 [桌面启动说明](docs/desktop-shortcut.md)。

### 源码版的配置在哪里？

```text
Rosetta/                    ← 克隆后的项目根目录
├─ package.json
├─ server.mjs
├─ 启动.bat
├─ .env.example             ← 源码版配置模板，Key 为空
└─ .env                     ← 源码版实际读取的配置
```

推荐在应用「设置」中填写后保存，程序会创建或更新根目录 `.env`。也可先复制模板再手动填写：

```powershell
Copy-Item .env.example .env
```

已有 `.env` 时直接编辑，不要重复用模板覆盖。手动改完配置后刷新阅读器；端口等启动参数变更需要重启服务。

不能直接双击 `dist/index.html` 使用：PDF.js 的模块 Worker 和资源需要通过本地 HTTP 服务加载。

## 三、配置 DeepSeek 或小米 MiMo

两种版本都推荐使用同一套界面操作：

1. 打开右上角「设置」，选择 **DeepSeek** 或 **小米 MiMo**。
2. 填入该服务商自己的 API Key。DeepSeek、MiMo、自定义接口分别保存 Key、地址、模型、温度和思考选项；切换会恢复各自设置，不覆盖其他服务商。
3. 点击「测试连接」，从返回的列表中选择可用的**文本模型**。
4. 点击「保存」。设置窗口会显示配置文件的实际位置。

| 服务商 | 默认接口地址 | 获取 API Key |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | [DeepSeek 开放平台](https://platform.deepseek.com/) |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | [小米 MiMo 开放平台](https://platform.xiaomimimo.com/#/console/api-keys) |

也支持手动填写其他 OpenAI 兼容接口。模型名称和权限以服务商及你的账号为准；Token Plan 等套餐请使用平台提供的专用接口和对应 Key。

DeepSeek 和 MiMo **默认关闭思考**。MiMo 使用 `thinking.type=disabled`，其他接口使用 `reasoning_effort=none`；选择「不发送此参数」后由服务商决定默认行为，可能开启思考。MiMo 接入细节见 [说明](docs/mimo.md)。

### 两家的 Key 怎么分别填写？

在同一份配置文件中使用不同前缀，`ACTIVE_PROVIDER` 决定当前启用谁：

```dotenv
ACTIVE_PROVIDER="mimo"

DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
DEEPSEEK_API_KEY=""
DEEPSEEK_MODEL="deepseek-flash"
DEEPSEEK_REASONING="none"

MIMO_BASE_URL="https://api.xiaomimimo.com/v1"
MIMO_API_KEY=""
MIMO_MODEL="mimo-v2.6-flash"
MIMO_REASONING="none"
```

填写各自的 Key 后，切换只需要修改 `ACTIVE_PROVIDER`，或在设置中选择服务商并保存。`CUSTOM_*` 为自定义接口的独立位置。温度分别使用 `DEEPSEEK_TEMPERATURE` 和 `MIMO_TEMPERATURE`。

旧版只有一组 `BASE_URL` / `API_KEY` / `MODEL` 的配置仍可读取；应用会按接口识别所属服务商，保存时迁移到对应前缀，不会把同一个 Key 自动分配给两家。便携版仍读取 `data/settings.env`，源码版仍读取根目录 `.env`。升级后可将旧配置文件复制到新版本相同位置，已有配置无需重新手工填写。

### 手动配置时的常用字段

下面这些字段适用于两种版本，但必须写入前文说明的**对应配置文件**。

| 字段 | 含义 |
| --- | --- |
| `DEEPSEEK_BASE_URL` / `MIMO_BASE_URL` | 各自的模型接口地址 |
| `DEEPSEEK_API_KEY` / `MIMO_API_KEY` | 各自的 API Key，不互相覆盖 |
| `DEEPSEEK_MODEL` / `MIMO_MODEL` | 各自账号可用的文本模型名 |
| `DEEPSEEK_REASONING` / `MIMO_REASONING` | `none` 关闭思考；`omit` 不发送思考参数 |
| `DEEPSEEK_TEMPERATURE` / `MIMO_TEMPERATURE` | 各自的温度，默认 0.3 |
| `ACTIVE_PROVIDER` | 当前使用 `deepseek` / `mimo` / `custom` |
| `OUTPUT_DIR` | 全文译本目录；留空使用用户目录下的 `PDF译文` |
| `TRIGGER` | `auto` 选中即翻，或 `shortcut` 按 Ctrl+Enter 翻译 |
| `DEBOUNCE_MS` | 选中后自动翻译的等待时间，默认 1000 毫秒 |
| `DEFAULT_ZOOM` | 打开 PDF 的初始缩放，默认 1.5，即 150% |
| `PAGE_TINT` | `none` 原色、`green` 护眼绿、`yellow` 淡黄、`sepia` 羊皮纸 |
| `SYSTEM_PROMPT` | 划词翻译提示词；留空使用内置值 |
| `PORT` | 源码服务的默认端口；便携启动器自动选择端口 |

**读取优先级：本地配置文件高于浏览器 `localStorage`。** 浏览器存储是副本和读取失败时的回退，不能用来判断你是否编辑了正确的文件。文件中明确写空的字段会覆盖浏览器里的旧值。

## 四、阅读、翻译和高亮

### 日常阅读与划词翻译

- 拖入或打开 PDF。划词模式下选中英文即可翻译，也可在设置中改成 Ctrl+Enter 触发。
- 显示 PDF 自带的书签目录；没有书签时不生成目录。
- Ctrl+滚轮缩放 PDF，也支持 Shift+滚轮。工具栏按钮每档 5%，范围 25%–300%。
- 可切换暗色界面下的页面色调、收起翻译栏、按窗口宽度缩放或输入页码跳转。

### 全文翻译

1. 打开英文 PDF，切换到「全文翻译」。仅支持 **40 页及以下、有文字层的 PDF**。
2. 检测到匹配的完整译本时，可「打开已有译本」继续阅读；否则点击「翻译全文」。
3. 引擎会生成两份 PDF：
   - **只看中文**：`.mono.pdf`。
   - **中英对照**：`.dual.pdf`，同一页左英右中，是一份 PDF，不是两个独立滚动窗口。
4. 切换阅读模式会保留当前译本；「重新翻译」会重新生成，成功后替换旧配对，失败或取消则保留旧结果。
5. 译本默认自动保存到 `%USERPROFILE%\PDF译文`。可在设置中自定义，不可写时回退到用户目录，界面会显示实际位置。

译本通过原文完整 SHA-256 指纹匹配，文件名包含指纹前 16 位；同名而内容不同的 PDF 不会混为一份。旧排版方式只生成的单个中文 PDF 不能作为新引擎的完整配对复用。本机服务同时运行一个全文任务。

### 高亮、擦除与保存

- 点击高亮工具，划选文字添加标准 PDF 高亮批注。
- 点击橡皮擦，再点击一条高亮即可擦除。两种编辑工具下不会自动触发划词翻译。
- **Ctrl+Z** 撤销上一步；**Ctrl+S** 或保存按钮才把编辑写入 PDF。
- 退出或刷新**不自动保存高亮**。保存后再撤销，也需要再次保存才能更新磁盘文件。
- 用 Edge/Chrome 的「打开 PDF」选择文件后，保存时可授权写回原文件；拖入文件或编辑译本时，首次保存通常需要选择位置，可选原文件覆盖。
- 浏览器不支持直接写入时，会下载编辑后的 PDF，并提示手动替换原文件。

**全文译本的自动导出，与高亮编辑的手动保存是两件独立的事。** 高亮保存在 PDF 内，保存后可用其他阅读器查看。详见 [高亮说明](docs/pdf-highlights.md)。

## 五、文件位置、迁移和隐私

| 内容 | Release 便携版 | 源码版 |
| --- | --- | --- |
| 应用配置 / API Key | `data/settings.env` | 项目根目录 `.env` |
| 模型、字体、CMap 等资源 | `data/cache/babeldoc` | 用户目录 `.cache/babeldoc` |
| 全文翻译文字缓存 | `data/cache/pdf2zh_next`，部分引擎缓存位于 `data/cache/babeldoc` | 用户目录 `.cache/pdf2zh_next`，部分引擎缓存位于 `.cache/babeldoc` |
| 全文任务临时文件 | `data/jobs`，任务结束后清理 | `.runtime/pdf2zh-next/jobs`，任务结束后清理 |
| 引擎运行环境 | `.runtime/portable-python` | `.runtime/pdf2zh-next/.venv` |
| 默认译本目录 | 用户目录的 `PDF译文` | 用户目录的 `PDF译文` |

- PDF 阅读、全文解析和排版在本机完成；**待翻译文字会发给你配置的模型服务**。模型和字体在本地不等于离线大模型翻译。
- 翻译需要联网，由服务商计费，项目不提供共享 Key。
- 配置文件和浏览器设置副本中的 Key 都是明文。不要分享真实配置、使用过的 `data` 文件夹或浏览器配置目录；文字缓存也可能含有论文内容。
- 源码版的 `.env`、运行环境、论文输出和临时文件已排除在 Git 之外。
- 当前程序面向本机使用，不应直接暴露到公网或作为多用户服务部署。

## 六、常见问题

### 填了 Key，重启后却显示未配置？

先查看设置窗口中的「配置文件」路径。便携版应编辑 `data/settings.env`，源码版应编辑项目根目录 `.env`；**便携版根目录的 `.env` 会被忽略**。再确认当前服务商对应的 Key 非空、模型名正确。401 表示 Key 未被服务商接受，通常需要检查是否填错、过期，或用了另一家的 Key。最简单的办法是在应用界面选择对应服务商，测试连接后保存。

### 关闭浏览器、关机后还需要重新填 Key 吗？

正常不需要。配置文件会保留，启动时自动读取。浏览器 `localStorage` 通常也能跨重启保留，但换浏览器、换端口或清除网站数据后可能读不到；本地配置文件仍是主要来源。

### 下载便携版后还需要运行 npm 命令吗？

不需要。完整解压后运行 `Rosetta.exe` 即可。如果你拿到的是 Source code ZIP，请重新下载 Release 中明确标为 portable 的附件。

### 翻译模型和字体都打包了，为什么还需要 API Key？

打包的 ONNX 模型负责识别页面布局，文字翻译由 DeepSeek、MiMo 或其他已配置的在线模型完成，两者用途不同。

### 为什么高亮退出后没了？

高亮不会自动保存。退出前按 Ctrl+S，并确认保存成功；若浏览器采用下载方式，请打开下载的那份 PDF。

### 全文翻译有哪些限制？

不支持扫描件 OCR。复杂多栏、表格、图内文字、题名、作者和参考文献仍可能被误识别或重排，行内公式也不能保证全部正确，需要对照原文。当前不提供允许增页的自由重排或统一增大中文字号。全文翻译使用 CPU，论文评估时引擎峰值内存约 2–3 GB，实际随文档变化。

Linux/macOS 的启动和快捷方式尚未完成验证。更多技术边界见 [论文评估](docs/pdf2zh-next-evaluation.md)、[引擎接入](docs/engine-integration.md) 和 [阅读控制](docs/reader-controls.md)。

## 七、开发与打包

前端使用 Vue 3 + PDF.js；全文处理使用 PDFMathTranslate-next，负责解析、调用翻译服务和排版。应用由本地 Node.js 服务提供页面及任务接口。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器，已接入本地配置和全文翻译接口 |
| `npm run type-check` | TypeScript 类型检查 |
| `npm run test:reader` | 缩放、高亮状态与模型协议测试 |
| `npm run test:engine` | 全文任务、保存、复用、取消与回退测试 |
| `npm run build` | 同步 PDF.js 资源并构建前端 |
| `npm run audit:release` | 检查受跟踪文件及本地 Git 对象中的密钥候选 |
| `npm run build:portable` | 在已准备好环境的 Windows 构建机生成完整便携目录 |

便携构建默认输出到源码目录的 `release`。可用 `npm run build:portable -- -OutputRoot <目录>` 指定其他输出目录。启动器将默认配置内置到 EXE，首次启动创建 `data/settings.env`；源码模板仍保留在源码内。

上面的回归测试不调用付费模型。浏览器验收工具位于 `.workbuddy/tools/`，应使用独立配置与模拟接口。`scripts/evaluate-pdf2zh-next.py --input <文件.pdf>` 会调用真实翻译服务并产生费用。

| 路径 | 用途 |
| --- | --- |
| `src/` | Vue 界面、PDF.js、划词翻译、高亮及设置 |
| `server.mjs`、`server/` | 本地服务、全文任务及译本保存 |
| `scripts/` | 资源同步、引擎安装、Python worker、快捷方式及打包 |
| `tests/` | 无需真实模型的回归测试 |
| `docs/` | 接入、评估与操作说明 |
| `licenses/` | 第三方原始许可及依赖清单 |

## 八、许可证

本项目原创代码采用 **GNU AGPL v3，仅第 3 版（SPDX: AGPL-3.0-only）**，见 [LICENSE](LICENSE) 和 [COPYRIGHT](COPYRIGHT)。修改或分发时应保留许可与声明；修改版本通过网络提供交互时，须按 AGPL 第 13 条提供对应源码获取方式。

第三方软件、模型权重、字体及论文保留各自许可，不会自动变为 AGPL。详见 [第三方许可说明](THIRD_PARTY_NOTICES.md) 和 [发布检查记录](docs/release-audit.md)。评估论文及译本不随源码发布。
