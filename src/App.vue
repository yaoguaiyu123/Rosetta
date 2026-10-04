<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppToolbar from './components/AppToolbar.vue'
import PdfViewer from './components/PdfViewer.vue'
import TranslatePanel from './components/TranslatePanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import OutlinePanel from './components/OutlinePanel.vue'
import type { OutlineNode } from './lib/outline'
import { useTranslation } from './composables/useTranslation'
import {
  fetchFileConfig,
  loadSettings,
  mergeFileConfig,
  PAGE_TINTS,
  saveFileConfig,
  saveSettings,
  tintColor,
  tintLabel
} from './lib/settings'
import type { DocInfo, SelectionPayload, Settings } from './types'
import type { FullViewMode, ReaderMode } from './types'
import { createFullTranslation, FULL_TRANSLATION_PAGE_LIMIT, type FullTranslationProgress } from './lib/fullTranslationClient'
import { findSavedTranslation, loadSavedTranslation, type SavedTranslation } from './lib/savedTranslation'
import { nextPdfZoom } from './lib/pdfZoom'

const viewer = ref<InstanceType<typeof PdfViewer> | null>(null)
const toolbar = ref<InstanceType<typeof AppToolbar> | null>(null)
const translatedViewer = ref<InstanceType<typeof PdfViewer> | null>(null)
const mode = ref<ReaderMode>('selection')
const fullView = ref<FullViewMode>('dual')
const sourceFile = ref<File | null>(null)
const translatedFile = ref<File | null>(null)
const savedTranslation = ref<SavedTranslation | null>(null)
const lookupBusy = ref(false)
const fullStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const fullProgress = ref<FullTranslationProgress | null>(null)
const fullError = ref('')
const savedPath = ref('')
const fallbackUsed = ref(false)
const variantFiles = new Map<FullViewMode, File>()
const variantLoading = ref(false)
let variantController: AbortController | null = null
let variantGeneration = 0
let fullController: AbortController | null = null
let lookupController: AbortController | null = null
let fullJob = 0

const settings = reactive<Settings>(loadSettings())
const settingsOpen = ref(false)
/** 磁盘配置还没读回来之前，先别提示"缺 API Key"，否则会闪一下假警告 */
const configReady = ref(false)
const configFile = ref('')
const configError = ref('')

const scale = ref(settings.defaultZoom)
const fileName = ref('')
const numPages = ref(0)
const currentPage = ref(1)
const translatedPages = ref(0)
const translatedCurrentPage = ref(1)
const viewingTranslation = computed(() => mode.value === 'full' && Boolean(translatedFile.value))
const shownPage = computed(() => viewingTranslation.value ? translatedCurrentPage.value : currentPage.value)
const shownPages = computed(() => viewingTranslation.value ? translatedPages.value : numPages.value)
const panelOpen = ref(true)
const busy = ref(false)
const errorMsg = ref('')

/** Only use the PDF's embedded bookmarks. */
const outline = ref<OutlineNode[]>([])
const outlineOpen = ref(true)

const translation = useTranslation(() => settings)

const hasApiKey = computed(() => settings.apiKey.trim().length > 0)
/** 护眼蒙版的 CSS 颜色；'transparent' 表示原色 */
const pageTintColor = computed(() => tintColor(settings.pageTint))
const pageTintLabel = computed(() => tintLabel(settings.pageTint))

let persistTimer: number | undefined

watch(settings, () => {
  saveSettings({ ...settings })
  // 配置同步落盘到 .env。防抖是为了别在拖温度滑块时狂写文件。
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => void persistToFile(), 800)
}, { deep: true })

/** 把当前配置写进磁盘文件；写失败必须让用户看到，否则他会以为已经存好了 */
async function persistToFile() {
  const res = await saveFileConfig({ ...settings })
  if (res.ok) {
    configError.value = ''
    if (res.file) configFile.value = res.file
  } else {
    configError.value = `配置没能写入本地文件：${res.error}`
  }
}

