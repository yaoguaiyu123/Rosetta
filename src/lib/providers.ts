import type { ReasoningEffort } from '../types'

export type ModelProvider = 'deepseek' | 'mimo' | 'custom'
export const PROVIDER_PRESETS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', keyUrl: 'https://platform.deepseek.com/' },
  mimo: { label: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', keyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys' },
}
export function modelProvider(baseUrl: string, model = ''): ModelProvider {
  try {
    const host = new URL(baseUrl).hostname
    if (host === 'xiaomimimo.com' || host.endsWith('.xiaomimimo.com')) return 'mimo'
    if (host === 'deepseek.com' || host.endsWith('.deepseek.com')) return 'deepseek'
  } catch { /* Allow a custom compatible endpoint. */ }
  return /^mimo-/i.test(model) ? 'mimo' : 'custom'
}
export function reasoningParameters(baseUrl: string, model: string, reasoning: ReasoningEffort): Record<string, unknown> {
  if (reasoning === 'omit') return {}
  if (modelProvider(baseUrl, model) === 'mimo') {
    return { thinking: { type: reasoning === 'none' ? 'disabled' : 'enabled' } }
  }
  return { reasoning_effort: reasoning }
}
