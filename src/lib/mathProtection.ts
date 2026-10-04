/** 划词翻译只能拿到 PDF 的文字层；保留可识别的公式串，避免模型再次改写。 */
const MATH_EXPRESSION = /(?:[A-Za-zΑ-ω][A-Za-z0-9,]*(?:\s*[′_^][A-Za-z0-9{},→+−-]+|\s+[a-z](?:,[a-z])?\s*→\s*[a-z])+(?:\s*[=<>≈≤≥∈∉×÷]\s*[A-Za-z0-9,→+−-]+)*|[A-Za-zΑ-ω][A-Za-z0-9,]*(?:\s+6)?\s*[=<>≈≤≥∈∉×÷]\s*[A-Za-z0-9,→+−-]+)/gu

export interface ProtectedMath {
  input: string
  pieces: Array<{ marker: string; original: string }>
}

export function protectMath(text: string): ProtectedMath {
  const pieces: ProtectedMath['pieces'] = []
  const input = text.replace(MATH_EXPRESSION, (original) => {
    const marker = `⟦M${pieces.length + 1}⟧`
    pieces.push({ marker, original })
    return marker
  })
  return { input, pieces }
}

export function hasProtectedMath(protectedText: ProtectedMath, output: string): boolean {
  const actual = output.match(/⟦M\d+⟧/g) ?? []
  return actual.length === protectedText.pieces.length &&
    actual.every((marker, index) => marker === protectedText.pieces[index].marker)
}

export function restoreMath(protectedText: ProtectedMath, output: string): string {
  let restored = output
  for (const { marker, original } of protectedText.pieces) restored = restored.replaceAll(marker, original)
  return restored
}
