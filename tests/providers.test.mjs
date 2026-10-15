import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModule } from './frontend-module.mjs'
const { reasoningParameters, modelProvider } = await import(frontendModule('../src/lib/providers.ts'))
const { streamChat, listModels } = await import(frontendModule('../src/lib/deepseek.ts'))
test('MiMo and DeepSeek send their documented thinking parameters; lookalike hosts stay custom', () => {
  assert.deepEqual(reasoningParameters('https://api.xiaomimimo.com/v1', 'mimo-v2.6-flash', 'none'), { thinking: { type: 'disabled' } })
  assert.deepEqual(reasoningParameters('https://token-plan-cn.xiaomimimo.com/v1', 'mimo-v2.6-pro', 'high'), { thinking: { type: 'enabled' } })
  assert.deepEqual(reasoningParameters('https://api.deepseek.com/v1', 'deepseek-flash', 'none'), { reasoning_effort: 'none' })
  assert.deepEqual(reasoningParameters('https://api.xiaomimimo.com/v1', 'mimo-v2.6-flash', 'omit'), {})
  assert.equal(modelProvider('https://api.xiaomimimo.com.evil.example/v1'), 'custom')
})
test('actual streaming client and model-list client work with MiMo protocol and split UTF8/SSE', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options })
    if (url.endsWith('/models')) return Response.json({ data: [{id:'mimo-v2.6-flash'}] })
    const wire = new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"do not display"}}]}\n\ndata: {"choices":[{"delta":{"content":"中文译文"}}]}\n\ndata: [DONE]\n\n')
    return new Response(new ReadableStream({ start(c) { for(let i=0;i<wire.length;i+=7)c.enqueue(wire.slice(i,i+7));c.close() } }))
  })
  let output = ''
  const result = await streamChat({ baseUrl:'https://api.xiaomimimo.com/v1',apiKey:'mock-key-for-testing',model:'mimo-v2.6-flash',reasoning:'none',temperature:0.3,messages:[{role:'user',content:'test'}],signal:new AbortController().signal,onDelta:p=>output+=p })
  assert.equal(result,'中文译文');assert.equal(output,'中文译文')
  const payload = JSON.parse(calls[0].body)
  assert.deepEqual(payload.thinking, {type:'disabled'});assert.equal('reasoning_effort' in payload,false)
  assert.equal(calls[0].headers.Authorization,'Bearer mock-key-for-testing')
  assert.deepEqual(await listModels('https://api.xiaomimimo.com/v1','mock-key-for-testing'),['mimo-v2.6-flash'])
})
