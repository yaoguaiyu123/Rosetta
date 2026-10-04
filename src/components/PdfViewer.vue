<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { loadPdfDocument, pdfjsLib } from '../lib/pdfjs'
import { loadOutline, type OutlineNode } from '../lib/outline'
import type { DocInfo, SelectionPayload } from '../types'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{ scale: number; tint: string; navigation?: boolean }>(), { navigation: true })

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
}>()

/** 页面之间与四周的留白 */
const PAD = 20
const GAP = 18
/** 视口上下各多渲染这么多像素，滚动时不会看到空白 */
const OVERSCAN = 800

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
}

const runtimes = new Map<number, PageRuntime>()

function rt(n: number): PageRuntime {
  let r = runtimes.get(n)
  if (!r) {
    r = { el: null, rendered: false, rendering: false, task: null, layer: null, gen: 0 }
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

// ---------------- 渲染 ----------------

async function renderPage(n: number) {
  const d = doc.value
  const r = runtimes.get(n)
  if (!d || !r || !r.el || r.rendered || r.rendering) return

  const gen = r.gen
  r.rendering = true
  try {
    const page = await d.getPage(n)
    if (r.gen !== gen || !r.el.isConnected) return

    const viewport = page.getViewport({ scale: props.scale })
    // 按设备像素比出图，保证文字清晰；上限 2 是防止 4K 屏下 canvas 过大
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = document.createElement('canvas')
    canvas.className = 'pdf-canvas'
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`

    const task = page.render({
      canvas,
      viewport,
      transform: [dpr, 0, 0, dpr, 0, 0]
    })
    r.task = task
    await task.promise
    if (r.gen !== gen || !r.el.isConnected) return

    const textDiv = document.createElement('div')
    textDiv.className = 'textLayer'
    const layer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport
    })
    r.layer = layer
    await layer.render()
    if (r.gen !== gen || !r.el.isConnected) return

    // 护眼蒙版夹在 canvas 与文字层之间：
    // 用 multiply 混合，白底被染成目标色、黑字仍是黑字，对比度不被冲淡；
    // 文字层在它上面，所以划选高亮不受影响；pointer-events:none 不挡鼠标。
    const tintDiv = document.createElement('div')
    tintDiv.className = 'pdf-tint'

    r.el.replaceChildren(canvas, tintDiv, textDiv)
    r.rendered = true
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (r.gen === gen && doc.value === d && name !== 'RenderingCancelledException' && name !== 'AbortException') {
      emit('error', `第 ${n} 页渲染失败：${(err as Error)?.message ?? String(err)}`)
    }
  } finally {
    if (r.gen === gen) r.rendering = false
  }
}

async function dropPage(n: number) {
  const r = runtimes.get(n)
  if (!r) return
  r.gen++
  try {
    r.task?.cancel()
  } catch {
    /* 取消已结束的任务会抛，忽略 */
  }
  try {
    r.layer?.cancel()
  } catch {
    /* 同上 */
  }
  r.task = null
  r.layer = null
  r.rendered = false
  r.rendering = false
  r.el?.replaceChildren()
}

function dropAll() {
  for (const n of [...runtimes.keys()]) void dropPage(n)
}

// ---------------- 可视区计算 ----------------

function currentPageFromScroll(scrollTop: number, clientHeight: number) {
  const l = layout.value
  if (l.length === 0) return 1
  const probe = scrollTop + clientHeight * 0.3
  let page = 1
  for (const p of l) {
    if (p.top <= probe) page = p.pageNumber
    else break
  }
  return page
}

function updateVisible() {
  const el = scrollEl.value
  if (!el || layout.value.length === 0) return

  const top = el.scrollTop
  const lo = top - OVERSCAN
  const hi = top + el.clientHeight + OVERSCAN

  for (const p of layout.value) {
    const r = runtimes.get(p.pageNumber)
    const inRange = p.top + p.height > lo && p.top < hi
    if (inRange) {
      if (!r || (!r.rendered && !r.rendering)) void renderPage(p.pageNumber)
    } else if (r && (r.rendered || r.rendering)) {
      void dropPage(p.pageNumber)
    }
  }

  const page = currentPageFromScroll(top, el.clientHeight)
  if (page !== currentPage.value) {
    currentPage.value = page
    emit('page-change', page)
  }
}

let rafId = 0
function onScroll() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    updateVisible()
  })
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
function onMouseUp() {
  markUserInput()
  captureSelection(true)
  window.setTimeout(() => captureSelection(true), 60)
}

function captureSelection(force = false) {
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
  if (!pageEl) return

  emit('select', { text, page: Number(pageEl.dataset.pageNumber), at: Date.now() })
}

// ---------------- 打开文件 ----------------

let openGeneration = 0
let navigationGeneration = 0
let pendingLoad: PDFDocumentLoadingTask | null = null

async function openFile(file: File) {
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
      if (!runtimes.get(i)?.rendered) page.cleanup()
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

defineExpose({ openFile, goToPage, fitWidthScale })

// ---------------- 生命周期 ----------------

let ro: ResizeObserver | null = null

onMounted(() => {
  const el = scrollEl.value
  if (el) {
    viewportWidth.value = el.clientWidth
    ro = new ResizeObserver(() => {
      viewportWidth.value = el.clientWidth
    })
    ro.observe(el)
  }
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keyup', onDocumentKeyup)
})

onBeforeUnmount(() => {
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
    dropAll()
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
    :class="{ 'drop-active': dragOver }"
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
