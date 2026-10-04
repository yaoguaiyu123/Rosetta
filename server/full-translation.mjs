import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { accessSync, constants, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { removeFile, removeTreeWithin } from './files.mjs'

const ENGINE = 'pdf2zh-next-2.9.0'
const MAX_UPLOAD = 200 * 1024 * 1024
const HASH = /^[a-f0-9]{64}$/i
const TERMINAL = new Set(['done', 'error', 'cancelled'])
const PREFIX = '/__full-translation'

export function defaultOutputDir() { return join(homedir(), 'PDF译文') }

export function resolveOutputDir(configured, excluded = [], userDirectory = homedir()) {
  const candidates = [...new Set([configured?.trim() ? resolve(configured.trim()) : null,
    join(userDirectory, 'PDF译文'), join(userDirectory, 'Documents', 'PDF译文')].filter(Boolean))]
  const tried = []
  for (const dir of candidates) {
    if (excluded.includes(dir)) continue
    try { mkdirSync(dir, { recursive: true }); accessSync(dir, constants.W_OK); return { dir, tried } }
    catch (err) { tried.push({ dir, error: err.code ?? err.message }) }
  }
  return { dir: null, tried }
}

function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function sourceName(value) {
  if (!value || value !== basename(value) || /[\\/\x00-\x1f]/.test(value) || !/\.pdf$/i.test(value)) throw new Error('源文件名无效')
  return value
}

function safeStem(name) { return name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 90) || '译文' }
function digest(buffer) { return createHash('sha256').update(buffer).digest('hex') }
function within(file, dir) { const path = resolve(file); const root = resolve(dir); return path.startsWith(root + sep) }
function pdfExists(file) { try { return statSync(file).isFile() && statSync(file).size > 5 && readFileSync(file).subarray(0, 5).toString() === '%PDF-' } catch { return false } }

function upload(req) {
  return new Promise((ok, fail) => {
    const chunks = []; let size = 0; let rejected = false
    req.on('data', c => {
      size += c.length
      if (size > MAX_UPLOAD) { if (!rejected) fail(new Error('PDF 超过 200 MB，无法上传')); rejected = true; chunks.length = 0 }
      else if (!rejected) chunks.push(c)
    })
    req.on('end', () => { if (!rejected) ok(Buffer.concat(chunks)) })
    req.on('error', fail)
    req.on('aborted', () => fail(new Error('上传已取消')))
  })
}

