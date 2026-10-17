// P0.10: the source checks of scripts/predeploy.mjs (the build and test steps just run npm).
import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error plain ESM script without type declarations
import { sourceProblems } from '../../scripts/predeploy.mjs'

const dirs: string[] = []
function fixture({ webDev = false, apiDev = false, readme = '# PSS\nSet strong passwords.', migrations = ['001_initial.sql', '002_features.sql', '003_more.sql'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'predeploy-'))
  dirs.push(root)
  mkdirSync(join(root, 'src/lib'), { recursive: true })
  mkdirSync(join(root, 'supabase/functions/api'), { recursive: true })
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true })
  writeFileSync(join(root, 'src/lib/devMode.js'), `export const DEV_MODE = ${webDev}\n`)
  writeFileSync(join(root, 'supabase/functions/api/lib.ts'), `export const DEV_MODE = ${apiDev};\n`)
  writeFileSync(join(root, 'README.md'), readme)
  for (const m of migrations) writeFileSync(join(root, 'supabase/migrations', m), '-- sql\n')
  return root
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('predeploy source checks (P0.10)', () => {
  test('this repository passes', () => {
    expect(sourceProblems(resolve(__dirname, '../..'))).toEqual([])
  })
  test('a clean tree passes', () => {
    expect(sourceProblems(fixture())).toEqual([])
  })
  test('DEV_MODE true in either file is refused', () => {
    expect(sourceProblems(fixture({ webDev: true }))).toEqual(['DEV_MODE is true in src/lib/devMode.js'])
    expect(sourceProblems(fixture({ apiDev: true }))).toEqual(['DEV_MODE is true in supabase/functions/api/lib.ts'])
  })
  test('the seeded passwords in the README are refused', () => {
    expect(sourceProblems(fixture({ readme: 'login owner / owner123, staff / staff123' }))).toEqual([
      'README.md still shows the default password owner123', 'README.md still shows the default password staff123'])
  })
  test('a gap, a repeat or a badly named migration is refused', () => {
    expect(sourceProblems(fixture({ migrations: ['001_a.sql', '003_c.sql'] })).join()).toMatch(/not contiguous.*expected 002, found 003_c.sql/)
    expect(sourceProblems(fixture({ migrations: ['001_a.sql', '002_b.sql', '002_c.sql'] })).join()).toMatch(/002 is used twice/)
    expect(sourceProblems(fixture({ migrations: ['002_a.sql'] })).join()).toMatch(/expected 001/)
    expect(sourceProblems(fixture({ migrations: ['001_a.sql', '2_b.sql'] })).join()).toMatch(/not NNN_name.sql: 2_b.sql/)
  })
})
