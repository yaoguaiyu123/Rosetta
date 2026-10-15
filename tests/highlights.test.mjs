import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModule } from './frontend-module.mjs'
const {HighlightHistory, highlightFromQuads, containsHighlight} = await import(frontendModule('../src/lib/highlights.ts'))
test('one multi-page selection undoes together; undo remains meaningful across saves', () => {
 const h = new HighlightHistory(), a=highlightFromQuads(0,[[10,30,80,30,10,10,80,10]]), b=highlightFromQuads(1,[[10,30,80,30,10,10,80,10]])
 h.change([a,b]);assert.equal(h.dirty,true);h.markSaved();assert.equal(h.dirty,false)
 h.change([], [a.key]);assert.equal(h.edits.size,1);assert.equal(h.dirty,true)
 h.undo();assert.equal(h.edits.size,2);assert.equal(h.dirty,false)
 h.undo();assert.equal(h.edits.size,0);assert.equal(h.dirty,true)
 h.markSaved();assert.equal(h.dirty,false)
 h.change([{...a,id:'12R',deleted:true}]);h.undo();assert.equal(h.dirty,false)
 h.clear();assert.equal(h.canUndo,false);assert.equal(h.dirty,false)
})
test('eraser hits individual rotated quadrilaterals without erasing whitespace between lines', () => {
 const h=highlightFromQuads(0,[[10,50,60,50,10,40,60,40],[10,20,60,20,10,10,60,10]])
 assert.equal(containsHighlight(h,20,45),true);assert.equal(containsHighlight(h,20,30),false)
 const rotated=highlightFromQuads(1,[[20,10,20,60,30,10,30,60]])
 assert.equal(containsHighlight(rotated,25,35),true);assert.equal(containsHighlight(rotated,15,35),false)
 assert.deepEqual(h.rect,[10,10,60,50])
})
