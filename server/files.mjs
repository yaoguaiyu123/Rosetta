import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export function removeFile(path) {
  try { unlinkSync(path) } catch (err) { if (err.code !== 'ENOENT') throw err }
}

// Use unlink/rmdir explicitly: Node 24.11.1 fs.rmSync silently left files behind on the target Windows machine.
export function removeTreeWithin(target, allowedRoot) {
  const path = resolve(target)
  const root = resolve(allowedRoot)
  if (!path.startsWith(root + sep)) throw new Error('Cleanup target must remain inside its working directory')
  let stat
  try { stat = lstatSync(path) } catch (err) { if (err.code === 'ENOENT') return; throw err }
  if (stat.isSymbolicLink() || !stat.isDirectory()) { removeFile(path); return }
  for (const entry of readdirSync(path)) removeTreeWithin(join(path, entry), root)
  rmdirSync(path)
}
