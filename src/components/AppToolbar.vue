<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ReaderMode } from '../types'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  fileName: string
  numPages: number
  currentPage: number
  scale: number
  panelOpen: boolean
  /** 目录侧栏是否展开 */
  outlineOpen: boolean
  hasOutline: boolean
  busy: boolean
  /** 当前护眼色调的名字，显示在按钮上 */
  tintLabel: string
  mode: ReaderMode
}>()

const emit = defineEmits<{
  (e: 'file', file: File): void
  (e: 'goto', page: number): void
  (e: 'zoom', delta: number): void
  (e: 'fit'): void
  (e: 'toggle-panel'): void
  (e: 'toggle-outline'): void
  (e: 'open-settings'): void
  (e: 'cycle-tint'): void
  (e: 'mode', value: ReaderMode): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const pageText = ref('1')

watch(
  () => props.currentPage,
  (v) => {
    pageText.value = String(v)
  }
)

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('file', file)
  input.value = ''
}

function commitPage() {
  const n = Number.parseInt(pageText.value, 10)
  if (Number.isFinite(n) && n >= 1 && n <= props.numPages) {
    emit('goto', n)
  } else {
    pageText.value = String(props.currentPage)
  }
}

function step(delta: number) {
  commitPage()
  const next = props.currentPage + delta
  if (next >= 1 && next <= props.numPages) emit('goto', next)
}

defineExpose({ pickFile })
</script>

<template>
  <header class="toolbar">
      <div class="brand" title="译读 · PDF 翻译阅读器"><AppIcon name="book" :size="20" /><strong>译读</strong></div>
      <div class="toolbar__file">
        <button class="btn btn--open" :disabled="busy" @click="pickFile"><AppIcon name="file" :size="16" />打开 PDF</button>
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" style="display: none" @change="onFileChange" />
      </div>
      <nav class="toolbar__modes" aria-label="阅读模式">
        <button :class="{ active: mode === 'selection' }" :aria-pressed="mode === 'selection'" @click="emit('mode', 'selection')"><AppIcon name="translate" :size="17" />划词翻译</button>
        <button :class="{ active: mode === 'full' }" :aria-pressed="mode === 'full'" @click="emit('mode', 'full')"><AppIcon name="book" :size="17" />全文翻译</button>
      </nav>
      <div class="toolbar__document"><span class="toolbar__name" :title="fileName || '尚未打开文献'">{{ fileName || '你的下一篇，值得细读' }}</span><span v-if="numPages" class="toolbar__document-meta">{{ numPages }} PAGES</span></div>
      <div class="toolbar__reading">
      <button v-if="hasOutline && mode === 'selection'" class="btn btn--quiet" :class="{ 'btn--on': outlineOpen }" :aria-pressed="outlineOpen" title="显示或隐藏目录" @click="emit('toggle-outline')"><AppIcon name="outline" :size="17" /><span>目录</span></button>
      <template v-if="numPages > 0">
        <div class="pager">
          <button class="btn btn--icon btn--quiet" aria-label="上一页" :disabled="currentPage <= 1" @click="step(-1)"><AppIcon name="left" :size="16" /></button>
          <input v-model="pageText" class="pager__input" aria-label="跳转页码" inputmode="numeric" @keyup.enter="commitPage" @blur="commitPage" />
          <span class="pager__total">/ {{ numPages }}</span>
          <button class="btn btn--icon btn--quiet" aria-label="下一页" :disabled="currentPage >= numPages" @click="step(1)"><AppIcon name="right" :size="16" /></button>
        </div>
        <div class="zoom-controls" title="Ctrl + 滚轮缩放 PDF；也支持 Shift + 滚轮">
          <button class="btn btn--icon btn--quiet" aria-label="缩小" :disabled="scale <= 0.25" @click="emit('zoom', -1)"><AppIcon name="minus" :size="16" /></button>
          <span class="zoom-label">{{ Math.round(scale * 100) }}%</span>
          <button class="btn btn--icon btn--quiet" aria-label="放大" :disabled="scale >= 3" @click="emit('zoom', 1)"><AppIcon name="plus" :size="16" /></button>
        </div>
        <button class="btn btn--quiet fit-button" title="按窗口宽度缩放" @click="emit('fit')"><AppIcon name="fit" :size="16" /><span>适应宽度</span></button>
      </template>
      </div>
      <div class="toolbar__actions">
        <button class="btn btn--quiet" :class="{ 'btn--on': tintLabel !== '原色' }" title="切换页面色调" @click="emit('cycle-tint')"><AppIcon name="tint" :size="16" /><span>{{ tintLabel }}</span></button>
        <button v-if="mode === 'selection'" class="btn btn--quiet" :class="{ 'btn--on': panelOpen }" title="显示或隐藏翻译栏" @click="emit('toggle-panel')"><AppIcon name="panel" :size="16" /><span>翻译栏</span></button>
        <button class="btn btn--quiet" title="翻译与阅读设置" @click="emit('open-settings')"><AppIcon name="settings" :size="17" /><span>设置</span></button>
      </div>
  </header>
</template>
