// PDF 翻译阅读器的本地静态服务器。
//
// 为什么不用 `python -m http.server`：
// Python 的 mimetypes 把 .mjs 识别成 text/plain，而浏览器对
// `new Worker(url, { type: 'module' })` 做严格 MIME 校验，
// MIME 不对会直接拒绝加载 —— pdf.js 的 worker 就跑不起来。
//
// 端口冲突的处理（避免"双击启动却报错退出"）：
//   1. 目标端口上如果已经在跑本应用 → 直接打开浏览器，自己退出
//   2. 端口被别的程序占用 → 自动往后找空闲端口
//   3. 连续 20 个端口都被占 → 给出明确提示
//
// 配置文件：项目根目录的 .env
//   浏览器的本地存储是按「来源」隔离的，而来源包含端口号 —— 端口一变，
//   存在浏览器里的 API Key 就"消失"了。所以配置以磁盘文件为准：
//   .env 里的值优先级高于浏览器本地存储。
//     读：GET  /__config
//     写：POST /__config（需带 X-Pdf-Reader 头，防外部网页写入）
//
// 用法：node server.mjs [目录] [端口] [--env <配置文件>] [--open]
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createFullTranslationService, defaultOutputDir, resolveOutputDir } from './server/full-translation.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PING_PATH = '/__pdf_reader_ping'
const PING_BODY = 'pdf-translate-reader'
const CONFIG_PATH = '/__config'
const PORT_SCAN = 20

/** 取 --env <path> 的值，用独立配置文件跑测试时不污染用户自己的 .env */
function readEnvFlag(argv) {
  const i = argv.indexOf('--env')
  if (i < 0) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) return null
  return resolve(SCRIPT_DIR, v)
}

const CLI_ARGS = process.argv.slice(2)
const ENV_PATH = readEnvFlag(CLI_ARGS) ?? join(SCRIPT_DIR, '.env')

// ---------------- .env 读写 ----------------

/** .env 键名 ↔ 前端字段名 */
const ENV_KEYS = {
  BASE_URL: 'baseUrl',
  API_KEY: 'apiKey',
  MODEL: 'model',
  TEMPERATURE: 'temperature',
  TRIGGER: 'trigger',
  DEBOUNCE_MS: 'debounceMs',
  DEFAULT_ZOOM: 'defaultZoom',
  PAGE_TINT: 'pageTint',
  REASONING: 'reasoning',
  OUTPUT_DIR: 'outputDir',
  SYSTEM_PROMPT: 'systemPrompt'
}
const NUMBER_ENV_KEYS = new Set([
  'TEMPERATURE',
  'DEBOUNCE_MS',
  'DEFAULT_ZOOM',
  'PORT'
])

function unescapeQuoted(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const n = s[++i]
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === '\\' || n === '"') out += n
      else out += `\\${n}`
    } else {
      out += c
    }
  }
  return out
}

function serializeEnvValue(value) {
  const v = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
  return `"${v}"`
}

/** 纯数字不加引号，让 .env 保持好读 */
function formatEnvValue(value) {
  const s = String(value ?? '').trim()
  if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) return s
  return serializeEnvValue(value)
}

function readEnvFile() {
  const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const map = {}
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let value = t.slice(eq + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = unescapeQuoted(value.slice(1, -1))
    map[key] = value
  }
  return { map, raw }
}

/**
 * 交给前端的配置。
 *
 * 空值也要照传 —— 磁盘文件是权威来源，写空就是"我就是空的"。
 * （早先跳过空值会导致：在 .env 里删掉 API Key，应用却仍拿浏览器存储里的旧值，
 *  看起来像"改了没生效"。）
 */
function envToConfig(map) {
  const out = {}
  for (const [envKey, field] of Object.entries(ENV_KEYS)) {
    const raw = map[envKey]
    if (raw === undefined || raw === null) continue
    if (NUMBER_ENV_KEYS.has(envKey)) {
      const n = Number(raw)
      if (Number.isFinite(n)) out[field] = n
    } else {
      out[field] = raw
    }
  }
  return out
}

