export interface PdfFileHandle {
  getFile(): Promise<File>
  requestPermission?(options: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}
type PickerOptions = { types: { description: string; accept: Record<string, string[]> }[]; excludeAcceptAllOption: boolean }
type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: PickerOptions & { multiple: boolean }) => Promise<PdfFileHandle[]>
  showSaveFilePicker?: (options: PickerOptions & { suggestedName: string }) => Promise<PdfFileHandle>
}
const pdfTypes: PickerOptions = { types: [{ description: 'PDF 文档', accept: { 'application/pdf': ['.pdf'] } }], excludeAcceptAllOption: true }
export async function pickPdf() {
  const picker = window as FilePickerWindow
  if (!picker.showOpenFilePicker) return null
  const [handle] = await picker.showOpenFilePicker({ ...pdfTypes, multiple: false })
  return { file: await handle.getFile(), handle }
}
/** Call directly from the save gesture, before asynchronous PDF serialization. */
export function pickSavePdf(name: string): Promise<PdfFileHandle> | null {
  return (window as FilePickerWindow).showSaveFilePicker?.({ ...pdfTypes, suggestedName: name }) ?? null
}
export function downloadPdf(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
