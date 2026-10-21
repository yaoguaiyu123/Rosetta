<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { loadPdfDocument, pdfjsLib } from '../lib/pdfjs'
import { loadOutline, type OutlineNode } from '../lib/outline'
import type { DocInfo, SelectionPayload } from '../types'
import { HighlightHistory, highlightFromQuads, containsHighlight, type Highlight } from '../lib/highlights'
import { pickSavePdf, downloadPdf, type PdfFileHandle } from '../lib/fileAccess'
import { pageRenderPlan, rasterEvictions, PREVIEW_CACHE_BYTES, PREVIEW_CACHE_PAGES } from '../lib/pageRenderCache'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{ scale: number; tint: string; navigation?: boolean; tool?: 'select' | 'highlight' | 'erase' }>(), { navigation: true, tool: 'select' })

const emit = defineEmits<{
  (e: 'update:scale', value: number): void
  (e: 'select', payload: SelectionPayload): void
  (e: 'loaded', info: DocInfo): void
  (e: 'outline', tree: OutlineNode[]): void
  (e: 'page-change', page: number): void
  (e: 'error', message: string): void
  (e: 'busy', value: boolean): void
  (e: 'file', file: File): void
  (e: 'pick'): void
  (e: 'edit-state', state: { dirty: boolean; canUndo: boolean; saving: boolean }): void
  (e: 'notice', message: string): void
  (e: 'saved', file: File): void
}>()

/** 页面之间与四周的留白 */
const PAD = 20
const GAP = 18
/** Two renders at a time; retained canvases and small previews cover rapid direction changes. */
const MAX_RENDER_TASKS = 2

const scrollEl = ref<HTMLDivElement | null>(null)
const doc = shallowRef<PDFDocumentProxy | null>(null)
const loadingTask = shallowRef<PDFDocumentLoadingTask | null>(null)
const numPages = ref(0)
/** 每页在 scale=1 下的真实尺寸，后台逐页探测填入 */
const sizes = reactive(new Map<number, { w: number; h: number }>())
/** 第一页尺寸，探测完其余页之前先用它排布 */
const fallback = ref<{ w: number; h: number } | null>(null)
const viewportWidth = ref(0)
const currentPage = ref(1)
const busy = ref(false)
const dragOver = ref(false)

interface PageRuntime {
  el: HTMLElement | null
  rendered: boolean
  rendering: boolean
  task: RenderTask | null
  layer: { cancel: () => void } | null
  /** 丢弃页面时自增，用来作废仍在飞行中的渲染结果 */
  gen: number
  canvas: HTMLCanvasElement | null
  scale: number
  bytes: number
  lastUsed: number
  pendingLayer: { cancel: () => void } | null
}

const runtimes = new Map<number, PageRuntime>()

function rt(n: number): PageRuntime {
  let r = runtimes.get(n)
  if (!r) {
    r = { el: null, rendered: false, rendering: false, task: null, layer: null, gen: 0, canvas: null, scale: 0, bytes: 0, lastUsed: 0, pendingLayer: null }
    runtimes.set(n, r)
  }
  return r
}

/** 全部页面的位置与尺寸。用绝对定位 + 一个撑高的内层容器实现虚拟滚动。 */
const layout = computed(() => {
  const f = fallback.value
  if (!f || numPages.value === 0) return []
  const out: { pageNumber: number; top: number; width: number; height: number }[] = []
  let top = PAD
  for (let i = 1; i <= numPages.value; i++) {
    const s = sizes.get(i) ?? f
    const width = Math.round(s.w * props.scale)
    const height = Math.round(s.h * props.scale)
    out.push({ pageNumber: i, top, width, height })
    top += height + GAP
  }
  return out
})

const totalHeight = computed(() => {
  const l = layout.value
  if (l.length === 0) return 0
  const last = l[l.length - 1]
  return last.top + last.height + PAD
})

/**
 * 每个页面上要挂的 CSS 变量。
 * pdf.js 的文字层靠这些变量算字号和层尺寸：
 *   .textLayer 的 font-size = calc(--total-scale-factor * --min-font-size * --font-height)
 * 所以改缩放只要改这几个变量，文字层本身不用重建。
 */
