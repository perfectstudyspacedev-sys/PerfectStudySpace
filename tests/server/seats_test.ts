// PSS-AI Phase 3 against the REAL api function: O1/SP10 seat hours (a member releases hours; the
// walk-in desk sells them through create_walkin; one sale per hour; the member's 50% credit
// reaches renewal as a pending cashback; a member who arrives anyway gets another desk or a free
// day), the hourly prediction job, I3 walk-in prices, and SP9 waitlist joins from the portal.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
import { istHour, istParts } from "../../supabase/functions/_shared/seats.ts";
let TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();

let b1: any, owner: any, priya: any, cabin: any, spare: any, member: any, mem: any, tO: string, tP: string, tM: string;
async function setup() {
  reset();
  TODAY = IST_TODAY();
  b1 = insert("branches", { name: "Hopes", is_active: true, desk_count: 3 });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  for (const [max, fee] of [[3, 35], [6, 60], [8, 80], [24, 100]]) insert("fee_config", { config_type: "walkin", max_hours: max, fee });
  insert("fee_config", { config_type: "membership", cabin_type: "permanent", hours_per_day: 12, fee: 2100, sort_order: 12 });
  cabin = insert("desks", { branch_id: b1.id, label: "P1", status: "reserved", seat_type: "fixed", sort_order: 1, current_booking_id: null });
  spare = insert("desks", { branch_id: b1.id, label: "F1", status: "occupied", seat_type: "floating", sort_order: 2, current_booking_id: null });
  member = insert("students", { name: "Meena Raj", phone: "9100000001", branch_id: b1.id, status: "active", course: "TNPSC Group 4" });
  cabin.assigned_student_id = member.id;
  mem = insert("memberships", { student_id: member.id, branch_id: b1.id, category: "permanent", seat_type: "fixed", hours_per_day: 12, start_date: addDays(TODAY, -40), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 21), months_paid: 1, monthly_fee: 2100, total_paid: 2100, fee_due: 0, is_active: true, is_paused: false, desk_id: cabin.id, plan_amount: 2100, plan_days: 30 });
  setSetting("pssai_portal", "on");
  const code = await call("create_portal_setup_code", { studentId: member.id }, tP);
  tM = (await call("me_set_pin", { phone: member.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
}
const tomorrow = () => addDays(TODAY, 1);
const walkin = (extra: any) => call("create_walkin", { branchId: b1.id, name: "Walk In", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, hours: 3, paymentMode: "cash", ...extra }, tP);

// ── SP10: a member releases hours; the desk sells them; the credit reaches renewal ──
await setup();
{
  check((await call("me_release_hours", { date: tomorrow(), fromHour: 9, toHour: 17 }, tM)).status === 403, "S1: with pssai_hour_release off the portal can't release hours");
  setSetting("pssai_hour_release", "on");
  const bad = await Promise.all([
    call("me_release_hours", { date: tomorrow(), fromHour: 9, toHour: 10 }, tM),
    call("me_release_hours", { date: addDays(TODAY, 9), fromHour: 9, toHour: 17 }, tM),
    call("me_release_hours", { date: tomorrow(), fromHour: 4, toHour: 9 }, tM),
  ]);
  check(bad.every((r) => r.status === 400), "S1: under 2 hours, more than 7 days ahead and before 06:00 are refused", bad.map((r) => r.error));
  const rel = await call("me_release_hours", { date: tomorrow(), fromHour: 9, toHour: 17 }, tM);
  const overlap = await call("me_release_hours", { date: tomorrow(), fromHour: 12, toHour: 14 }, tM);
  check(rel.status === 200 && rel.release.starts_at === istHour(tomorrow(), 9) && overlap.status === 400, "S1: 09:00–17:00 tomorrow is released; overlapping hours are refused", { rel, overlap: overlap.error });

  const startTime = istHour(tomorrow(), 10);
  const list = await call("list_resellable_desks", { branchId: b1.id, startTime, hours: 3 }, tP);
  check(list.desks.length === 1 && list.desks[0].deskLabel === "P1" && list.desks[0].source === "member", "S2: the walk-in desk sees cabin P1 free 09:00–17:00 for a 3-hour walk-in at 10:00", list);
  check((await call("list_resellable_desks", { branchId: b1.id, startTime: istHour(tomorrow(), 15), hours: 3 }, tP)).desks.length === 0, "S2: a walk-in running past 17:00 is not offered it");

  // Two desks sell the same hours at once: one wins.
  const [x, y] = await Promise.all([walkin({ startTime, releaseId: list.desks[0].releaseId }), walkin({ startTime, releaseId: list.desks[0].releaseId })]);
  const ok = [x, y].find((r) => r.status === 200)!;
  check([x, y].filter((r) => r.status === 200).length === 1 && rows("seat_resales").length === 1 && rows("bookings").length === 1, "S3: two desks selling the same hours at once — exactly one sale", [x.status, y.status]);
  const sale = rows("seat_resales")[0];
  const cb = rows("cashbacks").find((c) => c.student_id === member.id);
  check(ok.booking.deskLabel === "P1" && Number(sale.amount) === 35 && Number(sale.credit_amount) === 18 && cb?.cashback_type === "fixed" && Number(cb.cashback_value) === 18 && cb.status === "pending",
    "S3: the ₹35 walk-in on P1 earns the member ₹18 (D7: 50%) as a pending cashback", { sale, cb });
  check(cabin.status === "reserved" && cabin.current_booking_id === ok.booking.id && cabin.assigned_student_id === member.id, "S3: the cabin stays the member's (still reserved); only the booking is linked");
  const open = rows("seat_releases").filter((r) => r.status === "open").map((r) => [istParts(r.starts_at).hour, istParts(r.ends_at).hour]);
  check(JSON.stringify(open.sort((a, b) => a[0] - b[0])) === JSON.stringify([[9, 10], [13, 17]]), "S3: 09:00–10:00 and 13:00–17:00 go back on sale", open);
  const mine = await call("me_releases", {}, tM);
  check(mine.creditTotal === 18 && rows("portal_notifications").some((n) => n.kind === "release_credit"), "S3: the member sees the credit in the portal", mine.creditTotal);
  check((await call("me_cancel_release", { releaseId: rel.release.id }, tM)).status === 409, "S3: sold hours can't be cancelled");

  // The checkout of the walk-in leaves the cabin reserved.
  const out = await call("checkout_booking", { bookingId: ok.booking.id, overtimeMinutes: 0 }, tP);
  check(out.status === 200 && cabin.status === "reserved" && cabin.current_booking_id === null, "S4: checking out the walk-in leaves the cabin reserved for the member", out.status);
}

// ── Collisions: the member comes in during a resale ──
await setup();
{
  setSetting("pssai_hour_release", "on");
  const rel = await call("me_release_hours", { date: TODAY, fromHour: Math.min(21, istParts(Date.now()).hour + 1), toHour: 23 }, tM);
  // Sell it "now" (the release is set to start now for the test).
  const r = rows("seat_releases")[0];
  r.starts_at = new Date(Date.now() - 600e3).toISOString();
  const sold = await walkin({ releaseId: r.id, hours: 1 });
  spare.status = "free";
  const inNow = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  const booking = rows("bookings").find((b) => b.student_id === member.id);
  check(rel.status === 200 && sold.status === 200 && inNow.status === 200 && inNow.collision?.kind === "fallback_desk" && booking.desk_id === spare.id && spare.status === "occupied" && cabin.current_booking_id === sold.booking.id,
    "S5: a member arriving during a resale is seated at the first free desk; the walk-in keeps the cabin", inNow.collision);
}
await setup();
{
  setSetting("pssai_overbooking", "on");
  const r = insert("seat_releases", { membership_id: mem.id, student_id: member.id, branch_id: b1.id, desk_id: cabin.id, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(), source: "predicted", probability: 0.9, status: "open" });
  const sold = await walkin({ releaseId: r.id, hours: 2 });
  const inNow = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  const cb = rows("cashbacks").find((c) => c.student_id === member.id);
  check(sold.status === 200 && Number(rows("seat_resales")[0].credit_amount) === 0 && inNow.status === 200 && inNow.collision?.kind === "free_day" && Number(cb?.cashback_value) === 70 && rows("seat_resales")[0].collision === "free_day",
    "S6: a predicted release that collides with no free desk gives one free day (₹2,100 ÷ 30 = ₹70) as a credit (C7); predicted sales earn no 50% credit", { collision: inNow.collision, cb });
}
await setup();
{
  setSetting("pssai_hour_release", "on");
  await call("me_release_hours", { date: TODAY, fromHour: Math.min(21, istParts(Date.now()).hour + 1), toHour: 23 }, tM);
  rows("seat_releases")[0].starts_at = new Date(Date.now() - 600e3).toISOString();
  const inNow = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  check(inNow.status === 200 && !inNow.collision && rows("seat_releases")[0].status === "cancelled" && rows("bookings")[0].desk_id === cabin.id, "S7: a member who comes in while their unsold release covers now gets their cabin; the release is cancelled", rows("seat_releases")[0].status);
}

// ── O1: the hourly prediction job ──
await setup();
{
  const job0 = await run("cron_predict_releases");
  check(job0.skipped, "S8: with pssai_overbooking off nothing is predicted");
  setSetting("pssai_overbooking", "on");
  // 28 days of history: always 06:00–13:00, never after.
  for (let d = 1; d <= 28; d++) {
    const day = addDays(TODAY, -d);
    insert("bookings", { student_id: member.id, branch_id: b1.id, desk_id: cabin.id, membership_id: mem.id, booking_type: "permanent", status: "completed", start_time: istHour(day, 6), end_time: istHour(day, 13), hours: 7, amount: 0 });
  }
  const job = await run("cron_predict_releases");
  const pred = rows("seat_releases").filter((r) => r.source === "predicted");
  const hourNow = istParts(Date.now()).hour;
  const expectAny = 23 - Math.max(13, hourNow + 1) >= 3;   // floor(free × 0.8) ≥ 2 needs ≥ 3 free hours
  check(expectAny ? (job.offered === 1 && pred.length === 1 && istParts(pred[0].starts_at).hour >= 13 && Number(pred[0].probability) === 1) : job.offered === 0,
    "S8: a member who never comes after 13:00 has their afternoon offered (only hours they never use)", { job, pred: pred.map((p) => [p.starts_at, p.ends_at]) });
  const again = await run("cron_predict_releases");
  check(again.offered === 0, "S8: the next hourly run doesn't offer them twice", again);
  advanceClock(30 * 3600e3);
  const later = await run("cron_predict_releases");
  check(later.expired >= (expectAny ? 1 : 0), "S8: unsold releases close when their time has passed", later);
}

// ── I3: walk-in prices ──
await setup();
{
  const q0 = await call("quote_walkin", { branchId: b1.id, hours: 4 }, tP);
  check(q0.amount === 60 && q0.pct === 0, "Y1: with pssai_yield_pricing off the walk-in price is fee_config's", q0);
  setSetting("pssai_yield_pricing", "on");
  const skip = await call("set_walkin_price_day", { branchId: b1.id, date: TODAY, changePct: 30 }, tO);
  const staffTry = await call("set_walkin_price_day", { branchId: b1.id, date: TODAY, changePct: 10 }, tP);
  check(skip.status === 400 && staffTry.status === 403, "Y1: the owner can't go past ±20% (C8); staff can't set prices", [skip.error, staffTry.status]);
  await call("set_walkin_price_day", { branchId: b1.id, date: TODAY, changePct: 15 }, tO);
  const q = await call("quote_walkin", { branchId: b1.id, hours: 4 }, tP);
  const stale = await walkin({ hours: 4, expectedAmount: 60 });
  const ok = await walkin({ hours: 4, expectedAmount: q.amount });
  const tx = rows("transactions").filter((t) => t.booking_id === ok.booking?.id);
  check(q.amount === 70 && stale.status === 409 && /now ₹70/.test(stale.error) && ok.status === 200 && ok.booking.amount === 70 && Number(tx[0]?.amount) === 70,
    "Y2: +15% today makes a 4-hour walk-in ₹70; a modal still showing ₹60 is refused, not charged", { q, stale: stale.error, tx: tx.map((t) => t.amount) });
  const split = await walkin({ hours: 4, paymentMode: "split", cashAmount: 30, upiAmount: 30, expectedAmount: q.amount });
  check(split.status === 400, "Y2: a split must add up to the new price", split.error);
  const noPrice = await walkin({ hours: 4 });
  check(noPrice.status === 409 && /₹70/.test(noPrice.error) && !rows("bookings").some((b) => b.id === noPrice.booking?.id), "Y2 (review 4): with a price change today a form that sent no price is refused, never charged the new price silently", noPrice.error);

  // The nightly job: busy weekdays go up; the owner's day is left alone.
  const b2 = insert("branches", { name: "Ram Nagar", is_active: true });
  insert("desks", { branch_id: b2.id, label: "R1", status: "free" }); insert("desks", { branch_id: b2.id, label: "R2", status: "free" });
  for (let w = 1; w <= 4; w++) for (let k = 0; k < 2; k++) {
    const day = addDays(TODAY, -7 * w);
    insert("bookings", { student_id: member.id, branch_id: b2.id, booking_type: "walkin", status: "completed", start_time: istHour(day, 9), end_time: istHour(day, 15), hours: 6, amount: 60 });
  }
  const job = await run("cron_yield_prices");
  const d2 = rows("walkin_price_days").find((d) => d.branch_id === b2.id);
  const d1 = rows("walkin_price_days").find((d) => d.branch_id === b1.id);
  check(job.written === 1 && job.keptOwnerPrices === 1 && Number(d2.change_pct) === 15 && /100% expected full/.test(d2.reason) && d1.source === "owner", "Y3: a branch full on this weekday for 4 weeks gets +15%; the owner's own price for the other branch stays", { job, d2 });
  insert("exam_notices", { source: "tnpsc", exam_name: "TNPSC Group 4", exam_family: "tnpsc-group-4", exam_date: addDays(TODAY, 10), status: "confirmed" });
  // Review 16: the exam counts only where enough of the branch's members prepare for it.
  const g4 = insert("students", { name: "Ganesh", phone: "9100000077", branch_id: b2.id, status: "active", course: "TNPSC Group 4" });
  insert("memberships", { student_id: g4.id, branch_id: b2.id, category: "temporary", hours_per_day: 6, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25), is_active: true, is_paused: false });
  const b3 = insert("branches", { name: "Third", is_active: true });
  const ssc = insert("students", { name: "Sana", phone: "9100000078", branch_id: b3.id, status: "active", course: "SSC CGL" });
  insert("memberships", { student_id: ssc.id, branch_id: b3.id, category: "temporary", hours_per_day: 6, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25), is_active: true, is_paused: false });
  await run("cron_yield_prices");
  check(Number(rows("walkin_price_days").find((d) => d.branch_id === b2.id).change_pct) === 20 && /TNPSC Group 4/.test(rows("walkin_price_days").find((d) => d.branch_id === b2.id).reason), "Y3: a confirmed exam within 30 days adds 5% (capped at +20%)");
  const d3 = rows("walkin_price_days").find((d) => d.branch_id === b3.id);
  check(Number(d3.change_pct) === 0 && !/TNPSC/.test(d3.reason ?? ""), "Y3 (review 16): a branch whose members prepare for other exams gets no exam rise", d3);
  // Review 15: back to automatic for today gives today's automatic price at once.
  const cleared = await call("set_walkin_price_day", { branchId: b1.id, date: TODAY, changePct: null }, tO);
  const d1Now = rows("walkin_price_days").find((d) => d.branch_id === b1.id && d.price_date === TODAY);
  check(cleared.cleared && d1Now?.source === "auto" && /TNPSC Group 4/.test(d1Now.reason), "Y3 (review 15): clearing the owner's price for today works out the automatic one now", d1Now);
  const prices = await call("list_walkin_prices", {}, tO);
  check(prices.on && prices.days.length === 3 && (await call("list_walkin_prices", {}, tP)).status === 403, "Y4: the owner sees each branch's price days; staff can't");
}

