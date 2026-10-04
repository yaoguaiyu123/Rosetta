// 假的 OpenAI 兼容服务：用来在没有真实 API Key 的情况下验收整条翻译链路。
//
// 它能做到：
//   - GET  /v1/models              返回模型列表（供「测试连接」用）
//   - POST /v1/chat/completions    以 SSE 流式返回，分多片发送
//   - GET  /__stats                返回收到的请求记录，供验收脚本断言
//   - POST /__reset                重置统计
//   - 处理 CORS 与 OPTIONS 预检（应用在同源之外，必须处理）
//   - 用特定模型名模拟失败：mock-unauthorized（401）、mock-server-error（500）
//
// 用法：node mock-llm.mjs [端口]（默认 5299）
const PORT = Number(process.argv[2] ?? 5299)
const CHUNK_DELAY_MS = Number(process.env.MOCK_CHUNK_DELAY_MS ?? 35)
const CHINESE_LAYOUT_TEST = process.env.MOCK_CHINESE_LAYOUT_TEST === '1'
// 劣化模式：模拟真实模型对公式标记的常见破坏（丢标记、改括号、调顺序、漏 id）。
// 默认 mock 会机械复制所有标记，曾让 fca2446 的脆弱校验在验收里全绿、
// 真实模型却频繁触发「行内公式标记在翻译中丢失」。验收必须开这个模式。
const MESSY_MARKERS = process.env.MOCK_MESSY_MARKERS === '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let chatCount = 0
let last = null
/** 全部请求的时间线，用来诊断"一次划选发了多次请求"这类问题 */
const history = []
const HISTORY_MAX = 30

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Max-Age', '600')
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** 模拟真实模型：丢掉每第 3 个标记、每第 5 个改用全角括号、其余逆序排列 */
function degradeMarkers(text) {
  const markers = text.match(/⟦F\d+_\d+⟧/g) ?? []
  const survivors = markers
    .filter((_, i) => i % 3 !== 2)
    .map((m, i) => (i % 5 === 4 ? m.replace('⟦', '【').replace('⟧', '】') : m))
    .reverse()
  const body = text.replace(/⟦F\d+_\d+⟧/g, '').replace(/\s+/g, ' ').trim()
  return `这是对${body.slice(0, 10)}的中文模拟译文。${survivors.join(' ')}`.trim()
}

/** 造一段可预测的译文，并切成多片来模拟流式 */
function buildOutput(userText) {
  try {
    const blocks = JSON.parse(userText)
    if (Array.isArray(blocks) && blocks.every((b) => typeof b?.id === 'string' && typeof b?.text === 'string')) {
      let rows = blocks.map((b) => ({
        id: b.id,
        translation: CHINESE_LAYOUT_TEST
          ? b.text.split(/(⟦F\d+_\d+⟧)/gu).map((part) => /^⟦F\d+_\d+⟧$/u.test(part)
            ? part : '这是用于检查行内公式排版的中文译文。'.repeat(Math.max(1, Math.ceil(part.length / 25)))).join('')
          : `中文译文：${b.text.replace(/\s+/g, ' ').trim()}`
      }))
      if (MESSY_MARKERS) {
        rows = blocks.map((b) => ({ id: b.id, translation: degradeMarkers(b.text) }))
        // 每批漏掉最后一个 id，逼出"单块重试"路径
        if (rows.length > 1) rows = rows.slice(0, -1)
      }
      return JSON.stringify(rows)
    }
  } catch { /* 普通划词请求不是 JSON */ }
  if (MESSY_MARKERS && /⟦F\d+_\d+⟧/.test(userText)) return degradeMarkers(userText)
  const head = userText.replace(/\s+/g, ' ').trim().slice(0, 12)
  return `【模拟译文】${head}…… 公式原样保留：x 6 = 0 · A ∈ Rn×n`
}

const server = (await import('node:http')).createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

  if (url.pathname === '/__stats') {
    json(res, 200, { chatCount, last, history })
    return
  }
  if (url.pathname === '/__reset') {
    chatCount = 0
    last = null
    history.length = 0
    json(res, 200, { ok: true })
    return
  }

  if (url.pathname.endsWith('/models') && req.method === 'GET') {
    json(res, 200, {
      object: 'list',
      data: [
        { id: 'mock-translator', object: 'model' },
        { id: 'mock-unauthorized', object: 'model' },
        { id: 'mock-server-error', object: 'model' }
      ]
    })
    return
  }

  if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
    let body
    try {
      body = await readBody(req)
    } catch {
      json(res, 400, { error: { message: '请求体不是合法 JSON' } })
      return
    }

    chatCount++
    history.push({
      n: chatCount,
      at: Date.now(),
      model: body.model,
      userText: (Array.isArray(body.messages)
        ? body.messages.find((m) => m.role === 'user')?.content ?? ''
        : ''
      ).slice(0, 60)
    })
    if (history.length > HISTORY_MAX) history.shift()

    if (body.model === 'mock-unauthorized') {
      last = { model: body.model, failed: 401 }
      json(res, 401, { error: { message: 'Authentication Fails, Your api key is invalid' } })
      return
    }
    if (body.model === 'mock-server-error') {
      last = { model: body.model, failed: 500 }
      json(res, 500, { error: { message: 'internal server error' } })
      return
    }

    const messages = Array.isArray(body.messages) ? body.messages : []
    const systemText = messages.find((m) => m.role === 'system')?.content ?? ''
    const userText = messages.find((m) => m.role === 'user')?.content ?? ''
    const output = buildOutput(userText)

    last = {
      model: body.model,
      stream: body.stream === true,
      temperature: body.temperature,
      /** 思考模式强度：官方默认是 high，应用应当显式传 none 关掉 */
      reasoningEffort: body.reasoning_effort ?? null,
      hasThinkingField: 'thinking' in body,
      messageCount: messages.length,
      systemText,
      userText,
      hasFormulaRule: /原样保留/.test(systemText),
      forbidsGuessing: /不要猜|不要凭空编造|看不懂的片段原样保留/.test(systemText),
      keepsOriginalOnly: /只输出译文本身/.test(systemText),
      output
    }

    if (body.stream !== true) {
      json(res, 200, {
        id: 'mock',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }]
      })
      return
    }

    cors(res)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    const chunkSize = 4
    for (let i = 0; i < output.length; i += chunkSize) {
      const piece = output.slice(i, i + chunkSize)
      res.write(
        `data: ${JSON.stringify({
          id: 'mock',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
        })}\n\n`
      )
      if (CHUNK_DELAY_MS > 0) await sleep(CHUNK_DELAY_MS)
    }
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  json(res, 404, { error: { message: `未知路径 ${url.pathname}` } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] http://127.0.0.1:${PORT}/v1  已就绪`)
})
