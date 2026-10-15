import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { removeFile, removeTreeWithin } from '../server/files.mjs'

const compiler = join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
test('portable launcher creates embedded config without loose template and preserves existing settings', {
  skip: process.platform !== 'win32' || !existsSync(compiler),
}, () => {
  const allowed = resolve('tmp'); mkdirSync(allowed, {recursive:true})
  const root = mkdtempSync(join(allowed, 'portable-config-'))
  try {
    const nodeRoot = join(root,'.runtime/node'), pythonRoot = join(root,'.runtime/portable-python')
    mkdirSync(nodeRoot,{recursive:true}); mkdirSync(pythonRoot,{recursive:true}); mkdirSync(join(root,'dist'))
    // Use an isolated copy of the existing test runtime.
    copyFileSync(process.execPath,join(nodeRoot,'node.exe'))
    writeFileSync(join(pythonRoot,'python.exe'),'placeholder: this test never launches Python')
    writeFileSync(join(root,'dist/index.html'),'test')
    writeFileSync(join(root,'.env'),'API_KEY="mock-key-for-testing"\n')
    writeFileSync(join(root,'server.mjs'),`
      import {createServer} from 'node:http'
      import {writeFileSync} from 'node:fs'
      const args=process.argv.slice(2), port=Number(args[1]), ready=args[args.indexOf('--ready-file')+1]
      const server=createServer((req,res)=>res.end(req.url==='/__pdf_reader_ping'?'pdf-translate-reader':JSON.stringify({available:true})))
      server.listen(port,'127.0.0.1',()=>writeFileSync(ready,JSON.stringify({url:'http://127.0.0.1:'+port+'/',pid:process.pid})))
    `)
    const template = join(root,'embedded-defaults.txt')
    writeFileSync(template, readFileSync(resolve('.env.example'),'utf8'))
    const result = spawnSync(compiler, ['/nologo','/target:winexe','/platform:x64',
      '/out:'+join(root,'Rosetta.exe'), '/resource:'+template+',Rosetta.DefaultSettings.env',
      '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',
      resolve('scripts/portable/Launcher.cs')], {encoding:'utf8',windowsHide:true})
    assert.equal(result.status,0,result.stdout+result.stderr)
    removeFile(template)
    assert.equal(existsSync(join(root,'.env.example')),false)
    const launch = () => {
      const result=spawnSync(join(root,'Rosetta.exe'),['--smoke-test'],{encoding:'utf8',windowsHide:true,timeout:30000})
      assert.equal(result.status,0,result.stdout+result.stderr)
      assert.equal(JSON.parse(readFileSync(join(root,'data/launcher-smoke.json'),'utf8')).passed,true)
    }
    launch()
    const settings = join(root,'data/settings.env')
    assert.match(readFileSync(settings,'utf8'),/^API_KEY=""$/m)
    // A root .env is deliberately ignored; an already configured data/settings.env is untouched.
    writeFileSync(settings,'# preserve user settings\nAPI_KEY="mock-key-for-testing"\nMODEL="user-chosen-model"\n')
    const before = createHash('sha256').update(readFileSync(settings)).digest('hex')
    launch()
    assert.equal(createHash('sha256').update(readFileSync(settings)).digest('hex'),before)
  } finally { removeTreeWithin(root,allowed) }
})