function pageStyle(p: { pageNumber: number; top: number; width: number; height: number }) {
  const center = Math.max(PAD, Math.round((viewportWidth.value - p.width) / 2))
  return {
    top: `${p.top}px`,
    left: `${center}px`,
    width: `${p.width}px`,
    height: `${p.height}px`,
    '--scale-factor': String(props.scale),
    '--user-unit': '1',
    '--total-scale-factor': String(props.scale),
    '--scale-round-x': '1px',
    '--scale-round-y': '1px'
  } as Record<string, string>
}

function bindPage(n: number, el: unknown) {
  rt(n).el = (el as HTMLElement | null) ?? null
}

// ---------------- Rendering with retained surfaces ----------------
interface Preview { canvas: HTMLCanvasElement; bytes: number }
const previews = new Map<number, Preview>()
let lastUse = 0
let activeRenders = 0
let renderQueue: number[] = []
let wantedPages = new Set<number>()
let visiblePages = new Set<number>()
let lastScrollTop = 0
let scrollMotion = 0
let destroyed = false

function cancelRender(r: PageRuntime) {
  r.gen++
  try { r.task?.cancel() } catch { /* already finished */ }
  try { r.pendingLayer?.cancel() } catch { /* already finished */ }
  r.task = null; r.pendingLayer = null; r.rendering = false
}
function clearPreview(n: number) {
  const preview = previews.get(n)
  if (!preview) return
  if (preview.canvas.parentElement) preview.canvas.remove()
  preview.canvas.width = preview.canvas.height = 0
  previews.delete(n)
}
function trimPreviews() {
  let bytes = [...previews.values()].reduce((total, p) => total + p.bytes, 0)
  for (const [n, p] of previews) {
    if (previews.size <= PREVIEW_CACHE_PAGES && bytes <= PREVIEW_CACHE_BYTES) break
    if (visiblePages.has(n)) continue
    bytes -= p.bytes; clearPreview(n)
    const r = runtimes.get(n)
    if (r?.el && !r.canvas) delete r.el.dataset.visual
  }
}
function keepPreview(n: number, canvas: HTMLCanvasElement) {
  clearPreview(n)
  const ratio = Math.min(1, 320 / canvas.width, 420 / canvas.height)
  const preview = document.createElement('canvas')
  preview.width = Math.max(1, Math.round(canvas.width * ratio)); preview.height = Math.max(1, Math.round(canvas.height * ratio))
  preview.className = 'pdf-preview'
  preview.getContext('2d')?.drawImage(canvas, 0, 0, preview.width, preview.height)
  previews.set(n, { canvas: preview, bytes: preview.width * preview.height * 4 })
  return preview
}
function evictRaster(n: number) {
  const r = runtimes.get(n)
  if (!r?.canvas || r.rendering) return
  const preview = keepPreview(n, r.canvas)
  try { r.layer?.cancel() } catch { /* already finished */ }
  r.layer = null
  const tint = document.createElement('div'); tint.className = 'pdf-tint'
  r.el?.replaceChildren(preview, tint)
  if (r.el) { r.el.dataset.visual = 'preview'; delete r.el.dataset.stale }
  r.canvas.width = r.canvas.height = 0
  r.canvas = null; r.bytes = 0; r.rendered = false
  const d = doc.value
  if (d) void d.getPage(n).then(page => {
    if (doc.value === d && !r.canvas && !r.rendering) page.cleanup()
  }).catch(() => { /* document may have closed */ })
}
function trimRasterCache() {
  const protectedPages = new Set(visiblePages)
  const entries = []
  for (const [n, r] of runtimes) {
    if (r.rendering) protectedPages.add(n)
    if (r.canvas) entries.push({ pageNumber: n, bytes: r.bytes, lastUsed: r.lastUsed })
  }
  for (const n of rasterEvictions(entries, protectedPages)) evictRaster(n)
  trimPreviews()
}
/** Invalidating an image never removes the image currently on screen. */
function invalidatePage(n: number) {
  const r = runtimes.get(n)
  if (!r) return
  cancelRender(r); r.rendered = false
  if (r.el) {
    delete r.el.dataset.renderError
    if (r.scale !== props.scale) r.el.dataset.stale = 'true'
  }
}
async function renderPage(n: number) {
  const d = doc.value, r = runtimes.get(n)
  if (!d || !r?.el || r.rendered || r.rendering) return
  const gen = r.gen, scale = props.scale
  r.rendering = true
  let nextLayer: { cancel: () => void } | null = null
  let canvas: HTMLCanvasElement | null = null
  try {
    const page = await d.getPage(n)
    if (r.gen !== gen || doc.value !== d || !r.el.isConnected) return
    const viewport = page.getViewport({ scale })
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (viewport.width * viewport.height)))
    canvas = document.createElement('canvas'); canvas.className = 'pdf-canvas'
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr)); canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
    const task = page.render({ canvas, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE, transform: [dpr, 0, 0, dpr, 0, 0] })
    r.task = task
    await task.promise
    if (r.gen !== gen || doc.value !== d || !r.el.isConnected) return
    const existingText = r.scale === scale ? r.el.querySelector('.textLayer') : null
    let textDiv: Element
    if (existingText) textDiv = existingText
    else {
      textDiv = document.createElement('div'); textDiv.className = 'textLayer'
      nextLayer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv as HTMLDivElement, viewport })
      r.pendingLayer = nextLayer
      await (nextLayer as InstanceType<typeof pdfjsLib.TextLayer>).render()
    }
    await loadPageHighlights(n)
    if (r.gen !== gen || doc.value !== d || !r.el.isConnected) return
    const previousCanvas = r.canvas
    const tintDiv = document.createElement('div'); tintDiv.className = 'pdf-tint'
    // One synchronous commit: old pixels stay visible until both image and text are ready.
    r.el.replaceChildren(canvas, tintDiv, textDiv)
    if (nextLayer) { try { r.layer?.cancel() } catch { /* already finished */ }; r.layer = nextLayer }
    r.canvas = canvas; r.bytes = canvas.width * canvas.height * 4; r.scale = scale
    r.lastUsed = ++lastUse; r.rendered = true
    r.el.dataset.visual = 'full'; delete r.el.dataset.stale
    pageViewports.set(n, viewport)
    clearPreview(n)
    if (previousCanvas) previousCanvas.width = previousCanvas.height = 0
    canvas = null; nextLayer = null
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (r.gen === gen && doc.value === d && name !== 'RenderingCancelledException' && name !== 'AbortException') {
      r.el.dataset.renderError = 'true'
      emit('error', `第 ${n} 页渲染失败：${(err as Error)?.message ?? String(err)}`)
    }
  } finally {
    if (canvas) canvas.width = canvas.height = 0
    try { nextLayer?.cancel() } catch { /* cancelled render */ }
    if (r.gen === gen) { r.rendering = false; r.task = null; r.pendingLayer = null }
    trimRasterCache()
  }
}
function pumpRenders() {
  if (destroyed) return
  while (activeRenders < MAX_RENDER_TASKS && renderQueue.length) {
    const n = renderQueue.shift()!, r = runtimes.get(n)
    if (!wantedPages.has(n) || !r?.el || r.rendered || r.rendering || r.el.dataset.renderError) continue
    activeRenders++
    void renderPage(n).finally(() => { activeRenders--; pumpRenders() })
  }
}
function dropAll() {
  renderQueue = []; wantedPages.clear(); visiblePages.clear()
  for (const r of runtimes.values()) {
    cancelRender(r)
    try { r.layer?.cancel() } catch { /* already finished */ }
    r.layer = null; r.el?.replaceChildren()
    if (r.el) { delete r.el.dataset.visual; delete r.el.dataset.stale; delete r.el.dataset.renderError }
    if (r.canvas) r.canvas.width = r.canvas.height = 0
    r.canvas = null; r.bytes = 0; r.rendered = false
  }
  for (const n of [...previews.keys()]) clearPreview(n)
}
function currentPageFromScroll(scrollTop: number, clientHeight: number) {
  let page = 1
  const probe = scrollTop + clientHeight * 0.3
  for (const p of layout.value) { if (p.top <= probe) page = p.pageNumber; else break }
  return page
}
function updateVisible() {
  const el = scrollEl.value
  if (!el || el.clientHeight <= 0 || !layout.value.length) return
  const plan = pageRenderPlan(layout.value, el.scrollTop, el.clientHeight, scrollMotion)
  visiblePages = plan.visible; wantedPages = new Set(plan.wanted)
  for (const [n, r] of runtimes) {
    if (visiblePages.has(n)) r.lastUsed = ++lastUse
    if (!wantedPages.has(n) && r.rendering) cancelRender(r)
  }
  renderQueue = plan.wanted.filter(n => { const r = runtimes.get(n); return r && !r.rendered && !r.rendering })
  trimRasterCache(); pumpRenders()
  const page = currentPageFromScroll(el.scrollTop, el.clientHeight)
  if (page !== currentPage.value) { currentPage.value = page; emit('page-change', page) }
}
let rafId = 0
function onScroll() {
  const top = scrollEl.value?.scrollTop ?? 0
  scrollMotion = top - lastScrollTop; lastScrollTop = top
  if (rafId) return
  rafId = requestAnimationFrame(() => { rafId = 0; updateVisible() })
}