function applySettings(next: Settings) {
  Object.assign(settings, next)
  settingsOpen.value = false
  // 显式点保存时立即落盘，不等防抖
  window.clearTimeout(persistTimer)
  void persistToFile()
}

/** 工具栏上的「背景」按钮：在原色 → 护眼绿 → 淡黄 → 羊皮纸 之间循环 */
function cycleTint() {
  const index = PAGE_TINTS.findIndex((t) => t.value === settings.pageTint)
  const next = PAGE_TINTS[(index + 1) % PAGE_TINTS.length]
  settings.pageTint = next.value
}

function openFile(file: File) {
  fullController?.abort()
  lookupController?.abort()
  const job = ++fullJob
  const lookup = new AbortController()
  lookupController = lookup
  sourceFile.value = file
  translatedFile.value = null
  savedTranslation.value = null
  lookupBusy.value = true
  translatedPages.value = 0
  translatedCurrentPage.value = 1
  fullStatus.value = 'idle'
  fullProgress.value = null
  fullError.value = ''
  savedPath.value = ''
  variantController?.abort()
  variantGeneration++
  variantFiles.clear()
  variantLoading.value = false
  numPages.value = 0
  outline.value = []
  outlineOpen.value = true
  translation.clear()
  errorMsg.value = ''
  // 每次打开都回到配置里的初始缩放
  scale.value = settings.defaultZoom
  void viewer.value?.openFile(file)
  void findSavedTranslation(file, lookup.signal)
    .then((found) => { if (job === fullJob) savedTranslation.value = found })
    .catch((err) => {
      if (job === fullJob && !lookup.signal.aborted) fullError.value = (err as Error).message
    })
    .finally(() => {
      if (job === fullJob) lookupBusy.value = false
    })
}

function onOutline(tree: OutlineNode[]) {
  outline.value = tree
}

function onLoaded(info: DocInfo) {
  numPages.value = info.numPages
  fileName.value = info.fileName
  currentPage.value = 1
  if (mode.value === 'full' && info.numPages > FULL_TRANSLATION_PAGE_LIMIT) {
    fullError.value = `这份 PDF 有 ${info.numPages} 页，全文翻译最多支持 ${FULL_TRANSLATION_PAGE_LIMIT} 页。`
  }
}

function onSelection(payload: SelectionPayload) {
  if (mode.value === 'selection') translation.submit(payload)
}

function goto(page: number) {
  if (viewingTranslation.value) {
    translatedViewer.value?.goToPage(page)
  } else viewer.value?.goToPage(page)
}

function onOriginalPageChange(page: number) {
  if (mode.value === 'selection' || !translatedFile.value) currentPage.value = page
}

function onChinesePageChange(page: number) {
  if (mode.value === 'full') translatedCurrentPage.value = page
}

function onChineseLoaded(info: DocInfo) {
  translatedPages.value = info.numPages
  translatedCurrentPage.value = 1
}

function zoom(delta: number) {
  scale.value = nextPdfZoom(scale.value, delta)
}

function fit() {
  if (mode.value === 'full' && translatedFile.value) {
    const fitted = translatedViewer.value?.fitWidthScale()
    if (typeof fitted === 'number' && Number.isFinite(fitted)) scale.value = fitted
    return
  }
  const s = viewer.value?.fitWidthScale()
  if (typeof s === 'number' && Number.isFinite(s)) {
    scale.value = s
  }
}

function setMode(value: ReaderMode) {
  const page = value === 'full' && translatedFile.value ? translatedCurrentPage.value : currentPage.value
  mode.value = value
  if (value === 'full' && numPages.value > FULL_TRANSLATION_PAGE_LIMIT) {
    fullError.value = `这份 PDF 有 ${numPages.value} 页，全文翻译最多支持 ${FULL_TRANSLATION_PAGE_LIMIT} 页。`
  }
  void nextTick().then(async () => {
    if (mode.value !== value) return
    fit()
    await nextTick()
    if (mode.value === value) goto(page)
  })
}

