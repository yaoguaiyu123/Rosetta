import type { ReasoningEffort } from '../types'
import type { ChatMessage } from './prompt'
import { resolveChatUrl, resolveModelsUrl } from './settings'

export interface StreamChatOptions {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  /** 思考模式强度。DeepSeek 默认开启（high），这里默认传 none 关掉 */
  reasoning: ReasoningEffort
  messages: ChatMessage[]
  signal: AbortSignal
  /** 每收到一段增量就回调一次 */
  onDelta: (piece: string) => void
}

/** 把 HTTP 失败翻译成用户能看懂的中文，而不是丢一个 "HTTP 401" */
async function describeHttpError(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      detail = parsed.error?.message ?? text
    } catch {
      detail = text
    }
  } catch {
    /* 读不出来就算了 */
  }
  const hints: Record<number, string> = {
    400: '请求被拒绝，多半是模型名不对 —— 去设置里点「测试连接」看这个账号当前可用的模型',
    401: 'API Key 无效或已过期',
    402: '账户余额不足',
    403: '没有访问该模型的权限',
    404: '接口地址不对，检查 baseURL 是否写成了 https://api.deepseek.com/v1',
    422: '请求参数不被接受',
    429: '请求过于频繁或已超额度',
    500: '服务端错误，稍后重试',
    502: '网关错误，稍后重试',
    503: '服务暂时不可用，稍后重试'
  }
  const hint = hints[res.status] ?? ''
  const parts = [`HTTP ${res.status}`]
  if (hint) parts.push(hint)
  if (detail) parts.push(detail.slice(0, 300))
  return parts.join(' · ')
}

/** 网络层失败（DNS / 断网 / CORS）在这里被翻译成人话 */
export function describeFetchError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err)
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return '连不上接口。检查网络，或确认该服务商允许浏览器直连（CORS）。'
  }
  return msg
}

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey.trim()}`
  }
}

/**
 * 流式对话补全。
 *
 * 为什么不用官方 SDK：这里只需要一个 POST + SSE 解析，几十行就够，
 * 而且能保证换成任何 OpenAI 兼容服务商时只改 baseURL 就行。
 *
 * 注意：deepseek-reasoner 会在 delta 里附带 reasoning_content，
 * 这里刻意只取 content，把思考过程丢掉。
 */
export async function streamChat(options: StreamChatOptions): Promise<string> {
  const { baseUrl, apiKey, model, temperature, reasoning, messages, signal, onDelta } = options

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
    stream: true
  }
  // 官方文档：reasoning_effort 的 none 关闭思考模式，默认强度是 high。
  // 不显式关掉的话，模型会先"想一遍"再翻译 —— 白等时间、白花 token，
  // 而且思考模式下 temperature 根本不生效。
  if (reasoning !== 'omit') payload.reasoning_effort = reasoning

  let res: Response
  try {
    res = await fetch(resolveChatUrl(baseUrl), {
      method: 'POST',
      headers: headers(apiKey),
      signal,
      body: JSON.stringify(payload)
    })
  } catch (err) {
    if (signal.aborted) throw err
    throw new Error(describeFetchError(err))
  }

  if (!res.ok) throw new Error(await describeHttpError(res))
  if (!res.body) throw new Error('接口没有返回内容流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 以空行分隔事件；这里按行处理更稳，能容忍缺少空行的情况
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')

        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return full

        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null } }[]
          }
          const piece = chunk.choices?.[0]?.delta?.content
          if (piece) {
            full += piece
            onDelta(piece)
          }
        } catch {
          /* 忽略解析不了的行，不要因为一行脏数据中断整次翻译 */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* 忽略 */
    }
  }

  return full
}

/** 用 /models 验证 baseURL 与 Key 是否可用，顺便列出可用模型 */
export async function listModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  let res: Response
  try {
    res = await fetch(resolveModelsUrl(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal
    })
  } catch (err) {
    throw new Error(describeFetchError(err))
  }
  if (!res.ok) throw new Error(await describeHttpError(res))
  const data = (await res.json()) as { data?: { id?: string }[] }
  return (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
}