// ── SP9: the waitlist from the portal ──
await setup();
{
  const temp = insert("students", { name: "Tara Devi", phone: "9100000005", branch_id: b1.id, status: "active" });
  insert("memberships", { student_id: temp.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25), due_date: addDays(TODAY, 25), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true });
  const code = await call("create_portal_setup_code", { studentId: temp.id }, tP);
  const tT = (await call("me_set_pin", { phone: temp.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
  check((await call("me_join_waitlist", { hoursPerDay: 12 }, tT)).status === 403, "W1: with pssai_portal_r2 off, joining from the portal is closed");
  setSetting("pssai_portal_r2", "on");
  insert("permanent_waitlist", { branch_id: b1.id, name: "Earlier", phone: "9100000009", status: "waiting", created_at: new Date(Date.now() - 86400e3).toISOString() });
  const bad = await call("me_join_waitlist", { hoursPerDay: 9 }, tT);
  const join = await call("me_join_waitlist", { hoursPerDay: 12 }, tT);
  const twice = await call("me_join_waitlist", { hoursPerDay: 12 }, tT);
  const view = await call("me_waitlist", {}, tT);
  check(bad.status === 400 && join.status === 200 && twice.status === 400 && view.waiting.position === 2 && view.plans[0].monthlyFee === 2100, "W1: a temporary member joins the permanent waitlist (second in line); a made-up plan and a second join are refused", { view });
  check((await call("me_join_waitlist", {}, tM)).status === 400, "W1: a member with a cabin can't join");
  const leave = await call("me_leave_waitlist", {}, tT);
  check(leave.status === 200 && rows("permanent_waitlist").find((w) => w.phone === temp.phone).status === "cancelled", "W1: they can leave the waitlist");
}

// ── Phase 3 review: resale fixes ──
// 1 (High): a member who comes back for a second session during a resale is seated elsewhere again,
// and a free day is given once, even with two check-ins at the same moment.
await setup();
{
  setSetting("pssai_hour_release", "on");
  const r = insert("seat_releases", { membership_id: mem.id, student_id: member.id, branch_id: b1.id, desk_id: cabin.id, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 4 * 3600e3).toISOString(), source: "member", status: "open" });
  const sold = await walkin({ releaseId: r.id, hours: 3 });
  spare.status = "free";
  const first = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  const firstBk = rows("bookings").find((b) => b.student_id === member.id && b.status === "active");
  await call("checkout_booking", { bookingId: firstBk.id, overtimeMinutes: 0 }, tP);
  const second = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  const secondBk = rows("bookings").find((b) => b.student_id === member.id && b.status === "active");
  check(sold.status === 200 && first.collision?.kind === "fallback_desk" && second.collision?.kind === "fallback_desk" && secondBk.desk_id === spare.id && cabin.current_booking_id === sold.booking.id,
    "R1: the second arrival during the sale is seated at the free desk again; the walk-in keeps the cabin and its link", { first: first.collision, second: second.collision, desk: secondBk.desk_id });
}
await setup();
{
  setSetting("pssai_overbooking", "on");
  const r = insert("seat_releases", { membership_id: mem.id, student_id: member.id, branch_id: b1.id, desk_id: cabin.id, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(), source: "predicted", probability: 0.9, status: "open" });
  await walkin({ releaseId: r.id, hours: 2 });
  const both = await Promise.all([call("check_in_member", { branchId: b1.id, studentId: member.id }, tP), call("check_in_member", { branchId: b1.id, studentId: member.id }, tP)]);
  const credits = rows("cashbacks").filter((c) => c.student_id === member.id);
  check(credits.length === 1 && Number(credits[0].cashback_value) === 70, "R2: two check-ins at the same moment give one free day, not two", { credits: credits.length, statuses: both.map((b) => b.status) });
  const again = rows("bookings").find((b) => b.student_id === member.id && b.status === "active");
  if (again) await call("checkout_booking", { bookingId: again.id, overtimeMinutes: 0 }, tP);
  const later = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  check(later.collision?.kind === "no_desk" && /free day was already given/.test(later.collision.message) && later.collision.credit === 0 && rows("cashbacks").filter((c) => c.student_id === member.id).length === 1, "R2: coming back later the same day adds no second free day", later.collision);
}
// 2: a release outlives its cabin; a booked cabin can't be sold; overlap across a renewal.
await setup();
{
  setSetting("pssai_hour_release", "on");
  const rel = await call("me_release_hours", { date: addDays(TODAY, 1), fromHour: 9, toHour: 17 }, tM);
  mem.is_active = false;   // closed, moved or downgraded since
  const startTime = istHour(addDays(TODAY, 1), 10);
  const list = await call("list_resellable_desks", { branchId: b1.id, startTime, hours: 3 }, tP);
  const sale = await walkin({ startTime, releaseId: rel.release.id });
  check(list.desks.length === 0 && sale.status === 409 && rows("seat_releases")[0].status === "cancelled" && !rows("seat_resales").length, "R3: when the member no longer holds the cabin its release is neither listed nor sold (and is withdrawn)", sale.error);
}
await setup();
{
  setSetting("pssai_hour_release", "on");
  const rel = await call("me_release_hours", { date: addDays(TODAY, 1), fromHour: 9, toHour: 17 }, tM);
  const startTime = istHour(addDays(TODAY, 1), 10);
  insert("bookings", { student_id: member.id, branch_id: b1.id, desk_id: cabin.id, booking_type: "permanent", start_time: istHour(addDays(TODAY, 1), 9), end_time: istHour(addDays(TODAY, 1), 12), status: "active", is_paused: false });
  const sale = await walkin({ startTime, releaseId: rel.release.id });
  check(sale.status === 409 && /booked in that cabin/.test(sale.error) && rows("seat_releases")[0].status === "open", "R4: a cabin someone is booked into for those hours can't be sold (the release stays on sale)", sale.error);
  // Renewal: the new membership row must not allow releasing the same hours again.
  mem.is_active = false;
  const renewed = insert("memberships", { ...mem, id: crypto.randomUUID(), is_active: true, renewed_from_membership_id: mem.id, start_date: addDays(TODAY, -1), end_date: addDays(TODAY, 29) });
  const dup = await call("me_release_hours", { date: addDays(TODAY, 1), fromHour: 12, toHour: 15 }, tM);
  check(renewed && dup.status === 400 && /already released/.test(dup.error), "R5: after a renewal the same cabin hours can't be released twice", dup.error);
}
// 5: an early renewal still lets the member release days of the plan it continues.
await setup();
{
  setSetting("pssai_hour_release", "on");
  mem.is_active = false;
  mem.end_date = addDays(TODAY, 2);
  insert("memberships", { ...mem, id: crypto.randomUUID(), is_active: true, renewed_from_membership_id: mem.id, start_date: addDays(TODAY, 3), end_date: addDays(TODAY, 33) });
  const ok = await call("me_release_hours", { date: addDays(TODAY, 1), fromHour: 9, toHour: 13 }, tM);
  check(ok.status === 200, "R6: after an early renewal, tomorrow (still in the current paid period) can be released", ok.error);
}
// 3: time-aware collisions — a sale later today doesn't move the member now; an overstaying walk-in does not take the cabin.
await setup();
{
  setSetting("pssai_hour_release", "on");
  const later = insert("seat_releases", { membership_id: mem.id, student_id: member.id, branch_id: b1.id, desk_id: cabin.id, starts_at: new Date(Date.now() + 14 * 3600e3).toISOString(), ends_at: new Date(Date.now() + 18 * 3600e3).toISOString(), source: "member", status: "open" });
  const sold = await walkin({ releaseId: later.id, hours: 2, startTime: new Date(Date.now() + 15 * 3600e3).toISOString() });
  rows("memberships").find((m) => m.id === mem.id).hours_per_day = 2;
  const inNow = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  check(sold.status === 200 && inNow.status === 200 && !inNow.collision && rows("bookings").find((b) => b.student_id === member.id).desk_id === cabin.id, "R7: hours sold for later than the member's session leave the member in their cabin now", inNow.collision);
}
await setup();
{
  setSetting("pssai_hour_release", "on");
  const r = insert("seat_releases", { membership_id: mem.id, student_id: member.id, branch_id: b1.id, desk_id: cabin.id, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 4 * 3600e3).toISOString(), source: "member", status: "open" });
  const sold = await walkin({ releaseId: r.id, hours: 1 });
  const wb = rows("bookings").find((b) => b.id === sold.booking.id);
  wb.end_time = new Date(Date.now() - 5 * 60e3).toISOString();   // their sold hour is over; they are still here
  spare.status = "free";
  const inNow = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  const mb = rows("bookings").find((b) => b.student_id === member.id);
  check(inNow.collision?.kind === "walkin_overstay" && mb.desk_id === cabin.id && spare.status === "free" && cabin.current_booking_id === mb.id, "R8: a walk-in past their sold hours is the one asked to move; the member keeps the cabin", inNow.collision);
  // The walk-in's checkout afterwards must not unlink the member.
  await call("checkout_booking", { bookingId: wb.id, overtimeMinutes: 0 }, tP);
  check(cabin.current_booking_id === mb.id, "R8: checking the walk-in out leaves the member linked to the cabin");
}
// 14: with both switches off a live resale is still handled, and open releases are withdrawn.
await setup();
{
  setSetting("pssai_hour_release", "on");
  const r = insert("seat_releases", { membership_id: mem.id, student_id: member.id, branch_id: b1.id, desk_id: cabin.id, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 4 * 3600e3).toISOString(), source: "member", status: "open" });
  await walkin({ releaseId: r.id, hours: 1 });
  const future = await call("me_release_hours", { date: addDays(TODAY, 2), fromHour: 9, toHour: 12 }, tM);
  setSetting("pssai_hour_release", "off");
  spare.status = "free";
  const inNow = await call("check_in_member", { branchId: b1.id, studentId: member.id }, tP);
  check(inNow.collision?.kind === "fallback_desk", "R9: after the switch goes off, a member arriving during a sale is still seated elsewhere (no double seat)", inNow.collision);
  await run("cron_predict_releases");
  check(rows("seat_releases").find((x) => x.id === future.release.id).status === "cancelled", "R9: the hourly job withdraws releases whose switch is off");
}
// 5: predictions follow renewals (history and eligibility are not reset by a monthly renewal).
await setup();
{
  setSetting("pssai_overbooking", "on");
  const old = rows("memberships").find((m) => m.id === mem.id);
  old.is_active = false; old.start_date = addDays(TODAY, -60); old.end_date = addDays(TODAY, -6);
  insert("memberships", { ...old, id: crypto.randomUUID(), is_active: true, renewed_from_membership_id: old.id, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25) });
  const job = await run("cron_predict_releases");
  check(job.offered === 1 && rows("seat_releases").some((x) => x.source === "predicted" && x.student_id === member.id), "R10: a member who renewed 5 days ago still gets a prediction (history spans the renewal)", job);
}

done();
