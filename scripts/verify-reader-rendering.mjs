import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {Cdp,sleep,dragMouse} from './browser-cdp.mjs'
const value=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]}
const baseline=process.argv.includes('--baseline'),qa=resolve(value('--output','tmp/flicker-qa')),port=Number(value('--port','5797')),debug=Number(value('--debug-port','9737'))
mkdirSync(qa,{recursive:true});writeFileSync(qa+'/settings.env','API_KEY=""\nDEFAULT_ZOOM=1\nPAGE_TINT="green"\n')
const dist=baseline?value('--baseline-dist',''):value('--dist','dist')
if(baseline&&!dist)throw Error('Provide --baseline-dist for before/after comparison')
const server=spawn(process.execPath,['server.mjs',dist,String(port),'--env',qa+'/settings.env'],{windowsHide:true,stdio:'ignore'})
const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+debug,'--user-data-dir='+qa+(baseline?'/browser-before':'/browser-after'),'about:blank'],{windowsHide:true,stdio:'ignore'})
let cdp
try{
 let tabs;for(let i=0;i<100;i++){try{tabs=await(await fetch(`http://127.0.0.1:${debug}/json`)).json();if(tabs.length)break}catch{}await sleep(100)}
 cdp=await Cdp.connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
 await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable')
 await cdp.send('Network.setBlockedURLs',{urls:['*api.deepseek.com*','*xiaomimimo.com*']})
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
 for(let i=0;i<80;i++){try{if((await fetch(`http://127.0.0.1:${port}/__pdf_reader_ping`)).ok)break}catch{}await sleep(100)}
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}`});await cdp.waitFor("!!document.querySelector('.api-setup')",Boolean)
 const fixture=readFileSync(resolve(value('--fixture','tmp/flicker-qa/fixture.pdf'))).toString('base64')
 await cdp.eval(`(async()=>{const root=await navigator.storage.getDirectory();window.qaHandle=await root.getFileHandle('fixture.pdf',{create:true});const w=await qaHandle.createWritable();await w.write(Uint8Array.from(atob('${fixture}'),c=>c.charCodeAt(0)));await w.close();window.showOpenFilePicker=async()=>[{getFile:()=>qaHandle.getFile(),createWritable:()=>qaHandle.createWritable(),requestPermission:async()=> 'granted'}]})()`)
 await cdp.eval("document.querySelector('.toolbar__file button').click()")
 const ready="!!document.querySelector('.pdf-page[data-page-number=\"1\"] .textLayer') && !!document.querySelector('.pdf-page[data-page-number=\"2\"] .pdf-canvas')"
 await cdp.waitFor(ready,Boolean,{timeout:60000})
 await cdp.eval(`window.monitor={phase:'highlight',stats:{}};window.neighborCanvas=document.querySelector('.pdf-page[data-page-number="2"] .pdf-canvas');window.monitor.active=true;function tick(){if(!monitor.active)return;const el=document.querySelector('.viewer'),vr=el.getBoundingClientRect(),stats=monitor.stats[monitor.phase]??={frames:0,white:0,missingFirst:0};stats.frames++;for(const p of el.querySelectorAll('.pdf-page')){const b=p.getBoundingClientRect();if(b.top>=vr.bottom||b.bottom<=vr.top||b.left>=vr.right||b.right<=vr.left)continue;const canvas=p.querySelector('.pdf-canvas,.pdf-preview');if(!canvas||!canvas.width){if(p.dataset.pageNumber==='1')stats.missingFirst++;if(getComputedStyle(p).backgroundColor==='rgb(255, 255, 255)')stats.white++}}requestAnimationFrame(tick)}requestAnimationFrame(tick)`)
 const box=async text=>cdp.eval(`(()=>{const e=[...document.querySelectorAll('.pdf-page[data-page-number="1"] .textLayer span')].find(e=>e.textContent.includes(${JSON.stringify(text)}));const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})()`)
 const key=async(k,code)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,modifiers:2,windowsVirtualKeyCode:k.toUpperCase().charCodeAt(0)});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers:0,windowsVirtualKeyCode:k.toUpperCase().charCodeAt(0)})}
 const settled=async()=>{await cdp.waitFor(ready,Boolean);await sleep(350)}
 await cdp.eval("document.querySelector('[aria-label=\"高亮\"]').click()")
 let b=await box('Line 1:');await dragMouse(cdp,{x:b.x+1,y:b.y+b.h/2},{x:b.x+b.w-1,y:b.y+b.h/2});await settled()
 await cdp.eval("monitor.phase='erase-new';document.querySelector('[aria-label=\"橡皮擦\"]').click()")
 b=await box('Line 1:');for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:b.x+20,y:b.y+b.h/2,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
 await settled()
 await cdp.eval("monitor.phase='undo-erase'");await key('z','KeyZ');await settled()
 await cdp.eval("monitor.phase='erase-existing'");b=await box('Existing highlight')
 for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:b.x+20,y:b.y+b.h/2,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
 await settled()
 const neighborSame=await cdp.eval("window.neighborCanvas===document.querySelector('.pdf-page[data-page-number=\"2\"] .pdf-canvas')")
 await cdp.eval("monitor.phase='save'");await key('s','KeyS');await cdp.waitFor("document.querySelector('[aria-label=\"保存 PDF\"]').disabled && !document.querySelector('[aria-label=\"保存 PDF\"]').title.includes('正在')",Boolean)
 const saved=await cdp.eval("(async()=>{let s='';for(const b of new Uint8Array(await(await qaHandle.getFile()).arrayBuffer()))s+=String.fromCharCode(b);return btoa(s)})()")
 writeFileSync(qa+(baseline?'/before-saved.pdf':'/after-saved.pdf'),Buffer.from(saved,'base64'))
 await cdp.eval("monitor.phase='scroll'")
 for(const top of [700,1500,2400,1500,700,0,5000,10000,16000,22000,10000,2400,0]){await cdp.eval(`(()=>{const el=document.querySelector('.viewer');el.scrollTop=${top};el.dispatchEvent(new Event('scroll'))})()`);await sleep(35)}
 await cdp.waitFor(ready,Boolean,{timeout:60000});await sleep(350)
 await cdp.eval("monitor.phase='zoom'")
 await cdp.eval("document.querySelector('[aria-label=\"放大\"]').click()")
 await sleep(500);await cdp.waitFor(ready,Boolean,{timeout:60000})
 if(!baseline){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1})
  await cdp.eval("monitor.phase='cache-pressure'")
  for(const n of [5,10,15,20,25,30]){
   await cdp.eval(`(()=>{const el=document.querySelector('.viewer');const p=el.querySelector('.pdf-page[data-page-number="${n}"]');el.scrollTop+=p.getBoundingClientRect().top-el.getBoundingClientRect().top-20;el.dispatchEvent(new Event('scroll'))})()`)
   await cdp.waitFor(`!!document.querySelector('.pdf-page[data-page-number="${n}"] .pdf-canvas')`,Boolean,{timeout:60000})
   await sleep(100)
  }
  assert.equal(await cdp.eval("!!document.querySelector('.pdf-page[data-page-number=\"1\"] .pdf-preview')"),true)
  assert.equal(await cdp.eval("!!document.querySelector('.pdf-page[data-page-number=\"1\"] .pdf-tint')"),true)
  await cdp.eval("document.querySelector('.viewer').scrollTop=0")
  await cdp.waitFor(ready,Boolean,{timeout:60000});await sleep(200)
 }
 await cdp.screenshot(qa+(baseline?'/before.png':'/after.png'))
 const stats=await cdp.eval("(()=>{monitor.active=false;return monitor.stats})()")
 const usage=await cdp.eval("(()=>{const canvases=[...document.querySelectorAll('.viewer canvas')];return {full:canvases.filter(c=>c.classList.contains('pdf-canvas')).length,previews:canvases.filter(c=>c.classList.contains('pdf-preview')).length,bytes:canvases.reduce((a,c)=>a+c.width*c.height*4,0)}})()")
 if(!baseline){for(const [phase,frames]of Object.entries(stats)){assert.equal(frames.white,0,phase+' white frames');if(phase!=='scroll')assert.equal(frames.missingFirst,0,phase+' discarded page')}assert.equal(neighborSame,true);assert.ok(usage.full<=12);assert.ok(usage.bytes<=112*1024*1024)}
 assert.equal(cdp.exceptions.length,0,cdp.exceptions.join('\n'))
 const result={baseline,stats,neighborCanvasRetained:neighborSame,usage,externalApiRequests:cdp.requests.filter(u=>/api.deepseek.com|api.xiaomimimo.com/.test(u)).length}
 writeFileSync(qa+(baseline?'/before.json':'/after.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{if(cdp)cdp.ws.close();for(const p of [browser,server]){const k=spawn(process.env.SystemRoot+'/System32/taskkill.exe',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(ok=>k.on('close',ok))}}
