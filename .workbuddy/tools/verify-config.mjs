// 验证「配置以磁盘文件为准」这件事真的成立。
//
// 核心断言：在 A 端口保存的 API Key，换到 B 端口打开仍然在。
// 这正是浏览器本地存储做不到的（存储按来源隔离，端口变了就没了）。
//
// 用法：
//   node verify-config.mjs read              只读当前来源下应用实际拿到的配置
//   node verify-config.mjs write <新Key>     走界面改 Key 并保存
//   APP_URL=http://127.0.0.1:5201/ node verify-config.mjs read
import { Cdp, closeTarget, navigate, newTarget, preparePage, sleep } from './cdp-client.mjs'

const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/'
const MODE = process.argv[2] ?? 'read'
const NEW_KEY = process.argv[3] ?? ''

async function openSettings(cdp) {
  await cdp.eval(
    `[...document.querySelectorAll('.toolbar .btn')].find(b => b.textContent.trim() === '设置').click()`
  )
  await cdp.waitFor(`!!document.querySelector('#s-key')`, (v) => v === true, { label: '设置弹窗' })
  await sleep(250)
}

async function closeSettings(cdp) {
  await cdp.eval(`document.querySelector('.dialog__head .btn').click()`)
  await sleep(200)
}

async function snapshot(cdp) {
  const dom = await cdp.eval(`(() => {
    const raw = localStorage.getItem('pdfreader:settings:v1')
    let local = null
    try { local = raw ? JSON.parse(raw) : null } catch { local = '(解析失败)' }
    return {
      origin: location.origin,
      localStorageKey: local && local.apiKey ? local.apiKey : null,
      keyNoticeShown: !!document.querySelector('.notice')
    }
  })()`)
  await openSettings(cdp)
  const effective = await cdp.eval(`(() => {
    const val = (sel) => { const el = document.querySelector(sel); return el ? el.value : null }
    return {
      baseUrl: val('#s-base'),
      apiKey: val('#s-key'),
      model: val('#s-model'),
      debounce: val('#s-debounce'),
      configPath: document.querySelector('[data-config-path]')?.textContent ?? null
    }
  })()`)
  if (MODE !== 'write') await closeSettings(cdp)
  return { ...dom, effective }
}

async function main() {
  const target = await newTarget(CDP_PORT)
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await preparePage(cdp)

  await navigate(cdp, APP_URL)
  await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, {
    label: '应用挂载'
  })
  await sleep(600) // 等磁盘配置读回来

  if (MODE === 'wipe') {
    // 决定性测试：把浏览器存储整个清掉再重载。
    // 如果配置真的以磁盘文件为准，Key 必须还在；否则就会"消失"。
    const cleared = await cdp.eval(`(() => {
      const n = Object.keys(localStorage).length
      localStorage.clear()
      return n
    })()`)
    console.log(`已清空浏览器本地存储（原有 ${cleared} 项），现在重载页面…`)
    await navigate(cdp, APP_URL)
    await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, {
      label: '重载后应用挂载'
    })
    await sleep(600)
    const after = await snapshot(cdp)
    console.log('\n— 清空浏览器存储并重载之后 —')
    console.log(JSON.stringify(after, null, 2))
    console.log(
      after.effective.apiKey
        ? `\n✓ Key 依然在（${after.effective.apiKey}）—— 说明它来自磁盘文件，不再依赖浏览器存储`
        : '\n✗ Key 丢了 —— 说明磁盘配置没有生效'
    )
    await cdp.close()
    await closeTarget(CDP_PORT, target.id)
    return
  }

  const before = await snapshot(cdp)
  console.log(`— ${MODE === 'write' ? '修改前' : '当前状态'} · ${before.origin} —`)
  console.log(JSON.stringify(before, null, 2))

  if (MODE === 'write') {
    await cdp.eval(`(() => {
      const el = document.querySelector('#s-key')
      el.value = ${JSON.stringify(NEW_KEY)}
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return el.value
    })()`)
    await sleep(200)
    await cdp.eval(
      `[...document.querySelectorAll('.dialog__foot .btn')].find(b => b.textContent.trim() === '保存').click()`
    )
    await sleep(900)

    const after = await cdp.eval(`(() => {
      const raw = localStorage.getItem('pdfreader:settings:v1')
      const local = raw ? JSON.parse(raw) : null
      return {
        savedLocalStorageKey: local ? local.apiKey : null,
        errorBar: document.querySelector('.error-bar')?.textContent?.trim() ?? null
      }
    })()`)
    console.log('\n— 保存后 —')
    console.log(JSON.stringify(after, null, 2))
    console.log(
      after.savedLocalStorageKey === NEW_KEY
        ? '✓ 已写入浏览器本地存储'
        : '✗ 没有写入浏览器本地存储'
    )
    console.log(
      after.errorBar ? `✗ 界面报错：${after.errorBar}` : '✓ 界面没有报错（说明磁盘写入成功）'
    )
  }

  await cdp.close()
  await closeTarget(CDP_PORT, target.id)
}

main().catch((err) => {
  console.error('验证失败：', err.message)
  process.exit(1)
})
