import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = join(root, '.runtime')
mkdirSync(runtime, { recursive: true })
const environment = { ...process.env, UV_CACHE_DIR: join(runtime, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(runtime, 'python'), PYTHONUTF8: '1' }
const python = join(runtime, 'pdf2zh-next', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? '安装没有完成，请检查上方错误后重试。')
    process.exit(result.status || 1)
  }
}
if (spawnSync('uv', ['--version'], { windowsHide: true, stdio: 'ignore' }).status !== 0) {
  console.error('请先安装 uv：https://docs.astral.sh/uv/getting-started/installation/，然后重新运行 npm run setup:engine。')
  process.exit(1)
}
console.log('安装独立的 PDF 翻译环境（不会修改系统 Python）…')
run('uv', ['venv', '--allow-existing', '--python', '3.12', '--managed-python', join(runtime, 'pdf2zh-next', '.venv')])
run('uv', ['pip', 'install', '--python', python, '-r', join(root, 'scripts', 'pdf2zh-next-requirements.txt')])
console.log('准备版面模型和字体…')
run(python, [join(root, 'scripts', 'evaluate-pdf2zh-next.py'), '--warmup'])
console.log(`环境就绪：${dirname(python)}\n模型和字体保存在用户目录的 .cache/babeldoc。`)
