// P0.7 and P0.8 — the cron function and the system jobs against the REAL handlers: secret check,
// each job once, the pssai_cron switch, and the nightly integrity report.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";

Deno.env.set("CRON_SECRET", "cron-test-secret");
let cronHandler: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, "serve", { value: (h: any) => { cronHandler = h; return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {}, addr: {} }; }, configurable: true, writable: true });
await import(new URL("../../supabase/functions/cron/index.ts", import.meta.url).href);
if (!cronHandler) throw new Error("cron handler not captured");

async function cron(job: unknown, secret: string | null = "cron-test-secret", method = "POST") {
  const res = await cronHandler!(new Request("http://fn.local/cron", {
    method, headers: { "content-type": "application/json", ...(secret !== null ? { "x-cron-secret": secret } : {}) },
    ...(method === "POST" ? { body: JSON.stringify({ job }) } : {}),
  }));
  return { status: res.status, ...(await res.json()) };
}
const TODAY = IST_TODAY();
const flag = (value: "on" | "off") => {
  const t = rows("app_settings"); const hit = t.find((r) => r.key === "pssai_cron");
  if (hit) hit.value = value; else insert("app_settings", { key: "pssai_cron", value });
};

let b1: any, b2: any, owner: any, priya: any, tO: string, tP: string;
async function setup() {
  reset();
  b1 = insert("branches", { name: "Hopes", desk_count: 4, locker_capacity: 20, is_active: true, shift_config: ["morning"] });
  b2 = insert("branches", { name: "Ram Nagar", desk_count: 2, locker_capacity: 10, is_active: true, shift_config: ["morning"] });
  insert("branches", { name: "Closed", desk_count: 2, locker_capacity: 10, is_active: false, shift_config: ["morning"] });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
}
// end_date offsets: 3 and 7 days (inside the final week), 20 days (not), -2 days (expired)
function seedMembers() {
  const list: any[] = [];
  for (const [name, branch, endIn] of [["Asha Rao", b1, 3], ["Bala Kumar", b1, 20], ["Chitra Devi", b2, 7], ["Deepa Nair", b2, -2]] as [string, any, number][]) {
    const st = insert("students", { name, phone: `91000000${list.length}0`, branch_id: branch.id, status: "active" });
    list.push(insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, endIn - 29), end_date: addDays(TODAY, endIn), due_date: addDays(TODAY, endIn), months_paid: 1, monthly_fee: 1250, total_paid: 1250, is_active: true }));
  }
  return list;
}
// ids differ between runs (each setup makes new rows), so compare what staff see
const alertsView = () => rows("alerts").map((a) => `${a.alert_type}|${a.due_date}|${a.message}|${rows("branches").find((b) => b.id === a.branch_id)?.name}`).sort();

// ── The secret ──
await setup();
{
  const none = await cron("cron_purge_signups", null);
  const wrong = await cron("cron_purge_signups", "cron-test-secreT");
  const short = await cron("cron_purge_signups", "cron");
  const get = await cron("cron_purge_signups", "cron-test-secret", "GET");
  check([none, wrong, short, get].every((r) => r.status === 401 && r.error === "Unauthorized") && rows("events").length === 0,
    "C1: refused without the right x-cron-secret (missing, wrong, prefix, GET), and nothing runs", { none, wrong, short, get });
  Deno.env.delete("CRON_SECRET");
  const unset = await cron("cron_purge_signups");
  Deno.env.set("CRON_SECRET", "cron-test-secret");
  check(unset.status === 500 && /CRON_SECRET/.test(unset.error), "C1: with no CRON_SECRET set every call is refused", unset);
  const unknown = await cron("no_such_job");
  const staffAction = await cron("list_branches");
  check(unknown.status === 400 && staffAction.status === 400 && /Unknown job/.test(staffAction.error), "C1: only system jobs run here — not staff actions", { unknown, staffAction });
  for (const job of ["cron_expiry_alerts", "cron_purge_signups", "cron_purge_idempotency", "cron_integrity_report"]) {
    const r = await call(job, {}, tO);
    check(r.status === 400 && r.error === `Unknown action: ${job}`, `C1: the api function refuses ${job}, even for the owner`, r);
  }
}
// ── Each job once ──
await setup();
seedMembers();
for (const job of ["cron_expiry_alerts", "cron_purge_signups", "cron_purge_idempotency", "cron_integrity_report"]) {
  const before = rows("events").length;
  const r = await cron(job);
  const added = rows("events").slice(before);
  const expected = job === "cron_integrity_report" ? "integrity_report" : job;
  check(r.status === 200 && r.ok === true && added.length === 1 && added[0].action === expected && added[0].actor_type === "system" && added[0].actor_id === null && added[0].ok === true,
    `C2: ${job} runs once with the secret and logs one system event`, { r, added });
}