/** 写回 .env，保留用户手写的注释与未知键 */
function writeEnvFile(values) {
  const { raw } = readEnvFile()
  const lines = raw ? raw.split(/\r?\n/) : []
  const done = new Set()

  const out = lines.map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const eq = t.indexOf('=')
    if (eq <= 0) return line
    const key = t.slice(0, eq).trim()
    if (!(key in values)) return line
    done.add(key)
    return `${key}=${formatEnvValue(values[key])}`
  })

  if (!raw) {
    out.push('# PDF 翻译阅读器的本地配置。应用会读写这个文件，你也可以手工编辑。')
    out.push('# 注意：不要把它提交到任何公开仓库 —— 里面有你的 API Key。')
    out.push('')
  }
  for (const [key, value] of Object.entries(values)) {
    if (!done.has(key)) out.push(`${key}=${formatEnvValue(value)}`)
  }

  writeFileSync(ENV_PATH, `${out.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

const { map: initialEnv } = readEnvFile()

// ---------------- 参数与路径 ----------------

const args = CLI_ARGS
const openBrowser = args.includes('--open')
// --env 后面跟的是值，不是位置参数，要排除掉
const valueIndexes = ['--env', '--ready-file'].map(flag => args.indexOf(flag)).filter(i => i >= 0).map(i => i + 1)
const positional = args.filter((a, i) => !a.startsWith('--') && !valueIndexes.includes(i))
const readyFileIndex = args.indexOf('--ready-file')
const readyFile = readyFileIndex >= 0 ? args[readyFileIndex + 1] : null
function reportReady(url, reused) {
  if (readyFile) writeFileSync(resolve(SCRIPT_DIR, readyFile), JSON.stringify({ url, pid: reused ? null : process.pid, reused }))
}

const root = resolve(positional[0] ?? 'dist')
// 优先级：命令行 > .env 里的 PORT > 5199
const startPort = Number(positional[1] ?? initialEnv.PORT ?? 5199)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/octet-stream',
  '.pdf': 'application/pdf'
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readRequestBody(req, limit = 512 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function handleConfigRequest(req, res) {
  if (req.method === 'GET') {
    const map = readEnvFile().map
    const resolved = resolveOutputDir(map.OUTPUT_DIR)
    sendJson(res, 200, {
      ok: true,
      config: envToConfig(map),
      file: ENV_PATH,
      // 输出目录：配置的能不能用、实际会落到哪、默认在哪
      outputDir: resolved.dir,
      defaultOutputDir: defaultOutputDir(),
      outputDirTried: resolved.tried

    })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
    return
  }
  // 自定义头会让跨站请求走预检，而本服务不回应跨源预检 → 外部网页写不进来
  if (req.headers['x-pdf-reader'] !== '1') {
    sendJson(res, 403, { ok: false, error: '缺少 X-Pdf-Reader 头' })
    return
  }
  readRequestBody(req)
    .then((text) => {
      const incoming = JSON.parse(text || '{}')
      const merged = { ...readEnvFile().map }
      // 只接受已知字段，别让任意内容写进文件。
      // 这里刻意保留空值：写入来自用户点「保存」的明确动作，清空就该真的清空。
      // （而读取时会跳过空值 —— 手工编辑时留空更像"我没填"，不该抹掉已有内容。）
      for (const [envKey, field] of Object.entries(ENV_KEYS)) {
        if (!(field in incoming)) continue
        const value = incoming[field]
        if (value === undefined || value === null) continue
        merged[envKey] = value
      }
      writeEnvFile(merged)
      sendJson(res, 200, { ok: true, file: ENV_PATH })
    })
    .catch((err) => sendJson(res, 400, { ok: false, error: err.message }))
}

const fullTranslationService = createFullTranslationService({
  root: SCRIPT_DIR,
  readConfig: () => envToConfig(readEnvFile().map)
})
process.once('exit', () => fullTranslationService.shutdown())

function handleRequest(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let rel = decodeURIComponent(url.pathname)

    // 用来识别"这个端口上跑的是不是本应用"
    if (rel === PING_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(PING_BODY)
      return
    }

    if (rel === CONFIG_PATH) {
      handleConfigRequest(req, res)
      return
    }

    if (fullTranslationService.handles(rel)) {
      void fullTranslationService.handle(req, res, url)
      return
    }

    if (rel.endsWith('/')) rel += 'index.html'

    const full = resolve(join(root, rel))
    // 防止 ../ 穿越到项目外
    if (full !== root && !full.startsWith(root + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden')
      return
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found')
      return
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': statSync(full).size,
      'Cache-Control': 'no-cache'
    })
    createReadStream(full).pipe(res)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err))
  }
}

function openUrl(url) {
  const platform = process.platform
  const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open'
  const cmdArgs = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    console.log(`[server] 请手动在浏览器打开：${url}`)
  }
}

/** 目标端口上是不是已经在跑本应用 */
async function isOurInstance(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PING_PATH}`, {
      signal: AbortSignal.timeout(1200)
    })
    if (!res.ok) return false
    return (await res.text()).trim() === PING_BODY
  } catch {
    return false
  }
}

/** 尝试监听。失败不抛异常，避免 "Unhandled 'error' event" 把栈吐到用户脸上。 */
function tryListen(port) {
  return new Promise((resolvePromise) => {
    const server = createServer(handleRequest)
    const onError = (err) => {
      server.removeListener('listening', onListening)
      resolvePromise({ ok: false, code: err.code })
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolvePromise({ ok: true, server })
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function main() {
  if (!existsSync(root)) {
    console.error(`[server] 目录不存在：${root}`)
    console.error('[server] 先执行 npm run build 生成 dist/')
    process.exitCode = 1
    return
  }
  // 1) 已经在跑？那就没必要再起一个
  if (await isOurInstance(startPort)) {
    const url = `http://127.0.0.1:${startPort}/`
    console.log(`[server] ${startPort} 端口上已经有一个本应用的实例在运行。`)
    console.log(`[server] 直接使用它：${url}`)
    reportReady(url, true)
    if (openBrowser) openUrl(url)
    return
  }

  // 2) 找空闲端口
  for (let port = startPort; port < startPort + PORT_SCAN; port++) {
    const result = await tryListen(port)
    if (!result.ok) {
      if (result.code === 'EADDRINUSE') {
        console.log(`[server] 端口 ${port} 被占用，换下一个…`)
        continue
      }
      console.error(`[server] 无法在端口 ${port} 启动：${result.code}`)
      process.exitCode = 1
      return
    }

    const url = `http://127.0.0.1:${port}/`
    console.log(`[server] 目录 ${root}`)
    console.log(`[server] 配置 ${ENV_PATH}`)
    console.log(`[server] 地址 ${url}`)
    if (port !== startPort) {
      console.log('[server] 说明：端口变了不影响你的 API Key —— 配置以 .env 文件为准')
    }
    console.log('[server] 关掉这个窗口即停止服务')
    reportReady(url, false)
    if (openBrowser) openUrl(url)
    return
  }

  console.error(`[server] ${startPort} 起的 ${PORT_SCAN} 个端口全被占用了，请手动指定一个：`)
  console.error('[server]   node server.mjs dist 5300 --open')
  process.exitCode = 1
}

export { handleRequest }
export function getLocalConfig() { return envToConfig(readEnvFile().map) }

// 作为 Vite 开发服务的本地 API 模块导入时，不额外监听端口。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
