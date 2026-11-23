// npm run test:scale [-- --seed small|large] [--orig <ref>|--no-orig] [--skip-setup]
//
// Builds the self-hosted stack locally (Docker, dummy data only), loads a seed and runs every
// check; exits 1 if any fails. Steps:
//   1. paging lint (no Docker)
//   2. stack from tests/scale/stack + this repo's migrations and api (setup.sh); with a
//      reference ref (default origin/main) its api is deployed as "apiorig" for comparisons
//   3. seed: small = 1,500 students over 3 branches (seed-small.sql),
//            large = 20,000 students over 10 branches, two years (seed-large.sql)
//   4. checks: database numbers (check.mjs), students pages, batch/pollers, duplicates,
//      login lockout and cache
// The stack stays up afterwards (compose project "psslocal", gateway 127.0.0.1:8010);
// remove it with: cd .scale-test/backend && docker compose down -v
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const seed = opt("--seed", "small");
const noOrig = args.includes("--no-orig");
const orig = noOrig ? "" : opt("--orig", "origin/main");
const work = join(root, ".scale-test");
const results = [];

function run(label, cmd, cmdArgs, { input, cwd = root, env } = {}) {
  const t0 = Date.now();
  console.log(`\n=== ${label}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: input ? ["pipe", "inherit", "inherit"] : "inherit", input, env: { ...process.env, ...env }, maxBuffer: 1 << 28 });
  const ok = r.status === 0;
  results.push({ label, ok, s: Math.round((Date.now() - t0) / 1000) });
  if (!ok) console.log(`--- ${label}: FAILED (exit ${r.status ?? r.error?.message})`);
  return ok;
}

run("1. paging lint", process.execPath, [join(here, "lint-paging.mjs"), join(root, "supabase", "functions", "api", "index.ts")]);

if (!args.includes("--skip-setup")) {
  const ref = orig && spawnSync("git", ["rev-parse", "--verify", "--quiet", orig], { cwd: root }).status === 0 ? orig : "";
  if (orig && !ref) console.log(`(reference ${orig} not found: comparisons with the original api are skipped)`);
  if (!run(`2. stack (setup.sh${ref ? `, reference ${ref}` : ""})`, "bash", [join(here, "setup.sh"), work, ...(ref ? [ref] : [])])) process.exit(1);
  const seedFile = join(here, seed === "large" ? "seed-large.sql" : "seed-small.sql");
  if (!existsSync(seedFile)) { console.log(`no such seed: ${seed}`); process.exit(1); }
  if (!run(`3. seed (${seed})`, "docker", ["exec", "-i", `${process.env.SCALE_PREFIX || "psslocal"}-db`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: readFileSync(seedFile) })) process.exit(1);
}

const hasOrig = spawnSync("docker", ["exec", `${process.env.SCALE_PREFIX || "psslocal"}-functions`, "test", "-d", "/home/deno/functions/apiorig"]).status === 0;
run("4a. database numbers, create_staff roles, branch isolation, URL lengths (check.mjs)", process.execPath, [join(here, "check.mjs"), ...(hasOrig ? [] : ["--fixed-only"])]);
run("4b. students list pages (students-pages.mjs)", process.execPath, [join(here, "students-pages.mjs")]);
run("4c. batch and light pollers (calls.mjs)", process.execPath, [join(here, "calls.mjs")]);
run("4d. duplicates: double-click payment, simultaneous check-ins (duplicates.mjs)", process.execPath, [join(here, "duplicates.mjs")]);
run("4e. login lockout and worker cache (login-and-cache.mjs)", process.execPath, [join(here, "login-and-cache.mjs")], { env: hasOrig ? {} : { REF_FN: "none" } });
run("4g. last login, emergency contact, future start date (staff-login-registration.mjs)", process.execPath, [join(here, "staff-login-registration.mjs")]);
if (hasOrig) run("4f. money actions: old steps vs one transaction, rollback, same-moment requests (money-tx.mjs)", process.execPath, [join(here, "money-tx.mjs")]);
else console.log("\n=== 4f. money-tx.mjs skipped (needs the original api as apiorig)");

console.log("\n=== Summary");
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}  (${r.s} s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} step(s) FAILED` : "\nAll steps PASS");
process.exit(failed ? 1 : 0);