// ── The pssai_cron switch: expiry alerts ──
await setup();
seedMembers();
{
  // flag off (today): opening the Members page creates the reminders
  await call("list_active_memberships", { branchId: b1.id }, tP);
  await call("list_active_memberships", { allBranches: true }, tO);
  const fromPage = alertsView();
  check(fromPage.length === 2, "C3: flag off — opening the Members page creates the final-week reminders, as today", fromPage);

  await setup();
  seedMembers();
  flag("on");
  await call("list_active_memberships", { branchId: b1.id }, tP);
  await call("list_active_memberships", { allBranches: true }, tO);
  check(rows("alerts").length === 0, "C3: flag on — opening the Members page creates no alerts", rows("alerts"));
  const r = await cron("cron_expiry_alerts");
  check(r.ok && JSON.stringify(alertsView()) === JSON.stringify(fromPage), "C3: the 06:00 job creates the same reminders the page did", { cron: alertsView(), page: fromPage });
  await cron("cron_expiry_alerts");
  check(rows("alerts").length === 2, "C3: running the job again keeps one reminder per student (no duplicates)", rows("alerts"));
  const closed = rows("branches").find((b) => !b.is_active)!;
  const st = insert("students", { name: "Esha Shah", phone: "9100000099", branch_id: closed.id, status: "active" });
  insert("memberships", { student_id: st.id, branch_id: closed.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -27), end_date: addDays(TODAY, 2), due_date: addDays(TODAY, 2), months_paid: 1, monthly_fee: 1250, is_active: true });
  await cron("cron_expiry_alerts");
  check(rows("alerts").length === 2, "C3: inactive branches are skipped, like the owner's all-branches list", rows("alerts"));
}
// ── The pssai_cron switch: sign-up purge ──
await setup();
{
  const old = insert("signup_requests", { branch_id: b1.id, ref_code: "0A1B", name: "Old Signup", phone: "9400000001", emergency_contact: "9400000002", referral_source: "flex", claimed_by_staff_id: null, claimed_at: null, created_at: new Date(Date.now() - 2 * 86400e3).toISOString() });
  flag("on");
  await call("list_signup_requests", { branchId: b1.id }, tP);
  check(rows("signup_requests").some((r) => r.id === old.id), "C4: flag on — reading sign-ups no longer deletes old ones");
  await cron("cron_purge_signups");
  check(!rows("signup_requests").some((r) => r.id === old.id), "C4: the 00:05 job deletes them");
  const again = insert("signup_requests", { branch_id: b1.id, ref_code: "0A1C", name: "Old Two", phone: "9400000003", emergency_contact: "9400000004", referral_source: "flex", claimed_by_staff_id: null, claimed_at: null, created_at: new Date(Date.now() - 2 * 86400e3).toISOString() });
  flag("off");
  await call("list_signup_requests", { branchId: b1.id }, tP);
  check(!rows("signup_requests").some((r) => r.id === again.id), "C4: flag off — reading sign-ups purges them, as today");
}
// ── Idempotency key purge ──
await setup();
{
  const keep = { key: "fresh", action: "record_payment", status: 200, response: {}, created_at: new Date(Date.now() - 47 * 3600e3).toISOString() };
  const drop = { key: "old", action: "record_payment", status: 200, response: {}, created_at: new Date(Date.now() - 49 * 3600e3).toISOString() };
  rows("idempotency_keys").push(keep, drop);
  await cron("cron_purge_idempotency");
  check(rows("idempotency_keys").map((k) => k.key).join() === "fresh", "C5: keys older than 48 hours are deleted, newer ones kept", rows("idempotency_keys"));
}
// ── Integrity report ──
await setup();
{
  const [good] = seedMembers();
  const st = rows("students")[0];
  insert("memberships", { student_id: st.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: "2026-09-01", end_date: "2026-10-05", due_date: "2026-10-01", months_paid: 1, hold_days: 0, monthly_fee: 1250, is_active: false });
  insert("memberships", { student_id: st.id, branch_id: b2.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: "2026-08-01", end_date: "2026-09-04", due_date: "2026-09-01", months_paid: 1, hold_days: 3, monthly_fee: 1250, is_active: false });
  insert("food_passes", { student_id: st.id, branch_id: b1.id, balance: -40 });
  insert("food_passes", { student_id: st.id, branch_id: b2.id, balance: 25 });
  insert("bookings", { student_id: st.id, branch_id: b1.id, booking_type: "temporary", status: "active", start_time: new Date(Date.now() - 30 * 3600e3).toISOString(), hours: 6, amount: 0 });
  insert("bookings", { student_id: st.id, branch_id: b1.id, booking_type: "walkin", status: "active", start_time: new Date(Date.now() - 2 * 3600e3).toISOString(), hours: 3, amount: 35 });
  insert("bookings", { student_id: st.id, branch_id: b1.id, booking_type: "walkin", status: "completed", start_time: new Date(Date.now() - 50 * 3600e3).toISOString(), hours: 3, amount: 35 });
  const before = JSON.stringify(rows("memberships")) + JSON.stringify(rows("food_passes")) + JSON.stringify(rows("bookings"));

  const none = await call("get_integrity_report", {}, tO);
  check(none.status === 200 && none.report === null, "I1: before the first run there is no report", none);
  const r = await cron("cron_integrity_report");
  const after = JSON.stringify(rows("memberships")) + JSON.stringify(rows("food_passes")) + JSON.stringify(rows("bookings"));
  check(before === after, "I1: the checks change nothing");
  const ev = rows("events").filter((e) => e.action === "integrity_report");
  check(ev.length === 1 && ev[0].actor_type === "system" && ev[0].tier === "T0", "I1: one events row with action 'integrity_report'", ev);
  const rep = await call("get_integrity_report", {}, tO);
  check(rep.report && rep.report.occurredAt === ev[0].occurred_at && rep.report.counts.negative_food_pass === 1 && rep.report.counts.stale_active_bookings === 1
    && rep.report.stale_active_bookings[0].booking_type === "temporary" && rep.report.negative_food_pass[0].balance === -40,
    "I1: the owner reads it back — one negative Food Pass, one session open over 24 hours", rep.report);
  check(!JSON.stringify(ev[0].payload).includes("Asha") && !JSON.stringify(ev[0].payload).includes("91000000"), "I1: the report holds ids only, no names or phone numbers");
  const staffRead = await call("get_integrity_report", {}, tP);
  check(staffRead.status === 403, "I1: staff cannot read the report", staffRead);

  // the counts match what the fix_* actions then change
  const fixDates = await call("fix_membership_dates", {}, tO);
  const fixPasses = await call("fix_negative_food_pass_balances", {}, tO);
  check(fixDates.fixed === r.counts.membership_dates && fixDates.checked === rep.report.checked.memberships && fixPasses.fixed === r.counts.negative_food_pass,
    "I2: the counts match what fix_membership_dates and fix_negative_food_pass_balances change", { counts: r.counts, fixDates, fixPasses });
  await cron("cron_integrity_report");
  const latest = await call("get_integrity_report", {}, tO);
  check(latest.report.counts.membership_dates === 0 && latest.report.counts.negative_food_pass === 0 && rows("events").filter((e) => e.action === "integrity_report").length === 2,
    "I2: after the fixes the next report is clean and is the one returned", latest.report.counts);
  void good;
}

done();
