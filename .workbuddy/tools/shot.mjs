// 给界面拍一张「干净的产品图」：打开 PDF、等目录出来、不选中任何文字，
// 然后截图。用于 README 之类的展示场景。
//
// 用法：node shot.mjs <pdf路径> <输出png> [临时配置路径]
import { Cdp, closeTarget, navigate, newTarget, preparePage, setFileConfig, setFileInput, sleep } from './cdp-client.mjs'

const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5199/'
const PDF = process.argv[2]
const OUT = process.argv[3] ?? 'docs/screenshot.png'

if (!PDF) {
  console.error('用法: node shot.mjs <pdf路径> <输出png>')
  process.exit(1)
}

const target = await newTarget(CDP_PORT)
const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
await preparePage(cdp, { width: 1680, height: 1000 })

// 摆一个好看点的示例配置（不指向真实接口，反正不翻译）
try {
  await setFileConfig(APP_URL, {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'mock-key-for-screenshot',
    model: 'deepseek-flash',
    temperature: 0.3,
    trigger: 'auto',
    debounceMs: 1000,
    reasoning: 'none',
    pageTint: 'none',
    defaultZoom: 1.5
  })
} catch {
  /* 旧版服务没有配置端点也无所谓 */
}

await navigate(cdp, APP_URL)
await cdp.waitFor('!!document.querySelector(".toolbar")', (v) => v === true, { label: '应用挂载' })
await setFileInput(cdp, PDF)

// 等目录渲染出来
try {
  await cdp.waitFor(`document.querySelectorAll('.outline__row').length`, (n) => n > 0, {
    label: '目录出现',
    timeout: 20000
  })
} catch {
  /* 没目录就拍个没有目录的样子 */
}
await sleep(1500)

// 跳到有正文的章节页 —— 别停在封面或版权页（那种页面几乎是空白）
await cdp.eval(`(() => {
  const input = document.querySelector('.pager__input')
  input.value = '20'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  return input.value
})()`)

// 等这一页真正渲染出文字（说明不是空白页）
try {
  await cdp.waitFor(
    `document.querySelectorAll('.textLayer span').length`,
    (n) => n > 60,
    { label: '正文渲染完成', timeout: 20000 }
  )
} catch {
  /* 拍不到正文也比拍不出来强 */
}
await sleep(1500)

// 关键：清掉选区，避免右侧栏里出现测试用的假译文
await cdp.eval(
  `window.getSelection()?.removeAllRanges(); document.querySelector('.panel__footer .btn:last-child')?.click(); 'ok'`
)
await sleep(600)

// Published screenshots must not expose local output paths or their tooltips.
await cdp.eval(`(() => {
  document.querySelectorAll('.reader-status__path').forEach(el => {
    el.textContent = '本地保存'; el.removeAttribute('title');
  });
  window.getSelection()?.removeAllRanges();
})()`)
await cdp.screenshot(OUT)
console.log(`已保存 ${OUT}`)

const problems = cdp.problems().filter((p) => !/\[verbose\]/.test(p))
if (problems.length) console.log('浏览器侧有报错：\n' + problems.join('\n'))

await cdp.close()
await closeTarget(CDP_PORT, target.id)
