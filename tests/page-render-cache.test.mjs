import assert from 'node:assert/strict'
import test from 'node:test'
import {frontendModule} from './frontend-module.mjs'
const {pageRenderPlan,rasterEvictions}=await import(frontendModule('../src/lib/pageRenderCache.ts'))
test('visible pages render before directional prefetch and long jumps do not queue the entire document',()=>{
 const pages=Array.from({length:300},(_,i)=>({pageNumber:i+1,top:i*800,height:780}))
 const plan=pageRenderPlan(pages,2400,700,1200)
 assert.deepEqual([...plan.visible],[4]);assert.equal(plan.wanted[0],4)
 assert.ok(plan.wanted.indexOf(5)<plan.wanted.indexOf(3));assert.ok(plan.wanted.length<12)
 const jump=pageRenderPlan(pages,120000,700,117600)
 assert.equal(jump.wanted[0],151);assert.ok(jump.wanted.length<12)
 const reverse=pageRenderPlan(pages,2400,700,-1200)
 assert.ok(reverse.wanted.indexOf(3)<reverse.wanted.indexOf(5))
})
test('raster cache obeys byte and page budgets and never clears visible or in-flight pages',()=>{
 const entries=Array.from({length:12},(_,i)=>({pageNumber:i+1,bytes:16,lastUsed:i}))
 const evicted=rasterEvictions(entries,new Set([1,2,12]),96,8)
 assert.deepEqual(evicted,[3,4,5,6,7,8])
 assert.equal(rasterEvictions(entries,new Set(entries.map(p=>p.pageNumber)),1,1).length,0)
 assert.equal(rasterEvictions(entries,new Set(),1000,12).length,0)
})
