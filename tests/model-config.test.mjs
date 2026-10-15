import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModule } from './frontend-module.mjs'
import { envToModelConfig,modelConfigToEnv,legacyModelKeys } from '../server/model-config.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { removeTreeWithin } from '../server/files.mjs'
const {defaultSettings,sanitizeSettings}=await import(frontendModule('../src/lib/settings.ts'))
const {switchProvider,captureProviderSettings}=await import(frontendModule('../src/lib/providers.ts'))

test('provider switching restores independent keys, model and reasoning without mutating original settings',()=>{
 const original=sanitizeSettings({...defaultSettings,apiKey:'mock-key-for-testing',model:'deepseek-custom',reasoning:'high'})
 const mimo=switchProvider(original,'mimo');assert.equal(mimo.apiKey,'');assert.equal(mimo.model,'mimo-v2.6-flash');assert.equal(mimo.reasoning,'none')
 mimo.apiKey='mock-key-for-screenshot';mimo.temperature=0.7
 const ds=switchProvider(mimo,'deepseek');assert.equal(ds.apiKey,'mock-key-for-testing');assert.equal(ds.model,'deepseek-custom');assert.equal(ds.reasoning,'high')
 const restored=switchProvider(ds,'mimo');assert.equal(restored.apiKey,'mock-key-for-screenshot');assert.equal(restored.temperature,0.7)
 assert.equal(original.providerConfigs.mimo.apiKey,'')
 const encoded=modelConfigToEnv({...restored,...captureProviderSettings(restored)})
 assert.equal(encoded.ACTIVE_PROVIDER,'mimo');assert.equal(encoded.DEEPSEEK_API_KEY,'mock-key-for-testing');assert.equal(encoded.MIMO_API_KEY,'mock-key-for-screenshot')
 assert.deepEqual(envToModelConfig(encoded).providerConfigs,captureProviderSettings(restored).providerConfigs)
})
test('legacy slots migrate only to their actual provider; named empty keys override old shared values',()=>{
 const legacy=envToModelConfig({BASE_URL:'https://api.xiaomimimo.com/v1',MODEL:'mimo-v2.6-flash',API_KEY:'mock-key-for-testing',REASONING:'none'})
 assert.equal(legacy.activeProvider,'mimo');assert.equal(legacy.providerConfigs.mimo.apiKey,'mock-key-for-testing');assert.equal(legacy.providerConfigs.deepseek.apiKey,'')
 const mixed=envToModelConfig({ACTIVE_PROVIDER:'mimo',MIMO_API_KEY:'',API_KEY:'mock-key-for-testing'})
 assert.equal(mixed.apiKey,'')
 assert.deepEqual(envToModelConfig({OUTPUT_DIR:'output'}),{})
})
test('actual local server persists named slots, removes shared credentials and reloads after restart',async()=>{
 const allowed=resolve('tmp');mkdirSync(allowed,{recursive:true});const root=mkdtempSync(join(allowed,'profile-config-')),env=join(root,'settings.env'),ready=join(root,'ready.json')
 writeFileSync(env,'# keep this comment\nBASE_URL="https://api.deepseek.com/v1"\nAPI_KEY="mock-key-for-testing"\nMODEL="deepseek-custom"\n')
 let child
 async function start(){
  const probe=createServer();await new Promise(ok=>probe.listen(0,'127.0.0.1',ok));const port=probe.address().port;await new Promise(ok=>probe.close(ok))
  child=spawn(process.execPath,['server.mjs','dist',String(port),'--env',env,'--ready-file',ready],{windowsHide:true,stdio:'ignore'})
  for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/__pdf_reader_ping`);if(r.ok)return `http://127.0.0.1:${port}`}catch{}await new Promise(ok=>setTimeout(ok,40))}throw Error('Local config server did not start')
 }
 async function stop(){if(child){child.kill();await new Promise(ok=>child.once('close',ok));child=null}}
 try{
  let base=await start();const initial=(await(await fetch(base+'/__config')).json()).config
  assert.equal(initial.activeProvider,'deepseek')
  const next=switchProvider(sanitizeSettings({...defaultSettings,...initial}),'mimo');next.apiKey='mock-key-for-screenshot'
  const r=await fetch(base+'/__config',{method:'POST',headers:{'Content-Type':'application/json','X-Pdf-Reader':'1'},body:JSON.stringify({...next,...captureProviderSettings(next)})});assert.equal(r.status,200)
  const raw=readFileSync(env,'utf8');assert.match(raw,/^DEEPSEEK_API_KEY="mock-key-for-testing"$/m);assert.match(raw,/^MIMO_API_KEY="mock-key-for-screenshot"$/m)
  for(const key of legacyModelKeys)assert.doesNotMatch(raw,new RegExp('^'+key+'=','m'))
  assert.match(raw,/# keep this comment/)
  await stop();base=await start()
  const loaded=(await(await fetch(base+'/__config')).json()).config
  assert.equal(loaded.activeProvider,'mimo');assert.equal(loaded.apiKey,'mock-key-for-screenshot');assert.equal(loaded.model,'mimo-v2.6-flash')
  assert.equal(switchProvider(sanitizeSettings({...defaultSettings,...loaded}),'deepseek').apiKey,'mock-key-for-testing')
 }finally{await stop();removeTreeWithin(root,allowed)}
})
