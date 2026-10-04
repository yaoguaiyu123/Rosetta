import { saveFileConfig } from './settings'
import type { Settings } from '../types'
import type { SavedTranslation } from './savedTranslation'

export const FULL_TRANSLATION_PAGE_LIMIT = 40
export interface FullTranslationProgress {
  stage: string
  percent: number
  detail: string
  total: number
}
interface Job {
  id?: string
  status?: 'preparing' | 'running' | 'done' | 'error' | 'cancelled'
  progress?: FullTranslationProgress
  result?: SavedTranslation
  error?: string
  cached?: boolean
}

async function readResponse(response: Response): Promise<Job> {
  const data = await response.json() as Job
  if (!response.ok) throw new Error(data.error ?? `本机翻译服务返回 HTTP ${response.status}`)
  return data
}
function cancelled() { return new DOMException('已取消全文翻译', 'AbortError') }
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { window.clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cancelled()) }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 700)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
export async function createFullTranslation(file: File, settings: Settings, signal: AbortSignal,
  onProgress: (progress: FullTranslationProgress) => void, replaceExisting = false): Promise<SavedTranslation> {
  onProgress({ stage: 'uploading', percent: 0, detail: '正在上传原文', total: 0 })
  const config = await saveFileConfig(settings)
  if (!config.ok) throw new Error(`无法保存翻译设置：${config.error}`)
  if (signal.aborted) throw cancelled()
  const query = new URLSearchParams({ source: file.name, replace: replaceExisting ? '1' : '0' })
  // Observe creation even after cancellation, so we can cancel the returned job ID.
  const initial = await readResponse(await fetch(`__full-translation?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Pdf-Reader': '1' }, body: file,
  }))
  if (initial.cached && initial.result) {
    if (signal.aborted) throw cancelled()
    return initial.result
  }
  const id = initial.id
  if (!id) throw new Error('本机服务没有创建翻译任务')
  const cancel = () => { void fetch(`__full-translation/${id}`, {
    method: 'DELETE', headers: { 'X-Pdf-Reader': '1' }, keepalive: true,
  }).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) { cancel(); throw cancelled() }
    let job = initial
    for (;;) {
      if (job.progress) onProgress(job.progress)
      if (job.status === 'done' && job.result) return job.result
      if (job.status === 'error') throw new Error(job.error ?? '全文翻译失败')
      if (job.status === 'cancelled') throw cancelled()
      await pause(signal)
      job = await readResponse(await fetch(`__full-translation/${id}`, { signal, cache: 'no-store' }))
    }
  } catch (err) { cancel(); throw err }
  finally { signal.removeEventListener('abort', cancel) }
}
