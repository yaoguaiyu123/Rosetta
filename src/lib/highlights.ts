/** PDF coordinates, independent of viewport scale and page rotation. */
export interface Highlight {
  key: string
  id?: string
  popupRef?: string
  pageIndex: number
  quadPoints: number[]
  rect: number[]
  color: number[]
  opacity: number
  rotation: number
  outlines: number[][]
  annotationType: number
  deleted?: boolean
}
export function highlightFromQuads(pageIndex: number, quads: number[][]): Highlight {
  const xs = quads.flatMap(q => [q[0], q[2], q[4], q[6]])
  const ys = quads.flatMap(q => [q[1], q[3], q[5], q[7]])
  return {
    key: `pdfjs_internal_editor_rosetta_${crypto.randomUUID()}`, pageIndex,
    annotationType: 9, rotation: 0, color: [255, 210, 64], opacity: 0.4,
    rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    quadPoints: quads.flat(), outlines: quads.map(q => [q[0], q[1], q[2], q[3], q[6], q[7], q[4], q[5]]),
  }
}
export function containsHighlight(h: Pick<Highlight, 'quadPoints'>, x: number, y: number) {
  const q = h.quadPoints
  for (let i = 0; i + 7 < q.length; i += 8) {
    const points = [[q[i], q[i+1]], [q[i+2], q[i+3]], [q[i+6], q[i+7]], [q[i+4], q[i+5]]]
    let positive = false, negative = false
    for (let j = 0; j < 4; j++) {
      const a = points[j], b = points[(j+1)%4]
      const cross = (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])
      if (cross > 0.001) positive = true
      if (cross < -0.001) negative = true
    }
    if (!(positive && negative)) return true
  }
  return false
}
/** Snapshots include only edits, never whole PDF bytes. One gesture = one undo step. */
export class HighlightHistory {
  edits = new Map<string, Highlight>()
  private undoStack: Map<string, Highlight>[] = []
  private saved = '[]'
  private signature() { return JSON.stringify([...this.edits].sort(([a], [b]) => a.localeCompare(b))) }
  get dirty() { return this.signature() !== this.saved }
  get canUndo() { return this.undoStack.length > 0 }
  change(updates: Highlight[], remove: string[] = []) {
    if (!updates.length && !remove.some(key => this.edits.has(key))) return
    this.undoStack.push(new Map(this.edits))
    for (const key of remove) this.edits.delete(key)
    for (const h of updates) this.edits.set(h.key, h)
  }
  undo() {
    const previous = this.undoStack.pop()
    if (previous) this.edits = previous
  }
  markSaved() { this.saved = this.signature() }
  clear() { this.edits.clear(); this.undoStack = []; this.saved = '[]' }
}