async function showTranslatedVariant() {
  const source = sourceFile.value
  const saved = savedTranslation.value
  if (!source || !saved) return
  variantController?.abort()
  const ctrl = new AbortController()
  variantController = ctrl
  const generation = ++variantGeneration
  const variant = fullView.value
  const readingPage = translatedCurrentPage.value
  variantLoading.value = true
  try {
    const file = variantFiles.get(variant) ?? await loadSavedTranslation(source, saved, variant === 'dual' ? 'dual' : 'mono', ctrl.signal)
    if (generation !== variantGeneration || ctrl.signal.aborted) return
    variantFiles.set(variant, file)
    translatedFile.value = file
    savedPath.value = saved[variant === 'dual' ? 'dual' : 'mono'].path
    fallbackUsed.value = Boolean(saved.fallbackUsed)
    await nextTick()
    if (generation !== variantGeneration) return
    await translatedViewer.value?.openFile(file)
    if (generation !== variantGeneration) return
    await nextTick()
    fit()
    await nextTick()
    if (generation === variantGeneration) translatedViewer.value?.goToPage(Math.min(readingPage, translatedPages.value))
  } catch (err) {
    if (generation === variantGeneration && !ctrl.signal.aborted) fullError.value = (err as Error).message
  } finally {
    if (generation === variantGeneration) variantLoading.value = false
  }
}

watch(fullView, () => {
  if (translatedFile.value) void showTranslatedVariant()
})

async function startFullTranslation(replaceExisting = false) {
  const file = sourceFile.value
  if (!file || !numPages.value || lookupBusy.value || variantLoading.value || fullStatus.value === 'running') return
  if (!replaceExisting && translatedFile.value) return
  if (numPages.value > FULL_TRANSLATION_PAGE_LIMIT) {
    fullError.value = `这份 PDF 有 ${numPages.value} 页，全文翻译最多支持 ${FULL_TRANSLATION_PAGE_LIMIT} 页。`
    return
  }
  fullController?.abort()
  const ctrl = new AbortController()
  fullController = ctrl
  const job = ++fullJob
  fullStatus.value = 'running'
  fullError.value = ''
  fullProgress.value = null
  try {
    const saved = savedTranslation.value
    const result = saved && !replaceExisting ? saved : await createFullTranslation(file, { ...settings }, ctrl.signal, progress => {
      if (job === fullJob) fullProgress.value = progress
    }, replaceExisting)
    if (job !== fullJob || ctrl.signal.aborted) return
    savedTranslation.value = result
    if (replaceExisting) variantFiles.clear()
    await showTranslatedVariant()
    if (job !== fullJob || ctrl.signal.aborted) return
    fullStatus.value = 'done'
  } catch (err) {
    if (job !== fullJob) return
    fullStatus.value = ctrl.signal.aborted ? 'idle' : 'error'
    fullError.value = ctrl.signal.aborted ? '已取消全文翻译。原有译本仍可继续阅读。' : (err as Error)?.message ?? String(err)
  } finally {
    if (job === fullJob) fullController = null
  }
}

function cancelFullTranslation() {
  fullController?.abort()
  variantController?.abort()
  fullStatus.value = 'idle'
  fullError.value = '已取消全文翻译。原有译本仍可继续阅读。'
}

function downloadTranslated() {
  const file = translatedFile.value
  if (!file) return
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** 面板上的「翻译 / 重新翻译」都走这里：手动触发就该绕过缓存，结果更可预期 */
function translateText(text: string) {
  translation.translate(text, translation.state.page || currentPage.value, true)
}

/** 磁盘上的 .env 才是配置的权威来源：它不随端口/浏览器变化而丢失 */
async function loadConfigFromFile() {
  const { config, file, error } = await fetchFileConfig()
  if (error) {
    // 读不到就退回本地存储里的值，不阻断使用
    configError.value = `读取本地配置文件失败：${error}`
    configReady.value = true
    return
  }
  Object.assign(settings, mergeFileConfig({ ...settings }, config))
  configFile.value = file ?? ''
  configReady.value = true
}

function onKeydown(e: KeyboardEvent) {
  // Ctrl+Enter：翻译当前选区（shortcut 模式的主要入口，auto 模式下也能用来强制重翻）
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const target = e.target as HTMLElement | null
    const tag = target?.tagName
    // 焦点在输入框里就不抢，避免打断编辑
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (translation.state.source.trim()) {
      e.preventDefault()
      translation.translateNow()
    }
  }
}

