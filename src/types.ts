export interface DocInfo {
  numPages: number
  fileName: string
}

/** 一次划选的结果（未经清洗） */
export interface SelectionPayload {
  /** 用户选中的原始文本 */
  text: string
  /** 选区所在的页码，1 起 */
  page: number
  /** 生成时间戳，用于让重复内容也能触发刷新 */
  at: number
}

/** 页面护眼色调 */
export type PageTint = 'none' | 'green' | 'yellow' | 'sepia'

export type ReaderMode = 'selection' | 'full'
export type FullViewMode = 'dual' | 'chinese'

/**
 * 思考模式强度。
 * DeepSeek 的思考模式**默认是开启的（强度 high）**，会先"想一遍"再回答，
 * 翻译这种任务白等时间；而且官方文档写明「思考模式下 temperature 不生效」。
 * omit = 完全不发送该参数（给不认这个参数的服务商用）。
 */
export type ReasoningEffort = 'omit' | 'none' | 'low' | 'high' | 'max'

export interface Settings {
  /** OpenAI 兼容接口的 base，例如 https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  systemPrompt: string
  /** auto = 选中后自动翻译；shortcut = 选中后按 Ctrl+Enter 才翻 */
  trigger: 'auto' | 'shortcut'
  /** 自动触发前的防抖毫秒数 */
  debounceMs: number
  /** 打开 PDF 时的初始缩放倍数（1.5 = 150%） */
  defaultZoom: number
  /** 页面护眼色调 */
  pageTint: PageTint
  /** 思考模式强度 */
  reasoning: ReasoningEffort
  /** 全文翻译生成的 PDF 的本地保存目录；留空使用用户目录/PDF译文 */
  outputDir: string
}

export type TranslationStatus = 'idle' | 'queued' | 'streaming' | 'done' | 'error'

export interface TranslationState {
  status: TranslationStatus
  /** 送去翻译的文本 */
  source: string
  page: number
  /** 流式累积出来的译文 */
  output: string
  error: string
  /** 本次结果是否直接来自缓存（没有调用模型） */
  fromCache: boolean
  model: string
  elapsedMs: number
  /** 每次提交选区都自增，用来让界面在"内容相同但确实是新一次选择"时也能刷新 */
  revision: number
}
