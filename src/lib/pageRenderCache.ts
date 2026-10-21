export interface PagePosition { pageNumber: number; top: number; height: number }
export interface RasterEntry { pageNumber: number; bytes: number; lastUsed: number }
export const RASTER_CACHE_BYTES = 96 * 1024 * 1024
export const RASTER_CACHE_PAGES = 12
export const PREVIEW_CACHE_BYTES = 16 * 1024 * 1024
export const PREVIEW_CACHE_PAGES = 48

/** Visible pages first, then prefetch in the direction of travel. */
export function pageRenderPlan(pages: PagePosition[], top: number, height: number, motion = 0) {
  const margin = Math.max(1000, height * 1.5)
  const ahead = Math.min(Math.abs(motion) * 2, height * 2)
  const low = top - margin - (motion < 0 ? ahead : 0)
  const high = top + height + margin + (motion > 0 ? ahead : 0)
  const visible = new Set<number>()
  const wanted = pages.filter(p => {
    if (p.top < top + height && p.top + p.height > top) visible.add(p.pageNumber)
    return p.top < high && p.top + p.height > low
  })
  wanted.sort((a, b) => {
    const av = visible.has(a.pageNumber), bv = visible.has(b.pageNumber)
    if (av !== bv) return av ? -1 : 1
    const distance = (p: PagePosition) => Math.max(top - (p.top + p.height), p.top - (top + height), 0)
    const ad = distance(a), bd = distance(b)
    const aBehind = motion > 0 ? a.top < top : motion < 0 ? a.top > top : false
    const bBehind = motion > 0 ? b.top < top : motion < 0 ? b.top > top : false
    return ad + (aBehind ? height : 0) - bd - (bBehind ? height : 0)
  })
  return { visible, wanted: wanted.map(p => p.pageNumber) }
}
/** Retain the visible/in-flight set even on unusually tall displays. */
export function rasterEvictions(entries: RasterEntry[], protectedPages: Set<number>, maxBytes = RASTER_CACHE_BYTES, maxPages = RASTER_CACHE_PAGES) {
  let bytes = entries.reduce((sum, p) => sum + p.bytes, 0), count = entries.length
  const evict: number[] = []
  for (const p of [...entries].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (bytes <= maxBytes && count <= maxPages) break
    if (protectedPages.has(p.pageNumber)) continue
    evict.push(p.pageNumber); bytes -= p.bytes; count--
  }
  return evict
}
