export type TranslationVariant = 'mono' | 'dual'

export interface SavedTranslation {
  sourceHash: string
  engine: string
  pages?: number
  mono: { path: string; bytes: number }
  dual: { path: string; bytes: number }
  fallbackUsed?: boolean
}

export async function sourceHash(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

function endpoint(file: File, hash: string, variant?: TranslationVariant) {
  const query = new URLSearchParams({ source: file.name, hash })
  if (variant) { query.set('content', '1'); query.set('variant', variant) }
  return `__translation?${query}`
}

export async function findSavedTranslation(file: File, signal: AbortSignal): Promise<SavedTranslation | null> {
  const hash = await sourceHash(file)
  if (signal.aborted) throw new DOMException('已取消查找译本', 'AbortError')
  const response = await fetch(endpoint(file, hash), { signal, cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`查找已有译本失败：HTTP ${response.status}`)
  const data = await response.json() as SavedTranslation
  if (!data.mono?.path || !data.dual?.path) throw new Error('本地服务返回的译本不完整')
  return data
}

export async function loadSavedTranslation(file: File, saved: SavedTranslation, variant: TranslationVariant, signal: AbortSignal): Promise<File> {
  const response = await fetch(endpoint(file, saved.sourceHash, variant), { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`打开译本失败：HTTP ${response.status}`)
  if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('本地服务返回的不是 PDF 译本')
  const blob = await response.blob()
  return new File([blob], saved[variant].path.split(/[\\/]/).pop() ?? `${variant}.pdf`, { type: 'application/pdf' })
}
