// Runs every tests/server/*_test.ts with Deno. Each suite loads the REAL api edge function against
// an in-memory stand-in for Supabase, so no Docker or database is needed. Exit code 1 if any fails.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const dir = 'tests/server'
const deno = process.platform === 'win32' ? 'node_modules/deno/deno.exe' : 'node_modules/.bin/deno'
const args = process.argv.slice(2)
const only = args.filter((a) => !a.startsWith('--'))   // name filters, e.g. `golden`
const flags = args.filter((a) => a.startsWith('--'))   // passed to each suite, e.g. --update
const suites = readdirSync(dir).filter((f) => f.endsWith('_test.ts') && (!only.length || only.some((o) => f.includes(o)))).sort()
let failed = 0
for (const f of suites) {
  console.log(`\n=== ${f}`)
  const r = spawnSync(deno, ['run', '--quiet', '--allow-all', '--config', join(dir, 'deno.json'), join(dir, f), ...flags], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}
console.log(`\n${suites.length - failed}/${suites.length} server suites passed`)
process.exit(failed ? 1 : 0)
