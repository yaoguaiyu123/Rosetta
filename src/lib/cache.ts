import type { Settings } from '../types'

const STORAGE_KEY = 'pdfreader:cache:v1'
/** 上限，防止 localStorage 被塞满（约 5MB 配额） */
const MAX_ENTRIES = 400

interface Entry {
  /** 译文 */
  t: string
  /** 写入时间，用于淘汰 */
  at: number
}

/** FNV-1a 32 位：够快够用，只用来做缓存键，不需要抗碰撞 */
export function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/** 缓存键要包含模型与提示词 —— 改了提示词就必须重翻，否则会拿到旧规则的结果 */
export function makeCacheKey(text: string, settings: Settings): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return hashString(`${settings.model}|${hashString(settings.systemPrompt)}|${normalized}`)
}

function readAll(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Entry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, Entry>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* 配额满：丢掉一半重试一次，还不行就放弃 */
    try {
      const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at)
      const kept = Object.fromEntries(entries.slice(0, Math.floor(entries.length / 2)))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
    } catch {
      /* 放弃缓存，不影响主流程 */
    }
  }
}

export function getCached(key: string): string | null {
  const entry = readAll()[key]
  return entry?.t ?? null
}

export function putCached(key: string, translation: string) {
  const map = readAll()
  map[key] = { t: translation, at: Date.now() }

  const entries = Object.entries(map)
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].at - a[1].at)
    for (const [k] of entries.slice(MAX_ENTRIES)) delete map[k]
  }
  writeAll(map)
}

export function cacheCount(): number {
  return Object.keys(readAll()).length
}

export function clearCache(): number {
  const n = cacheCount()
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
  return n
}
