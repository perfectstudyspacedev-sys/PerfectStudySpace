// Three changes of 24 Nov 2026, on the local dummy stack (writes dummy rows only):
//  1. last login: every login is recorded; list_staff shows it to an admin for everyone,
//     to the owner only for staff members (never the owner row).
//  2. lookup_student returns the saved emergency contact (New Registration fills it for a
//     returning student).
//  3. a new registration may start up to 60 days ahead: the payment is recorded today,
//     check-in is refused before the start date; early renewals (renewed_from set) still
//     check in during the paid period they continue.
import { execFileSync } from "node:child_process";
const DB = `${process.env.SCALE_PREFIX || "psslocal"}-db`;
const sql = (q) => execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const call = async (body, token) => {
  const r = await fetch("http://127.0.0.1:8010/functions/v1/api", { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
      "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let fails = 0;
const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fails++; };
const login = async (u, p) => (await call({ action: "login", username: u, password: p })).body.token;
const istToday = sql("select ((now() at time zone 'Asia/Kolkata')::date)::text");
const plusDays = (n) => sql(`select ('${istToday}'::date + ${n})::text`);

console.log("-- 1. last login on the Staff page");
const t0 = sql("select now()");
const owner = await login("owner", "local-owner-pass");
const admin = await login("localadmin", "local-admin-pass");
const staff1 = await login("staff_1", "local-staff-pass");
ok(owner && admin && staff1, "owner, admin and staff_1 log in");
const stamped = sql(`select string_agg(username, ',' order by username) from staff where last_login_at >= '${t0}'`);
ok(stamped === "localadmin,owner,staff_1", `every login is recorded (fresh last_login_at: ${stamped})`);
const asOwner = (await call({ action: "list_staff" }, owner)).body.staff ?? [];
const ownerRowO = asOwner.find((r) => r.role === "owner"), staffRowO = asOwner.find((r) => r.username === "staff_1");
ok(ownerRowO && !("last_login_at" in ownerRowO), "owner viewing: the owner row has no last login");
ok(asOwner.filter((r) => r.role === "staff").every((r) => "last_login_at" in r) && !!staffRowO?.last_login_at,
  `owner viewing: every staff row carries its last login (staff_1: ${staffRowO?.last_login_at ? "set" : "missing"})`);
const asAdmin = (await call({ action: "list_staff" }, admin)).body.staff ?? [];
ok(asAdmin.length > 0 && asAdmin.every((r) => "last_login_at" in r) && !!asAdmin.find((r) => r.role === "owner")?.last_login_at,
  "admin viewing: every row incl. the owner carries its last login");
const asStaff = await call({ action: "list_staff" }, staff1);
ok(asStaff.status === 403, `staff viewing: list_staff refused as before (HTTP ${asStaff.status})`);

console.log("\n-- 2 and 3. new registration starting in the future; emergency contact of a returning student");
const branch = sql("select id from branches order by name limit 1");
const rnd = () => "7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
const reg = (phone, startDate, emergencyContact = rnd()) => call({ action: "create_membership", branchId: branch, name: "Future Start Test", phone,
  category: "temporary", hoursPerDay: 6, monthsPaid: 1, paymentMode: "cash", course: "Test",
  emergencyContact, referralSource: "word_of_mouth", advanceAmount: null, startDate }, owner);
const p10 = rnd(), start10 = plusDays(10);
const r10 = await reg(p10, start10);
ok(r10.status === 200, `start today+10 accepted: HTTP ${r10.status}${r10.body.error ? ` "${r10.body.error}"` : ""}`);
const m10 = sql(`select m.id || ' ' || m.start_date from memberships m
  join students s on s.id = m.student_id where s.phone = '${p10}' and m.is_active`).split(" ");
ok(m10[1] === start10, `membership starts on the chosen day (${m10[1]})`);
const tx = sql(`select count(*) || ' ' || coalesce(sum(amount), 0) || ' ' || coalesce(max((created_at at time zone 'Asia/Kolkata')::date)::text, '-')
  from transactions where membership_id = '${m10[0]}'`).split(" ");
ok(Number(tx[0]) > 0 && Number(tx[1]) > 0 && tx[2] === istToday, `payment recorded today (${tx[0]} row(s), Rs ${tx[1]}, on ${tx[2]})`);
const st = sql(`select status from students where phone = '${p10}'`);
ok(st === "active", `student shows as active from registration (${st})`);
const sid = sql(`select id from students where phone = '${p10}'`);
const ci = await call({ action: "check_in_member", branchId: branch, studentId: sid }, owner);
ok(ci.status === 400 && /Membership starts on/.test(ci.body.error ?? ""), `check-in before the start: HTTP ${ci.status} "${ci.body.error}"`);
ok(sql(`select count(*) from bookings where student_id = '${sid}' and status = 'active'`) === "0", "no session was opened");
// A future-start registration entered by mistake can be deleted before it starts (it is not an
// early renewal, so "cancel the early renewal first" does not apply); the refund is the full plan.
const p20 = rnd(), ec20 = rnd();
const r20 = await reg(p20, plusDays(20), ec20);
const m20 = sql(`select m.id || ' ' || m.total_paid from memberships m join students s on s.id = m.student_id where s.phone = '${p20}' and m.is_active`).split(" ");
const sum20 = await call({ action: "get_membership_delete_summary", membershipId: m20[0] }, owner);
ok(r20.status === 200 && sum20.status === 200, `delete summary of a not-yet-started registration: HTTP ${sum20.status}${sum20.body.error ? ` "${sum20.body.error}"` : ""}`);
const del20 = await call({ action: "delete_membership", membershipId: m20[0], paymentMode: "cash", reason: "entered by mistake (test)" }, owner);
const after20 = sql(`select is_active || ' ' || coalesce((select sum(amount) from payouts where student_id = m.student_id and created_at >= now() - interval '1 minute'), 0)
  from memberships m where id = '${m20[0]}'`).split(" ");
ok(del20.status === 200 && after20[0] === "false" && Number(after20[1]) === Number(m20[1]),
  `deleted before the start: HTTP ${del20.status}${del20.body.error ? ` "${del20.body.error}"` : ""}, refund Rs ${after20[1]} of Rs ${m20[1]} paid`);
// That student now has only an inactive membership, i.e. is a returning student: New Registration
// gets their saved emergency contact from lookup_student and fills it in.
const lk = (await call({ action: "lookup_student", phone: p20 }, owner)).body.student;
ok(lk?.is_returning === true && lk?.emergency_contact === ec20,
  `returning student: lookup_student gives the saved emergency contact (is_returning ${lk?.is_returning}, contact ${lk?.emergency_contact === ec20 ? "matches" : lk?.emergency_contact})`);
const r60 = await reg(rnd(), plusDays(60));
ok(r60.status === 200, `start today+60 accepted: HTTP ${r60.status}${r60.body.error ? ` "${r60.body.error}"` : ""}`);
const r61 = await reg(rnd(), plusDays(61));
ok(r61.status === 400 && /at most 60 days/.test(r61.body.error ?? ""), `start today+61 refused: HTTP ${r61.status} "${r61.body.error}"`);

console.log("\n-- early renewals still check in during the period they continue");
// Dummy data: a paid-up member with a current membership (picked as in duplicates.mjs) gets
// its membership turned into an early renewal starting tomorrow (renewed_from set, as
// renew_membership does); the check-in must still work.
const er = sql(`select m.id || ' ' || s.id || ' ' || s.branch_id from students s join memberships m on m.student_id = s.id and m.is_active
    and m.end_date >= '${istToday}' and m.fee_due = 0
  order by exists (select 1 from bookings b where b.student_id = s.id and b.status = 'active'),
           (select max(b.start_time) from bookings b where b.student_id = s.id) nulls first, s.s_no limit 1`).split(" ");
sql(`update bookings set status = 'completed', end_time = now() where student_id = '${er[1]}' and status = 'active'`);
sql(`update memberships set start_date = '${plusDays(1)}', renewed_from_membership_id = id where id = '${er[0]}'`);
const ce = await call({ action: "check_in_member", branchId: er[2], studentId: er[1] }, owner);
ok(ce.status === 200, `early-renewed member checks in today: HTTP ${ce.status}${ce.body.error ? ` "${ce.body.error}"` : ""}`);
sql(`update bookings set status = 'completed', end_time = now() where student_id = '${er[1]}' and status = 'active'`);

console.log(`\nResult: ${fails ? fails + " FAIL" : "all PASS"}`);
process.exit(fails ? 1 : 0);
