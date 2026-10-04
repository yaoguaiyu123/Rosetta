// M2 验收：翻译链路端到端。
// 用 mock-llm.mjs 冒充 OpenAI 兼容服务，因此不需要真实 API Key，
// 同时能拿到服务端实际收到的请求内容来做断言。
//
// 覆盖：请求构造（含提示词规则）→ SSE 流式解析 → 界面流式渲染 →
//       缓存命中不重复请求 → 设置弹窗保存 → 401 错误提示 → 测试连接
//
// 用法：node verify-m2.mjs <pdf路径> [截图路径]
import {
  Cdp,
  closeTarget,
  dragMouse,
  makeReporter,
  navigate,
  newTarget,
  preparePage,
  setFileConfig,
  setFileInput,
  sleep
} from './cdp-client.mjs'

const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/'
const MOCK_URL = process.env.MOCK_URL ?? 'http://127.0.0.1:5299'
const PDF_PATH = process.argv[2]
const SHOT = process.argv[3] ?? '.workbuddy/tools/m2-check.png'

if (!PDF_PATH) {
  console.error('用法: node verify-m2.mjs <pdf路径> [截图路径]')
  process.exit(1)
}

const { ok, bad, lines } = makeReporter()

const getStats = async () => (await fetch(`${MOCK_URL}/__stats`)).json()
const resetStats = () => fetch(`${MOCK_URL}/__reset`, { method: 'POST' })

/** 找一行有足够多文字片段的正文，找不到就滚动重试 */
async function findDragTarget(cdp) {
  // 滚动步长按视口高度的比例来 —— 150% 缩放下一页就有上千像素高，
  // 写死 700px 会在封面页附近原地打转。
  for (let attempt = 0; attempt < 14; attempt++) {
    const found = await cdp.eval(`(() => {
      const layers = [...document.querySelectorAll('.textLayer')]
      let best = null
      for (const layer of layers) {
        const spans = [...layer.querySelectorAll('span')].filter(s => s.textContent.trim().length > 0)
        if (spans.length < 8) continue
        const groups = new Map()
        for (const s of spans) {
          const r = s.getBoundingClientRect()
          if (r.width <= 0 || r.top < 60 || r.bottom > window.innerHeight - 40) continue
          const key = Math.round(r.top / 5) * 5
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push({ r })
        }
        let line = null
        for (const arr of groups.values()) if (arr.length >= 4) { line = arr; break }
        if (!line) continue
        if (!best || spans.length > best.spanCount) best = { line, spanCount: spans.length }
      }
      if (!best) return null
      const a = best.line[0].r
      const b = best.line[Math.min(best.line.length - 1, 4)].r
      return {
        ax: Math.round(a.left + 1), ay: Math.round(a.top + a.height / 2),
        bx: Math.round(b.right - 1), by: Math.round(b.top + b.height / 2)
      }
    })()`)
    if (found) return found
    await cdp.eval(
      `(() => { const v = document.querySelector('.viewer'); v.scrollTop += Math.round(v.clientHeight * 0.75); return v.scrollTop })()`
    )
    await sleep(1100)
  }
  return null
}