export function createFullTranslationService({ root, readConfig, spawnProcess = spawn, outputDirectoryResolver = resolveOutputDir }) {
  const jobs = new Map()
  let active = null
  const python = join(root, '.runtime', 'pdf2zh-next', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const jobRoot = join(root, '.runtime', 'pdf2zh-next', 'jobs')
  const directories = () => [...new Set([readConfig().outputDir?.trim() ? resolve(readConfig().outputDir.trim()) : null,
    defaultOutputDir(), join(homedir(), 'Documents', 'PDF译文'), join(root, 'tempPDF')].filter(Boolean))]

  function find(name, hash) {
    for (const dir of directories()) {
      if (!existsSync(dir)) continue
      let entries
      try { entries = readdirSync(dir) } catch { continue }
      for (const index of entries.filter(f => f.endsWith('.pdfmathtranslate.json'))) {
        try {
          const data = JSON.parse(readFileSync(join(dir, index), 'utf8'))
          if (data.engine !== ENGINE || data.sourceHash !== hash) continue
          if (data.mono !== basename(data.mono) || data.dual !== basename(data.dual)) continue
          const mono = join(dir, data.mono); const dual = join(dir, data.dual)
          if (pdfExists(mono) && pdfExists(dual)) return { mono, dual, pages: data.pages, engine: ENGINE, sourceHash: hash }
        } catch { /* Skip incomplete or stale pairs. */ }
      }
      // Reuse the three previously evaluated native engine pairs only after checking original bytes.
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'evaluation-manifest.json'), 'utf8'))
        if (manifest.versions?.['pdf2zh-next'] !== '2.9.0') continue
        for (const item of manifest.papers ?? []) {
          if (item.status !== 'finished' || basename(item.source) !== name) continue
          const mono = resolve(item.mono_pdf_path); const dual = resolve(item.dual_pdf_path)
          if (!within(mono, dir) || !within(dual, dir) || !pdfExists(mono) || !pdfExists(dual)) continue
          if (digest(readFileSync(item.source)) === hash) return { mono, dual, engine: ENGINE, sourceHash: hash }
        }
      } catch { /* Evaluation samples are optional. */ }
    }
    return null
  }

  function pairInfo(pair) {
    return { sourceHash: pair.sourceHash, engine: pair.engine, pages: pair.pages,
      mono: { path: pair.mono, bytes: statSync(pair.mono).size },
      dual: { path: pair.dual, bytes: statSync(pair.dual).size } }
  }

  // Synchronous commit keeps requests from observing a half-published pair. On errors restore originals.
  function publish(job, result) {
    const config = job.config
    const monoSource = resolve(result.mono); const dualSource = resolve(result.dual)
    if (!within(monoSource, job.work) || !within(dualSource, job.work) || !pdfExists(monoSource) || !pdfExists(dualSource)) throw new Error('引擎输出文件验证失败')
    const monoBytes = readFileSync(monoSource); const dualBytes = readFileSync(dualSource)
    const excluded = []
    for (;;) {
      const selected = outputDirectoryResolver(config.outputDir, excluded)
      if (!selected.dir) throw new Error('无法保存译本，请在设置中选择可写的输出目录')
      const dir = selected.dir
      const stem = `${safeStem(job.name)}-${job.hash.slice(0, 16)}`
      const paths = [join(dir, `${stem}.no_watermark.zh.mono.pdf`), join(dir, `${stem}.no_watermark.zh.dual.pdf`), join(dir, `${stem}.pdfmathtranslate.json`)]
      const data = { engine: ENGINE, sourceName: job.name, sourceHash: job.hash, pages: result.pages,
        mono: basename(paths[0]), dual: basename(paths[1]), updatedAt: new Date().toISOString(), model: config.model }
      const buffers = [monoBytes, dualBytes, Buffer.from(JSON.stringify(data, null, 2))]
      const moved = []; const installed = []
      try {
        for (let i = 0; i < paths.length; i++) writeFileSync(`${paths[i]}.${job.id}.tmp`, buffers[i], { flag: 'wx' })
        for (const path of paths) {
          if (existsSync(path)) {
            if (!statSync(path).isFile()) throw new Error('输出路径被同名文件夹占用')
            renameSync(path, `${path}.${job.id}.backup`); moved.push(path)
          }
        }
        for (const path of paths) { renameSync(`${path}.${job.id}.tmp`, path); installed.push(path) }
      } catch (err) {
        for (const path of installed) removeFile(path)
        for (const path of moved) renameSync(`${path}.${job.id}.backup`, path)
        excluded.push(dir)
        continue
      } finally {
        for (const path of paths) removeFile(`${path}.${job.id}.tmp`)
      }
      for (const path of moved) { try { removeFile(`${path}.${job.id}.backup`) } catch { /* PDF commit already succeeded. */ } }
      return { ...pairInfo({ mono: paths[0], dual: paths[1], pages: result.pages, engine: ENGINE, sourceHash: job.hash }),
        fallbackUsed: Boolean(config.outputDir?.trim()) && resolve(config.outputDir.trim()) !== dir }
    }
  }

  function publicJob(job) {
    return { ok: true, id: job.id, status: job.status, progress: job.progress,
      result: job.result, error: job.error }
  }
  function prune() {
    for (const [id, job] of jobs) if (TERMINAL.has(job.status) && Date.now() - job.updated > 30 * 60 * 1000) jobs.delete(id)
    while (jobs.size > 30) { const old = [...jobs].find(([, j]) => TERMINAL.has(j.status)); if (!old) break; jobs.delete(old[0]) }
  }
  function cancel(job) {
    if (TERMINAL.has(job.status)) return
    job.status = 'cancelled'; job.updated = Date.now()
    if (job.child?.pid) {
      if (process.platform === 'win32') spawnProcess('taskkill', ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => job.child.kill())
      else job.child.kill('SIGTERM')
    }
  }

  function launch(job) {
    job.status = 'running'
    job.child = spawnProcess(python, [join(root, 'scripts', 'pdf2zh-worker.py')], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
    })
    let pending = ''; let result = null; let engineError = ''
    job.child.stdout.setEncoding('utf8')
    job.child.stdout.on('data', chunk => {
      pending += chunk
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break
        const line = pending.slice(0, end); pending = pending.slice(end + 1)
        try {
          const event = JSON.parse(line)
          if (job.status === 'cancelled') continue
          if (event.type === 'progress') job.progress = { stage: event.stage, percent: Math.max(job.progress.percent, event.percent), detail: event.detail, total: event.pages }
          if (event.type === 'error') engineError = String(event.error).replaceAll(job.config.apiKey, '[REDACTED]')
          if (event.type === 'finish') result = event
        } catch { /* Ignore third party non-protocol stdout. */ }
      }
      if (pending.length > 100_000) pending = ''
    })
    // Drain upstream logs, but do not store raw settings or translated document content in server logs.
    job.child.stderr.on('data', () => {})
    job.child.stdin.on('error', () => {})
    job.child.on('error', () => { engineError = '无法启动翻译引擎，请运行 npm run setup:engine 安装本地环境' })
    job.child.on('close', code => {
      if (job.status !== 'cancelled') {
        if (code === 0 && result && !engineError) {
          try {
            job.progress = { ...job.progress, stage: 'saving', percent: 99, detail: '正在保存译本' }
            job.result = publish(job, result)
            job.status = 'done'; job.progress = { ...job.progress, percent: 100, detail: '译本已生成' }
          } catch (err) { job.status = 'error'; job.error = err.message }
        } else { job.status = 'error'; job.error = engineError || '翻译引擎意外退出，请重试或检查模型设置' }
      }
      job.config = null; job.child = null; job.updated = Date.now()
      if (active === job.id) active = null
      try { removeTreeWithin(job.work, jobRoot) } catch { /* A locked temporary file can be cleaned after server shutdown. */ }
      prune()
    })
    job.child.stdin.end(JSON.stringify({ input: join(job.work, 'source.pdf'), output: job.work,
      config: job.config, replace: job.replace }) + '\n')
  }

  async function handle(req, res, url) {
    try {
      prune()
      const path = url.pathname
      if (req.method !== 'GET' && req.headers['x-pdf-reader'] !== '1') return send(res, 403, { ok: false, error: '缺少 X-Pdf-Reader 头' })
      if (path === `${PREFIX}/engine` && req.method === 'GET') return send(res, 200, { ok: true, available: existsSync(python), engine: ENGINE })
      if (path === '/__translation') {
        if (req.method !== 'GET') return send(res, 405, { ok: false, error: '只支持 GET' })
        const name = sourceName(url.searchParams.get('source')); const hash = url.searchParams.get('hash') || ''
        if (!HASH.test(hash)) return send(res, 400, { ok: false, error: '原文指纹无效' })
        const pair = find(name, hash.toLowerCase())
        if (!pair) return send(res, 404, { ok: false, exists: false })
        if (url.searchParams.get('content') !== '1') return send(res, 200, { ok: true, exists: true, ...pairInfo(pair) })
        const variant = url.searchParams.get('variant')
        if (!['mono', 'dual'].includes(variant)) return send(res, 400, { ok: false, error: '请选择中文或中英对照译本' })
        const file = pair[variant]
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
        createReadStream(file).on('error', () => res.destroy()).pipe(res)
        return
      }
      if (path === PREFIX && req.method === 'POST') {
        if (active) return send(res, 409, { ok: false, error: '已有全文翻译任务正在运行，请稍后再试' })
        if (!existsSync(python)) return send(res, 503, { ok: false, error: '本机翻译环境尚未安装，请运行 npm run setup:engine' })
        const name = sourceName(url.searchParams.get('source'))
        const config = { ...readConfig() }
        if (!config.apiKey?.trim()) return send(res, 400, { ok: false, error: '请先在设置中填写 API Key' })
        const id = randomUUID(); active = id
        let work = null
        try {
          const bytes = await upload(req)
          if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF')
          const hash = digest(bytes); const replace = url.searchParams.get('replace') === '1'
          const saved = find(name, hash)
          if (saved && !replace) { active = null; return send(res, 200, { ok: true, cached: true, result: pairInfo(saved) }) }
          work = join(jobRoot, id); mkdirSync(work, { recursive: true }); writeFileSync(join(work, 'source.pdf'), bytes)
          const job = { id, name, hash, config, replace, work, status: 'preparing', updated: Date.now(),
            progress: { stage: 'preparing', percent: 0, detail: '正在准备翻译', total: 0 } }
          jobs.set(id, job); launch(job)
          send(res, 202, publicJob(job))
        } catch (err) {
          if (active === id) active = null
          if (work) removeTreeWithin(work, jobRoot)
          throw err
        }
        return
      }
      const match = new RegExp(`^${PREFIX}/([a-f0-9-]{36})$`).exec(path)
      if (match) {
        const job = jobs.get(match[1]); if (!job) return send(res, 404, { ok: false, error: '翻译任务不存在或已过期' })
        if (req.method === 'DELETE') { cancel(job); return send(res, 200, publicJob(job)) }
        if (req.method === 'GET') return send(res, 200, publicJob(job))
      }
      send(res, 405, { ok: false, error: '不支持此操作' })
    } catch (err) { send(res, 400, { ok: false, error: err.message ?? '请求失败' }) }
  }

  return { handles: path => path === '/__translation' || path === PREFIX || path.startsWith(PREFIX + '/'),
    handle, shutdown() { for (const job of jobs.values()) cancel(job) } }
}