// ---------------- 选区捕获 ----------------

let selTimer: number | undefined
/**
 * 最近一次"真实用户输入"的时间。
 *
 * selectionchange 不只由拖拽触发 —— 点按钮、弹窗开关、焦点转移都会让它冒出来，
 * 而且此时文档里可能还留着上一次的选区。如果照单全收，就会对着同一段文字
 * 反复发翻译请求（实测过：一次点击导致 62ms 内发了两次）。
 * 所以只有紧随用户输入之后发生的选区变化才算数。
 */
let lastUserInputAt = 0
const USER_INPUT_WINDOW = 800

function markUserInput() {
  lastUserInputAt = Date.now()
}

function onDocumentKeyup(e: KeyboardEvent) {
  // 键盘扩展选区（Shift + 方向键）
  if (e.shiftKey) markUserInput()
}

function onSelectionChange() {
  if (props.tool !== 'select') return
  window.clearTimeout(selTimer)
  selTimer = window.setTimeout(captureSelection, 150)
}

/**
 * 鼠标松开时同步抓一次。
 *
 * 只靠 selectionchange 延迟 150ms 再读，偶尔会读到"已经被浏览器收起或
 * 转移到别处"的选区（比如点按钮、弹窗开关引起的焦点变化），结果就是
 * 用户明明选好了、右侧栏却不刷新。mouseup 之后选区一定已经定型，立刻读最可靠。
 * 再补一次 60ms 的兜底，兼容选区延迟提交的浏览器。
 */