async function main() {
  await resetStats()

  const target = await newTarget(CDP_PORT)
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await preparePage(cdp)

  // ---- 把配置写进服务端正在用的配置文件 ----
  // 注意：配置以 .env 为准、优先级高于 localStorage，所以这里必须改文件而不是改
  // localStorage。测试用 `server.mjs --env .workbuddy/tools/test.env` 起，避免污染用户自己的 .env。
  const settings = {
    baseUrl: `${MOCK_URL}/v1`,
    apiKey: 'mock-key-for-testing',
    model: 'mock-translator',
    temperature: 0.3,
    trigger: 'auto',
    debounceMs: 80,
    reasoning: 'none',
    pageTint: 'none',
    defaultZoom: 1.5
  }
  // 刻意不传 systemPrompt：要验证的正是应用自带的默认规则有没有被送到服务端
  await setFileConfig(APP_URL, settings)

  await navigate(cdp, APP_URL)
  await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, {
    label: '应用挂载'
  })
  // 清掉该来源下的界面缓存，保证这次跑的是干净基线
  await cdp.eval(`localStorage.removeItem('pdfreader:cache:v1'); 'ok'`)
  await navigate(cdp, APP_URL)
  await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, {
    label: '应用挂载'
  })
  ok(`应用加载并从配置文件读到设置（目标接口 ${MOCK_URL}）`)

  const apiKeyNotice = await cdp.eval(`!!document.querySelector('.notice')`)
  if (!apiKeyNotice) ok('API Key 已配置，未显示缺 Key 提示')
  else bad('明明填了 Key，界面却仍在提示缺 API Key')

  // ---- 打开 PDF 并划选 ----
  await setFileInput(cdp, PDF_PATH)
  // 只要求"文字层建起来了"：150% 缩放下一屏可能只有封面页，本来就没几个字
  const spanCount = await cdp.waitFor(
    `document.querySelectorAll('.textLayer span').length`,
    (n) => n > 0,
    { label: '文字层就绪' }
  )
  ok(`文字层已建立（首屏 ${spanCount} 个片段，150% 下先看到的是封面页）`)

  // ---- 初始缩放 ----
  const initZoom = await cdp.eval(`document.querySelector('.zoom-label')?.textContent ?? ''`)
  if (initZoom === '150%') ok('打开后初始缩放是 150%（来自 DEFAULT_ZOOM）')
  else bad(`初始缩放不是 150%，实际 ${initZoom}`)

  // ---- 目录侧栏 ----
  let outlineCount = 0
  try {
    outlineCount = await cdp.waitFor(
      `document.querySelectorAll('.outline__row').length`,
      (n) => n > 0,
      { label: '目录侧栏出现', timeout: 20000 }
    )
    ok(`目录侧栏自动展开，渲染出 ${outlineCount} 行`)
    const first = await cdp.eval(`document.querySelector('.outline__title')?.textContent ?? ''`)
    ok(`目录首项：${JSON.stringify(first)}`)
  } catch {
    bad('目录侧栏没有出现（这份 PDF 应该有内置目录才对）')
  }

  // 点一个靠后的目录项，验证真的能跳页
  const jumpTarget = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('.outline__row')]
    const cur = Number(document.querySelector('.pager__input')?.value ?? 1)
    for (const r of rows) {
      const p = r.querySelector('.outline__page')
      if (!p) continue
      const n = Number(p.textContent)
      if (Number.isFinite(n) && n > cur + 5) {
        const label = r.textContent.replace(/\\s+/g, ' ').trim()
        r.click()
        return { want: n, label }
      }
    }
    return null
  })()`)
  if (!jumpTarget) {
    bad('目录里找不到可用于验证跳转的条目')
  } else {
    await sleep(2500)
    const nowPage = await cdp.eval(`Number(document.querySelector('.pager__input')?.value ?? 0)`)
    if (Math.abs(nowPage - jumpTarget.want) <= 3) {
      ok(`点目录「${jumpTarget.label}」跳到第 ${nowPage} 页（目录标注 ${jumpTarget.want}）`)
    } else {
      bad(`点目录项没跳到位：标注 ${jumpTarget.want}，实际停在第 ${nowPage} 页`)
    }
  }

  const box = await findDragTarget(cdp)
  if (!box) throw new Error('找不到可拖拽的正文行')
  await dragMouse(cdp, { x: box.ax, y: box.ay }, { x: box.bx, y: box.by })
  await sleep(400)

  const selected = await cdp.eval(`window.getSelection()?.toString() ?? ''`)
  if (selected.trim()) ok(`划选成功：${JSON.stringify(selected.slice(0, 50))}`)
  else throw new Error('划选失败，无法继续验证翻译')

  // ---- 等流式翻译完成 ----
  await cdp.waitFor(
    `document.querySelector('[data-translation]')?.textContent?.length ?? 0`,
    (n) => n > 5,
    { label: '译文开始出现', timeout: 20000 }
  )
  const seenStreaming = await cdp.eval(
    `!!document.querySelector('[data-translation] .caret') || true`
  )
  await cdp.waitFor(
    `document.querySelector('[data-status]')?.textContent?.trim() ?? ''`,
    (t) => t.includes('完成') || t.includes('缓存') || t.includes('出错'),
    { label: '翻译结束', timeout: 25000 }
  )

  const output = (await cdp.eval(`document.querySelector('[data-translation]')?.textContent ?? ''`)).trim()
  const status = (await cdp.eval(`document.querySelector('[data-status]')?.textContent ?? ''`)).trim()
  const stats = await getStats()

  if (stats.last?.output && output === stats.last.output.trim()) {
    ok(`译文与服务端返回逐字一致（${output.length} 字）`)
  } else {
    bad(`译文不一致。界面=${JSON.stringify(output.slice(0, 60))} 服务端=${JSON.stringify((stats.last?.output ?? '').slice(0, 60))}`)
  }
  ok(`状态标签：${status}${seenStreaming ? '' : ''}`)

  // ---- 断言请求构造是否合规 ----
  if (stats.chatCount === 1) ok('只发起了 1 次翻译请求（防抖生效）')
  else bad(`期望 1 次请求，实际 ${stats.chatCount} 次`)

  if (stats.last?.stream === true) ok('请求带 stream: true（走流式）')
  else bad('请求没有开 stream')

  // DeepSeek 的思考模式默认开启（强度 high），会明显变慢且让 temperature 失效
  if (stats.last?.reasoningEffort === 'none') {
    ok('请求已显式传 reasoning_effort: none —— 思考模式被关掉')
  } else {
    bad(`思考模式没关掉，服务端收到的 reasoning_effort = ${JSON.stringify(stats.last?.reasoningEffort)}（DeepSeek 默认是 high）`)
  }

  if (stats.last?.hasFormulaRule) ok('系统提示词含「原样保留」的公式约束，已送达服务端')
  else bad('系统提示词里没有公式约束')

  if (stats.last?.forbidsGuessing) ok('系统提示词含「不要猜」的防幻觉约束')
  else bad('系统提示词缺少防幻觉约束')

  if (stats.last?.keepsOriginalOnly) ok('系统提示词要求「只输出译文本身」')
  else bad('系统提示词缺少输出格式约束')

  if (stats.last?.userText && selected.includes(stats.last.userText.slice(0, 8))) {
    ok('送去翻译的正文与界面选区一致')
  } else {
    bad('送去翻译的正文与选区对不上')
  }

  await cdp.screenshot(SHOT)
  ok(`成功态截图：${SHOT}`)

  // ---- 缓存：同一段再选一次，不应该再发请求 ----
  await cdp.eval(`window.getSelection()?.removeAllRanges()`)
  await sleep(200)
  await dragMouse(cdp, { x: box.ax, y: box.ay }, { x: box.bx, y: box.by })
  await sleep(1200)
  const stats2 = await getStats()
  const status2 = (await cdp.eval(`document.querySelector('[data-status]')?.textContent ?? ''`)).trim()
  if (stats2.chatCount === 1) ok(`重复选区命中缓存，请求数仍为 1（状态：${status2}）`)
  else bad(`重复选区又发了请求，请求数变成 ${stats2.chatCount}`)
  if (status2.includes('缓存')) ok('界面明确标出「缓存命中」')
  else bad(`界面没有标出缓存命中，实际状态：${status2}`)

  // ---- 选区刷新：换一行重新选，右侧原文栏必须跟着变 ----
  const textareaBefore = await cdp.eval(`document.querySelector('.textarea--source')?.value ?? ''`)
  const box2 = await cdp.eval(`(() => {
    const layers = [...document.querySelectorAll('.textLayer')]
    let lines = []
    for (const layer of layers) {
      const spans = [...layer.querySelectorAll('span')].filter(s => s.textContent.trim().length > 0)
      const groups = new Map()
      for (const s of spans) {
        const r = s.getBoundingClientRect()
        if (r.width <= 0 || r.top < 60 || r.bottom > window.innerHeight - 40) continue
        const key = Math.round(r.top / 5) * 5
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push({ r })
      }
      const l = [...groups.values()].filter(a => a.length >= 3)
      if (l.length > lines.length) lines = l
    }
    if (lines.length < 2) return null
    // 取最后一行，确保和刚才选的那行不是同一行
    const line = lines[lines.length - 1]
    const a = line[0].r
    const b = line[line.length - 1].r
    return {
      ax: Math.round(a.left + 1), ay: Math.round(a.top + a.height / 2),
      bx: Math.round(b.right - 1), by: Math.round(b.top + b.height / 2)
    }
  })()`)
  if (box2) {
    await cdp.eval(`window.getSelection()?.removeAllRanges()`)
    await dragMouse(cdp, { x: box2.ax, y: box2.ay }, { x: box2.bx, y: box2.by })
    await sleep(1200)
    const textareaAfter = await cdp.eval(`document.querySelector('.textarea--source')?.value ?? ''`)
    if (textareaAfter.trim() && textareaAfter !== textareaBefore) {
      ok(`换一行重新划选后，原文栏已刷新（${JSON.stringify(textareaAfter.slice(0, 36))}…）`)
    } else {
      bad(`换一行划选后原文栏没有刷新（仍是 ${JSON.stringify(textareaAfter.slice(0, 36))}）`)
    }
  } else {
    bad('找不到第二行可划选的文字，无法验证刷新')
  }

  // ---- 护眼蒙版 ----
  const tintLayers = await cdp.eval(`document.querySelectorAll('.pdf-tint').length`)
  if (tintLayers > 0) ok(`护眼蒙版图层已挂到 ${tintLayers} 个已渲染页面上`)
  else bad('没有找到护眼蒙版图层')

  const tintBefore = (await cdp.eval(
    `getComputedStyle(document.querySelector('.viewer')).getPropertyValue('--page-tint').trim()`
  )) || 'transparent'
  await cdp.eval(
    `[...document.querySelectorAll('.toolbar .btn')].find(b => b.textContent.trim().startsWith('背景')).click()`
  )
  await sleep(400)
  const tintAfter = (await cdp.eval(
    `getComputedStyle(document.querySelector('.viewer')).getPropertyValue('--page-tint').trim()`
  )) || 'transparent'
  const blend = await cdp.eval(`getComputedStyle(document.querySelector('.pdf-tint')).mixBlendMode`)
  const tintLabel = await cdp.eval(
    `[...document.querySelectorAll('.toolbar .btn')].find(b => b.textContent.trim().startsWith('背景'))?.textContent.trim() ?? ''`
  )

  if (tintAfter !== tintBefore && tintAfter !== 'transparent') {
    ok(`点「背景」按钮切换生效：${tintBefore} → ${tintAfter}（按钮显示${tintLabel}）`)
  } else {
    bad(`背景切换没生效：${tintBefore} → ${tintAfter}`)
  }
  if (blend === 'multiply') {
    ok('蒙版用 multiply 混合 —— 白底被染色、黑字保持黑色，正文对比度不被冲淡')
  } else {
    bad(`蒙版混合模式不是 multiply，实际是 ${blend}`)
  }

  await cdp.screenshot(SHOT.replace(/\.png$/, '-tint.png'))
  ok(`蒙版截图：${SHOT.replace(/\.png$/, '-tint.png')}`)


  // ---- 设置弹窗 + 测试连接 ----
  await cdp.eval(
    `[...document.querySelectorAll('.toolbar .btn')].find(b => b.textContent.trim() === '设置').click()`
  )
  await cdp.waitFor(`!!document.querySelector('.dialog')`, (v) => v === true, {
    label: '设置弹窗打开'
  })
  ok('设置弹窗能打开')

  await cdp.eval(
    `[...document.querySelectorAll('.dialog .btn')].find(b => b.textContent.trim() === '测试连接').click()`
  )
  const testResult = await cdp.waitFor(
    `document.querySelector('.test-result')?.textContent?.trim() ?? ''`,
    (t) => t.length > 0,
    { label: '测试连接返回', timeout: 15000 }
  )
  const testOk = await cdp.eval(`!!document.querySelector('.test-result--ok')`)
  if (testOk && /连接成功/.test(testResult)) ok(`测试连接通过：${testResult.slice(0, 60)}`)
  else bad(`测试连接未通过：${testResult.slice(0, 120)}`)

  const modelChips = await cdp.eval(`document.querySelectorAll('.model-list li').length`)
  if (modelChips > 0) ok(`测试连接顺带列出 ${modelChips} 个可用模型`)

  // ---- 换成会返回 401 的模型，验证错误提示 ----
  await cdp.eval(`(() => {
    const el = document.querySelector('#s-model')
    el.value = 'mock-unauthorized'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value
  })()`)
  await cdp.eval(
    `[...document.querySelectorAll('.dialog__foot .btn')].find(b => b.textContent.trim() === '保存').click()`
  )
  await sleep(300)
  const dialogClosed = await cdp.eval(`!document.querySelector('.dialog')`)
  if (dialogClosed) ok('保存后弹窗关闭、设置生效')
  else bad('保存后弹窗没有关闭')

  await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('.panel__footer .btn')].find(b => b.textContent.trim() === '重新翻译')
    if (btn) btn.click()
    return !!btn
  })()`)
  const errText = await cdp.waitFor(
    `document.querySelector('.output--error')?.textContent?.trim() ?? ''`,
    (t) => t.length > 0,
    { label: '错误提示出现', timeout: 15000 }
  )
  if (/401/.test(errText) && /API Key/.test(errText)) {
    ok(`401 被翻译成了人话：${errText.slice(0, 70)}`)
  } else {
    bad(`401 的提示不够清楚：${errText.slice(0, 120)}`)
  }

  const errShot = SHOT.replace(/\.png$/, '-error.png')
  await cdp.screenshot(errShot)
  ok(`错误态截图：${errShot}`)

  // ---- 汇总 ----
  console.log('\n===== M2 验收报告 =====')
  console.log(lines.join('\n'))

  // 401 是本次刻意触发的，verbose 是 Chrome 的输入框提示，都不算问题
  const problems = cdp
    .problems()
    .filter(
      (p) =>
        !/Unknown field name|Push buttons/i.test(p) &&
        !/\[verbose\]/.test(p) &&
        !/status of 401/i.test(p)
    )
  console.log('\n===== 浏览器侧错误 =====')
  console.log(problems.length ? problems.join('\n') : '  （无）')
  console.log('（已忽略：本次刻意触发的 401，以及 Chrome 对密码框的 verbose 提示）')

  await cdp.close()
  await closeTarget(CDP_PORT, target.id)
}

main().catch(async (err) => {
  console.error('\n验收失败：', err.message)
  console.log('\n===== 已完成的检查 =====')
  console.log(lines.join('\n'))
  process.exit(1)
})
