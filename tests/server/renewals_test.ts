// CP1 — RSP R1–R7 against the REAL handler (fake DB).
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";

const today = IST_TODAY();
let branch: any, owner: any, t: string;
function setup() {
  reset();
  branch = insert("branches", { name: "Hopes", is_active: true, locker_capacity: 10 });
  owner = insert("staff", { username: "own", role: "owner", is_active: true, branch_id: null, display_name: "Owner" });
}
function member(endOffset: number, extra: any = {}) {
  const st = insert("students", { name: "Priya", phone: "9000000001", branch_id: branch.id, status: "active" });
  const end = addDays(today, endOffset);
  const mem = insert("memberships", {
    student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6,
    start_date: addDays(end, -29), end_date: end, due_date: addDays(end, 1), months_paid: 1, monthly_fee: 1250,
    total_paid: 1250, fee_due: 0, is_active: true, is_paused: false, hold_days: 0, discount_percent: 0, ...extra,
  });
  return { st, mem };
}
const renewBody = (mem: any, extra: any = {}) => ({ membershipId: mem.id, monthsPaid: 1, paymentMode: "cash", category: "temporary", hoursPerDay: 6, isCustomPlan: false, ...extra });

setup(); t = await tokenFor(owner);

// ── R2/R3 Early renewal ──
{
  const { st, mem } = member(4); // ends in 4 days
  const originalEnd = mem.end_date;
  insert("cashbacks", { student_id: st.id, branch_id: branch.id, cashback_type: "fixed", cashback_value: 100, status: "pending", month_label: "Sep" });
  const r = await call("renew_membership", renewBody(mem), t);
  check(r.ok && r.kind === "early", "early: renewal before expiry succeeds (was 'Start date cannot be in the future')", r);
  check(r.startDate === addDays(mem.end_date, 1), "early: new period starts the day after the current end", r.startDate);
  const nm = rows("memberships").find((m) => m.id === r.membershipId)!;
  check(nm.is_active && !rows("memberships").find((m) => m.id === mem.id)!.is_active, "early: new membership active, old switched off (one active per student)");
  check(nm.renewed_from_membership_id === mem.id, "early: renewal linked to the membership it continued");
  check(Number(nm.plan_amount) === 1250 && nm.plan_days >= 28 && nm.plan_days <= 31, "early: plan price and plan days stored", { a: nm.plan_amount, d: nm.plan_days });
  const tx = rows("transactions").filter((x) => x.membership_id === nm.id);
  check(tx.length === 1 && Number(tx[0].amount) === 1150 && /early — starts/.test(tx[0].notes), "early: payment recorded once (₹1250 − ₹100 cashback) with an 'early' note", tx);

  // R4 already renewed early
  const again = await call("renew_membership", renewBody(nm), t);
  check(again.status === 400 && /already renewed early/.test(again.error), "R4: a second renewal before the new period starts is blocked", again.error);
  // R5 gap blocks
  for (const [action, extra] of [["change_membership_plan", { newCategory: "temporary", newHoursPerDay: 8 }], ["get_membership_delete_summary", {}], ["delete_membership", { reason: "x", paymentMode: "cash" }], ["get_membership_closure_summary", {}], ["close_membership", { paymentMode: "cash" }]] as const) {
    const g = await call(action, { membershipId: nm.id, ...extra }, t);
    check(g.status === 400 && /renewed early/.test(g.error), `R5: ${action} blocked before the new period starts`, g.error);
  }

  // R6 cancel: attendance during the gap + a hold taken in the gap
  const bk = insert("bookings", { student_id: st.id, branch_id: branch.id, membership_id: nm.id, booking_type: "temporary", status: "completed", start_time: new Date().toISOString() });
  nm.hold_days = 2; nm.end_date = addDays(nm.end_date, 2);
  const noReason = await call("cancel_early_renewal", { membershipId: nm.id, reason: " " }, t);
  check(noReason.status === 400 && /reason/.test(noReason.error), "R6: cancel requires a reason", noReason.error);
  const c = await call("cancel_early_renewal", { membershipId: nm.id, reason: "renewed by mistake" }, t);
  check(c.ok && c.refund === 1150, "R6: cancel refunds the renewal money actually paid (₹1150)", c);
  const old = rows("memberships").find((m) => m.id === mem.id)!;
  check(old.is_active && !nm.is_active, "R6: previous membership active again, renewal switched off");
  check(old.end_date === addDays(originalEnd, 2) && old.hold_days === 2, "R6: hold days taken in the gap move back to the previous membership", { end: old.end_date, hold: old.hold_days });
  check(rows("bookings").find((x) => x.id === bk.id)!.membership_id === mem.id, "R6: attendance from the gap re-pointed to the previous membership");
  const cb = rows("cashbacks")[0];
  check(cb.status === "pending" && cb.redeemed_membership_id === null, "R6: cashback used by the renewal is pending again");
  const p = rows("payouts").find((x) => x.payout_type === "membership_refund");
  check(p && Number(p.amount) === 1150, "R6: refund recorded as a payout (books: +1150 −1150 = 0)");
  check(rows("membership_edits").some((e) => e.edit_type === "cancel_early_renewal" && e.new_value === "renewed by mistake"), "R6: cancellation logged with its reason");
}

