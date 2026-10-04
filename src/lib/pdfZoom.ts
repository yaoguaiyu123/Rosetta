export const MIN_PDF_ZOOM = 0.25
export const MAX_PDF_ZOOM = 3
export const PDF_ZOOM_STEP = 0.05

/** Use the displayed percentage as the starting point, including arbitrary fit scales. */
export function nextPdfZoom(scale: number, steps: number) {
  if (!steps) return scale
  const next = (Math.round(scale * 100) + steps * PDF_ZOOM_STEP * 100) / 100
  return Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, next))
}
