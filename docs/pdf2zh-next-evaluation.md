# PDFMathTranslate-next 本机实测

日期：2026-10-01。分支：`feat/html-typesetting`。

## 结果

三篇论文全部页面已由 PDFMathTranslate-next 生成译本，每篇输出中文单版（mono）与左右对照版（dual），无水印。
输出目录：`tempPDF`。
未覆盖 `%USERPROFILE%\PDF译文` 中的旧译本，未替换 Vue3 应用的全文翻译逻辑。

以上为独立评估时的状态。后续应用已完成引擎接入，见 [接入记录](engine-integration.md)。

| 论文 | 页数（原文 / 单版 / 对照版） | 实测耗时 | 引擎报告峰值内存 |
| --- | --- | --- | --- |
| Identity Mappings in Deep Residual Networks，1603.05027v3 | 15 / 15 / 15 | 112.2 秒 | 2691.37 MB |
| Attention Is All You Need | 11 / 11 / 11 | 87.1 秒 | 2309.02 MB |
| Searching for MobileNetV3 | 11 / 11 / 11 | 124.3 秒 | 2080.67 MB |

对照版每页宽度为原文的两倍，原文在左、译文在右；不是交替页，也不是应用内的两个独立滚动窗格。
总耗时约 324 秒，不含首次安装与资源下载。耗时为脚本测得，内存来自引擎日志，未独立测量系统总内存峰值。

## 配置与版本

- Python 3.12.13；pdf2zh-next 2.9.0；BabelDOC 0.6.2；PyMuPDF 1.25.2；ONNX Runtime 1.30.0。
- ONNX CPU 版面识别；模型 `doclayout_yolo_docstructbench_imgsz1024.onnx`，约 75 MB。
- 项目现有 DeepSeek 接口，模型 `deepseek-flash`，关闭思考模式。
- 英文转中文；qps=2，翻译线程上限 4；表格文字翻译设置为关闭；关闭自动术语提取。
- API Key 仅从被 Git 忽略的 `.env` 读取，没有复制到脚本或提交。
- 用户明确同意三篇论文文字发送至 api.deepseek.com 并使用当前 API 配置产生费用。
- 三篇主翻译调用报告合计 207371 tokens，另外各有 67 tokens 的引擎检查；脚本还有一次短接口预检查。没有把 token 数换算成未经核实的实际费用。
- 引擎内部发生 23 / 12 / 11 次简单翻译回退，三篇均有 finish 事件；回退不代表相关公式已通过验证。

## 视觉检查与实际问题

渲染浏览全部 37 页的中文单版，重点放大检查公式、表格及 MobileNetV3 双栏页，并渲染原文重点页对照。文本提取仅作辅助，未进行每个公式、数字及每句译文的自动等价验证。

### 保留较好的部分

- 独立公式（如 ResNet 的递推、求和、梯度公式，Attention 的注意力公式与前馈公式）外观保留较好。
- 图片和表格线框大体保留原位置；MobileNetV3 第 3 页左栏两幅图没有被截成包含右栏正文的整页宽图片。
- MobileNetV3 第 2 页第 2 节保持在左栏、第 3 节保持在右栏，没有在成品视觉阅读中出现此前的跨栏排序问题。
- 本次六份 PDF 可重新打开，页数与页面尺寸符合所选输出方式。

### 尚未通过验收的部分

1. **标题、作者、机构被翻译。** ResNet 的作者改为中文；Attention 首页作者与机构窄区域出现混排、断行。这与项目要求不符。
2. **参考文献翻译并合并重排。** ResNet 第 15 页、Attention 第 10-11 页和 MobileNetV3 第 9-11 页均可观察到中文文献标题与原条目排版变化。
3. **关闭表格文字翻译不等于整张表格不变。** 如 ResNet 第 6、8 页，Attention 第 6、8、9 页以及 MobileNetV3 第 5 页表头和部分单元格仍被翻译。
4. **图内文字也可能被识别为可翻译段落。** ResNet 网络图、曲线图标签，MobileNetV3 第 3 页图内标题等被翻译；字体和间距随之变化。
5. **行内公式仍有错误。** MobileNetV3 第 3 页右栏原有 `DeltaAcc / |Deltalatency|` 分式被部分当成普通文字翻译，数学表达的外观和内容均未完整保留。左栏多目标公式仍有断行；ResNet 第 3-4 页行内分式/求和的间距、基线也需要继续检查。
6. **中文字号并未统一增大一至两号。** 本次采用原位排版默认策略，局部缩小，部分页面有较大段间空白；不能等同于允许增页的流式重排。

因此：**这批文件是原生引擎的评估样本，尚未达到项目正式译本标准。** 没有通过后处理隐藏引擎默认行为。

## 下载与缓存位置

- 独立环境及 Python 包：`.runtime\pdf2zh-next\.venv`。
- 独立 CPython 下载：`.runtime\python`。
- uv 下载缓存：`.runtime\uv-cache`。
- 版面模型、字体、CMap 和 tokenizer：`%USERPROFILE%\.cache\babeldoc`，本次预下载约 336 MiB。
- 翻译缓存数据库：`%USERPROFILE%\.cache\pdf2zh_next\cache.v1.db`。
- 安装包中的源码：`.runtime\pdf2zh-next\.venv\Lib\site-packages\pdf2zh_next` 与 `babeldoc`。
- 使用 PyPI 固定版本，没有单独克隆 GitHub 仓库。
- 完整安装版本快照：`.runtime\pdf2zh-next\installed-versions.txt`。
- 执行日志：`.runtime\pdf2zh-next\evaluation.log`；输出清单和 token 统计：`tempPDF\evaluation-manifest.json`。

## 复用

在项目根目录运行：

```powershell
& .runtime/pdf2zh-next/.venv/Scripts/python.exe scripts/evaluate-pdf2zh-next.py --input "论文.pdf"
```

使用 `--input "绝对路径.pdf"` 选择其他输入（可重复），`--output "目录"` 指定输出，`--pages 1-2` 做局部验收，`--warmup` 预下载资源。
重复运行可能覆盖同名评估译本并复用引擎翻译缓存；脚本拒绝超过 40 页的输入。
必要依赖见 `scripts/pdf2zh-next-requirements.txt`。

## 后续接入建议

方案可行，但应先基于引擎的版面中间表示增加保护策略，明确标题/作者区域、参考文献起始位置、完整图表区域，不把这些区域中的字符发送给翻译接口；不能只依赖提示词或现有 translate_table_text 开关。
行内公式保护要结合数学字体、上下标、二维结构和上下文，并为不确定区域提供原样保留及人工复核。

Vue3 保留 PDF.js 展示；通过项目本机服务调用独立 Python 引擎，提供进度、取消与结果文件。翻译峰值内存约 2-3 GB，适合按需启动引擎，并发 PDF 任务先限制为 1。
若坚持增大字号并允许增页，需要另行设计重排模式，不能假设该引擎默认原位排版就满足这一要求。

源码与许可：

- https://github.com/PDFMathTranslate-next/PDFMathTranslate-next
- https://github.com/funstory-ai/BabelDOC
- 安装包 pdf2zh-next 声明 AGPL-3.0；日后发布二次开发版本时应按其许可要求处理。