let wheelBalance = 0
let wheelAt = 0
let wheelSteps = 0
let wheelFrame = 0
function onZoomWheel(event: WheelEvent) {
  if ((!event.ctrlKey && !event.shiftKey) || !shownPages.value || settingsOpen.value) return
  if (!(event.target instanceof Element) || !event.target.closest('.app')) return
  if (!event.cancelable) return // Shift is also available when the browser owns a Ctrl gesture.
  event.preventDefault()
  const now = performance.now()
  if (now - wheelAt > 180) wheelBalance = 0
  wheelAt = now
  const delta = (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1)
  if (!delta) return
  // A mouse notch moves one 5% step; small trackpad events accumulate rather than racing to a limit.
  // Chromium normalizes Ctrl gestures to small deltas, unlike ordinary mouse notches.
  wheelBalance -= Math.sign(delta) * Math.min(1, Math.abs(delta) / (event.ctrlKey ? 2 : 20))
  const steps = Math.trunc(wheelBalance)
  wheelBalance -= steps
  wheelSteps += steps
  if (!wheelFrame && wheelSteps) wheelFrame = requestAnimationFrame(() => {
    wheelFrame = 0
    if (!settingsOpen.value && shownPages.value) zoom(wheelSteps)
    wheelSteps = 0
  })
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('wheel', onZoomWheel, { passive: false, capture: true })
  await loadConfigFromFile()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('wheel', onZoomWheel, true)
  cancelAnimationFrame(wheelFrame)
  fullController?.abort()
  lookupController?.abort()
  variantController?.abort()
  window.clearTimeout(persistTimer)
})
</script>

