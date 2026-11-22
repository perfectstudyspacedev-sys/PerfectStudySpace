// 2b-A: the SQL-summed reports ("api") must equal the JavaScript method ("apiprev",
// committed bfe2cb1) on the local dummy data: money to the paisa, counts exactly.
import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", `${process.env.SCALE_PREFIX || "psslocal"}-db`, "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const call = async (fn, body, token) => {
  const t0 = performance.now();
  const r = await fetch(`http://127.0.0.1:8010/functions/v1/${fn}`, { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), ms: performance.now() - t0 };
};
const tok = {};
for (const fn of ["api", "apiprev"]) {
  tok[fn] = {
    owner: (await call(fn, { action: "login", username: "owner", password: "local-owner-pass" })).body.token,
    staff: (await call(fn, { action: "login", username: "staff_1", password: "local-staff-pass" })).body.token,
  };
}
const branches = sql("SELECT string_agg(id::text, ',' ORDER BY name) FROM branches WHERE is_active").split(",");
const staffBranch = sql("SELECT branch_id FROM staff WHERE username = 'staff_1'");
const today = sql("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date");
const minus = (d) => sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - ${d})`);

// Deep comparison: numbers within half a paisa, everything else exactly.
const diffs = [];
function same(a, b, path) {
  if (typeof a === "number" && typeof b === "number") { if (Math.abs(a - b) > 0.005) diffs.push(`${path}: ${a} vs ${b}`); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { diffs.push(`${path}: length ${a.length} vs ${b.length}`); return; }
    a.forEach((x, i) => same(x, b[i], `${path}[${i}]`)); return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) same(a[k], b[k], `${path}.${k}`); return;
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
let fails = 0, n = 0;
const times = { api: 0, apiprev: 0 };
async function compare(label, body, who, normalise = (x) => x, normalisePrev = normalise) {
  const a = await call("api", body, tok.api[who]), b = await call("apiprev", body, tok.apiprev[who]);
  times.api += a.ms; times.apiprev += b.ms; n++;
  diffs.length = 0;
  if (a.status !== b.status) diffs.push(`HTTP ${a.status} vs ${b.status}`);
  else if (a.status === 200) same(normalise(a.body), normalisePrev(b.body), "");
  const ok = diffs.length === 0;
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${String(Math.round(a.ms)).padStart(5)} / ${String(Math.round(b.ms)).padStart(5)} ms${ok ? "" : "  " + diffs.slice(0, 3).join("; ")}`);
}
const scopes = [["all branches", { allBranches: true }, "owner"], ...branches.map((b, i) => [`branch ${i + 1}`, { branchId: b }, "owner"]), ["staff own branch", { branchId: staffBranch }, "staff"]];
const periods = [["today", { period: "today" }], ["week", { period: "week" }], ["month", { period: "month" }],
  ["custom 30 days", { dateFrom: minus(29), dateTo: today }], ["single past day", { dateFrom: minus(3), dateTo: minus(3) }]];

console.log("-- get_revenue (money to the paisa)            SQL ms / JS ms");
const revNorm = (x) => ({ ...x, byBranch: [...(x.byBranch ?? [])].sort((p, q) => p.name.localeCompare(q.name)) });
for (const [s, sp, who] of scopes) for (const [p, pp] of periods) await compare(`${s}, ${p}`, { action: "get_revenue", ...sp, ...pp }, who, revNorm);

console.log("\n-- get_daily_report (counts exact; walk-ins/new members as counts)");
const dailyNorm = (x) => ({ ...x, byBranch: [...(x.byBranch ?? [])].sort((p, q) => p.name.localeCompare(q.name)) });
const dailyPrev = (x) => { const { walkins, newMembers, ...rest } = x; return dailyNorm({ ...rest, walkinCount: walkins?.length, newMemberCount: newMembers?.length }); };
for (const [s, sp, who] of scopes) for (const [p, pp] of [...periods, ["day (staff view)", { date: minus(1) }]]) {
  await compare(`${s}, ${p}`, { action: "get_daily_report", ...sp, ...pp }, who, (x) => { const { walkins, newMembers, ...r } = x; return dailyNorm(r); }, dailyPrev);
}

console.log("\n-- get_referral_stats");
const refNorm = (x) => ({ ...x, rows: [...(x.rows ?? [])].sort((p, q) => p.source.localeCompare(q.source)) });
for (const [s, sp, who] of scopes) await compare(s, { action: "get_referral_stats", ...sp }, who, refNorm);

console.log("\n-- get_top_students this month (visit and hour figures; ties may list other students)");
const topNorm = (x) => ({ figures: (x.students ?? []).map((r) => [r.total_visits, r.total_hours_studied]) });
for (const [i, b] of branches.entries()) for (const sortBy of ["visits", "hours"]) {
  await compare(`branch ${i + 1}, by ${sortBy}`, { action: "get_top_students", branchId: b, period: "month", sortBy }, "owner", topNorm);
}
// Each student the SQL path lists must carry exactly their own database figures.
for (const [i, b] of branches.entries()) {
  const r = await call("api", { action: "get_top_students", branchId: b, period: "month", sortBy: "visits" }, tok.api.owner);
  const ms = sql(`SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  let bad = 0;
  for (const st of r.body.students ?? []) {
    const [v, h] = sql(`SELECT count(*) || ' ' || coalesce(sum(hours), 0) FROM bookings WHERE branch_id = '${b}' AND student_id = '${st.id}' AND start_time >= '${ms}'`).split(" ").map(Number);
    if (v !== st.total_visits || Math.abs(h - st.total_hours_studied) > 0.005) bad++;
  }
  n++; if (bad) fails++;
  console.log(`  ${bad ? "FAIL" : "PASS"}  branch ${i + 1}: all ${(r.body.students ?? []).length} listed students match their own database figures${bad ? ` (${bad} differ)` : ""}`);
}

console.log("\n-- list_active_memberships (per membership: overtime due, pending cashbacks)");
const memNorm = (x) => ({ members: [...(x.members ?? [])].sort((p, q) => p.membership_id.localeCompare(q.membership_id)) });
for (const [s, sp, who] of scopes) await compare(s, { action: "list_active_memberships", ...sp }, who, memNorm);

console.log("\n-- get_dashboard");
const dashNorm = (x) => ({ ...x, actionable: { dueToday: [...x.actionable.dueToday].sort((p, q) => p.id.localeCompare(q.id)), expiredToday: [...x.actionable.expiredToday].sort((p, q) => p.id.localeCompare(q.id)) } });
for (const [i, b] of branches.entries()) await compare(`branch ${i + 1}`, { action: "get_dashboard", branchId: b }, "owner", dashNorm);
await compare("staff own branch", { action: "get_dashboard", branchId: staffBranch }, "staff", dashNorm);

console.log("\n-- unchanged lists, as a regression check: list_transactions, get_discounts_waivers");
for (const [s, sp, who] of scopes) for (const [p, pp] of [["month", { period: "month" }], ["custom 30 days", { dateFrom: minus(29), dateTo: today }]]) {
  await compare(`list_transactions ${s}, ${p}`, { action: "list_transactions", ...sp, ...pp }, who);
  await compare(`get_discounts_waivers ${s}, ${p}`, { action: "get_discounts_waivers", ...sp, ...pp }, who);
}

console.log(`\n${n} comparisons, ${fails} FAIL. Total time SQL ${Math.round(times.api)} ms, JS ${Math.round(times.apiprev)} ms.`);
process.exit(fails ? 1 : 0);
