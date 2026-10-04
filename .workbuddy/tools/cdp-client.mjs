// 项目内共用的 CDP 客户端与常用操作。
// verify-m1 / verify-m2 都基于它，避免每个验收脚本各写一份。
//
// 前置：静态服务器已起、无头浏览器已开（--remote-debugging-port=9333）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.consoleErrors = []
    this.exceptions = []
    this.logEntries = []
    this.requests = []
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error(`WebSocket 连接失败: ${wsUrl}`))
    })
    const cdp = new Cdp(ws)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id)
        cdp.pending.delete(msg.id)
        if (msg.error) reject(new Error(`CDP ${msg.error.message}`))
        else resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        cdp.consoleErrors.push(
          msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
        )
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        cdp.exceptions.push(d.exception?.description ?? d.text)
      }
      if (msg.method === 'Log.entryAdded') {
        cdp.logEntries.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`)
      }
      if (msg.method === 'Network.requestWillBeSent') {
        cdp.requests.push(msg.params.request.url)
      }
    }
    return cdp
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) {
      throw new Error(
        `页面内执行出错: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`
      )
    }
    return r.result.value
  }

  async waitFor(expression, predicate, { timeout = 30000, label } = {}) {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      last = await this.eval(expression)
      if (predicate(last)) return last
      await sleep(150)
    }
    throw new Error(`等待超时：${label ?? expression}（最后一次取值 ${JSON.stringify(last)}）`)
  }

  async screenshot(filePath) {
    mkdirSync(dirname(filePath), { recursive: true })
    const shot = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(filePath, Buffer.from(shot.data, 'base64'))
    return filePath
  }

  /** 控制台错误 + 未捕获异常 + 浏览器日志（都是"流程没失败但功能已坏"的信号） */
  problems({ ignoreFavicon = true } = {}) {
    const logs = this.logEntries.filter((l) => !(ignoreFavicon && /favicon/i.test(l)))
    return [
      ...this.consoleErrors.map((e) => `console.error: ${e}`),
      ...this.exceptions.map((e) => `未捕获异常: ${e}`),
      ...logs.map((l) => `浏览器日志: ${l}`)
    ]
  }

  async close() {
    try {
      this.ws.close()
    } catch {
      /* 忽略 */
    }
  }
}

/** 建一个空白标签页。新版 Chrome 要求 PUT，老版本 GET。 */
export async function newTarget(port, url = 'about:blank') {
  let res = await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })
  if (!res.ok) res = await fetch(`http://127.0.0.1:${port}/json/new?${url}`)
  if (!res.ok) throw new Error(`无法建立调试标签页: HTTP ${res.status}`)
  return res.json()
}

export async function closeTarget(port, targetId) {
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {})
}

/** 开好常用域并固定视口，让几何计算可复现 */
export async function preparePage(cdp, { width = 1600, height = 1000 } = {}) {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Log.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
}

export async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url })
  await cdp.waitFor('document.readyState', (v) => v === 'complete', { label: '页面加载' })
}

/** 往页面的 <input type=file> 里塞一个真实文件 */
export async function setFileInput(cdp, pdfPath) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file]'
  })
  if (!nodeId) throw new Error('页面上找不到 input[type=file]')
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [pdfPath] })
}

/**
 * 用真实鼠标事件做一次拖拽。
 * 刻意不用 Range 伪造选区 —— 只有真实事件才能验证命中测试。
 */
export async function dragMouse(cdp, from, to, steps = 10) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button: 'left',
      buttons: 1
    })
    await sleep(15)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

export async function clickSelector(cdp, selector) {
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)}).click()`
  })
}

/** 读服务端正在用的配置文件 */
export async function getFileConfig(appUrl) {
  const res = await fetch(new URL('__config', appUrl).href, { cache: 'no-store' })
  if (!res.ok) throw new Error(`读取配置失败: HTTP ${res.status}`)
  return res.json()
}

/**
 * 把配置写进「服务端正在用的那个配置文件」。
 *
 * 配置以磁盘文件为准、优先级高于 localStorage，所以验收脚本不能再用
 * localStorage 去改端点了 —— 必须改文件。配合 `server.mjs --env <path>`
 * 用独立的配置文件跑测试，就不会污染用户自己的 .env。
 */
export async function setFileConfig(appUrl, settings) {
  const res = await fetch(new URL('__config', appUrl).href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pdf-Reader': '1' },
    body: JSON.stringify(settings)
  })
  if (!res.ok) throw new Error(`写入配置失败: HTTP ${res.status}`)
  return res.json()
}

export function makeReporter() {
  const lines = []
  return {
    ok: (t) => lines.push(`  ✔ ${t}`),
    bad: (t) => lines.push(`  ✘ ${t}`),
    lines
  }
}
