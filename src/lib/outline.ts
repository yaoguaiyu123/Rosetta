import type { PDFDocumentProxy } from 'pdfjs-dist'

/** 目录里的一个节点，页码已经解析成 1 起 */
export interface OutlineNode {
  id: string
  title: string
  /** 1 起的页码；解析不出来时为 null（这种节点只当分组用，点了不跳转） */
  page: number | null
  children: OutlineNode[]
}

/** pdf.js 返回的原始节点结构（官方类型是内联的，这里按需取字段） */
interface RawOutlineNode {
  title?: string
  dest?: string | unknown[] | null
  url?: string | null
  items?: RawOutlineNode[]
}

/**
 * 把 dest 解析成页码。
 *
 * dest 有两种形态：
 *   - 字符串：命名目标，要先 getDestination 查出来
 *   - 数组：显式目标，第 0 项是指向页对象的引用
 * 而且引用可能是 {num, gen} 也可能直接是页码数字，两种情况都要接。
 */
async function destToPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  if (dest === null || dest === undefined) return null
  try {
    let resolved: unknown = dest
    if (typeof resolved === 'string') {
      resolved = await doc.getDestination(resolved)
    }
    if (!Array.isArray(resolved) || resolved.length === 0) return null

    const ref = resolved[0]
    if (typeof ref === 'number') return ref + 1
    if (ref && typeof ref === 'object' && 'num' in ref) {
      const index = await doc.getPageIndex(ref as { num: number; gen: number })
      return index + 1
    }
    return null
  } catch {
    // 个别条目解析失败不该影响整份目录
    return null
  }
}

/**
 * 读出文档的目录（书签）树并解析出页码。
 *
 * 没有目录的 PDF 很常见（很多论文、扫描件都没有），所以返回空数组而不是报错。
 */
export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  let raw: RawOutlineNode[] | null = null
  try {
    raw = (await doc.getOutline()) as unknown as RawOutlineNode[] | null
  } catch {
    return []
  }
  if (!raw || raw.length === 0) return []

  let seq = 0

  async function walk(nodes: RawOutlineNode[]): Promise<OutlineNode[]> {
    const out: OutlineNode[] = []
    for (const node of nodes) {
      const children = Array.isArray(node.items) ? await walk(node.items) : []
      // 自己没目标但子节点有的话，退而用第一个子节点的页码，
      // 这样点"Part I"也能跳到该部分开头，而不是毫无反应
      const own = await destToPage(doc, node.dest)
      const page = own ?? children.find((c) => c.page !== null)?.page ?? null
      out.push({
        id: `o${seq++}`,
        title: (node.title ?? '').replace(/\s+/g, ' ').trim() || '(未命名)',
        page,
        children
      })
    }
    return out
  }

  return walk(raw)
}

/** 拍平成带层级的列表，供界面渲染 */
export interface FlatOutlineRow {
  node: OutlineNode
  depth: number
  hasChildren: boolean
  expanded: boolean
}

export function flattenOutline(
  nodes: OutlineNode[],
  expanded: Set<string>,
  depth = 0,
  out: FlatOutlineRow[] = []
): FlatOutlineRow[] {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0
    const isExpanded = hasChildren && expanded.has(node.id)
    out.push({ node, depth, hasChildren, expanded: isExpanded })
    if (isExpanded) flattenOutline(node.children, expanded, depth + 1, out)
  }
  return out
}

/** 默认展开：顶层分组展开，更深的折叠起来 */
export function defaultExpanded(nodes: OutlineNode[]): Set<string> {
  return new Set(nodes.map((n) => n.id))
}

/**
 * 找出当前页对应的高亮项：页码不超过当前页的最靠后那一条。
 * 目录的层级顺序是按文档顺序来的，所以直接顺序扫一遍即可。
 */
export function findCurrentRow(rows: FlatOutlineRow[], currentPage: number): string | null {
  let hit: string | null = null
  for (const row of rows) {
    if (row.node.page !== null && row.node.page <= currentPage) hit = row.node.id
  }
  return hit
}
