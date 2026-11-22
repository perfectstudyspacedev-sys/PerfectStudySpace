// Load test: N simultaneous staff tabs against the api, dummy data only.
//   node tests/scale/load.mjs --users 10 --seconds 120 [--base http://127.0.0.1:8010/functions/v1/api] [--out file.json]
//   (SCALE_PREFIX / DOCKER_HOST pick the database container, as for the other tests)
// Each user is one browser tab: staff_<k> of one of the branches (every 5th user the owner,
// all branches) clicking every 1-3 s through a weighted mix of what the pages call: the
// light pollers, dashboard + seat map in one batch, student pages and search, today's
// bookings, memberships, revenue, transactions, the daily report, and now and then a
// Rs 1 payment on a membership that owes money (dummy data). Prints per action: calls,
// failures, p50/p95/max ms; exits 1 if any request failed (network, 5xx, 401/403/429).
// A 4xx that is a business answer (e.g. "nothing due") is counted apart, not as a failure.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const USERS = Number(opt("--users", 10)), SECONDS = Number(opt("--seconds", 120));
const BASE = opt("--base", "http://127.0.0.1:8010/functions/v1/api");
const OUT = opt("--out", "");
const DB = `${process.env.SCALE_PREFIX || "psslocal"}-db`;
const sql = (q) => execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();

const branches = sql("SELECT string_agg(id::text, ',' ORDER BY name) FROM branches").split(",");
const owing = {};
for (const line of sql(`SELECT branch_id || ' ' || string_agg(id::text, ',') FROM (SELECT branch_id, id FROM memberships
                         WHERE is_active AND fee_due >= 50 ORDER BY random() LIMIT 2000) x GROUP BY branch_id`).split("\n").filter(Boolean)) {
  const [b, ids] = line.split(" "); owing[b] = ids.split(",");
}

async function call(body, token) {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(/^record_/.test(body.action) ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, ms: performance.now() - t0, body: text };
  } catch (e) { return { status: 0, ms: performance.now() - t0, body: String(e) }; }
}

const stats = {};
const rec = (name, r) => {
  const s = stats[name] ??= { calls: 0, ms: [], failed: 0, business4xx: 0, samples: [] };
  s.calls++; s.ms.push(r.ms);
  const failed = r.status === 0 || r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 429;
  if (failed) { s.failed++; if (s.samples.length < 3) s.samples.push(`${r.status} ${r.body.slice(0, 120)}`); }
  else if (r.status >= 400) s.business4xx++;
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const MIX = [
  [20, "poll_session_alerts", (u) => ({ action: "poll_session_alerts", branchId: u.branch })],
  [10, "poll_my_tasks", () => ({ action: "poll_my_tasks" })],
  [15, "batch dashboard+seat map", (u) => ({ action: "batch", calls: [{ action: "get_dashboard", branchId: u.branch }, { action: "get_seat_map", branchId: u.branch, shift: "morning" }] })],
  [12, "list_students_page", (u) => ({ action: "list_students_page", ...(u.owner ? { allBranches: true } : { branchId: u.branch }), page: 1 + Math.floor(Math.random() * 8) })],
  [5, "students search", (u) => ({ action: "list_students_page", ...(u.owner ? { allBranches: true } : { branchId: u.branch }), search: pick(["a", "an", "ra", "98", "kumar", "s"]), page: 1 })],
  [10, "list_today_bookings", (u) => ({ action: "list_today_bookings", branchId: u.branch })],
  [5, "list_active_memberships", (u) => ({ action: "list_active_memberships", branchId: u.branch })],
  [5, "get_revenue month", (u) => ({ action: "get_revenue", ...(u.owner ? { allBranches: true } : { branchId: u.branch }), period: "month" })],
  [4, "list_transactions month", (u) => ({ action: "list_transactions", branchId: u.branch, period: "month" })],
  [5, "get_daily_report", (u) => ({ action: "get_daily_report", ...(u.owner ? { allBranches: true } : { branchId: u.branch }), period: "today" })],
  [5, "record_payment Rs 1", (u) => ({ action: "record_payment", membershipId: pick(owing[u.branch] ?? [""]), amount: 1, paymentMode: "cash" })],
];
const total = MIX.reduce((n, m) => n + m[0], 0);
const choose = () => { let x = Math.random() * total; for (const m of MIX) { x -= m[0]; if (x < 0) return m; } return MIX[0]; };

// Log every user in first (staff_<k> as in the seeds; every 5th user the owner).
const users = [];
for (let i = 0; i < USERS; i++) {
  const owner = i % 5 === 4;
  const k = (i % branches.length) + 1;
  const r = await call({ action: "login", username: owner ? "owner" : `staff_${k}`, password: owner ? "local-owner-pass" : "local-staff-pass" });
  rec("login", r);
  const token = r.status === 200 ? JSON.parse(r.body).token : null;
  if (!token) { console.log(`login failed for user ${i}: ${r.status} ${r.body.slice(0, 120)}`); process.exit(1); }
  users.push({ token, owner, branch: branches[k - 1] });
}

const end = Date.now() + SECONDS * 1000;
const t0 = Date.now();
await Promise.all(users.map(async (u) => {
  await new Promise((r) => setTimeout(r, Math.random() * 2000));
  while (Date.now() < end) {
    const [, name, body] = choose();
    rec(name, await call(body(u), u.token));
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  }
}));
const secs = (Date.now() - t0) / 1000;

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0); };
let calls = 0, failed = 0, biz = 0; const all = [];
console.log(`\n${USERS} users, ${Math.round(secs)} s, against ${BASE}`);
console.log("action                          calls  failed  4xx-answer   p50   p95    max (ms)");
for (const [name, s] of Object.entries(stats)) {
  calls += s.calls; failed += s.failed; biz += s.business4xx; all.push(...s.ms);
  console.log(`${name.padEnd(30)} ${String(s.calls).padStart(6)} ${String(s.failed).padStart(7)} ${String(s.business4xx).padStart(11)} ${String(q(s.ms, 0.5)).padStart(5)} ${String(q(s.ms, 0.95)).padStart(5)} ${String(Math.round(Math.max(...s.ms))).padStart(6)}`);
  for (const x of s.samples) console.log(`      e.g. ${x}`);
}
console.log(`TOTAL ${calls} calls (${(calls / secs).toFixed(1)}/s), failed ${failed} (${((calls ? failed / calls : 0) * 100).toFixed(2)} %), business 4xx ${biz}, p50 ${q(all, 0.5)} ms, p95 ${q(all, 0.95)} ms`);
if (OUT) writeFileSync(OUT, JSON.stringify({ users: USERS, seconds: secs, calls, failed, biz, p50: q(all, 0.5), p95: q(all, 0.95),
  stats: Object.fromEntries(Object.entries(stats).map(([k, s]) => [k, { calls: s.calls, failed: s.failed, p50: q(s.ms, 0.5), p95: q(s.ms, 0.95) }])) }, null, 1));
process.exit(failed ? 1 : 0);
