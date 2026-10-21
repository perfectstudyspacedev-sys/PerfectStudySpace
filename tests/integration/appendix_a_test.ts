// Appendix A part 2 (B1–B10) — the money and seat rules against a REAL Postgres through the real
// Supabase client: real constraints, real concurrency, real PostgREST filters.
// deno-lint-ignore-file no-explicit-any
import { addDays, call, check, db, done, get, insert, IST_TODAY, phone, where, world } from "./harness.ts";
import { claimDesk } from "../../supabase/functions/api/lib.ts";

const TODAY = IST_TODAY();

async function member(branchId: string, opts: { start?: string; end?: string; fee_due?: number; total_paid?: number; months?: number; plan_amount?: number; plan_days?: number; discount?: number; is_paused?: boolean } = {}) {
  const s = await insert("students", { name: "IT Student", phone: phone(), branch_id: branchId, status: "active" });
  const end = opts.end ?? addDays(TODAY, 10);
  const start = opts.start ?? addDays(end, -29);
  const m = await insert("memberships", {
    student_id: s.id, branch_id: branchId, category: "temporary", seat_type: "floating", hours_per_day: 6,
    start_date: start, end_date: end, due_date: addDays(end, 1), months_paid: opts.months ?? 1, monthly_fee: 1250,
    total_paid: opts.total_paid ?? 1250, fee_due: opts.fee_due ?? 0, is_active: true, is_paused: !!opts.is_paused,
    paused_at: opts.is_paused ? new Date().toISOString() : null, discount_percent: opts.discount ?? 0,
    plan_amount: opts.plan_amount ?? 1250, plan_days: opts.plan_days ?? 30,
  });
  return { s, m };
}
const txOf = async (studentId: string) => (await where("transactions", "student_id", studentId));

// ── B1: two claimDesk calls at once for one free desk → exactly one wins ──
{
  const w = await world("b1");
  let ok = 0, rounds = 6;
  for (let i = 0; i < rounds; i++) {
    const desk = await insert("desks", { branch_id: w.branch.id, label: `B1-${i}`, status: "free", sort_order: i });
    const a = await insert("students", { name: "A", phone: phone(), branch_id: w.branch.id });
    const b = await insert("students", { name: "B", phone: phone(), branch_id: w.branch.id });
    const [x, y] = await Promise.all([claimDesk(db as any, desk.id, a.id), claimDesk(db as any, desk.id, b.id)]);
    const after = await get("desks", desk.id);
    if ([x, y].filter(Boolean).length === 1 && after.assigned_student_id === (x ? a.id : b.id)) ok++;
  }
  check(ok === rounds, `B1: exactly one of two simultaneous claims wins, every time (${ok}/${rounds})`);
}

// ── B2: checkout twice → the second is refused and charges nothing ──
{
  const w = await world("b2");
  const { s, m } = await member(w.branch.id);
  const desk = await insert("desks", { branch_id: w.branch.id, label: "B2", status: "occupied", sort_order: 0 });
  const bk = await insert("bookings", { student_id: s.id, branch_id: w.branch.id, desk_id: desk.id, membership_id: m.id, booking_type: "temporary", status: "active", start_time: new Date(Date.now() - 3 * 3600e3).toISOString(), end_time: new Date(Date.now() + 3 * 3600e3).toISOString(), hours: 6, scheduled_hours: 6, amount: 0 });
  const first = await call("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, w.tS);
  const txBefore = (await txOf(s.id)).length;
  const second = await call("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, w.tS);
  check(first.status === 200 && second.status === 400 && second.error === "This session has already been checked out." && (await txOf(s.id)).length === txBefore,
    "B2: the second checkout says 'This session has already been checked out.' and charges nothing", { first: first.status, second });
}

// ── B3: attendance overlapping an existing session is refused ──
{
  const w = await world("b3");
  const { s, m } = await member(w.branch.id);
  const day = addDays(TODAY, -1);
  await insert("bookings", { student_id: s.id, branch_id: w.branch.id, membership_id: m.id, booking_type: "temporary", status: "completed", start_time: `${day}T10:00:00+05:30`, end_time: `${day}T13:00:00+05:30`, hours: 3, amount: 0 });
  const r = await call("add_attendance", { branchId: w.branch.id, studentId: s.id, startTime: `${day}T11:00:00+05:30`, endTime: `${day}T12:00:00+05:30` }, w.tO);
  check(r.status >= 400 && /overlap/i.test(r.error), "B3: a session overlapping an existing one is refused", r);
}

// ── B4: early renewal starts the day after the end date, same plan ──
let b6: any;
{
  const w = await world("b4");
  const end = addDays(TODAY, 5);
  const { s, m } = await member(w.branch.id, { end });
  await insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: 6, fee: 1250, sort_order: 6 }).catch(() => null);
  const r = await call("renew_membership", { membershipId: m.id, monthsPaid: 1, paymentMode: "cash", category: "temporary", hoursPerDay: 6, expectedTotal: 1250 }, w.tS);
  const renewed = (await where("memberships", "renewed_from_membership_id", m.id))[0];
  check(r.status === 200 && renewed?.start_date === addDays(end, 1) && Number(renewed.hours_per_day) === 6 && renewed.category === "temporary", "B4: an early renewal on a ₹1,250 plan starts the day after the old end date, on the same plan", { r: r.status, renewed: renewed && { start: renewed.start_date, end } });
  b6 = { w, s, m, renewed };
}

