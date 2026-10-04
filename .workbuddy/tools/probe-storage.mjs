// 配置持久化探针：验证"通过界面保存的 API Key 到底存不存得住"。
//
// 用法：
//   node probe-storage.mjs write        走界面保存，然后刷新页面再读一次
//   node probe-storage.mjs read         只读当前来源下的存储状态
//   配合 APP_URL 环境变量可以指向不同端口，用来验证"换端口 = 换存储"
import { Cdp, navigate, newTarget, preparePage, closeTarget, sleep } from './cdp-client.mjs'

const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/'
const MODE = process.argv[2] ?? 'read'
const MARK = 'sk-PERSIST-TEST-1234'

const readState = `(() => {
  const raw = localStorage.getItem('pdfreader:settings:v1')
  let parsed = null
  try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = '(解析失败)' }
  return {
    origin: location.origin,
    hasEntry: raw !== null,
    apiKey: parsed && parsed.apiKey ? parsed.apiKey : null,
    model: parsed && parsed.model ? parsed.model : null,
    allKeys: Object.keys(localStorage),
    appThinksKeyMissing: !!document.querySelector('.notice')
  }
})()`

async function settle(cdp) {
  await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, {
    label: '应用挂载',
    timeout: 15000
  })
  await sleep(300)
}

async function main() {
  const target = await newTarget(CDP_PORT)
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await preparePage(cdp)

  if (MODE === 'write') {
    // 必须先导航到 http(s) 来源，about:blank 上访问 localStorage 会抛 SecurityError
    await navigate(cdp, APP_URL)
    await settle(cdp)
    await cdp.eval(`localStorage.removeItem('pdfreader:settings:v1'); 'cleared'`)
    await navigate(cdp, APP_URL)
    await settle(cdp)

    console.log('— 保存前 —')
    console.log(JSON.stringify(await cdp.eval(readState), null, 2))

    // 走真实界面：打开设置 → 填 Key 与模型 → 保存
    await cdp.eval(
      `[...document.querySelectorAll('.toolbar .btn')].find(b => b.textContent.trim() === '设置').click()`
    )
    await cdp.waitFor(`!!document.querySelector('.dialog')`, (v) => v === true, {
      label: '设置弹窗'
    })
    await sleep(200)
    const applied = await cdp.eval(`(() => {
      const key = document.querySelector('#s-key')
      const model = document.querySelector('#s-model')
      if (!key || !model) return '找不到输入框'
      key.value = ${JSON.stringify(MARK)}
      key.dispatchEvent(new Event('input', { bubbles: true }))
      model.value = 'persist-test-model'
      model.dispatchEvent(new Event('input', { bubbles: true }))
      return key.value + ' / ' + model.value
    })()`)
    console.log(`— 在界面上填入 — ${applied}`)
    await sleep(200)
    await cdp.eval(
      `[...document.querySelectorAll('.dialog__foot .btn')].find(b => b.textContent.trim() === '保存').click()`
    )
    await sleep(500)

    console.log('\n— 保存后（同一页面）—')
    console.log(JSON.stringify(await cdp.eval(readState), null, 2))

    await navigate(cdp, APP_URL)
    await settle(cdp)
    console.log('\n— 页面刷新后 —')
    const after = await cdp.eval(readState)
    console.log(JSON.stringify(after, null, 2))
    console.log(
      after.apiKey === MARK
        ? '\n结论：刷新后仍然保留 → 写入与读取都没问题'
        : '\n结论：刷新后丢失 → 问题出在应用自身的读写逻辑'
    )
  } else {
    await navigate(cdp, APP_URL)
    await settle(cdp)
    console.log(JSON.stringify(await cdp.eval(readState), null, 2))
  }

  await cdp.close()
  await closeTarget(CDP_PORT, target.id)
}

main().catch((err) => {
  console.error('探针失败：', err.message)
  process.exit(1)
})
