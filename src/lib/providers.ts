import type { ReasoningEffort, Settings } from '../types'

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

export const MODEL_FIELDS = ['baseUrl', 'apiKey', 'model', 'temperature', 'reasoning'] as const
export function defaultProviderConfigs(): Settings['providerConfigs'] {
  return {
    deepseek: { baseUrl: PROVIDER_PRESETS.deepseek.baseUrl, apiKey: '', model: PROVIDER_PRESETS.deepseek.model, temperature: 0.3, reasoning: 'none' },
    mimo: { baseUrl: PROVIDER_PRESETS.mimo.baseUrl, apiKey: '', model: PROVIDER_PRESETS.mimo.model, temperature: 0.3, reasoning: 'none' },
    custom: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', temperature: 0.3, reasoning: 'none' },
  }
}
export function captureProviderSettings(input: Partial<Settings>) {
  const active: ModelProvider = ['deepseek','mimo','custom'].includes(input.activeProvider ?? '')
    ? input.activeProvider! : modelProvider(input.baseUrl ?? '', input.model ?? '')
  const profiles = defaultProviderConfigs()
  for (const id of ['deepseek','mimo','custom'] as const) {
    const saved = input.providerConfigs?.[id]
    if (saved) profiles[id] = { ...profiles[id], ...saved }
    const profile = profiles[id]
    profile.apiKey = typeof profile.apiKey === 'string' ? profile.apiKey.trim() : ''
    profile.baseUrl = typeof profile.baseUrl === 'string' ? profile.baseUrl.trim() : ''
    profile.model = typeof profile.model === 'string' ? profile.model.trim() : ''
    profile.temperature = Math.min(2, Math.max(0, Number(profile.temperature) || 0))
    if (!['none','omit','low','high','max'].includes(profile.reasoning)) profile.reasoning = 'none'
  }
  const current = { ...profiles[active] }
  for (const field of MODEL_FIELDS) if (input[field] !== undefined) Object.assign(current, { [field]: input[field] })
  current.apiKey = typeof current.apiKey === 'string' ? current.apiKey.trim() : ''
  current.temperature = Math.min(2, Math.max(0, Number(current.temperature) || 0))
  profiles[active] = current
  return { ...current, activeProvider: active, providerConfigs: profiles }
}
export function switchProvider(settings: Settings, next: ModelProvider): Settings {
  const captured = captureProviderSettings(settings)
  return { ...settings, ...captured, activeProvider: next, ...captured.providerConfigs[next] }
}
export function cloneSettings(settings: Settings): Settings { return JSON.parse(JSON.stringify(settings)) as Settings }
