import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createFullTranslationService, resolveOutputDir } from '../server/full-translation.mjs'
import { removeFile, removeTreeWithin } from '../server/files.mjs'

const source = Buffer.from('%PDF-1.7\noriginal test document')
const sourceHash = createHash('sha256').update(source).digest('hex')

async function fixture(t, options = {}) {
  const temporaryRoot = resolve('tmp')
  mkdirSync(temporaryRoot, {recursive:true})
  const root = mkdtempSync(join(temporaryRoot, 'engine-test-'))
  const python = options.portable ? join(root,'.runtime/portable-python/python.exe')
    : join(root,'.runtime/pdf2zh-next/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')
  mkdirSync(resolve(python,'..'),{recursive:true}); writeFileSync(python,'test placeholder')
  const output=join(root,'output')
  const config={apiKey:'local-test-key',model:'local-test',outputDir:output}
  const children=[]
  let launches=0
  let mode='success'
  function spawnProcess(command, args, spawnOptions) {
    if(command==='taskkill') {
      const controller=new EventEmitter()
      queueMicrotask(()=>{for(const child of children) if(child.running){child.running=false;child.emit('close',1)}})
      return controller
    }
    launches++
    const child=new EventEmitter()
    child.pid=10000+launches;child.running=true
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough()
    child.kill=()=>{if(child.running){child.running=false;child.emit('close',1)}}
    child.command=command;child.spawnOptions=spawnOptions
    children.push(child)
    let payload=''
    child.stdin.on('data',c=>payload+=c)
    child.stdin.on('finish',()=>{
      const request=JSON.parse(payload)
      assert.equal(request.config.apiKey,'local-test-key')
      assert.equal(readFileSync(request.input).compare(source),0)
      child.request=request
      if(mode==='hold') return
      setImmediate(()=>{
        if(!child.running)return
        if(mode==='error')child.stdout.write(JSON.stringify({type:'error',error:'local-test-key simulated failure'})+'\n')
        else {
          const mono=join(request.output,'test.mono.pdf'),dual=join(request.output,'test.dual.pdf')
          writeFileSync(mono,`%PDF-1.7\nmono generation ${launches}`);writeFileSync(dual,`%PDF-1.7\ndual generation ${launches}`)
          child.stdout.write(JSON.stringify({type:'progress',percent:75,stage:'translation',detail:'正在翻译',pages:2})+'\n')
          child.stdout.write(JSON.stringify({type:'finish',mono,dual,pages:2})+'\n')
        }
        child.running=false;child.emit('close',mode==='error'?1:0)
      })
    })
    return child
  }
  const service=createFullTranslationService({root,readConfig:()=>config,spawnProcess,...options})
  const server=createServer((req,res)=>service.handle(req,res,new URL(req.url,'http://localhost')))
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
  const base=`http://127.0.0.1:${server.address().port}`
  t.after(async()=>{
    service.shutdown()
    await new Promise(ok=>server.close(ok))
    assert.ok(root.startsWith(temporaryRoot+'\\')||root.startsWith(temporaryRoot+'/'))
    removeTreeWithin(root, temporaryRoot)
  })
  const request=async(path,options)=>{const response=await fetch(base+path,options);return{status:response.status,data:await response.json()}}
  const create=replace=>request('/__full-translation?source=paper.pdf'+(replace?'&replace=1':''),{method:'POST',headers:{'X-Pdf-Reader':'1'},body:source})
  const lookup=hash=>request('/__translation?'+new URLSearchParams({source:'paper.pdf',hash:hash??sourceHash}))
  const wait=async id=>{
    for(let n=0;n<100;n++) {
      const result=await request('/__full-translation/'+id)
      if(['done','error','cancelled'].includes(result.data.status))return result.data
      await new Promise(ok=>setTimeout(ok,10))
    }
    throw Error('Test job timed out')
  }
  return{root,output,config,request,create,lookup,wait,children,launches:()=>launches,mode:v=>mode=v}
}

