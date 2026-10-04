// 通用 DOM 探针：开一个标签页、载入指定 PDF、执行一段表达式并打印结果。
// 调 M1~M5 时反复用得上。
//
// 用法：node probe-dom.mjs <pdf路径> "<要执行的JS表达式>"
import { readFileSync } from 'node:fs'

const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/'
const PDF_PATH = process.argv[2]
const EXPR = process.argv[3] ?? 'document.title'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function newTarget() {
  let res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
  if (!res.ok) res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`)
  return res.json()
}

const target = await newTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('WebSocket 失败'))
})

let seq = 0
const pending = new Map()
const logs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) reject(new Error(m.error.message))
    else resolve(m.result)
    return
  }
  if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`)
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`)
  }
}

const send = (method, params = {}) => {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
  }
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('DOM.enable')
await send('Log.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false
})
await send('Page.navigate', { url: APP_URL })

for (let i = 0; i < 100; i++) {
  if ((await evaluate('document.readyState')) === 'complete') break
  await sleep(200)
}
for (let i = 0; i < 100; i++) {
  if (await evaluate('!!document.querySelector(".toolbar")')) break
  await sleep(200)
}

if (PDF_PATH && PDF_PATH !== '-') {
  const { root } = await send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file]'
  })
  await send('DOM.setFileInputFiles', { nodeId, files: [PDF_PATH] })
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`document.querySelectorAll('.textLayer span').length > 20`)) break
    await sleep(200)
  }
  await sleep(1200)
}

console.log('===== 探针结果 =====')
try {
  const value = await evaluate(EXPR)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
} catch (err) {
  console.log('表达式执行出错：', err.message)
}

if (logs.length) {
  console.log('\n===== 浏览器日志 =====')
  console.log(logs.filter((l) => !/favicon/i.test(l)).join('\n') || '（无）')
}

ws.close()
process.exit(0)
