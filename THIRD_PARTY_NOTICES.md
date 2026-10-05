# 第三方许可说明

本项目原创代码采用 AGPL-3.0-only，见 [LICENSE](LICENSE) 和 [COPYRIGHT](COPYRIGHT)。第三方作品保留其原有版权与许可；下列版本来自本次安装及锁文件，不改变上游声明中的版本适用范围。

## 核心组件

| 组件及来源 | 核对版本 | 上游许可声明 | 随附许可 |
| --- | --- | --- | --- |
| [PDFMathTranslate-next](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next) | 2.9.0 | AGPL-3.0 | [原文](licenses/PDFMathTranslate-next/LICENSE) |
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | 0.6.2 | AGPL-3.0 | [原文](licenses/BabelDOC/LICENSE) |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) | 1.25.2 | AGPL-3.0 | [原文](licenses/PyMuPDF/LICENSE) |
| [ONNX-Runtime](https://github.com/microsoft/onnxruntime) | 1.30.0 | MIT | [原文](licenses/ONNX-Runtime/LICENSE) |
| [python-dotenv](https://github.com/theskumar/python-dotenv) | 1.2.4 | BSD-3-Clause | [原文](licenses/python-dotenv/LICENSE) |
| [Vue](https://github.com/vuejs/core) | 3.5.43 | MIT | [原文](licenses/Vue/LICENSE) |
| [PDF.js](https://github.com/mozilla/pdf.js) | 6.3.289 | Apache-2.0 | [原文](licenses/PDF.js/LICENSE) |

PyMuPDF 安装包的 COPYING 仅写明 GNU AFFERO GPL 3.0，原样保留；AGPLv3 完整条款也可查阅项目根目录 LICENSE。其上游另有商业授权，本项目使用上述开源安装包。PDFMathTranslate-next 及 BabelDOC 安装元数据声明 AGPL-3.0，此处不将其重新许可为本项目的 only 变体。

ONNX Runtime 的内含组件另见 [原始第三方声明](licenses/ONNX-Runtime/ThirdPartyNotices.txt)。

## PDF.js 随附字体、解码器及色彩资源

PDF.js 总体使用 Apache-2.0，随附资源还保留各自声明。原始许可按安装包目录保存在 `licenses/PDF.js/standard_fonts`、`wasm` 和 `iccs` 中，包含 Foxit、Liberation、JBIG2、OpenJPEG、QCMS 等资源许可。构建同步脚本保留资源目录中的声明，并把项目许可说明和核心许可复制到构建产物的 `licenses/` 目录。请勿将总体 Apache 许可替代这些资源各自的许可。

## 完整依赖清单与分发

- [npm 锁文件依赖清单](licenses/npm-dependencies.json)：记录版本、许可元数据、运行或构建用途以及可选依赖。包含不一定在本平台安装的可选平台包；本次已安装包的根目录原始许可及 NOTICE 保存在 `licenses/npm/`，清单的 `licenseTexts` 字段指向这些文件。
- [Python 环境快照](licenses/python-environment.json)：本次安装环境的全部包、版本、许可元数据、分类器及声明的许可文件。实际部署时以安装版本为准。
- 清单是依赖来源记录，不能替代每个包的原始条款。除核心组件外，其余许可文本保存在相应安装包中；本源码仓库不捆绑 node_modules 或 Python 环境。
- 传递依赖还包括 MIT、BSD、Apache、MPL、GPL、LGPL、PSF、CNRI 等许可。若分发安装环境、可执行包、容器或改动第三方代码，应逐项保留版权与许可，并提供相应许可所要求的源码；不要直接把开发环境压缩当作发布包。

## 版面模型、字体与文档

全文引擎下载的版面权重来自 [DocLayout-YOLO-DocStructBench ONNX](https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx)，字体等资源来自 [BabelDOC-Assets](https://github.com/funstory-ai/BabelDOC-Assets)。这些大文件不纳入 Git 源码仓库。完整便携发行包包含未经修改的资源：已核实该 ONNX 模型卡声明 Apache-2.0；多数字体采用 SIL OFL 1.1，MaruBuri 使用 Naver 字体条款。便携包保留各字体嵌入版权和保留名称、原始许可、模型卡、Adobe CMap 与 tiktoken 许可，详见包内 licenses/PORTABLE-NOTICES.md。不能将引擎的软件许可替代资源各自的许可。

用户导入的论文、译本及翻译接口属于各自权利人或服务商，不纳入本项目原创代码授权。本仓库不附带论文和评估译本。

## 源码获取

上表链接指向第三方源码。分发修改后的项目或通过网络提供修改版本时，应提供与所运行版本对应的完整源码及构建、安装说明，遵守 AGPL 第 13 条等要求。本项目源码仓库为 [yaoguaiyu123/Rosetta](https://github.com/yaoguaiyu123/Rosetta)。分发修改版本时，仍应提供该修改版本的对应源码，而非仅指向本项目或第三方上游。