function onMouseUp(event: MouseEvent) {
  if (saving || busy.value) return
  if (props.tool === 'highlight') { addSelectionHighlights(); return }
  if (props.tool === 'erase') { void eraseAt(event); return }
  markUserInput()
  captureSelection(true)
  window.setTimeout(() => captureSelection(true), 60)
}

function captureSelection(force = false) {
  if (props.tool !== 'select') return
  if (!force && Date.now() - lastUserInputAt > USER_INPUT_WINDOW) return

  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return
  const text = sel.toString()
  if (!text.trim()) return

  // 从选区起点往上找带 data-page-number 的页面容器
  let node: Node | null = sel.anchorNode
  let pageEl: HTMLElement | null = null
  while (node) {
    if (node instanceof HTMLElement && node.dataset.pageNumber) {
      pageEl = node
      break
    }
    node = node.parentNode
  }
  if (!pageEl || !scrollEl.value?.contains(pageEl)) return

  emit('select', { text, page: Number(pageEl.dataset.pageNumber), at: Date.now() })
}

// ---------------- Standard PDF highlight annotations ----------------
const history = new HighlightHistory()
const existingHighlights = new Map<number, Highlight[]>()
const storageKeys = new Set<string>()
let appliedEdits = new Map<string, Highlight>()
let sourceFile: File | null = null
let fileHandle: PdfFileHandle | null = null
let saving = false
function emitEditState() { emit('edit-state', { dirty: history.dirty, canUndo: history.canUndo, saving }) }
async function loadPageHighlights(pageNumber: number) {
  const d = doc.value
  if (!d || existingHighlights.has(pageNumber)) return
  const page = await d.getPage(pageNumber)
  const annotations = await page.getAnnotations()
  if (doc.value !== d) return
  existingHighlights.set(pageNumber, annotations.filter(a => a.subtype === 'Highlight' && a.quadPoints?.length).map(a => ({
    ...highlightFromQuads(pageNumber - 1, Array.from({ length: a.quadPoints.length / 8 }, (_, i) => Array.from(a.quadPoints.slice(i * 8, i * 8 + 8)))),
    id: a.id, key: `pdfjs_internal_editor_rosetta_existing_${a.id}`, popupRef: a.popupRef,
    color: a.color ? Array.from(a.color) : [255, 255, 0], opacity: a.opacity ?? 1,
  })))
}
function syncEdits() {
  const d = doc.value
  if (!d) return
  for (const key of storageKeys) d.annotationStorage.remove(key)
  storageKeys.clear()
  for (const [key, value] of history.edits) {
    const { key: _key, ...annotation } = value
    d.annotationStorage.setValue(key, annotation)
    storageKeys.add(key)
  }
  const changedPages = new Set<number>()
  for (const key of new Set([...appliedEdits.keys(), ...history.edits.keys()])) {
    const before = appliedEdits.get(key), after = history.edits.get(key)
    if (before === after) continue
    if (before) changedPages.add(before.pageIndex + 1)
    if (after) changedPages.add(after.pageIndex + 1)
  }
  appliedEdits = new Map(history.edits)
  for (const n of changedPages) invalidatePage(n)
  updateVisible(); emitEditState()
}
function addSelectionHighlights() {
  const selection = window.getSelection(), d = doc.value
  if (!selection || selection.isCollapsed || !selection.rangeCount || !d) return
  const selected = selection.getRangeAt(0)
  const updates: Highlight[] = []
  for (const [pageNumber, r] of runtimes) {
    if (!r.el || !r.canvas || r.scale !== props.scale || !selected.intersectsNode(r.el)) continue
    const quads: number[][] = []
    const box = r.el.getBoundingClientRect()
    const viewport = pageViewports.get(pageNumber)
    if (!viewport) continue
    // Walk text nodes rather than parent boxes: avoids painting blank columns or whole paragraphs.
    const layer = r.el.querySelector('.textLayer')
    if (!layer) continue
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    let node: Node | null
    const seen = new Set<string>()
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || !selected.intersectsNode(node)) continue
      const piece = document.createRange(); piece.selectNodeContents(node)
      if (selected.compareBoundaryPoints(Range.START_TO_START, piece) > 0) piece.setStart(selected.startContainer, selected.startOffset)
      if (selected.compareBoundaryPoints(Range.END_TO_END, piece) < 0) piece.setEnd(selected.endContainer, selected.endOffset)
      if (piece.collapsed) continue
      for (const rect of piece.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue
        const signature = [rect.left, rect.top, rect.right, rect.bottom].map(n => Math.round(n * 10)).join(',')
        if (seen.has(signature)) continue
        seen.add(signature)
        const left = Math.max(0, rect.left-box.left), right = Math.min(box.width, rect.right-box.left)
        const top = Math.max(0, rect.top-box.top), bottom = Math.min(box.height, rect.bottom-box.top)
        if (right <= left || bottom <= top) continue
        // The element rounds dimensions to CSS pixels; the viewport keeps the exact PDF transform.
        const sx = viewport.width / box.width, sy = viewport.height / box.height
        quads.push([ ...viewport.convertToPdfPoint(left*sx, top*sy), ...viewport.convertToPdfPoint(right*sx, top*sy),
          ...viewport.convertToPdfPoint(left*sx, bottom*sy), ...viewport.convertToPdfPoint(right*sx, bottom*sy) ])
      }
    }
    if (quads.length) updates.push(highlightFromQuads(pageNumber-1, quads))
  }
  if (!updates.length) return
  selection.removeAllRanges()
  history.change(updates); syncEdits()
}
const pageViewports = new Map<number, ReturnType<import('pdfjs-dist').PDFPageProxy['getViewport']>>()
async function eraseAt(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.pdf-page') : null
  if (!target || !scrollEl.value?.contains(target)) return
  const pageNumber = Number(target.dataset.pageNumber), d = doc.value
  await loadPageHighlights(pageNumber)
  if (doc.value !== d || saving) return
  const viewport = pageViewports.get(pageNumber)
  if (!viewport) return
  const box = target.getBoundingClientRect()
  const [x, y] = viewport.convertToPdfPoint((event.clientX-box.left)*viewport.width/box.width, (event.clientY-box.top)*viewport.height/box.height)
  const all = [...existingHighlights.get(pageNumber) ?? [], ...[...history.edits.values()].filter(h => !h.id && h.pageIndex === pageNumber-1)]
  const hit = all.reverse().find(h => !history.edits.get(h.key)?.deleted && containsHighlight(h, x, y))
  if (!hit) return
  if (hit.id) history.change([{ ...hit, deleted: true }])
  else history.change([], [hit.key])
  window.getSelection()?.removeAllRanges(); syncEdits()
}
function undoHighlight() { if (!saving && history.canUndo) { history.undo(); syncEdits() } }
async function saveHighlights() {
  const d = doc.value, file = sourceFile
  if (!d || !file || saving || !history.dirty) return
  saving = true; emitEditState()
  try {
    // Request a destination within the Ctrl+S/button activation, before serializing bytes.
    const target = fileHandle ?? await pickSavePdf(file.name)
    if (target?.requestPermission && await target.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('没有获得文件写入权限')
    const bytes = await d.saveDocument()
    if (doc.value !== d) return
    if (target) {
      const writable = await target.createWritable()
      try { await writable.write(new Blob([bytes], { type: 'application/pdf' })); await writable.close() }
      catch (error) { await writable.abort().catch(() => {}); throw error }
      fileHandle = target
      emit('notice', '高亮已保存到 PDF。')
    } else {
      downloadPdf(bytes, file.name)
      emit('notice', '浏览器不支持直接写入，已下载含高亮的 PDF；请用下载文件替换原文件。')
    }
    sourceFile = new File([bytes], file.name, { type: 'application/pdf', lastModified: Date.now() })
    emit('saved', sourceFile)
    history.markSaved()
  } catch (error) {
    if ((error as Error).name !== 'AbortError') emit('error', `高亮保存失败：${(error as Error).message}。编辑仍保留，可重试。`)
  } finally { saving = false; emitEditState() }
}

// ---------------- 打开文件 ----------------

let openGeneration = 0
let navigationGeneration = 0
let pendingLoad: PDFDocumentLoadingTask | null = null

async function openFile(file: File, handle?: PdfFileHandle) {
  const generation = ++openGeneration
  navigationGeneration++
  if (pendingLoad) void pendingLoad.destroy()
  pendingLoad = null
  busy.value = true
  emit('busy', true)
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    if (generation !== openGeneration) return
    const task = loadPdfDocument(data)
    pendingLoad = task
    const next = await task.promise
    if (generation !== openGeneration) return

    const p1 = await next.getPage(1)
    if (generation !== openGeneration) return
    const vp1 = p1.getViewport({ scale: 1 })

    dropAll()
    history.clear(); appliedEdits.clear(); existingHighlights.clear(); storageKeys.clear(); pageViewports.clear()
    sourceFile = file; fileHandle = handle ?? null
    emitEditState()
    runtimes.clear()
    sizes.clear()
    const prevTask = loadingTask.value
    doc.value = next
    loadingTask.value = task
    pendingLoad = null
    numPages.value = next.numPages
    fallback.value = { w: vp1.width, h: vp1.height }
    sizes.set(1, { w: vp1.width, h: vp1.height })

    currentPage.value = 1
    lastScrollTop = 0; scrollMotion = 0
    await nextTick()
    if (generation !== openGeneration) return
    if (scrollEl.value) scrollEl.value.scrollTop = 0
    updateVisible()

    emit('loaded', { numPages: next.numPages, fileName: file.name })
    if (prevTask) void prevTask.destroy()

    // 目录单独异步加载：没有目录的 PDF 很常见，不该拖慢打开速度
    emit('outline', [])
    if (props.navigation !== false) void loadOutline(next)
      .then((tree) => {
        if (doc.value === next) emit('outline', tree)
      })
      .catch(() => {
        if (doc.value === next) emit('outline', [])
      })

    void probeSizes(next)
  } catch (err) {
    if (generation === openGeneration) emit('error', `打不开这个 PDF：${(err as Error)?.message ?? String(err)}`)
  } finally {
    if (generation === openGeneration) {
      if (pendingLoad) void pendingLoad.destroy()
      pendingLoad = null
      busy.value = false
      emit('busy', false)
    }
  }
}

