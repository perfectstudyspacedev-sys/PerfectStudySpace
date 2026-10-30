// Runs every tests/integration/*_test.ts with Deno against a real database (Appendix A part 2).
// Without one configured (see tests/integration/README.md) each suite says "skipped" and passes.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const dir = 'tests/integration'
const deno = process.platform === 'win32' ? 'node_modules/deno/deno.exe' : 'node_modules/.bin/deno'
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const suites = readdirSync(dir).filter((f) => f.endsWith('_test.ts') && (!only.length || only.some((o) => f.includes(o)))).sort()
let failed = 0
for (const f of suites) {
  console.log(`\n=== ${f}`)
  const r = spawnSync(deno, ['run', '--quiet', '--allow-all', '--config', join(dir, 'deno.json'), join(dir, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}
console.log(`\n${suites.length - failed}/${suites.length} integration suites passed`)
process.exit(failed ? 1 : 0)