// ── R3 same plan; R2 fixed start ──
setup(); t = await tokenFor(owner);
{
  const { mem } = member(3);
  const r1 = await call("renew_membership", renewBody(mem, { hoursPerDay: 8 }), t);
  check(r1.status === 400 && /keeps the same plan/.test(r1.error), "R3: early renewal with a different plan is refused", r1.error);
  const r2 = await call("renew_membership", renewBody(mem, { startDate: today }), t);
  check(r2.status === 400 && /starts on/.test(r2.error), "R2: early renewal can't start today (would eat remaining days)", r2.error);
  // R4 on hold
  rows("memberships").find((m) => m.id === mem.id)!.is_paused = true;
  const r3 = await call("renew_membership", renewBody(mem), t);
  check(r3.status === 400 && /on hold/.test(r3.error), "R4: renewing while on hold is blocked", r3.error);
}

// ── Grace renewal ──
setup(); t = await tokenFor(owner);
{
  const { mem } = member(-5);
  const bad = await call("renew_membership", renewBody(mem, { startDate: today }), t);
  check(bad.status === 400 && /grace-period/.test(bad.error), "grace: start date other than the day after expiry is refused", bad.error);
  const r = await call("renew_membership", renewBody(mem, { hoursPerDay: 8 }), t);
  check(r.ok && r.kind === "grace" && r.startDate === addDays(mem.end_date, 1), "grace: starts the day after expiry (grace days count as used), plan change allowed", r);
}

// ── Late renewal ──
setup(); t = await tokenFor(owner);
{
  const { mem } = member(-15);
  const overlap = await call("renew_membership", renewBody(mem, { startDate: mem.end_date }), t);
  check(overlap.status === 400 && /overlap/.test(overlap.error), "late: backdating into the old period is refused", overlap.error);
  const future = await call("renew_membership", renewBody(mem, { startDate: addDays(today, 1) }), t);
  check(future.status === 400 && /future/.test(future.error), "late: future start refused");
  const back = await call("renew_membership", renewBody(mem, { startDate: addDays(mem.end_date, 3) }), t);
  check(back.ok && back.kind === "late" && back.startDate === addDays(mem.end_date, 3), "late: backdating within allowed range works", back);
}
setup(); t = await tokenFor(owner);
{
  const { mem } = member(-15);
  const r = await call("renew_membership", renewBody(mem), t);
  check(r.ok && r.startDate === today, "late: default start is today", r.startDate);
  // cancel is only for early renewals that haven't started
  const c = await call("cancel_early_renewal", { membershipId: r.membershipId, reason: "x" }, t);
  check(c.status === 400 && /already started/.test(c.error), "R6: cancelling a renewal that has started is refused", c.error);
}

// ── R6 blocked after a branch transfer ──
setup(); t = await tokenFor(owner);
{
  const other = insert("branches", { name: "Gandhipuram", is_active: true, locker_capacity: 10 });
  const { mem } = member(2);
  const r = await call("renew_membership", renewBody(mem), t);
  rows("memberships").find((m) => m.id === r.membershipId)!.branch_id = other.id;
  const c = await call("cancel_early_renewal", { membershipId: r.membershipId, reason: "x" }, t);
  check(c.status === 400 && /another branch/.test(c.error), "R6: cancel blocked if the student was transferred after renewing", c.error);
}

// ── plan price/days stored by new registrations too ──
setup(); t = await tokenFor(owner);
{
  const r = await call("create_membership", {
    branchId: branch.id, name: "Asha", phone: "9000000002", category: "temporary", hoursPerDay: 6, monthsPaid: 3,
    paymentMode: "cash", emergencyContact: "9000000003", referralSource: "google_search",
  }, t);
  const m = rows("memberships").find((x) => x.id === r.membership?.id);
  check(m && Number(m.plan_amount) === 3375 && m.plan_days >= 89 && m.plan_days <= 92, "registration stores plan price after discount (3 × 1250 − 10% = 3375) and plan days", m && { a: m.plan_amount, d: m.plan_days });
}
done();
