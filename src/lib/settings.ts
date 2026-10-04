import type { PageTint, ReasoningEffort, Settings } from '../types'
import { DEFAULT_SYSTEM_PROMPT } from './prompt'

/** 浏览器本地存储的键（按来源隔离，端口变了就读不到） */
const STORAGE_KEY = 'pdfreader:settings:v1'
/** 由 server.mjs 提供的配置文件读写端点 */
const CONFIG_ENDPOINT = '__config'

export const defaultSettings: Settings = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  // 模型名是厂商随时会改的字符串（deepseek-chat / deepseek-reasoner 已于
  // 2026-07-24 下线），所以这里只给一个"当前文档里的默认值"作为初值。
  // 真正可靠的做法是用设置里的「测试连接」拉取该账号当前可用的模型列表。
  model: 'deepseek-flash',
  // 学术翻译要的是稳定与忠实，不是文采。温度调高容易出现"顺手改写公式"的情况，
  // 所以默认给低值，需要更流畅的行文再往上调。
  temperature: 0.3,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  trigger: 'auto',
  // 1 秒：拖选时难免有停顿，太短会误发请求。反正有缓存兜底，
  // 重复选同一段是不花钱的。
  debounceMs: 1000,
  // 打开 PDF 时的初始缩放。150% 在常见屏幕上正文大小比较舒服，
  // 想改就改 .env 里的 DEFAULT_ZOOM。
  defaultZoom: 1.5,
  // 默认不加护眼色调，保持 PDF 原样
  pageTint: 'none',
  /**
   * 默认关闭思考模式。
   *
   * 官方文档写明 reasoning_effort 的取值是 none/low/high/max，
   * **none 关闭思考模式，默认强度为 high** —— 也就是说不动它的话
   * 模型会先"想一遍"再翻译，白等时间、白花 token；
   * 而且「思考模式下 temperature 不生效」，我们设的 0.3 会被忽略。
   */
  reasoning: 'none',
  outputDir: ''
}

/** 页面护眼色调候选。用 multiply 混合叠在页面上，白底会变成这个色，黑字仍是黑字 */
export const PAGE_TINTS: { value: PageTint; label: string; color: string }[] = [
  { value: 'none', label: '原色', color: 'transparent' },
  { value: 'green', label: '护眼绿', color: 'rgb(220 232 205)' },
  { value: 'yellow', label: '淡黄', color: '#f5e7c1' },
  { value: 'sepia', label: '羊皮纸', color: '#e7dcc6' }
]

export function tintColor(tint: PageTint): string {
  return PAGE_TINTS.find((t) => t.value === tint)?.color ?? 'transparent'
}

export function tintLabel(tint: PageTint): string {
  return PAGE_TINTS.find((t) => t.value === tint)?.label ?? '原色'
}

export const REASONING_OPTIONS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: 'none', label: '关闭（推荐）', hint: '发送 reasoning_effort: none，最快、最省' },
  { value: 'low', label: '思考·低', hint: '开启思考，强度 low' },
  { value: 'high', label: '思考·高', hint: '开启思考，强度 high（DeepSeek 的默认值）' },
  { value: 'max', label: '思考·最大', hint: '开启思考，强度 max，最慢' },
  { value: 'omit', label: '不发送此参数', hint: '留给不认 reasoning_effort 的服务商' }
]

export function reasoningLabel(value: ReasoningEffort): string {
  if (value === 'omit') return '未发送'
  return value === 'none' ? '关闭' : value
}

/** 统一做边界与兜底，避免任何来源的脏值直接影响行为 */
export function sanitizeSettings(input: Settings): Settings {
  const out = { ...input }
  out.outputDir = typeof out.outputDir === 'string' ? out.outputDir.trim() : ''
  // 老版本存过的空提示词要兜回默认值，否则翻译会直接失去全部规则
  if (!out.systemPrompt || !out.systemPrompt.trim()) out.systemPrompt = DEFAULT_SYSTEM_PROMPT
  out.debounceMs = Math.min(3000, Math.max(0, Number(out.debounceMs) || 0))
  out.temperature = Math.min(2, Math.max(0, Number(out.temperature) || 0))
  out.defaultZoom = Math.min(4, Math.max(0.25, Number(out.defaultZoom) || defaultSettings.defaultZoom))
  if (!out.baseUrl || !out.baseUrl.trim()) out.baseUrl = defaultSettings.baseUrl
  if (!out.model || !out.model.trim()) out.model = defaultSettings.model
  if (out.trigger !== 'shortcut') out.trigger = 'auto'
  if (!PAGE_TINTS.some((t) => t.value === out.pageTint)) out.pageTint = defaultSettings.pageTint
  if (!REASONING_OPTIONS.some((o) => o.value === out.reasoning)) {
    out.reasoning = defaultSettings.reasoning
  }
  return out
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultSettings }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return sanitizeSettings({ ...defaultSettings, ...parsed })
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* 隐私模式或配额满，忽略 */
  }
}

/**
 * 把配置文件里的值叠加上去。
 *
 * 只跳过 undefined / null —— 空字符串是**有效值**（文件是权威来源，
 * 写空就表示"我就是空的"）。这样在 .env 里删掉 API Key 才真的等于删掉。
 * 文件里没写的字段不会出现在 file 里，因此不受影响。
 */
export function mergeFileConfig(base: Settings, file: Partial<Settings> | null): Settings {
  if (!file) return sanitizeSettings(base)
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(file)) {
    if (value === undefined || value === null) continue
    merged[key] = value
  }
  return sanitizeSettings(merged as unknown as Settings)
}

export interface FileConfigResult {
  config: Partial<Settings> | null
  /** .env 的绝对路径，用于在界面上告诉用户配置存在哪 */
  file?: string
  error?: string
}

/** 读磁盘上的配置文件。任何失败都不该阻断启动，退回本地存储即可。 */
export async function fetchFileConfig(): Promise<FileConfigResult> {
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!res.ok) return { config: null, error: `HTTP ${res.status}` }
    const data = (await res.json()) as {
      ok?: boolean
      config?: Partial<Settings>
      file?: string
    }
    if (!data?.ok) return { config: null, error: '配置文件端点返回异常' }
    return { config: data.config ?? {}, file: data.file }
  } catch (err) {
    return { config: null, error: (err as Error).message }
  }
}

/** 写回磁盘配置 */
export async function saveFileConfig(
  settings: Settings
): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pdf-Reader': '1' },
      body: JSON.stringify(settings)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = (await res.json()) as { ok?: boolean; file?: string; error?: string }
    return data?.ok ? { ok: true, file: data.file } : { ok: false, error: data?.error ?? '未知错误' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function resetSettings(): Settings {
  return { ...defaultSettings }
}

/** 把用户随手填的 base 规范化成 chat/completions 的完整地址 */
export function resolveChatUrl(baseUrl: string): string {
  let base = baseUrl.trim()
  if (!base) base = defaultSettings.baseUrl
  base = base.replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(base)) return base
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

/** 从 chat 地址反推出 /models 地址，用于「测试连接」 */
export function resolveModelsUrl(baseUrl: string): string {
  const chat = resolveChatUrl(baseUrl)
  return chat.replace(/\/chat\/completions$/, '/models')
}
