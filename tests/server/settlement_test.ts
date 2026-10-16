// CP2 — RSP O1–O4 (overstay) and D1–D3 (delete refund) against the REAL handler.
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
const today = IST_TODAY();
let branch: any, owner: any, t: string;
async function setup() {
  reset();
  branch = insert("branches", { name: "Hopes", is_active: true, locker_capacity: 10 });
  owner = insert("staff", { username: "own", role: "owner", is_active: true, branch_id: null });
  t = await tokenFor(owner);
}
function member(endOffset: number, extra: any = {}) {
  const st = insert("students", { name: "Priya", phone: "9000000001", branch_id: branch.id, status: "active" });
  const end = addDays(today, endOffset);
  const mem = insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6,
    start_date: addDays(end, -29), end_date: end, due_date: addDays(end, 1), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0,
    is_active: true, is_paused: false, hold_days: 0, discount_percent: 0, ...extra });
  return { st, mem };
}
const visit = (st: any, mem: any, dayOffsetFromEnd: number, type = "temporary") =>
  insert("bookings", { student_id: st.id, branch_id: branch.id, membership_id: mem.id, booking_type: type, status: "completed",
    start_time: new Date(addDays(mem.end_date, dayOffsetFromEnd) + "T10:00:00+05:30").toISOString() });

// O1 no visits after expiry → ₹0
await setup();
{ const { mem } = member(-25);
  const s = await call("get_membership_closure_summary", { membershipId: mem.id }, t);
  check(s.overstayDays === 0 && s.overstayCharge === 0 && s.lastVisitDate === null, "O1: expired 25 days, never came back → no overstay (was 25 days ≈ ₹1,042)", s); }
// O1 visits → up to last visit
await setup();
{ const { st, mem } = member(-25); visit(st, mem, 2); visit(st, mem, 7);
  const s = await call("get_membership_closure_summary", { membershipId: mem.id }, t);
  check(s.overstayDays === 7 && s.overstayCharge === 292 && s.lastVisitDate === addDays(mem.end_date, 7), "O1/O3: last visit day 7 → 7 × ₹41.67 = ₹292", s);
  check(s.overstayDailyRate === 41.67, "O3/O4: daily rate shown (monthly fee ÷ 30)", s.overstayDailyRate); }
// O2 walk-in ignored; cap at 10
await setup();
{ const { st, mem } = member(-25); visit(st, mem, 5, "walkin");
  const s = await call("get_membership_closure_summary", { membershipId: mem.id }, t);
  check(s.overstayDays === 0, "O2: walk-in visits (paid separately) don't count as overstay", s); }
await setup();
{ const { st, mem } = member(-25); visit(st, mem, 14);
  const s = await call("get_membership_closure_summary", { membershipId: mem.id }, t);
  check(s.overstayDays === 10 && s.overstayCharge === 417, "O2: capped at 10 days even if a later visit exists", s); }
// Quit with/without waive → ledger
await setup();
{ const { st, mem } = member(-20); visit(st, mem, 4);
  const q = await call("close_membership", { membershipId: mem.id, paymentMode: "cash" }, t);
  const tx = rows("transactions");
  check(q.ok && q.overstayCharge === 167 && tx.length === 1 && Number(tx[0].amount) === 167 && /4 day\(s\) used after expiry/.test(tx[0].notes), "Quit: overstay ₹167 (4 days) collected and recorded with its working", { q, tx }); }
await setup();
{ const { st, mem } = member(-20); visit(st, mem, 4);
  const q = await call("close_membership", { membershipId: mem.id, waiveOverstayCharge: true, waiveReason: "goodwill" }, t);
  check(q.ok && q.overstayCharge === 0 && rows("transactions").length === 0, "Quit with waive: nothing charged", q); }
// Delete after expiry uses the same rule
await setup();
{ const { st, mem } = member(-6); visit(st, mem, 3);
  const s = await call("get_membership_delete_summary", { membershipId: mem.id }, t);
  check(s.overstayDays === 3 && s.overstayCharge === 125 && s.proratedRefund === 0, "Delete after expiry: same last-visit overstay (3 days = ₹125), no refund", s); }

// D1 refund at the discounted plan rate (stored plan price/days)
await setup();
{ const st = insert("students", { name: "Asha", phone: "9000000005", branch_id: branch.id });
  const start = addDays(today, -30); const end = addDays(start, 89);
  const mem = insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6,
    start_date: start, end_date: end, due_date: addDays(start, 31), months_paid: 3, monthly_fee: 1250, discount_percent: 10,
    total_paid: 3375, fee_due: 0, is_active: true, is_paused: false, hold_days: 0, plan_amount: 3375, plan_days: 90 });
  const s = await call("get_membership_delete_summary", { membershipId: mem.id }, t);
  const remaining = 59; // end − today
  check(s.remainingDays === remaining && s.refundDailyRate === 37.5 && s.proratedRefund === Math.round(remaining * 37.5), `D1: ${remaining} unused days × ₹37.50 (₹3,375 ÷ 90) = ₹${Math.round(remaining * 37.5)} (old rule: ₹${Math.round(remaining * 3750 / 90)})`, s);
  const d = await call("delete_membership", { membershipId: mem.id, reason: "moving away" }, t);
  const p = rows("payouts").find((x) => x.payout_type === "membership_refund");
  check(d.ok && p && Number(p.amount) === s.proratedRefund && /× ₹37.5 \(plan ₹3375 ÷ 90 days\)/.test(p.notes), "D1: refund paid out with the working in the note", p); }
// D2 legacy row (no plan_amount/plan_days) → estimate from monthly fee, months, discount
await setup();
{ const st = insert("students", { name: "Old", phone: "9000000006", branch_id: branch.id });
  const start = addDays(today, -30); const end = addDays(start, 89);
  const mem = insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6,
    start_date: start, end_date: end, due_date: addDays(start, 31), months_paid: 3, monthly_fee: 1250, discount_percent: 10,
    total_paid: 3375, fee_due: 0, is_active: true, is_paused: false, hold_days: 0 });
  const s = await call("get_membership_delete_summary", { membershipId: mem.id }, t);
  check(s.planAmount === 3375 && s.totalDays === 90 && s.proratedRefund === Math.round(59 * 37.5), "D2: older membership uses the best estimate (₹3,375 over 90 days)", s); }
// D1 cap at what was paid (Pay Later membership)
await setup();
{ const { mem } = member(20, { total_paid: 0, fee_due: 1250, plan_amount: 1250, plan_days: 30 });
  const s = await call("get_membership_delete_summary", { membershipId: mem.id }, t);
  check(s.proratedRefund === Math.round(20 * 1250 / 30) && s.membershipDue === 1250 && s.netAmount === 1250 - s.proratedRefund, "D1: Pay Later membership — dues owed, refund nets against them", s); }
done();
