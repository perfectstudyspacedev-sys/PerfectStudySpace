// CP3 — RSP W1 (Discounts & Waivers report) and W2 (reasons + log) against the REAL handler.
// deno-lint-ignore-file no-explicit-any
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
const today = IST_TODAY();
let branch: any, other: any, owner: any, t: string, recep: any, tr: string;
async function setup() {
  reset();
  branch = insert("branches", { name: "Hopes", is_active: true, locker_capacity: 10 });
  other = insert("branches", { name: "Other", is_active: true, locker_capacity: 10 });
  owner = insert("staff", { username: "own", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  recep = insert("staff", { username: "rec", display_name: "Ravi", role: "staff", is_active: true, branch_id: other.id });
  t = await tokenFor(owner);
  tr = await tokenFor(recep);
}
function member(endOffset: number, extra: any = {}, phone = "9000000001") {
  const st = insert("students", { name: "Priya", phone, branch_id: branch.id, status: "active" });
  const end = addDays(today, endOffset);
  const mem = insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6,
    start_date: addDays(end, -29), end_date: end, due_date: addDays(end, 1), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0,
    is_active: true, is_paused: false, hold_days: 0, discount_percent: 0, ...extra });
  return { st, mem };
}
const visit = (st: any, mem: any, dayOffsetFromEnd: number) =>
  insert("bookings", { student_id: st.id, branch_id: branch.id, membership_id: mem.id, booking_type: "temporary", status: "completed",
    start_time: new Date(addDays(mem.end_date, dayOffsetFromEnd) + "T10:00:00+05:30").toISOString() });

// ── W2a: Quit — waiving overstay needs a reason, and is logged ──
await setup();
{ const { st, mem } = member(-20); visit(st, mem, 4);
  const r = await call("close_membership", { membershipId: mem.id, waiveOverstayCharge: true }, t);
  const m = rows("memberships").find((x) => x.id === mem.id);
  check(r.status === 400 && /reason/.test(r.error) && m.is_active === true && rows("transactions").length === 0 && rows("waivers").length === 0,
    "W2a Quit: waive without a reason is refused and nothing is written", r);
  const ok = await call("close_membership", { membershipId: mem.id, waiveOverstayCharge: true, waiveReason: "  was unwell  " }, t);
  const w = rows("waivers");
  check(ok.ok && w.length === 1 && w[0].waiver_type === "overstay" && Number(w[0].amount) === 167 && w[0].reason === "was unwell"
    && w[0].created_by_staff_id === owner.id && w[0].membership_id === mem.id && w[0].branch_id === branch.id,
    "W2a Quit: waiver logged — ₹167 (4 days), reason, who, membership", w); }
// Waive ticked but no overstay → no reason needed, nothing logged
await setup();
{ const { mem } = member(-20);
  const ok = await call("close_membership", { membershipId: mem.id, waiveOverstayCharge: true }, t);
  check(ok.ok && rows("waivers").length === 0, "W2a Quit: nothing to waive (no visits after expiry) → no reason needed, no waiver row", ok); }
// Not waived → no waiver row
await setup();
{ const { st, mem } = member(-20); visit(st, mem, 4);
  const ok = await call("close_membership", { membershipId: mem.id, paymentMode: "cash" }, t);
  check(ok.ok && rows("waivers").length === 0, "W2a Quit: overstay charged → no waiver row", ok); }

// ── W2a: Delete ──
await setup();
{ const { st, mem } = member(-6); visit(st, mem, 3);
  const r = await call("delete_membership", { membershipId: mem.id, reason: "left", waiveOverstayCharge: true }, t);
  check(r.status === 400 && /reason for waiving/.test(r.error) && rows("memberships")[0].is_active === true && rows("waivers").length === 0,
    "W2a Delete: waive without a reason is refused and nothing is written", r);
  const ok = await call("delete_membership", { membershipId: mem.id, reason: "left", waiveOverstayCharge: true, waiveReason: "owner said ok" }, t);
  const w = rows("waivers");
  check(ok.ok && w.length === 1 && w[0].waiver_type === "overstay" && Number(w[0].amount) === 125 && w[0].reason === "owner said ok",
    "W2a Delete: waiver logged — ₹125 (3 days) with the reason", w); }

// ── W2b: overtime omit / restore ──
await setup();
{ const { st, mem } = member(10);
  const ot = insert("overtime_sessions", { student_id: st.id, branch_id: branch.id, membership_id: mem.id, session_date: today, overtime_minutes: 45, billed_amount: 30, excluded: false, billed_at: null });
  const r = await call("set_overtime_excluded", { overtimeSessionId: ot.id, excluded: true }, t);
  check(r.status === 400 && /reason/i.test(r.error) && rows("overtime_sessions")[0].excluded === false && rows("waivers").length === 0,
    "W2b: omitting overtime without a reason is refused", r);
  const o = await call("set_overtime_excluded", { overtimeSessionId: ot.id, excluded: true, reason: "clock ran late" }, t);
  check(o.ok && rows("overtime_sessions")[0].excluded === true && rows("waivers").length === 1 && rows("waivers")[0].waiver_type === "overtime_omit"
    && Number(rows("waivers")[0].amount) === 30 && rows("waivers")[0].related_id === ot.id, "W2b: omit logged with amount ₹30 and the reason", rows("waivers"));
  const same = await call("set_overtime_excluded", { overtimeSessionId: ot.id, excluded: true, reason: "again" }, t);
  check(same.ok && rows("waivers").length === 1, "W2b: setting the same state again logs nothing", rows("waivers").length);
  const back = await call("set_overtime_excluded", { overtimeSessionId: ot.id, excluded: false, reason: "omitted by mistake" }, t);
  check(back.ok && rows("overtime_sessions")[0].excluded === false && rows("waivers").length === 2 && rows("waivers")[1].waiver_type === "overtime_restore",
    "W2b: restore logged as overtime_restore", rows("waivers"));
  const rep = await call("get_discounts_waivers", { branchId: branch.id, period: "today" }, t);
  check(rep.totals.overtime === 0 && rep.items.filter((i: any) => i.type === "overtime").length === 2,
    "W1: omit then restore nets to ₹0 in the report (both rows listed)", rep.totals); }