// ── B5: renewal on hold / with dues / after an early renewal → each refused ──
{
  const w = await world("b5");
  const hold = await member(w.branch.id, { is_paused: true });
  const dues = await member(w.branch.id, { fee_due: 300 });
  const base = { monthsPaid: 1, paymentMode: "cash", category: "temporary", hoursPerDay: 6 };
  const r1 = await call("renew_membership", { ...base, membershipId: hold.m.id }, w.tS);
  const r2 = await call("renew_membership", { ...base, membershipId: dues.m.id }, w.tS);
  const r3 = await call("renew_membership", { ...base, membershipId: b6.renewed.id }, b6.w.tS);
  check(/on hold/.test(r1.error) && /₹300 pending/.test(r2.error) && /already renewed early/.test(r3.error), "B5: on hold, unpaid dues and an already-early-renewed plan are each refused with their message", [r1.error, r2.error, r3.error]);
}

// ── B6: cancelling an early renewal restores the old plan and refunds the renewal in full ──
{
  const { w, s, m, renewed } = b6;
  const r = await call("cancel_early_renewal", { membershipId: renewed.id, reason: "student changed plans" }, w.tO);
  const old = await get("memberships", m.id);
  const payouts = await where("payouts", "student_id", s.id);
  check(r.status === 200 && old.is_active === true && payouts.some((p: any) => p.payout_type === "membership_refund" && Number(p.amount) === 1250), "B6: the previous membership is active again and ₹1,250 is refunded as a membership_refund payout", { r: r.status, payouts });
}

// ── B7: a Food Pass never ends negative; the shortfall is collected at checkout ──
{
  const w = await world("b7");
  const { s, m } = await member(w.branch.id);
  await insert("food_passes", { student_id: s.id, branch_id: w.branch.id, balance: 50 });
  const item = await insert("food_items", { branch_id: w.branch.id, name: "Thali", price: 80, is_active: true });
  const desk = await insert("desks", { branch_id: w.branch.id, label: "B7", status: "occupied", sort_order: 0 });
  const bk = await insert("bookings", { student_id: s.id, branch_id: w.branch.id, desk_id: desk.id, membership_id: m.id, booking_type: "temporary", status: "active", start_time: new Date(Date.now() - 2 * 3600e3).toISOString(), end_time: new Date(Date.now() + 4 * 3600e3).toISOString(), hours: 6, scheduled_hours: 6, amount: 0 });
  const bill = await call("create_food_bill", { branchId: w.branch.id, studentId: s.id, bookingId: bk.id, items: [{ foodItemId: item.id, quantity: 1 }], paymentMode: "cash" }, w.tS);
  const passMid = (await where("food_passes", "student_id", s.id))[0];
  const ask = await call("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, w.tS);
  const out = await call("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0, foodPassPaymentMode: "cash" }, w.tS);
  const passEnd = (await where("food_passes", "student_id", s.id))[0];
  const food = (await txOf(s.id)).filter((t: any) => /food/.test(t.category));
  check(bill.status === 200 && Number(passMid.balance) === 50 && ask.needsFoodPassCollection === true && ask.shortfall === 30, "B7: an ₹80 order on a ₹50 pass leaves the pass at ₹50 and checkout asks for the ₹30 shortfall", { bill: bill.status, mid: passMid.balance, ask });
  check(out.status === 200 && Number(passEnd.balance) === 0 && food.reduce((x: number, t: any) => x + Number(t.amount), 0) >= 30, "B7: after collecting, the pass ends at ₹0 (never negative) and the shortfall is recorded", { out: out.status, end: passEnd.balance, food });
}

// ── B8: a split payment that doesn't add up is refused ──
{
  const w = await world("b8");
  const { s, m } = await member(w.branch.id, { fee_due: 500, total_paid: 750 });
  const r = await call("record_payment", { membershipId: m.id, amount: 500, paymentMode: "split", cashAmount: 200, upiAmount: 200 }, w.tS);
  check(r.status === 400 && r.error === "Cash + UPI amounts must add up to the total" && (await txOf(s.id)).length === 0 && Number((await get("memberships", m.id)).fee_due) === 500, "B8: ₹200 cash + ₹200 UPI for ₹500 is refused and nothing is written", r);
}

// ── B9: quitting 25 days after expiry with the last visit on day 7 → 7 days of overstay ──
{
  const w = await world("b9");
  const end = addDays(TODAY, -25);
  const { s, m } = await member(w.branch.id, { end });
  await insert("bookings", { student_id: s.id, branch_id: w.branch.id, membership_id: m.id, booking_type: "temporary", status: "completed", start_time: `${addDays(end, 7)}T10:00:00+05:30`, end_time: `${addDays(end, 7)}T14:00:00+05:30`, hours: 4, amount: 0 });
  const sum = await call("get_membership_closure_summary", { membershipId: m.id }, w.tO);
  check(sum.status === 200 && Number(sum.overstayDays) === 7, "B9: overstay counts to the last visit (7 days), not the 25 days since expiry", sum);
}

// ── B10: deleting a 3-month ₹3,375 plan after 30 days refunds ₹2,250 ──
{
  const w = await world("b10");
  const start = addDays(TODAY, -30);
  // Same shape as A14: 1 Sep → 30 Nov (start + 90), checked on 1 Oct (start + 30).
  const { m } = await member(w.branch.id, { start, end: addDays(start, 90), months: 3, total_paid: 3375, plan_amount: 3375, plan_days: 90, discount: 10 });
  const sum = await call("get_membership_delete_summary", { membershipId: m.id }, w.tO);
  check(sum.status === 200 && Number(sum.proratedRefund) === 2250, "B10: 60 of 90 days unused at ₹37.50 a day → ₹2,250 refund", sum);
}

done();
