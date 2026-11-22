// 2b-E: no duplicates, on the local dummy stack. Writes test rows (dummy data only).
import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", `${process.env.SCALE_PREFIX || "psslocal"}-db`, "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const call = async (body, { token, key } = {}) => {
  const r = await fetch("http://127.0.0.1:8010/functions/v1/api", { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body) });
  return { status: r.status, replayed: r.headers.get("idempotency-replayed") === "true", body: await r.json().catch(() => ({})) };
};
let fails = 0; const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fails++; };
const token = (await call({ action: "login", username: "owner", password: "local-owner-pass" })).body.token;
const uuid = () => crypto.randomUUID();

console.log("-- double-click payment (record_payment)");
const mem = sql("SELECT id FROM memberships WHERE is_active AND fee_due >= 100 ORDER BY id LIMIT 1 OFFSET 7");
const txBefore = Number(sql(`SELECT count(*) FROM transactions WHERE membership_id = '${mem}'`));
const dueBefore = Number(sql(`SELECT fee_due FROM memberships WHERE id = '${mem}'`));
const pay = { action: "record_payment", membershipId: mem, amount: 40, paymentMode: "cash" };
const key = uuid();
const [p1, p2] = await Promise.all([call(pay, { token, key }), call(pay, { token, key })]);
const txAfter = Number(sql(`SELECT count(*) FROM transactions WHERE membership_id = '${mem}'`));
const dueAfter = Number(sql(`SELECT fee_due FROM memberships WHERE id = '${mem}'`));
ok(p1.status === 200 && p2.status === 200, `both clicks answered: HTTP ${p1.status} / ${p2.status}`);
ok(txAfter - txBefore === 1, `one payment recorded (transactions +${txAfter - txBefore})`);
ok(dueBefore - dueAfter === 40, `fee due went down once: ${dueBefore} -> ${dueAfter}`);
ok(p1.replayed !== p2.replayed, `one answer was a replay of the other (replayed: ${p1.replayed}/${p2.replayed})`);
ok(JSON.stringify(p1.body) === JSON.stringify(p2.body), "both clicks got the same answer");
const p3 = await call({ ...pay, amount: 41 }, { token, key });
ok(p3.status === 422, `same key, different amount: HTTP ${p3.status} "${p3.body.error}"`);
const p4 = await call(pay, { token, key: uuid() });
ok(p4.status === 200 && Number(sql(`SELECT count(*) FROM transactions WHERE membership_id = '${mem}'`)) - txBefore === 2,
  "a NEW key is a new payment (a real second payment still works)");
const stored = sql(`SELECT count(*) || ' rows, ' || string_agg(DISTINCT status, ',') FROM idempotency_keys`);
console.log(`     idempotency_keys: ${stored}`);

console.log("\n-- simultaneous check-ins (no keys: two desks / two tabs)");
const st = sql(`SELECT s.id || ' ' || s.branch_id FROM students s JOIN memberships m ON m.student_id = s.id AND m.is_active
                 AND m.end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date AND m.fee_due = 0
                WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.student_id = s.id AND b.status = 'active')
                  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.student_id = s.id AND b.start_time >= now() - interval '1 day')
                ORDER BY s.s_no LIMIT 1`).split(" ");
const ci = { action: "check_in_member", branchId: st[1], studentId: st[0] };
const res = await Promise.all([1, 2, 3, 4, 5].map(() => call(ci, { token })));
const open = Number(sql(`SELECT count(*) FROM bookings WHERE student_id = '${st[0]}' AND status = 'active'`));
const okCount = res.filter((r) => r.status === 200).length;
ok(open === 1, `5 check-ins of one student at the same moment: ${open} open session in the database`);
ok(okCount === 1, `exactly one check-in succeeded (${okCount}); the others said: ${[...new Set(res.filter((r) => r.status !== 200).map((r) => r.body.error))].join(" | ")}`);

console.log("\n-- two students, one free desk, at the same moment");
const desk = sql(`SELECT d.id || ' ' || d.branch_id FROM desks d WHERE d.status = 'free'
                   AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.desk_id = d.id AND b.status = 'active') ORDER BY d.label LIMIT 1`).split(" ");
const two = sql(`SELECT string_agg(id::text, ' ') FROM (SELECT s.id FROM students s JOIN memberships m ON m.student_id = s.id AND m.is_active
                  AND m.end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date AND m.category = 'temporary'
                 WHERE s.branch_id = '${desk[1]}' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.student_id = s.id AND (b.status = 'active' OR b.start_time >= (((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata')))
                 ORDER BY s.s_no LIMIT 2) x`).split(" ");
if (two.length !== 2 || !two[0]) { ok(false, `the test found ${two.filter(Boolean).length} eligible students instead of 2`); process.exit(1); }
const dres = await Promise.all(two.map((sid) => call({ action: "check_in_member", branchId: desk[1], studentId: sid, deskId: desk[0] }, { token })));
const onDesk = Number(sql(`SELECT count(*) FROM bookings WHERE desk_id = '${desk[0]}' AND status = 'active'`));
ok(onDesk === 1 && dres.filter((r) => r.status === 200).length === 1, `open sessions on that desk: ${onDesk} (answers ${dres.map((r) => r.status).join("/")}${dres.some((r) => r.status !== 200) ? `: "${dres.find((r) => r.status !== 200).body.error}"` : ""})`);

console.log(`\nResult: ${fails === 0 ? "all PASS" : fails + " FAIL"}`);
process.exit(fails ? 1 : 0);
