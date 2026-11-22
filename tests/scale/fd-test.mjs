import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", "psslocal-db", "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const call = async (fn, body, { ip, token } = {}) => {
  const t0 = performance.now();
  const r = await fetch(`http://127.0.0.1:8010/functions/v1/${fn}`, { method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), ms: performance.now() - t0 };
};
const login = (u, p, ip, fn = "api") => call(fn, { action: "login", username: u, password: p }, { ip });
let fails = 0; const ok = (cond, label) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) fails++; };
sql("DELETE FROM login_failures");
const A = "203.0.113.10", B = "203.0.113.20", C = "203.0.113.30";
console.log("-- F. login lockout");
const wrong = []; for (let i = 0; i < 5; i++) wrong.push((await login("staff_2", "wrong", A)).status);
ok(wrong.every((s) => s === 401), `5 wrong passwords for staff_2 from IP A: ${wrong.join(",")}`);
let r = await login("staff_2", "local-staff-pass", A);
ok(r.status === 429, `6th try, CORRECT password, same IP: HTTP ${r.status} "${r.body.error}"`);
r = await login("staff_2", "local-staff-pass", C);
ok(r.status === 429, `staff_2 from another IP C (username lock): HTTP ${r.status}`);
r = await login("staff_3", "local-staff-pass", A);
ok(r.status === 429, `another user staff_3 from IP A (IP lock): HTTP ${r.status}`);
r = await login("staff_3", "local-staff-pass", B);
ok(r.status === 200, `staff_3 from IP B: HTTP ${r.status}`);
const recorded = sql("SELECT count(*) FROM login_failures");
ok(recorded === "5", `refused attempts are not recorded: ${recorded} failures stored`);
sql("UPDATE login_failures SET failed_at = failed_at - interval '16 minutes'");
r = await login("staff_2", "local-staff-pass", A);
ok(r.status === 200, `16 minutes later, correct password: HTTP ${r.status}`);
ok(sql("SELECT count(*) FROM login_failures WHERE username = 'staff_2'") === "0", "a successful login clears that username's failures");
for (let i = 0; i < 4; i++) await login("staff_1", "wrong", B);
r = await login("staff_1", "local-staff-pass", B);
ok(r.status === 200, `4 wrong then right is still allowed: HTTP ${r.status}`);
r = await login("Staff_2", "wrong"); r = await login("STAFF_2", "wrong");
ok(sql("SELECT count(DISTINCT username) FROM login_failures WHERE username ILIKE 'staff_2'") === "1", "usernames are counted case-insensitively");
for (let i = 0; i < 5; i++) await login(`nobody${i}`, "wrong");
r = await login("staff_1", "local-staff-pass");
ok(r.status === 200, `5 failures with no known client IP do not lock other users: HTTP ${r.status}`);
sql("DELETE FROM login_failures");

console.log("\n-- D. cached reads give the same answer as before (apiprev = committed bfe2cb1)");
const tok = {}; for (const fn of ["api", "apiprev"]) tok[fn] = (await login("owner", "local-owner-pass", null, fn)).body.token;
const staffTok = {}; for (const fn of ["api", "apiprev"]) staffTok[fn] = (await login("staff_1", "local-staff-pass", null, fn)).body.token;
for (const [label, body, who] of [["list_branches (owner)", { action: "list_branches" }, tok], ["list_branches (staff)", { action: "list_branches" }, staffTok],
    ["list_transfer_branches", { action: "list_transfer_branches" }, tok], ["list_fee_config", { action: "list_fee_config" }, tok],
    ["get_welcome_template", { action: "get_welcome_template" }, tok], ["get_staff_grid", { action: "get_staff_grid" }, tok],
    ["get_combined_hall", { action: "get_combined_hall" }, tok], ["list_students all (branch ids)", { action: "list_students", allBranches: true }, tok]]) {
  const a = await call("api", body, { token: who.api }), b = await call("apiprev", body, { token: who.apiprev });
  ok(a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body), `${label}: HTTP ${a.status}/${b.status}, ${JSON.stringify(a.body).length} bytes, identical`);
}
console.log("\n-- D. login time, 20 logins each (warm), median ms");
for (const fn of ["apiprev", "api"]) {
  const t = []; for (let i = 0; i < 20; i++) t.push((await login("staff_1", "local-staff-pass", null, fn)).ms);
  t.sort((x, y) => x - y); console.log(`  ${fn.padEnd(8)} median ${t[10].toFixed(0)} ms, min ${t[0].toFixed(0)}, max ${t[19].toFixed(0)}`);
}
console.log(`\nResult: ${fails === 0 ? "all PASS" : fails + " FAIL"}`);
