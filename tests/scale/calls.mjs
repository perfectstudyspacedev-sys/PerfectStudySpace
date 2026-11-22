// 2b-D on the local dummy stack: batch parts equal their own calls; the light pollers give
// what the hooks used to take from the heavy lists. Reads only.
import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", "psslocal-db", "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const call = async (body, token) => {
  const r = await fetch("http://127.0.0.1:8010/functions/v1/api", { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, bytes: text.length, body: JSON.parse(text || "null") };
};
let fails = 0; const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fails++; };
const login = async (u, p) => (await call({ action: "login", username: u, password: p })).body.token;
const owner = await login("owner", "local-owner-pass");
const staff = await login("staff_1", "local-staff-pass");
const branches = sql("SELECT string_agg(id::text, ',' ORDER BY name) FROM branches WHERE is_active").split(",");
const keysBefore = Number(sql("SELECT count(*) FROM idempotency_keys"));
const norm = (x) => JSON.stringify(x, (k, v) => (Array.isArray(v) && v.length && v[0]?.id ? [...v].sort((a, b) => String(a.id).localeCompare(String(b.id))) : v));

console.log("-- batch: each part equals its own call");
for (const [i, b] of branches.entries()) {
  const calls = [{ action: "get_dashboard", branchId: b }, { action: "get_seat_map", branchId: b, shift: "morning" }];
  const batched = await call({ action: "batch", calls }, owner);
  const singles = await Promise.all(calls.map((c) => call(c, owner)));
  ok(batched.status === 200 && batched.body.results.every((r, k) => r.status === singles[k].status && norm(r.body) === norm(singles[k].body)),
    `branch ${i + 1}: get_dashboard + get_seat_map (${batched.bytes} bytes in 1 request vs ${singles.reduce((n, s) => n + s.bytes, 0)} in 2)`);
}
const comb = [{ action: "get_combined_hall" }, { action: "get_combined_seatmap" }, { action: "get_combined_pending", date: sql("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date") }];
const cb = await call({ action: "batch", calls: comb }, owner);
const cs = await Promise.all(comb.map((c) => call(c, owner)));
ok(cb.status === 200 && cb.body.results.every((r, k) => r.status === cs[k].status && norm(r.body) === norm(cs[k].body)), "Combined Hall: hall + seat map + pending, 1 request instead of 3");
const sb = await call({ action: "batch", calls: [{ action: "get_dashboard", branchId: branches[1] }] }, staff);
const ss = await call({ action: "get_dashboard", branchId: branches[1] }, staff);
ok(sb.body.results[0].status === 403 && ss.status === 403, `branch rules still apply inside a batch (staff, other branch: ${sb.body.results[0].status})`);
const w = await call({ action: "batch", calls: [{ action: "record_payment", membershipId: "x", amount: 1 }] }, owner);
ok(w.status === 400, `a write inside a batch is refused: HTTP ${w.status} "${w.body.error}"`);
const big = await call({ action: "batch", calls: Array.from({ length: 11 }, () => ({ action: "whoami" })) }, owner);
ok(big.status === 400, `more than 10 calls refused: HTTP ${big.status}`);
const nested = await call({ action: "batch", calls: [{ action: "batch", calls: [] }] }, owner);
ok(nested.status === 400, `nested batch refused: HTTP ${nested.status}`);

console.log("\n-- light pollers give what the hooks used to read");
const pick = (bk) => ({ id: bk.id, start_time: bk.start_time, end_time: bk.end_time, hours: Number(bk.hours), is_paused: bk.is_paused, name: bk.students?.name ?? null });
for (const [i, b] of branches.entries()) {
  const heavy = await call({ action: "list_today_bookings", branchId: b }, owner);
  const light = await call({ action: "poll_session_alerts", branchId: b }, owner);
  const h = heavy.body.bookings.map(pick).sort((x, y) => x.id.localeCompare(y.id));
  const l = light.body.bookings.map(pick).sort((x, y) => x.id.localeCompare(y.id));
  ok(JSON.stringify(h) === JSON.stringify(l), `session alerts, branch ${i + 1}: ${l.length} open sessions identical; ${light.bytes} bytes instead of ${heavy.bytes}`);
}
for (const [who, token, user] of [["owner", owner, "owner"], ["staff_1", staff, "staff_1"]]) {
  const me = sql(`SELECT id FROM staff WHERE username = '${user}'`);
  const heavy = await call({ action: "list_tasks", allBranches: true }, token);
  const light = await call({ action: "poll_my_tasks" }, token);
  const h = heavy.body.tasks.filter((t) => t.assigned_to_staff_id === me).map((t) => [t.id, t.title, t.assigned_by_staff_id]).sort();
  const l = light.body.tasks.map((t) => [t.id, t.title, t.assigned_by_staff_id]).sort();
  ok(JSON.stringify(h) === JSON.stringify(l), `task bell, ${who}: ${l.length} tasks identical; ${light.bytes} bytes instead of ${heavy.bytes}`);
}
ok(Number(sql("SELECT count(*) FROM idempotency_keys")) === keysBefore, "batches and polls stored no idempotency records");
console.log(`\nResult: ${fails === 0 ? "all PASS" : fails + " FAIL"}`);
process.exit(fails ? 1 : 0);
