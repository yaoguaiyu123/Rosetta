# 桌面快捷方式与图标

## 使用

双击 Windows 桌面的「译读 PDF 阅读器」即可运行本项目的 `启动.bat`，服务窗口最小化，浏览器正常打开。需要停止服务时，可从任务栏打开该窗口并关闭。

图标保存在项目内，快捷方式引用绝对路径。移动项目后，在新的项目目录运行 `npm run shortcut:desktop`，即可创建对应新路径的快捷方式；脚本保留同名但指向其他位置的快捷方式。

脚本：`scripts/create-desktop-shortcut.ps1`，兼容 Windows PowerShell 5.1，带 UTF-8 BOM。通过系统桌面目录定位桌面，支持桌面被重定向到 OneDrive 等位置。创建后读回并验证启动路径、工作目录、图标及最小化状态。

## 图标

- [PNG 原图](../assets/desktop/reader.png)：透明背景，深绿底色、米白与鼠尾草绿书页，以 A／文和双向箭头表达中英阅读。
- [Windows ICO](../assets/desktop/reader.ico)：保留透明通道，包含 16、24、32、48、64、128、256 像素七种尺寸。
- 生成方式：内置 imagegen 工具。Pillow 仅用于将已生成图像转换为 Windows 多尺寸 ICO，不是重新绘制图标。

## 最终生成提示词

```text
Use case: logo-brand. Asset type: a single production Windows desktop app icon for a personal PDF translation reader named 译读. Create a square rounded-corner app tile floating on a truly transparent background, centered and filling about 90% of the image, with a deep graphite forest-green tile (#1a201d), a softly lit beveled edge and a clean very restrained dimensional finish. Main symbol: a large beautifully simplified open book made of two broad paper pages, left page warm ivory and right page muted sage green (#b9d6be). A bold simple letter A on the left page and the Chinese character 文 on the right page suggest English-to-Chinese reading, with a small simple horizontal exchange-arrow bridge near the bottom of the pages. Very clear silhouette, generous spacing, large forms and strong contrast that remain recognizable at 32 and 48 pixels. Front view, almost flat, premium quiet desktop productivity icon, coherent with a dark sage-green reading interface. No app name, no captions, no badge, no screenshot, no desktop mockup, no extra objects, no watermark. Transparent outside the rounded tile; preserve smooth alpha edges.
```
