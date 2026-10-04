// 从一份大 PDF 里抽出连续页段，供全文翻译的端到端验收使用。
// 用法：node extract-pages.mjs <源PDF> <起页> <止页> <输出PDF>
import { PDFDocument } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

const [src, fromRaw, toRaw, out] = process.argv.slice(2)
if (!src || !fromRaw || !toRaw || !out) {
  console.error('用法：node extract-pages.mjs <源PDF> <起页> <止页> <输出PDF>')
  process.exit(1)
}
const from = Number(fromRaw)
const to = Number(toRaw)
const doc = await PDFDocument.load(await readFile(src))
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > doc.getPageCount() || from > to) {
  console.error(`页码范围无效（该 PDF 共 ${doc.getPageCount()} 页）`)
  process.exit(1)
}
for (let i = doc.getPageCount() - 1; i >= 0; i--) {
  if (i < from - 1 || i > to - 1) doc.removePage(i)
}
await writeFile(out, await doc.save())
console.log(`已抽出第 ${from}-${to} 页（共 ${to - from + 1} 页）→ ${out}`)
