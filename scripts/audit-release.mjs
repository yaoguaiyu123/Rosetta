import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Never print a matched value. Report only locations, rule IDs and object hashes.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, maxBuffer: 128 * 1024 * 1024, windowsHide: true })
const env = existsSync(resolve(root, '.env')) ? readFileSync(resolve(root, '.env'), 'utf8') : ''
const match = env.match(/^API_KEY\s*=\s*(.*?)\s*$/m)
let key = match?.[1] ?? ''
if (/^["']/.test(key)) key = key.slice(1, -1)
else key = key.replace(/\s+#.*$/, '').trim()
const rules = [
  ['provider-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['credential-literal', /\b(?:api[_-]?key|api[_-]?token|access[_-]?token|client[_-]?secret|password)\b["']?\s*[:=]\s*["']([^"'\r\n]{16,})["']/gi],
  ['env-credential', /^(?:export\s+)?(?:API_KEY|API_TOKEN|ACCESS_TOKEN|CLIENT_SECRET|PASSWORD)\s*=\s*([A-Za-z0-9_./+=-]{20,})\s*$/gm],
  ['bearer-literal', /\bBearer\s+[A-Za-z0-9_.-]{24,}/g]
]
// Exact reviewed mock values only; a "test" substring alone never suppresses a finding.
const mocks = new Set(['sk-' + 'demo-only-not-a-real-key', 'mock-key-for-screenshot', 'mock-key-for-testing'])
const findings = []
const mocksFound = []
function scan(buffer, location) {
  if (key && (buffer.includes(Buffer.from(key)) || buffer.includes(Buffer.from(key, 'utf16le')))) findings.push({ location, rule: 'current-configured-key' })
  if (buffer.includes(0)) return // Binary bytes are still checked for the configured key above.
  const content = buffer.toString('utf8')
  for (const [rule, regex] of rules) {
    for (const m of content.matchAll(regex)) {
      const value = m[1] ?? m[0]
      const entry = { location, line: content.slice(0, m.index).split('\n').length, rule }
      if (mocks.has(value)) mocksFound.push(entry)
      else findings.push(entry)
    }
  }
}
const tracked = git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
for (const path of tracked) if (existsSync(resolve(root, path))) scan(readFileSync(resolve(root, path)), `worktree:${path}`)
// Include new release files before staging so the first preparation run covers them too.
for (const path of git(['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean)) {
  if (existsSync(resolve(root, path))) scan(readFileSync(resolve(root, path)), `untracked:${path}`)
}
const objects = git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']).toString('utf8').trim().split('\n')
const blobs = objects.filter(line => line.endsWith(' blob')).map(line => line.split(' ')[0])
for (const object of objects) {
  const [id, type] = object.split(' ')
  scan(git(['cat-file', type, id]), `git-${type}:${id}`)
}
const result = {
  trackedFiles: tracked.length, gitObjects: objects.length, gitBlobs: blobs.length,
  commitsAcrossRefs: Number(git(['rev-list', '--all', '--count']).toString().trim()),
  configuredKeyChecked: Boolean(key), findings, reviewedMockFindings: mocksFound,
  scope: 'Current tracked and nonignored untracked files; all local Git objects (blobs, commits, trees, tags) including unreachable objects. Binary blobs checked for the current key only. Ignored local runtime/config/output directories excluded.'
}
console.log(JSON.stringify(result, null, 2))
if (findings.length) process.exitCode = 1
