import { reactive, ref } from 'vue'
import type { SelectionPayload, Settings, TranslationState } from '../types'
import { streamChat } from '../lib/deepseek'
import { buildMessages } from '../lib/prompt'
import { getCached, makeCacheKey, putCached } from '../lib/cache'
import { hasProtectedMath, protectMath, restoreMath } from '../lib/mathProtection'

export function useTranslation(getSettings: () => Settings) {
  const state = reactive<TranslationState>({
    status: 'idle',
    source: '',
    page: 0,
    output: '',
    error: '',
    fromCache: false,
    model: '',
    elapsedMs: 0,
    revision: 0
  })

  /** shortcut 模式下等着用户按键的那次选区 */
  const pending = ref<SelectionPayload | null>(null)

  let controller: AbortController | null = null
  let timer: number | undefined
  /**
   * 请求代号。每次发起或取消都自增，回调里先比对代号，
   * 这样被打断的旧请求即使晚到也不会污染界面。
   */
  let seq = 0
  /**
   * 上一次提交的选区指纹。
   * 拖拽过程中 selectionchange 会触发很多次，两次之间只要超过防抖窗口
   * 就会各发一次请求 —— 指纹去重把同一段文字收敛成一次。
   */
  let lastFingerprint = ''

  function stopTimer() {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  function abortInFlight() {
    seq++
    controller?.abort()
    controller = null
  }

  function cancel() {
    stopTimer()
    abortInFlight()
    if (state.status === 'streaming' || state.status === 'queued') {
      state.status = state.output.trim() ? 'done' : 'idle'
    }
  }

  function resetOutput() {
    state.output = ''
    state.error = ''
    state.fromCache = false
    state.elapsedMs = 0
  }

  /**
   * 真正发请求。
   * force = true 时跳过缓存（用于「重新翻译」）。
   */
  async function translate(text: string, page: number, force = false) {
    const trimmed = text.trim()
    if (!trimmed) return

    stopTimer()
    const mySeq = ++seq
    controller?.abort()
    const ctrl = new AbortController()
    controller = ctrl

    const settings = getSettings()
    const protectedText = protectMath(trimmed)
    state.source = text
    state.page = page
    state.model = settings.model
    resetOutput()

    const cacheKey = makeCacheKey(protectedText.pieces.length ? `公式保护v2:${trimmed}` : trimmed, settings)
    if (!force) {
      const hit = getCached(cacheKey)
      if (hit) {
        state.output = hit
        state.status = 'done'
        state.fromCache = true
        return
      }
    }

    if (!settings.apiKey.trim()) {
      state.status = 'error'
      state.error = '还没有填 API Key。点右上角「设置」，把 DeepSeek 的 Key 填进去。'
      return
    }

    const startedAt = Date.now()
    state.status = 'streaming'
    try {
      const messages = buildMessages(protectedText.input, settings)
      if (protectedText.pieces.length) {
        messages[0].content += '\n\n形如 ⟦M1⟧ 的标记是原文公式。译文中必须保留每个标记，顺序和次数都不能改变。'
      }
      let rawOutput = ''
      await streamChat({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: settings.temperature,
        reasoning: settings.reasoning,
        messages,
        signal: ctrl.signal,
        onDelta: (piece) => {
          if (mySeq === seq) {
            rawOutput += piece
            state.output = restoreMath(protectedText, rawOutput)
          }
        }
      })
      if (mySeq !== seq) return
      if (!hasProtectedMath(protectedText, rawOutput)) {
        state.output = ''
        throw new Error('模型丢失了行内公式标记，已停止显示这次译文；请缩小选区后重试。')
      }
      state.elapsedMs = Date.now() - startedAt
      state.status = 'done'
      if (state.output.trim()) putCached(cacheKey, state.output)
    } catch (err) {
      if (mySeq !== seq) return
      state.elapsedMs = Date.now() - startedAt
      if (ctrl.signal.aborted) {
        state.status = state.output.trim() ? 'done' : 'idle'
        return
      }
      state.status = 'error'
      state.error = (err as Error).message
    }
  }

  /** 来自阅读区的选区 */
  function submit(payload: SelectionPayload) {
    const settings = getSettings()
    const fingerprint = makeCacheKey(payload.text, settings)
    const duplicate =
      fingerprint === lastFingerprint && state.status !== 'error' && payload.text.trim() !== ''

    if (duplicate) {
      // 同一段文字不重复请求；但界面必须反映出"这次选区确实被收到了" ——
      // 用户可能改过原文，或者只是没看到变化，不刷新就会以为功能坏了。
      state.source = payload.text
      state.page = payload.page
      state.revision++
      if (state.status === 'done') state.fromCache = true
      return
    }

    lastFingerprint = payload.text.trim() ? fingerprint : ''
    stopTimer()
    abortInFlight()
    resetOutput()
    state.source = payload.text
    state.page = payload.page
    state.model = settings.model
    state.revision++

    if (settings.trigger === 'shortcut') {
      // 只登记，等用户按 Ctrl+Enter 或点面板上的按钮
      pending.value = payload
      state.status = 'idle'
      return
    }

    pending.value = payload
    state.status = 'queued'
    timer = window.setTimeout(() => {
      timer = undefined
      pending.value = null
      void translate(payload.text, payload.page)
    }, Math.max(0, settings.debounceMs))
  }

  /** 手动触发（快捷键或面板按钮），优先用传入的文本 */
  function translateNow(text?: string) {
    const src = text ?? pending.value?.text ?? state.source
    const page = pending.value?.page ?? state.page
    if (!src.trim()) return
    stopTimer()
    pending.value = null
    void translate(src, page)
  }

  function retry() {
    void translate(state.source, state.page, true)
  }

  function clear() {
    stopTimer()
    abortInFlight()
    pending.value = null
    // 清空后允许重新翻译同一段
    lastFingerprint = ''
    Object.assign(state, {
      status: 'idle' as const,
      source: '',
      page: 0,
      output: '',
      error: '',
      fromCache: false,
      model: '',
      elapsedMs: 0
    })
  }

  return { state, pending, submit, translate, translateNow, retry, cancel, clear }
}
