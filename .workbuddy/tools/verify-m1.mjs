// M1 验收：能打开、能虚拟滚动、能用真实鼠标划选、右侧栏收到选区。
// 这是回归基线脚本，跑它不需要任何 API Key（翻译失败不影响这些断言）。
//
// 用法：node verify-m1.mjs <pdf路径> [截图路径]
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
const PDF_PATH = process.argv[2]
const SHOT = process.argv[3] ?? '.workbuddy/tools/m1-check.png'

if (!PDF_PATH) {
  console.error('用法: node verify-m1.mjs <pdf路径> [截图路径]')
  process.exit(1)
}

const { ok, bad, lines } = makeReporter()

async function findDragTarget(cdp) {
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
      const b = best.line[Math.min(best.line.length - 1, 3)].r
      return {
        ax: Math.round(a.left + 1), ay: Math.round(a.top + a.height / 2),
        bx: Math.round(b.right - 1), by: Math.round(b.top + b.height / 2),
        spansOnLine: best.line.length, layerSpanCount: best.spanCount
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
  const target = await newTarget(CDP_PORT)
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await preparePage(cdp)

  await navigate(cdp, APP_URL)
  // 明确把 Key 清掉，让 M1 跑在"没有翻译"的干净基线上。
  // 配置以 .env 为准，所以要改文件而不是改 localStorage。
  try {
    await setFileConfig(APP_URL, {
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash'
    })
  } catch (err) {
    console.warn(`[warn] 无法写入配置文件（服务端可能是旧版本？）：${err.message}`)
  }
  await cdp.eval(`localStorage.removeItem('pdfreader:cache:v1'); 'ok'`)
  await navigate(cdp, APP_URL)
  await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, {
    label: '应用挂载'
  })
  ok('Vue 应用挂载成功，工具栏已渲染')

  await setFileInput(cdp, PDF_PATH)

  const pageCount = await cdp.waitFor(`document.querySelectorAll('.pdf-page').length`, (n) => n > 0, {
    label: '页面占位符生成'
  })
  ok(`文档解析成功，生成 ${pageCount} 个页面占位符`)

  const pager = await cdp.eval(`document.querySelector('.pager')?.textContent ?? ''`)
  ok(`工具栏页码区：${pager.replace(/\s+/g, ' ').trim()}`)

  const canvasCount = await cdp.waitFor(
    `document.querySelectorAll('.pdf-page canvas').length`,
    (n) => n > 0,
    { label: '首屏 canvas 渲染' }
  )
  ok(`可见页 canvas 已渲染（${canvasCount} 张）—— 虚拟滚动只画可视页`)

  // 150% 缩放下一屏可能只有封面页，所以只要求文字层非空
  const spanCount = await cdp.waitFor(
    `document.querySelectorAll('.textLayer span').length`,
    (n) => n > 0,
    { label: '文字层生成' }
  )
  ok(`文字层已建立（首屏 ${spanCount} 个片段）`)

  // ---- 真实鼠标拖拽 ----
  const box = await findDragTarget(cdp)
  if (!box) throw new Error('多次滚动后仍未找到可拖拽的连续文字行')
  ok(`拖拽目标：同一行 ${box.spansOnLine} 个片段，所在文字层共 ${box.layerSpanCount} 个片段`)

  await dragMouse(cdp, { x: box.ax, y: box.ay }, { x: box.bx, y: box.by })
  await sleep(600)

  const selected = await cdp.eval(`window.getSelection()?.toString() ?? ''`)
  if (selected.trim()) ok(`鼠标选中成功：${JSON.stringify(selected.slice(0, 60))}`)
  else bad('鼠标拖拽没有选中任何文字 —— 文字层不可命中')

  // M2 起原文放在可编辑的 textarea 里
  const panelText = await cdp.eval(
    `document.querySelector('.textarea--source')?.value ?? ''`
  )
  if (panelText.trim() && selected.trim() && panelText.trim().startsWith(selected.trim().slice(0, 20))) {
    ok(`右侧栏已收到选区：${JSON.stringify(panelText.slice(0, 60))}`)
  } else {
    bad(`右侧栏没有收到正确的选区，实际=${JSON.stringify(panelText.slice(0, 60))}`)
  }

  const tags = await cdp.eval(`document.querySelector('.panel__tags')?.textContent ?? ''`)
  if (tags) ok(`右侧栏标签：${tags.replace(/\s+/g, ' ').trim()}`)

  await cdp.screenshot(SHOT.replace(/\.png$/, '-selection.png'))
  ok(`选中状态截图：${SHOT.replace(/\.png$/, '-selection.png')}`)

  // ---- 翻页 ----
  await cdp.eval(`(() => {
    const input = document.querySelector('.pager__input')
    input.value = '40'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  })()`)
  await sleep(2500)
  const afterJump = await cdp.eval(
    `document.querySelectorAll('.pdf-page canvas').length + ' / 第 ' + document.querySelector('.pager__input').value + ' 页'`
  )
  ok(`跳页后 canvas 数 / 当前页 = ${afterJump}`)

  // ---- 缩放 ----
  const before = await cdp.eval(`document.querySelector('.zoom-label').textContent`)
  await cdp.eval(`[...document.querySelectorAll('.toolbar .btn')].find(b => b.title === '放大').click()`)
  await sleep(1200)
  const after = await cdp.eval(`document.querySelector('.zoom-label').textContent`)
  ok(`缩放 ${before} → ${after}`)

  await cdp.screenshot(SHOT)
  ok(`截图已保存：${SHOT}`)

  console.log('\n===== M1 验收报告 =====')
  console.log(lines.join('\n'))

  const problems = cdp
    .problems()
    .filter((p) => !/Unknown field name|Push buttons|\[verbose\]/i.test(p))
  console.log('\n===== 浏览器侧错误 =====')
  console.log(problems.length ? problems.join('\n') : '  （无）')

  await cdp.close()
  await closeTarget(CDP_PORT, target.id)
}

main().catch(async (err) => {
  console.error('\n验收失败：', err.message)
  console.log('\n===== 已完成的检查 =====')
  console.log(lines.join('\n'))
  process.exit(1)
})