/** 后台把所有页的尺寸探完，避免混合纸张尺寸的文档滚动条长度不准 */
async function probeSizes(d: PDFDocumentProxy) {
  for (let i = 2; i <= d.numPages; i++) {
    if (doc.value !== d) return
    try {
      const page = await d.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      sizes.set(i, { w: vp.width, h: vp.height })
      // The render queue owns page lifetime; metadata probing must not clean an in-flight page.
    } catch {
      /* 个别页取不到就沿用第一页尺寸 */
    }
    if (i % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function goToPage(n: number) {
  const target = layout.value.find((p) => p.pageNumber === n)
  if (!target || !scrollEl.value) return
  navigationGeneration++
  scrollEl.value.scrollTop = Math.max(0, target.top - PAD)
  updateVisible()
}

function fitWidthScale() {
  const el = scrollEl.value
  const f = fallback.value
  if (!el || !f) return props.scale
  const avail = el.clientWidth - PAD * 2
  return Math.min(3, Math.max(0.25, avail / f.w))
}

defineExpose({ openFile, goToPage, fitWidthScale, undoHighlight, saveHighlights })

// ---------------- 生命周期 ----------------

let ro: ResizeObserver | null = null

onMounted(() => {
  const el = scrollEl.value
  if (el) {
    viewportWidth.value = el.clientWidth
    ro = new ResizeObserver(() => {
      viewportWidth.value = el.clientWidth
      updateVisible()
    })
    ro.observe(el)
  }
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keyup', onDocumentKeyup)
})

onBeforeUnmount(() => {
  destroyed = true
  cancelAnimationFrame(rafId)
  openGeneration++
  void pendingLoad?.destroy()
  ro?.disconnect()
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('keyup', onDocumentKeyup)
  window.clearTimeout(selTimer)
  dropAll()
  void loadingTask.value?.destroy()
})

// 缩放：canvas 是位图必须重画，文字层靠 CSS 变量自动跟着缩放
let scaleGeneration = 0
watch(
  () => props.scale,
  async (nextScale, previousScale) => {
    const generation = ++scaleGeneration
    const navigation = navigationGeneration
    const document = doc.value
    const el = scrollEl.value
    const anchor = currentPage.value
    let oldTop = PAD
    for (let page = 1; page < anchor; page++) {
      oldTop += Math.round((sizes.get(page)?.h ?? fallback.value?.h ?? 0) * previousScale) + GAP
    }
    const offset = (el?.scrollTop ?? 0) - oldTop
    for (const n of runtimes.keys()) invalidatePage(n)
    await nextTick()
    if (generation !== scaleGeneration || document !== doc.value) return
    const target = layout.value.find(page => page.pageNumber === anchor)
    if (el && el.clientHeight > 0 && target && previousScale > 0 && navigation === navigationGeneration) {
      el.scrollTop = Math.max(0, target.top + offset * nextScale / previousScale)
    }
    if (el && el.clientHeight > 0) updateVisible()
  }
)

function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) emit('file', file)
}
</script>

<template>
  <div
    ref="scrollEl"
    class="viewer"
    :class="{ 'drop-active': dragOver, 'viewer--erase': tool === 'erase', 'viewer--highlight': tool === 'highlight' }"
    :style="{ '--page-tint': tint }"
    @scroll.passive="onScroll"
    @mousedown="markUserInput"
    @mouseup="onMouseUp"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="viewer__inner" :style="{ height: `${totalHeight}px` }">
      <div
        v-for="p in layout"
        :key="p.pageNumber"
        class="pdf-page"
        :data-page-number="p.pageNumber"
        :style="pageStyle(p)"
        :ref="(el) => bindPage(p.pageNumber, el)"
      />
    </div>

    <div v-if="numPages === 0" class="viewer__empty">
      <div class="welcome-art" aria-hidden="true">
        <div class="welcome-paper welcome-paper--back"><span>THE ORIGINAL</span><i /><i /><i /><b /><i /><i /></div>
        <div class="welcome-paper welcome-paper--front"><span>新的阅读视角</span><i /><i /><i /><b /><i /><i /></div>
        <div class="welcome-art__badge"><AppIcon name="translate" :size="23" /></div>
      </div>
      <span class="welcome-eyebrow">READ BEYOND LANGUAGE</span>
      <h2>每一篇论文，都值得读懂。</h2>
      <p>划选一句，理解细节；翻译全文，沉浸阅读。</p>
      <button class="btn btn--primary welcome-open" @click="emit('pick')"><AppIcon name="file" />打开 PDF<AppIcon name="arrow" :size="17" /></button>
      <span class="welcome-hint">或将 PDF 拖到这里 · 文档保存在本机</span>
    </div>

    <div v-if="busy" class="viewer__busy">正在解析文档…</div>
  </div>
</template>
