import assert from 'node:assert/strict'
import { Cdp, closeTarget, newTarget, preparePage, navigate, setFileInput } from './cdp-client.mjs'

const port = Number(process.env.CDP_PORT ?? 9341)
const app = process.env.APP_URL ?? 'http://127.0.0.1:5311/'
const [book, plainPaper, pairedPaper, shot = 'tmp/reader-controls'] = process.argv.slice(2)
if (!book || !plainPaper || !pairedPaper) throw new Error('Provide PDFs with bookmarks, without bookmarks, and with a saved mono/dual pair')
const target = await newTarget(port)
const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
const click = text => cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw Error('Missing button: ' + ${JSON.stringify(text)}); b.click() })()`)
const page = () => cdp.eval('document.querySelector(".pager__input").value')
const zoom = () => cdp.eval('parseInt(document.querySelector(".zoom-label").textContent)')
const geometry = () => cdp.eval(`(() => {
  const v = [...document.querySelectorAll('.viewer')].find(v => v.clientHeight > 0)
  const r = v.getBoundingClientRect()
  return { top:r.top, height:r.height, share:r.height/innerHeight, width:innerWidth,
    toolbar:document.querySelector('.toolbar').getBoundingClientRect().height,
    x:r.left+r.width/2, y:r.top+Math.min(180,r.height/2), scroll:v.scrollTop,
    viewport:visualViewport.width, dpr:devicePixelRatio }
})()`)
const wheel = async (modifiers, deltaY) => {
  const g = await geometry()
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:g.x, y:g.y, deltaX:0, deltaY, modifiers })
}
try {
  await preparePage(cdp, { width:1440, height:960 })
  await navigate(cdp, app)
  await cdp.waitFor('!!document.querySelector(".toolbar")', Boolean)
  await setFileInput(cdp, book)
  await cdp.waitFor('document.querySelectorAll(".outline__row").length', n => n > 0)
  const nativeCount = await cdp.eval('document.querySelectorAll(".outline__row").length')
  const jump = await cdp.eval(`(() => {
    const row = [...document.querySelectorAll('.outline__row')].find(r=>Number(r.querySelector('.outline__page')?.textContent)>5)
    const n = Number(row.querySelector('.outline__page').textContent); row.click(); return String(n)
  })()`)
  await cdp.waitFor('document.querySelector(".pager__input").value', v => v === jump)
  await cdp.waitFor(`document.querySelector('.reader-lane [data-page-number="${jump}"] canvas')?.width`, v => v > 100)
  await cdp.screenshot(`${shot}-outline.png`)
  await click('目录')
  assert.equal(await cdp.eval('!!document.querySelector(".outline")'), false)
  await click('目录')
  await click('全文翻译'); await click('划词翻译')
  await cdp.waitFor('!!document.querySelector(".outline")', Boolean)
  await cdp.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await page(), jump)

  await cdp.eval(`window.addEventListener('wheel',e=>{window.lastQaWheel={trusted:e.isTrusted,ctrl:e.ctrlKey,shift:e.shiftKey,cancelled:e.defaultPrevented}})`)
  const before = await geometry()
  const initialZoom = await zoom()
  await wheel(2, -120) // Trusted Ctrl + wheel, not dispatchEvent.
  await cdp.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const ctrlZoom = await cdp.waitFor('parseInt(document.querySelector(".zoom-label").textContent)', v => v > initialZoom && v - initialZoom <= 5)
  const afterCtrl = await geometry()
  assert.equal(afterCtrl.toolbar, before.toolbar)
  assert.equal(afterCtrl.viewport, before.viewport)
  assert.equal(afterCtrl.dpr, before.dpr)
  assert.deepEqual(await cdp.eval('window.lastQaWheel'), {trusted:true,ctrl:true,shift:false,cancelled:true})
  assert.equal(await page(), jump)
  await wheel(8, 120)
  await cdp.waitFor('parseInt(document.querySelector(".zoom-label").textContent)', v => v === ctrlZoom - 5)
  assert.deepEqual(await cdp.eval('window.lastQaWheel'), {trusted:true,ctrl:false,shift:true,cancelled:true})
  const scrollBefore = (await geometry()).scroll
  await wheel(0, 160)
  await cdp.waitFor(`[...document.querySelectorAll('.viewer')].find(v=>v.clientHeight>0).scrollTop`, v => v > scrollBefore + 50)
  assert.equal(await zoom(), ctrlZoom - 5)
  assert.equal((await cdp.eval('window.lastQaWheel')).cancelled, false)

  await setFileInput(cdp, plainPaper)
  await cdp.waitFor('document.querySelector(".toolbar__name").textContent', v => v === plainPaper.split(/[\\/]/).pop())
  await cdp.waitFor('document.querySelector(".textLayer span")?.textContent', Boolean)
  assert.equal(await cdp.eval('!!document.querySelector(".outline")'), false)
  assert.equal(await cdp.eval(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='目录')`), false)

  await setFileInput(cdp, pairedPaper)
  await cdp.waitFor('document.querySelector(".toolbar__name").textContent', v => v === pairedPaper.split(/[\\/]/).pop())
  await click('全文翻译')
  await cdp.waitFor('document.querySelector(".full-controls .btn--primary")?.textContent.trim()', v => v === '打开已有译本')
  await click('打开已有译本')
  await cdp.waitFor('document.querySelector(".reader-lane--translated .textLayer span")?.textContent', Boolean)
  const dual = await geometry()
  assert.ok(dual.toolbar <= 48, `Toolbar height ${dual.toolbar}`)
  assert.ok(dual.share > .87, `PDF viewport share ${dual.share}`)
  await cdp.screenshot(`${shot}-dual.png`)
  await click('只看中文')
  await cdp.waitFor('document.querySelector(".reader-status__path")?.textContent', v => v?.includes('.mono.pdf'))
  await cdp.waitFor('document.querySelector(".full-controls .btn--primary")?.textContent.trim()', v => v === '译本已打开')
  const monoBefore = await zoom()
  await wheel(2, -120)
  await cdp.waitFor('parseInt(document.querySelector(".zoom-label").textContent)', v => v > monoBefore && v - monoBefore <= 5)

  await cdp.send('Emulation.setDeviceMetricsOverride', {width:750,height:900,deviceScaleFactor:1,mobile:false})
  await click('适应宽度')
  await cdp.waitFor('document.querySelector(".reader-lane--translated .textLayer span")?.textContent', Boolean)
  const narrow = await geometry()
  assert.ok(narrow.share > .8, `Narrow PDF viewport share ${narrow.share}`)
  assert.equal(await cdp.eval('document.documentElement.scrollWidth > innerWidth'), false)
  await cdp.screenshot(`${shot}-narrow.png`)
  assert.deepEqual(cdp.consoleErrors, [])
  assert.deepEqual(cdp.exceptions, [])
  assert.equal(await cdp.eval('document.querySelector(".error-bar")?.textContent ?? ""'), '')
  assert.equal(cdp.requests.filter(u=>u.includes('/chat/completions')).length, 0)
  console.log(JSON.stringify({passed:true,nativeOutlineRows:nativeCount,ctrlWheelPdfOnly:true,shiftWheelPdfOnly:true,
    normalWheelScrolls:true,desktopReaderPercent:Math.round(dual.share*100),narrowReaderPercent:Math.round(narrow.share*100)}))
} catch (error) {
  await cdp.screenshot(`${shot}-failed.png`)
  console.error(JSON.stringify(await cdp.eval(`({error:document.querySelector('.error-bar')?.textContent,
    filename:document.querySelector('.toolbar__name')?.textContent,pages:document.querySelectorAll('.pdf-page').length,
    outline:document.querySelector('.outline')?.textContent,busy:document.querySelector('.viewer__busy')?.textContent})`)))
  console.error(JSON.stringify({consoleErrors:cdp.consoleErrors,exceptions:cdp.exceptions}))
  throw error
} finally {
  const closed = new Promise(resolve => cdp.ws.readyState === 3 ? resolve() : cdp.ws.addEventListener('close', resolve, {once:true}))
  await cdp.close(); await closed
  await closeTarget(port, target.id)
}