test('saved pairs match the real source hash; reuse avoids a worker; regenerate replaces both',async t=>{
  const f=await fixture(t)
  const initial=await f.create(false);assert.equal(initial.status,202)
  const result=await f.wait(initial.data.id);assert.equal(result.status,'done')
  const saved=await f.lookup();assert.equal(saved.status,200)
  assert.equal(saved.data.mono.path,result.result.mono.path)
  assert.equal((await f.lookup('0'.repeat(64))).status,404)
  const cached=await f.create(false);assert.equal(cached.data.cached,true);assert.equal(f.launches(),1)
  const old=readFileSync(saved.data.mono.path)
  const next=await f.create(true);const replaced=await f.wait(next.data.id)
  assert.equal(replaced.status,'done');assert.equal(f.children[1].request.replace,true)
  assert.equal(replaced.result.mono.path,saved.data.mono.path)
  assert.notEqual(readFileSync(saved.data.mono.path).compare(old),0)
  assert.equal(readdirSync(f.output).length,3)
  assert.equal(readdirSync(join(f.root,'.runtime/pdf2zh-next/jobs')).length,0)
})

test('failure and cancellation retain the previous complete pair and redact keys',async t=>{
  const f=await fixture(t)
  const first=await f.create();const completed=await f.wait(first.data.id)
  const mono=readFileSync(completed.result.mono.path),dual=readFileSync(completed.result.dual.path)
  f.mode('error');const failed=await f.create(true);const failure=await f.wait(failed.data.id)
  assert.equal(failure.status,'error');assert.ok(!failure.error.includes('local-test-key'))
  assert.equal(readFileSync(completed.result.mono.path).compare(mono),0)
  f.mode('hold');const held=await f.create(true)
  assert.equal((await f.create(true)).status,409)
  assert.equal((await f.request('/__full-translation/'+held.data.id,{method:'DELETE',headers:{'X-Pdf-Reader':'1'}})).data.status,'cancelled')
  await new Promise(ok=>setTimeout(ok,20))
  assert.equal(readFileSync(completed.result.mono.path).compare(mono),0)
  assert.equal(readFileSync(completed.result.dual.path).compare(dual),0)
  assert.equal(readdirSync(join(f.root,'.runtime/pdf2zh-next/jobs')).length,0)
})

test('reject invalid uploads and unauthenticated mutations; do not expose incomplete pairs',async t=>{
  const f=await fixture(t)
  assert.equal((await f.request('/__full-translation?source=paper.pdf',{method:'POST',body:source})).status,403)
  assert.equal((await f.request('/__full-translation?source=../paper.pdf',{method:'POST',headers:{'X-Pdf-Reader':'1'},body:source})).status,400)
  assert.equal((await f.request('/__full-translation?source=paper.pdf',{method:'POST',headers:{'X-Pdf-Reader':'1'},body:'not pdf'})).status,400)
  assert.equal(f.launches(),0)
  const first=await f.create();const saved=await f.wait(first.data.id)
  removeFile(saved.result.dual.path)
  assert.equal((await f.lookup()).status,404)
})

test('an unusable custom output directory falls back to the user folder',async t=>{
  let testHome
  const f=await fixture(t,{outputDirectoryResolver:(dir,excluded)=>resolveOutputDir(dir,excluded,testHome)})
  testHome=join(f.root,'test-user')
  writeFileSync(join(f.root,'blocked'),'this is a file')
  f.config.outputDir=join(f.root,'blocked','output')
  const created=await f.create();const result=await f.wait(created.data.id)
  assert.equal(result.status,'done');assert.equal(result.result.fallbackUsed,true)
  assert.equal(resolve(result.result.mono.path,'..'),join(testHome,'PDF译文'))
  assert.ok(existsSync(result.result.dual.path))
})


test('portable runtime selects bundled Python and keeps jobs/cache/temp paths inside package', {skip:process.platform!=='win32'}, async t=>{
  const f=await fixture(t,{portable:true})
  const initial=await f.create();const result=await f.wait(initial.data.id)
  assert.equal(result.status,'done')
  const child=f.children[0]
  assert.equal(child.command,join(f.root,'.runtime/portable-python/python.exe'))
  assert.equal(child.spawnOptions.env.PYTHONNOUSERSITE,'1')
  assert.equal(child.spawnOptions.env.PYTHONPATH,'')
  assert.equal(child.spawnOptions.env.ROSETTA_DATA_DIR,join(f.root,'data'))
  assert.equal(child.spawnOptions.env.TEMP,join(f.root,'data','tmp'))
  assert.equal(child.spawnOptions.env.PYTHONHOME,join(f.root,'.runtime/portable-python'))
  assert.ok(child.request.input.startsWith(join(f.root,'data','jobs')))
})
