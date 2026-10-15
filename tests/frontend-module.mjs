import { readFileSync } from 'node:fs'
import ts from 'typescript'
const cache = new Map()
export function frontendModule(relative) {
  const url = new URL(relative, import.meta.url)
  if (cache.has(url.href)) return cache.get(url.href)
  let { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  outputText = outputText.replace(/from ['"]([^'"]+)['"]/g, (match, specifier) => {
    if (!specifier.startsWith('.')) return match
    return `from ${JSON.stringify(frontendModule(new URL(specifier + '.ts', url).href))}`
  })
  const result = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  cache.set(url.href, result)
  return result
}
