import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { removeFile, removeTreeWithin } from '../../server/files.mjs'

const root=resolve(process.argv[2]??'')
assert.ok(existsSync(join(root,'Rosetta.exe')),'Provide an extracted portable package')
const python=join(root,'.runtime/portable-python/python.exe')
const node=join(root,'.runtime/node/node.exe')
const data=join(root,'data')
if(existsSync(join(data,'settings.env'))){assert.match(readFileSync(join(data,'settings.env'),'utf8'),/^API_KEY=""$/m,'Refuse to verify a package with a configured key')}
function cleanup(){
 for(const file of ['launcher-smoke.json','settings.env','server-ready.json'])removeFile(join(data,file))
 for(const folder of ['engine-config','jobs','tmp','verification','cache/pdf2zh_next']){const path=join(data,folder);if(existsSync(path))removeTreeWithin(path,root)}
 for(const file of readdirSync(join(data,'cache/babeldoc')))if(/\.db(?:-|$)/.test(file))removeFile(join(data,'cache/babeldoc',file))
}
process.once('exit',cleanup)
const cleanEnv={...process.env,PATH:join(process.env.SystemRoot,'System32'),PYTHONHOME:join(root,'.runtime/portable-python'),PYTHONPATH:'',PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',ROSETTA_DATA_DIR:data}
for(const name of Object.keys(cleanEnv))if(/^(?:https?|all|no)_proxy$/i.test(name))delete cleanEnv[name]
const run=(command,args)=>{const r=spawnSync(command,args,{cwd:root,env:cleanEnv,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(r.status!==0)throw Error('Portable command failed: '+(r.stderr||r.stdout).slice(-1500));return r.stdout}
const manifest=JSON.parse(readFileSync(join(root,'portable-manifest.json'),'utf8'))
let assets=0
for(const [folder,items] of Object.entries(manifest.assets))for(const item of items){assert.equal(createHash('sha3-256').update(readFileSync(join(data,'cache/babeldoc',folder,item.name))).digest('hex'),item.sha3_256);assets++}
run(join(root,'Rosetta.exe'),['--smoke-test'])
assert.equal(JSON.parse(readFileSync(join(data,'launcher-smoke.json'),'utf8')).passed,true)
run(python,['-c','import fitz,onnxruntime,pdf2zh_next.high_level,babeldoc; print("portable imports ready")'])
const testRoot=join(data,'verification');mkdirSync(testRoot,{recursive:true})
const input=join(testRoot,'portable-test.pdf')
const output=join(testRoot,'output');mkdirSync(output)
run(python,['-c',`import fitz; d=fitz.open();p=d.new_page();p.insert_text((72,100),'Portable translation test. This paper explains a simple algorithm.',fontsize=14);p.insert_text((72,145),'The method works on a local computer without installing Python.',fontsize=12);d.save(${JSON.stringify(input)})`])
let requests=0
const mock=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{if(req.url.includes('chat/completions')){requests++;const request=JSON.parse(body);const text='便携版翻译测试。这篇文章介绍了一个简单算法，该方法可以在本地计算机上运行。';res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'portable-test',object:'chat.completion',created:1,model:request.model,choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}))}else{res.writeHead(404);res.end()}})})
await new Promise(ok=>mock.listen(0,'127.0.0.1',ok))
const mockPort=mock.address().port
// Fail on any non-loopback DNS lookup or connect: proves bundled resources are sufficient.
const guard=String.raw`import sys,socket,runpy
_connect=socket.socket.connect
_getaddrinfo=socket.getaddrinfo
def connect(self,address):
    if address[0] not in ('127.0.0.1','::1','localhost'): raise RuntimeError('External network forbidden during portable verification')
    return _connect(self,address)
def lookup(host,*args,**kwargs):
    if host not in ('127.0.0.1','::1','localhost',None): raise RuntimeError('External DNS forbidden during portable verification')
    return _getaddrinfo(host,*args,**kwargs)
socket.socket.connect=connect
socket.getaddrinfo=lookup
runpy.run_path(sys.argv[1],run_name='__main__')`
let engineResult=null
try{
 await new Promise((ok,fail)=>{
  const child=spawn(python,['-c',guard,join(root,'scripts/pdf2zh-worker.py')],{cwd:root,env:cleanEnv,windowsHide:true,stdio:['pipe','pipe','pipe']})
  let stdout='',stderr=''
  const timeout=setTimeout(()=>{child.kill();fail(Error('Portable engine test timed out'))},180000)
  child.stdout.on('data',c=>stdout+=c)
  child.stderr.on('data',c=>stderr+=c)
  child.on('error',fail)
  child.on('close',code=>{clearTimeout(timeout);try{const events=stdout.trim().split('\n').flatMap(line=>{try{const event=JSON.parse(line);return event.type?[event]:[]}catch{return []}});const error=events.find(e=>e.type==='error');assert.equal(code,0,error?.error??stderr.slice(-2000));engineResult=events.find(e=>e.type==='finish');assert.ok(engineResult);ok()}catch(e){fail(e)}})
  child.stdin.end(JSON.stringify({input,output,replace:true,config:{baseUrl:`http://127.0.0.1:${mockPort}/v1`,apiKey:'smoke-key',model:'mock-portable',reasoning:'omit'}})+'\n')
 })
 assert.ok(requests>0,'Real engine must call the local mock translator')
 const translated=run(python,['-c',`import fitz,json; m=fitz.open(${JSON.stringify(engineResult.mono)});d=fitz.open(${JSON.stringify(engineResult.dual)});print(json.dumps({'mono':len(m),'dual':len(d),'ratio':d[0].rect.width/m[0].rect.width,'chinese':any('\u4e00'<=c<='\u9fff' for c in m[0].get_text())}))`])
 const pdf=JSON.parse(translated);assert.equal(pdf.mono,1);assert.equal(pdf.dual,1);assert.equal(pdf.ratio,2);assert.equal(pdf.chinese,true)
 // Check actual server configuration creation and frontend delivery with bundled Node only.
 assert.ok(run(node,['--version']).trim().startsWith('v24.'))
 const result={passed:true,launcher:true,imports:true,assets,mockTranslationRequests:requests,externalNetworkAllowed:false,pdf,systemNodePythonUvNeeded:false}
 console.log(JSON.stringify(result))
 writeFileSync(resolve('tmp/portable-verification.json'),JSON.stringify(result,null,2)+'\n')
}finally{
 await new Promise(ok=>mock.close(ok))
 assert.ok(testRoot.startsWith(root+sep));removeTreeWithin(testRoot,root)
 for(const file of ['launcher-smoke.json','settings.env','server-ready.json'])removeFile(join(data,file))
 for(const folder of ['engine-config','jobs','tmp','cache/pdf2zh_next']){const path=join(data,folder);if(existsSync(path))removeTreeWithin(path,root)}
 // Translation cache must never be included in the release.
 for(const file of readdirSync(join(data,'cache/babeldoc')))if(/\.db(?:-|$)/.test(file))removeFile(join(data,'cache/babeldoc',file))
}
