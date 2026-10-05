# 完整便携版

便携版支持 Windows 10/11 x64，使用系统自带的浏览器和 .NET Framework。下载 GitHub Releases 中的 `Rosetta-版本-windows-x64-portable.zip`，完整解压到可写文件夹，再双击 Rosetta.exe。无需安装 Node.js、uv 或 Python，模型及字体已经包含。首次使用只需在应用设置填写自己的 API Key 和模型。

这是浏览器阅读器配合本机启动器，不内置浏览器，不修改系统 PATH，不需要管理员权限，不注册服务或开机启动。配置、翻译缓存及任务临时文件位于解压目录的 data。译本仍默认输出到用户目录的 PDF译文，可在设置中自定义。

启动器会打开浏览器；关闭浏览器后，可在启动窗口或托盘菜单重新打开。退出启动窗口或托盘中的 Rosetta 会停止本次启动的服务及翻译子进程。移动文件夹前先退出；升级时退出旧版本并保留自己的 data，首次包中已包含版面资源。

翻译仍需要联网调用用户所配置的模型接口，便携版不是离线大模型翻译器。不要分享使用后的 data/settings.env 或翻译缓存。程序当前未使用付费代码签名，下载后可用 Release 提供的 SHA256SUMS.txt 核对文件。

## 打包与许可

构建机需要 npm 依赖、uv 已安装的 Python 3.12 和固定版本翻译引擎，以及暖启动下载完成的 BabelDOC 资源；用户不需要这些构建工具。

执行 `npm run build:portable`。打包脚本从官方源下载 Node.js 并核对 SHA-256，复制可重定位 CPython 与第三方依赖，排除虚拟环境绝对路径、个人配置、翻译缓存及字节码。每个模型、字体、CMap 和 tokenizer 文件按 BabelDOC 元数据核验 SHA3-256。

仅在便携包的副本中修改 PDFMathTranslate-next/BabelDOC 的配置和缓存路径，使其使用 data；源码 checkout 中的引擎保持原状。完整修改源码随包保留，补丁逻辑在 scripts/portable/build.py。

包内保留 Node.js、CPython、所有安装依赖的许可，以及各字体版权、SIL OFL、Naver 字体条款、Apache 模型卡、CMap 和 tokenizer 声明。AGPL/GPL 等组件的对应源码发行归档位于 source/third-party，项目源码及打包脚本位于 source。另行附带与实际运行版本匹配的 MuPDF 完整源码（包含其第三方源码）。

打包完成后运行 `node scripts/portable/verify.mjs <便携目录>`，验证启动器、实际 Python 引擎、完整资源、实际 PDF 输出和无外部翻译请求。验证必须使用假接口，不使用开发者 API Key。最后运行 `python scripts/portable/archive.py <便携目录>` 生成 ZIP 和 SHA-256 校验文件。

## 本次验证（2026-10-05）

- 将实际发行目录移到含中文和空格的新路径后，EXE 及其内置运行时正常启动。
- 测试进程 PATH 仅保留 Windows System32；不依赖机器上安装的 Node.js、Python 或 uv。
- 182 个模型、字体、CMap 和 tokenizer 资源全部通过 SHA3-256 校验。
- 实际 PDFMathTranslate-next 引擎在阻止非本机网络连接的条件下，通过本地假接口完成测试。生成 1 页中文 mono 和 1 页 dual，dual 宽度是 mono 的两倍，mono 可提取中文文字。
- 现有全文任务与缩放回归测试通过，新增便携路径测试通过；类型检查通过。
- 已检查当前配置 API Key 未进入源码或本地 Git 对象；归档前再次扫描完整发行目录。

以上测试在开发机上完成，使用隔离路径和清理后的命令搜索路径；未使用独立的干净 Windows 虚拟机，不宣称在所有 Windows 设备上已验证。
