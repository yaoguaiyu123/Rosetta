<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TranslationState } from '../types'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  state: TranslationState
  trigger: 'auto' | 'shortcut'
  hasApiKey: boolean
  /** 磁盘配置加载完成前不显示"缺 Key"提示，避免闪一下假警告 */
  configReady: boolean
}>()

const emit = defineEmits<{
  (e: 'translate', text: string): void
  (e: 'cancel'): void
  (e: 'retry'): void
  (e: 'clear'): void
  (e: 'open-settings'): void
}>()

/** 原文可编辑：PDF 文字层有噪声时，手动删掉那截再翻往往比重新选更省事 */
const draft = ref('')
const copied = ref(false)
let copyTimer: number | undefined

watch(
  () => props.state.source,
  (value) => {
    draft.value = value
    copied.value = false
  }
)

const hasSelection = computed(() => props.state.source.trim().length > 0)
const charCount = computed(() => draft.value.replace(/\s+/g, '').length)
const busy = computed(() => props.state.status === 'queued' || props.state.status === 'streaming')
const needsManualTrigger = computed(
  () => props.trigger === 'shortcut' && props.state.status === 'idle' && hasSelection.value
)

const statusText = computed(() => {
  switch (props.state.status) {
    case 'queued':
      return '准备中…'
    case 'streaming':
      return '翻译中…'
    case 'done':
      return props.state.fromCache ? '缓存命中' : '完成'
    case 'error':
      return '出错'
    default:
      return ''
  }
})

const statusKind = computed(() => {
  if (props.state.status === 'error') return 'error'
  if (props.state.status === 'done') return props.state.fromCache ? 'cache' : 'ok'
  if (busy.value) return 'busy'
  return 'idle'
})

const elapsed = computed(() =>
  props.state.elapsedMs > 0 ? `${(props.state.elapsedMs / 1000).toFixed(1)}s` : ''
)

async function copyTranslation() {
  if (!props.state.output) return
  try {
    await navigator.clipboard.writeText(props.state.output)
    copied.value = true
    window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch {
    /* 剪贴板被拒就静默失败，用户可以手动选 */
  }
}
</script>

<template>
  <aside class="panel">
    <div class="panel__head">
      <span class="panel__heading"><AppIcon name="translate" :size="18" />划词译文</span>
      <div v-if="hasSelection" class="panel__tags">
        <span class="tag">第 {{ state.page }} 页</span>
        <span class="tag tag--accent">{{ charCount }} 字</span>
      </div>
    </div>

    <div v-if="configReady && !hasApiKey" class="notice">
      <span>还没配置 API Key，翻译功能无法使用。</span>
      <button class="btn btn--sm" @click="emit('open-settings')">去设置</button>
    </div>

    <div v-if="hasSelection" class="panel__body">
      <div class="panel__section">
        <div class="panel__label">
          <span>原文 · 划选内容</span>
          <span class="tag">可编辑</span>
        </div>
        <textarea v-model="draft" class="textarea textarea--source" spellcheck="false" />
      </div>

      <div class="panel__section">
        <div class="panel__label">
          <span>译文</span>
          <span class="status" :class="`status--${statusKind}`" data-status>
            <i class="dot" />{{ statusText }}
          </span>
          <span v-if="elapsed" class="tag">{{ elapsed }}</span>
          <span v-if="state.model" class="tag tag--dim">{{ state.model }}</span>
        </div>

        <div v-if="state.status === 'error'" class="output output--error" data-translation>
          {{ state.error }}
        </div>

        <div v-else-if="state.output" class="output" data-translation>
          <span>{{ state.output }}</span><i v-if="busy" class="caret" />
        </div>

        <div v-else-if="state.status === 'queued'" class="output output--muted" data-translation>
          正在准备…
        </div>

        <div
          v-else-if="state.status === 'streaming'"
          class="output output--muted output--wait"
          data-translation
        >
          <i class="caret" />
        </div>

        <div v-else-if="needsManualTrigger" class="output output--muted" data-translation>
          已捕获选区。按 <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 翻译，或直接点下面的「翻译」。
        </div>

        <div v-else class="output output--muted" data-translation>
          选中左侧文字后，译文会在这里流式出现。
        </div>
      </div>
    </div>

    <div v-else class="panel__placeholder">
      <div class="panel__empty-icon"><AppIcon name="translate" :size="26" /></div>
      <strong>从一句话开始理解</strong>
      <p>在文档中划选文字，<br />原文与译文会显示在这里。</p>
      <span class="panel__shortcut">{{ trigger === 'auto' ? '选中后自动翻译' : 'Ctrl + Enter 触发翻译' }}</span>
    </div>

    <div v-if="hasSelection" class="panel__footer">
      <button v-if="needsManualTrigger" class="btn btn--primary" @click="emit('translate', draft)">
        翻译
      </button>
      <button v-if="busy" class="btn" @click="emit('cancel')">停止</button>
      <button
        v-if="state.status === 'done' || state.status === 'error'"
        class="btn"
        @click="emit('translate', draft)"
      >
        重新翻译
      </button>
      <button class="btn" :disabled="!state.output" @click="copyTranslation">
        {{ copied ? '已复制' : '复制译文' }}
      </button>
      <div class="panel__foot-spacer" />
      <button class="btn" @click="emit('clear')">清空</button>
    </div>
  </aside>
</template>
