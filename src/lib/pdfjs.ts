import * as pdfjsLib from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'

export { pdfjsLib }

/**
 * worker 必须是「原样提供的 module worker」。
 * pdf.js v6 内部固定执行 new Worker(workerSrc, { type: 'module' })，
 * 所以这个文件被放在 public/ 下原样发布，绝不能交给打包器转成 IIFE。
 */
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href

const CMAP_URL = new URL('cmaps/', document.baseURI).href
const STANDARD_FONT_URL = new URL('standard_fonts/', document.baseURI).href
const WASM_URL = new URL('wasm/', document.baseURI).href
const ICC_URL = new URL('iccs/', document.baseURI).href

/**
 * 这几个目录是 pdf.js 运行期按需 fetch 的资源，必须原样发布：
 *   cmaps          CJK 等编码表
 *   standard_fonts 非嵌入式字体（Type1 base14）
 *   wasm           JBIG2 / JPEG2000 / 色彩管理的编译产物
 *   iccs           预置 ICC 色彩配置（CMYK 图像需要）
 * 缺 wasmUrl 会看到 "Jbig2 failed to initialize"，那些图就渲染不出来；
 * 缺 iccUrl 只是 CMYK 图像不做色彩管理，通常无感。
 *
 * 注意：v6 里 PDFDocumentProxy 自身没有 destroy()，
 * 必须持有返回的 loading task 并调用它的 destroy()，
 * 否则 worker 会一直挂着。
 */
export function loadPdfDocument(data: Uint8Array) {
  return pdfjsLib.getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    wasmUrl: WASM_URL,
    iccUrl: ICC_URL
  })
}
