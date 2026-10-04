// 把 pdf.js 需要「原样发布」的静态资源从 node_modules 同步到 public/。
//
// 这些文件不能被打包器处理：worker 必须是 module worker，wasm/cmaps 是运行期
// 按需 fetch 的。所以只能原样拷过去。升级 pdfjs-dist 后重跑一次即可
// （已挂在 predev / prebuild 上）。
//
// 注意：这里刻意不用 fs.cpSync —— 在本机（Node 24 / Windows）上
// 用 cpSync 递归复制目录会让进程静默退出（exit 127，无异常栈）。
// 手写的递归复制稳定可靠。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const pkgRoot = join(projectRoot, 'node_modules', 'pdfjs-dist')
const outRoot = join(projectRoot, 'public')

function copyTree(src, dest) {
  const st = statSync(src)
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true })
    let count = 0
    for (const name of readdirSync(src)) {
      count += copyTree(join(src, name), join(dest, name))
    }
    return count
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  return 1
}

if (!existsSync(pkgRoot)) {
  console.error('[sync-pdfjs] 找不到 pdfjs-dist，先执行 npm install')
  process.exit(1)
}
mkdirSync(outRoot, { recursive: true })

const items = [
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['LICENSE', 'licenses/PDF.js/LICENSE'],
  ['standard_fonts', 'standard_fonts'],
  ['cmaps', 'cmaps'],
  ['wasm', 'wasm'],
  ['iccs', 'iccs']
]

let failed = 0
for (const [from, to] of items) {
  const src = join(pkgRoot, from)
  const dest = join(outRoot, to)
  if (!existsSync(src)) {
    console.warn(`[sync-pdfjs] 跳过（node_modules 里没有）: ${from}`)
    failed++
    continue
  }
  try {
    rmSync(dest, { recursive: true, force: true })
    const count = copyTree(src, dest)
    console.log(`[sync-pdfjs] ${from} -> public/${to}（${count} 个文件）`)
  } catch (err) {
    console.error(`[sync-pdfjs] 复制失败 ${from}:`, err.message)
    failed++
  }
}

if (failed > 0) {
  console.error(`[sync-pdfjs] 有 ${failed} 项未完成，PDF 可能无法正常渲染`)
  process.exit(1)
}
// Preserve licensing alongside downloadable browser assets.
copyTree(join(projectRoot, 'licenses'), join(outRoot, 'licenses'))
for (const name of ['LICENSE', 'COPYRIGHT', 'THIRD_PARTY_NOTICES.md']) {
  copyTree(join(projectRoot, name), join(outRoot, name))
}
console.log('[sync-pdfjs] 完成')