// ── W1: report pulls every source, scoped by date and branch ──
await setup();
{ const { st, mem } = member(10);
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 40 * 86400e3).toISOString();
  insert("membership_discounts", { membership_id: mem.id, student_id: st.id, branch_id: branch.id, discount_type: "fixed", discount_value: 200, discount_amount: 200, remarks: "top student", applied_by_staff_id: owner.id });
  insert("membership_discounts", { membership_id: mem.id, student_id: st.id, branch_id: branch.id, discount_type: "fixed", discount_value: 999, discount_amount: 999, remarks: "old", applied_by_staff_id: owner.id, created_at: old });
  insert("cashbacks", { student_id: st.id, branch_id: branch.id, month_label: "Sep 2026", cashback_type: "fixed", cashback_value: 100, status: "redeemed", redeemed_amount: 100, redeemed_at: now, redeemed_membership_id: mem.id, granted_by_staff_id: owner.id });
  insert("cashbacks", { student_id: st.id, branch_id: branch.id, month_label: "Aug 2026", cashback_type: "fixed", cashback_value: 80, status: "settled", redeemed_amount: 80, redeemed_at: now, granted_by_staff_id: owner.id });
  insert("cashbacks", { student_id: st.id, branch_id: branch.id, month_label: "Oct 2026", cashback_type: "fixed", cashback_value: 50, status: "pending" });
  insert("food_bills", { branch_id: branch.id, student_id: st.id, student_name: "Priya", student_phone: "9000000001", subtotal: 300, discount_type: "percent", discount_value: 10, discount_amount: 30, total: 270, payment_mode: "cash", created_by_staff_id: owner.id });
  insert("food_bills", { branch_id: branch.id, student_name: "Walk", subtotal: 100, discount_amount: 0, total: 100, payment_mode: "cash" });
  insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: today, end_date: addDays(today, 89), due_date: today,
    months_paid: 3, monthly_fee: 1250, discount_percent: 10, total_paid: 3375, is_active: false, created_by_staff_id: owner.id });
  insert("waivers", { branch_id: branch.id, student_id: st.id, membership_id: mem.id, waiver_type: "overstay", amount: 167, reason: "was unwell", created_by_staff_id: owner.id });
  // other branch — must not leak in
  insert("membership_discounts", { membership_id: mem.id, student_id: st.id, branch_id: other.id, discount_type: "fixed", discount_value: 500, discount_amount: 500, remarks: "x" });
  const rep = await call("get_discounts_waivers", { branchId: branch.id, period: "today" }, t);
  const want = { loyalty: 200, cashback: 100, food: 30, overstay: 167, overtime: 0, multi_month: 375 };
  check(JSON.stringify(rep.totals) === JSON.stringify(want) && rep.total === 872,
    "W1: totals — loyalty ₹200, cashback used on renewal ₹100 (cash payouts excluded), food ₹30, overstay ₹167, multi-month ₹375 = ₹872", rep.totals);
  const ov = rep.items.find((i: any) => i.type === "overstay");
  check(ov && ov.reason === undefined && ov.detail === "was unwell" && ov.by === "Owner" && ov.student === "Priya", "W1: each row shows who, student and the reason", ov);
  const mm = rep.items.find((i: any) => i.type === "multi_month");
  check(mm && /3 months at 10% off/.test(mm.detail), "W1: multi-month row explains the discount", mm);
  const range = await call("get_discounts_waivers", { branchId: branch.id, period: "custom", dateFrom: addDays(today, -45), dateTo: addDays(today, -30) }, t);
  check(range.total === 999 && range.items.length === 1, "W1: custom date range picks up only that window", range.totals);
  const all = await call("get_discounts_waivers", { allBranches: true, period: "today" }, t);
  check(all.totals.loyalty === 700 && all.items.some((i: any) => i.branch === "Other"), "W1: owner 'all branches' includes every branch with its name", all.totals);
  const denied = await call("get_discounts_waivers", { branchId: branch.id, period: "today" }, tr);
  check(denied.status === 403, "W1: staff of another branch can't read this branch's report", denied);
  const own = await call("get_discounts_waivers", { branchId: other.id, period: "today", allBranches: true }, tr);
  check(own.status === 200 && own.total === 500, "W1: non-owner asking for all branches only gets their own branch", own.totals);
  const bad = await call("get_discounts_waivers", { branchId: branch.id, period: "custom", dateFrom: "2026-13-01", dateTo: today }, t);
  check(bad.status === 400, "W1: invalid date refused", bad); }
done();