<template>
  <div class="app">
    <AppToolbar
      ref="toolbar"
      :file-name="fileName"
      :num-pages="shownPages"
      :current-page="shownPage"
      :scale="scale"
      :panel-open="panelOpen"
      :outline-open="outlineOpen"
      :has-outline="outline.length > 0"
      :busy="busy"
      :tint-label="pageTintLabel"
      :mode="mode"
      @file="openFile"
      @goto="goto"
      @zoom="zoom"
      @fit="fit"
      @cycle-tint="cycleTint"
      @toggle-outline="outlineOpen = !outlineOpen"
      @toggle-panel="panelOpen = !panelOpen"
      @open-settings="settingsOpen = true"
      @mode="setMode"
    />

    <section v-if="mode === 'full'" class="full-controls" aria-label="全文译本">
      <div class="view-switch" aria-label="译本显示方式">
        <button :aria-pressed="fullView === 'dual'" :class="{ active: fullView === 'dual' }" @click="fullView = 'dual'">中英对照</button>
        <button :aria-pressed="fullView === 'chinese'" :class="{ active: fullView === 'chinese' }" @click="fullView = 'chinese'">只看中文</button>
      </div>
      <button v-if="fullStatus === 'running'" class="btn" :disabled="fullProgress?.stage === 'saving'" @click="cancelFullTranslation">取消翻译</button>
      <template v-else>
        <button class="btn btn--primary"
          :disabled="!configReady || !sourceFile || !numPages || lookupBusy || variantLoading || !!translatedFile || numPages > FULL_TRANSLATION_PAGE_LIMIT"
          @click="startFullTranslation(false)">
          {{ variantLoading ? '正在打开…' : translatedFile ? '译本已打开' : savedTranslation ? '打开已有译本' : '翻译全文' }}
        </button>
        <button v-if="savedTranslation || translatedFile" class="btn"
          :disabled="!sourceFile || !numPages || lookupBusy || variantLoading || numPages > FULL_TRANSLATION_PAGE_LIMIT"
          @click="startFullTranslation(true)">重新翻译</button>
      </template>
      <button v-if="translatedFile" class="btn" :disabled="variantLoading" @click="downloadTranslated">下载当前译本</button>
    </section>
    <div v-if="mode === 'full' && lookupBusy" class="full-message" role="status">正在查找已有译本…</div>
    <div v-if="mode === 'full' && savedTranslation && !translatedFile && !lookupBusy" class="full-message" role="status">
      <span class="status-dot" />已有中文和中英对照译本，直接打开即可继续阅读。
    </div>
    <div v-if="mode === 'full' && fullStatus === 'running' && fullProgress" class="full-progress" role="status">
      <div class="full-progress__text"><span>{{ fullProgress.detail }}</span><span>{{ Math.round(fullProgress.percent) }}%</span></div>
      <div class="full-progress__track" role="progressbar" :aria-valuenow="Math.round(fullProgress.percent)" aria-valuemin="0" aria-valuemax="100" aria-label="全文翻译进度">
        <div :style="{ width: `${fullProgress.percent}%` }" />
      </div>
    </div>
    <div v-if="mode === 'full' && variantLoading" class="full-message" role="status">正在打开{{ fullView === 'dual' ? '中英对照' : '中文' }}译本…</div>
    <div v-if="mode === 'full' && fullError" class="error-bar" role="alert">{{ fullError }}</div>
    <div v-if="errorMsg" class="error-bar">{{ errorMsg }}</div>
    <div v-if="configError" class="error-bar">{{ configError }}</div>

    <div class="app__main">
      <OutlinePanel
        v-if="mode === 'selection' && outlineOpen && outline.length > 0"
        :tree="outline"
        :current-page="currentPage"
        @goto="goto"
      />
      <div v-show="mode === 'selection' || !translatedFile" class="reader-lane">
        <PdfViewer
          ref="viewer"
          v-model:scale="scale"
          :tint="pageTintColor"
          @loaded="onLoaded"
          @outline="onOutline"
          @page-change="onOriginalPageChange"
          @select="onSelection"
          @error="errorMsg = $event"
          @busy="busy = $event"
          @file="openFile"
          @pick="toolbar?.pickFile()"
        />
      </div>
      <TranslatePanel
        v-if="mode === 'selection' && panelOpen"
        :state="translation.state"
        :trigger="settings.trigger"
        :has-api-key="hasApiKey"
        :config-ready="configReady"
        @translate="translateText"
        @cancel="translation.cancel()"
        @retry="translation.retry()"
        @clear="translation.clear()"
        @open-settings="settingsOpen = true"
      />
      <div v-if="translatedFile" v-show="mode === 'full'" class="reader-lane reader-lane--translated">
        <PdfViewer
          ref="translatedViewer"
          v-model:scale="scale"
          :tint="pageTintColor"
          :navigation="false"
          @loaded="onChineseLoaded"
          @page-change="onChinesePageChange"
          @error="errorMsg = $event"
          @file="openFile"
        />
      </div>
    </div>

    <footer class="reader-status">
      <span><i class="status-dot" />本机阅读 <span class="reader-status__separator">/</span> {{ mode === 'full' ? '全文翻译' : '划词翻译' }}</span>
      <span v-if="mode === 'full' && savedPath" class="reader-status__path" :title="savedPath">{{ savedPath }}<span v-if="fallbackUsed"> · 已回退到用户目录</span></span>
      <span v-else>{{ sourceFile ? `${numPages} 页 · ${settings.model}` : '打开一篇论文，专注每一次阅读' }}</span>
    </footer>

    <SettingsDialog
      :open="settingsOpen"
      :settings="settings"
      :config-file="configFile"
      @close="settingsOpen = false"
      @save="applySettings"
    />
  </div>
</template>
