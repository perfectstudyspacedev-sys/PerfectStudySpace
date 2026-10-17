#!/usr/bin/env node
// PSS-AI P0.10 — run before every deploy: `npm run predeploy`. Refuses when a dev switch is on,
// the README still shows the seeded passwords, the migration numbers have a gap or a repeat, or
// the build or any test fails. On success it prints the deploy order (plan rule R10).
//   node scripts/predeploy.mjs [--root <dir>]   (--root: check another checkout, e.g. a scratch copy)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export const DEV_MODE_FILES = ['src/lib/devMode.js', 'supabase/functions/api/lib.ts']
export const DEFAULT_PASSWORDS = ['owner123', 'staff123']
const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/

/** Problems in the source tree at `root` (no build, no tests). Empty when all is well. */
export function sourceProblems(root) {
  const problems = []
  for (const f of DEV_MODE_FILES) {
    const path = join(root, f)
    if (!existsSync(path)) problems.push(`${f} is missing`)
    else if (/\bDEV_MODE\s*=\s*true\b/.test(readFileSync(path, 'utf8'))) problems.push(`DEV_MODE is true in ${f}`)
  }
  const readme = existsSync(join(root, 'README.md')) ? readFileSync(join(root, 'README.md'), 'utf8') : ''
  for (const pw of DEFAULT_PASSWORDS) if (readme.includes(pw)) problems.push(`README.md still shows the default password ${pw}`)

  const dir = join(root, 'supabase', 'migrations')
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.sql')).sort() : []
  if (!files.length) problems.push('supabase/migrations has no .sql files')
  const seen = new Map()
  for (const f of files) {
    const m = f.match(MIGRATION_NAME)
    if (!m) { problems.push(`migration file name is not NNN_name.sql: ${f}`); continue }
    const n = Number(m[1])
    if (seen.has(n)) problems.push(`migration number ${m[1]} is used twice: ${seen.get(n)} and ${f}`)
    else seen.set(n, f)
  }
  const numbers = [...seen.keys()].sort((a, b) => a - b)
  numbers.forEach((n, i) => {
    if (n !== i + 1) problems.push(`migration numbers are not contiguous from 001: expected ${String(i + 1).padStart(3, '0')}, found ${seen.get(n)}`)
  })
  return [...new Set(problems)].slice(0, 20)
}

function run(cmd, args, cwd) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  return r.status === 0
}

function main() {
  const i = process.argv.indexOf('--root')
  const root = i > 0 ? resolve(process.argv[i + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const problems = sourceProblems(root)
  if (problems.length) {
    console.error('✗ predeploy refused:\n' + problems.map((p) => `  - ${p}`).join('\n'))
    process.exit(1)
  }
  console.log('✓ dev switches off, README clean, migrations 001–' + String(readdirSync(join(root, 'supabase', 'migrations')).filter((n) => n.endsWith('.sql')).length).padStart(3, '0') + ' contiguous')
  for (const [cmd, args] of [['npm', ['run', 'build']], ['npm', ['test']], ['npm', ['run', 'test:server']]]) {
    if (!run(cmd, args, root)) {
      console.error(`\n✗ predeploy refused: ${cmd} ${args.join(' ')} failed`)
      process.exit(1)
    }
  }
  const latest = readdirSync(join(root, 'supabase', 'migrations')).filter((n) => n.endsWith('.sql')).sort().at(-1)
  console.log(`
✓ predeploy passed. Deploy in this order (R10):
  1. Database: apply every migration not yet on Supabase, in number order (newest here: ${latest})
  2. Functions: supabase functions deploy api   then   supabase functions deploy cron
  3. Frontend: merge to main — Cloudflare Pages rebuilds both sites
  Never the frontend first: it sends headers that only the new api function accepts.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
