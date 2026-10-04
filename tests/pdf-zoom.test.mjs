import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Compile the actual frontend helper using the project's existing TypeScript dependency (also works on Node 20).
const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/pdfZoom.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { nextPdfZoom } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('zoom moves in 5% steps, respects arbitrary fit scales and stops at limits', () => {
  assert.equal(nextPdfZoom(1.5, 1), 1.55)
  assert.equal(nextPdfZoom(1.5, -1), 1.45)
  assert.equal(nextPdfZoom(1.14, 1), 1.19)
  assert.equal(nextPdfZoom(1.14, -1), 1.09)
  assert.equal(nextPdfZoom(1.6464, 1), 1.7)
  assert.equal(nextPdfZoom(1.6464, -1), 1.6)
  assert.equal(nextPdfZoom(1.5, 3), 1.65)
  assert.equal(nextPdfZoom(1.5, -3), 1.35)
  assert.equal(nextPdfZoom(3, 1), 3)
  assert.equal(nextPdfZoom(.25, -1), .25)
  assert.equal(nextPdfZoom(1.5, 0), 1.5)
})
