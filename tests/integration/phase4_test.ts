// Phase 4 (and the Phase 3 review fixes) against a REAL Postgres + PostgREST: the queries an
// in-memory fake can't prove — relation hints (bookings!booking_id, desks!desk_id inside an embed),
// the anomaly_flags conflict target, uuid[]/text[] columns and their CHECKs, the supplier draft's
// partial unique index, .or() on a read, inventory_logs' widened CHECK — plus self check-in,
// self checkout with food as dues, the 23:30 close and the food queue end to end.
// deno-lint-ignore-file no-explicit-any
import { addDays, call, check, db, done, get, insert, IST_TODAY, phone, where, world } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { integrityFindings } from "../../supabase/functions/api/domains/system.ts";
import { CONSENT_VERSION } from "../../supabase/functions/_shared/checkin.ts";

const TODAY = IST_TODAY();
Deno.env.delete("AI_API_KEY");
const setting = async (key: string, value: string) => { const { error } = await db.from("app_settings").upsert({ key, value }, { onConflict: "key" }); if (error) throw new Error(error.message); };
for (const k of ["pssai_portal", "pssai_self_checkin", "pssai_session_watch", "pssai_seat_matching", "pssai_live_seats", "pssai_food_orders", "pssai_food_stock", "pssai_tickets", "pssai_photo_tasks", "pssai_hour_release", "pssai_overbooking"]) await setting(k, "on");
const sys = async (name: string) => await (await runAction(REGISTRY.get(name)!, { db: db as any, req: new Request("http://x"), action: name, actor: { type: "system", id: null } }, {})).json();
const HALL = { lat: 11.0168, lng: 76.9558 };
const near = { latitude: HALL.lat + 0.0002, longitude: HALL.lng, accuracy: 20 };

const w = await world("p4");
const f1 = await insert("desks", { branch_id: w.branch.id, label: "P4-F1", status: "free", seat_type: "floating", sort_order: 1 });
const f2 = await insert("desks", { branch_id: w.branch.id, label: "P4-F2", status: "free", seat_type: "floating", sort_order: 2 });
const cabin = await insert("desks", { branch_id: w.branch.id, label: "P4-C1", status: "reserved", seat_type: "fixed", sort_order: 3 });
const temp = await insert("students", { name: "Self Checker", phone: phone(), branch_id: w.branch.id, status: "active", course: "TNPSC Group 4" });
await insert("memberships", { student_id: temp.id, branch_id: w.branch.id, category: "temporary", seat_type: "floating", hours_per_day: 12, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25), due_date: addDays(TODAY, 26), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true });
const perm = await insert("students", { name: "Cabin Holder", phone: phone(), branch_id: w.branch.id, status: "active" });
await db.from("desks").update({ assigned_student_id: perm.id }).eq("id", cabin.id);
const permMem = await insert("memberships", { student_id: perm.id, branch_id: w.branch.id, category: "permanent", seat_type: "fixed", hours_per_day: 12, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25), due_date: addDays(TODAY, 26), months_paid: 1, monthly_fee: 2100, total_paid: 2100, fee_due: 0, is_active: true, desk_id: cabin.id, cabin_no: "P4-C1" });
const tokenOf = async (s: any) => {
  const code = await call("create_portal_setup_code", { studentId: s.id }, w.tS);
  return (await call("me_set_pin", { phone: s.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
};
const tT = await tokenOf(temp), tC = await tokenOf(perm);

// ── 1. Poster settings, consent, location and seat matching on Postgres ──
let posterKey = "";
{
  const loc = await call("set_branch_location", { branchId: w.branch.id, latitude: HALL.lat, longitude: HALL.lng }, w.tO);
  const rot = await call("rotate_checkin_key", { branchId: w.branch.id }, w.tO);
  posterKey = new URL(rot.posterUrl).searchParams.get("k")!;
  const { error: badLoc } = await db.from("branches").update({ latitude: 95 }).eq("id", w.branch.id);
  check(loc.status === 200 && rot.status === 200 && posterKey.length >= 20 && !!badLoc, "P4-1: the owner saves the location (the CHECK refuses an impossible one) and gets a poster key", { loc: loc.status, badLoc: badLoc?.message });
  await db.from("desks").update({ tags: ["window"] }).eq("id", f2.id);
  const prefs = await call("me_set_seat_prefs", { deskIds: [f2.id], tags: ["window"] }, tT);
  const stored = (await where("seat_preferences", "student_id", temp.id))[0];
  const { error: tooMany } = await db.from("seat_preferences").update({ desk_ids: [f1.id, f2.id, cabin.id, temp.id] }).eq("student_id", temp.id);
  check(prefs.status === 200 && stored?.desk_ids?.[0] === f2.id && stored.tags[0] === "window" && !!tooMany, "P4-1: seat preferences are stored in uuid[]/text[] columns; the CHECK refuses more than 3 desks", { prefs: prefs.status, stored, tooMany: tooMany?.message });
  const first = await call("me_check_in", { branchId: w.branch.id, key: posterKey, ...near }, tT);
  const inn = await call("me_check_in", { branchId: w.branch.id, key: posterKey, ...near, consent: CONSENT_VERSION }, tT);
  const recs = await where("checkin_records", "student_id", temp.id);
  const bk = inn.bookingId ? await get("bookings", inn.bookingId) : null;
  check(first.status === 400 && inn.status === 200 && inn.deskLabel === "P4-F2" && bk?.actor_type === "student" && bk.desk_id === f2.id && (await get("desks", f2.id)).status === "occupied",
    "P4-1: after the consent, the student is checked in as themselves at their favourite free desk", { first: first.error, inn });
  check(recs.some((r: any) => r.result === "ok" && r.booking_id === inn.bookingId && r.distance_m > 10 && r.distance_m < 40) && (await where("checkin_consents", "student_id", temp.id)).length === 1, "P4-1: the record holds the distance only; the consent row is stored once", recs.map((r: any) => [r.result, r.distance_m]));
  const live = await call("me_live_seats", {}, tT);
  const mine = live.branches?.find((b: any) => b.id === w.branch.id);
  check(live.status === 200 && mine?.total === 2 && mine.inUse === 1 && mine.free === 1, "P4-1: live seats read open sessions with desks!desk_id(seat_type)", mine);
}

// ── 2. Self checkout: overtime by the clock, food as dues (C14) ──
{
  const bkId = (await db.from("bookings").select("id").eq("student_id", temp.id).eq("status", "active").single()).data!.id;
  await db.from("bookings").update({ start_time: new Date(Date.now() - 6 * 3600e3).toISOString(), end_time: new Date(Date.now() - 2 * 3600e3).toISOString() }).eq("id", bkId);
  await insert("food_passes", { student_id: temp.id, branch_id: w.branch.id, balance: 20 });
  const bill = await insert("food_bills", { branch_id: w.branch.id, student_id: temp.id, booking_id: bkId, subtotal: 50, total: 50, paid: false, payment_mode: null });
  const atDesk = await call("checkout_booking", { bookingId: bkId, overtimeMinutes: 0, foodAsDues: true }, w.tS);
  const out = await call("me_check_out", {}, tT);
  const ot = (await where("overtime_sessions", "booking_id", bkId))[0];
  const pass = (await where("food_passes", "student_id", temp.id))[0];
  check(atDesk.needsFoodPassCollection && out.status === 200 && [120, 121].includes(out.overtimeMinutes) && out.foodDue === 30 && ot?.billed_at === null && Number(ot.billed_amount) === 20 && (await get("food_bills", bill.id)).paid === false && Number(pass.balance) === 20 && (await get("desks", f2.id)).status === "free",
    "P4-2: staff still must collect the shortfall; self checkout logs 120 min (₹20, Pay Later), leaves ₹30 food as dues and frees the desk", { atDesk, out, ot });
}

// ── 3. The 23:30 close and checkout-correction flags (anomaly_flags conflict target, events reads) ──
{
  const s = await insert("students", { name: "Forgot Out", phone: phone(), branch_id: w.branch.id, status: "active" });
  const end = new Date(Date.now() - 3 * 3600e3).toISOString();
  const forgot = await insert("bookings", { student_id: s.id, branch_id: w.branch.id, desk_id: f1.id, booking_type: "walkin", start_time: new Date(Date.now() - 6 * 3600e3).toISOString(), end_time: end, hours: 3, scheduled_hours: 3, amount: 35, payment_mode: "cash", status: "active" });
  await db.from("desks").update({ status: "occupied", current_booking_id: forgot.id }).eq("id", f1.id);
  const moved = await insert("bookings", { student_id: perm.id, branch_id: w.branch.id, desk_id: cabin.id, booking_type: "permanent", start_time: new Date(Date.now() - 5 * 3600e3).toISOString(), end_time: new Date(Date.now() - 3600e3).toISOString(), hours: 4, amount: 0, status: "active" });
  await call("checkout_booking", { bookingId: moved.id, overtimeMinutes: 0, actualEndTime: new Date(Date.now() - 45 * 60e3).toISOString() }, w.tS);
  const r1 = await sys("cron_close_forgotten_sessions");
  const r2 = await sys("cron_close_forgotten_sessions");
  const b = await get("bookings", forgot.id);
  const flags = await where("anomaly_flags", "ref_id", forgot.id);
  const corr = (await where("anomaly_flags", "ref_id", moved.id)).filter((f: any) => f.kind === "checkout_corrected");
  check(r1.ok && b.status === "completed" && Date.parse(b.end_time) === Date.parse(end) && flags.length === 1 && (await get("desks", f1.id)).status === "free", "P4-3: a forgotten session closes at its booked end; one flag, also after a second run (onConflict kind,ref_table,ref_id)", { r1, r2, flags: flags.length });
  check(corr.length === 1 && corr[0].branch_id === w.branch.id && r2.corrected === 0, "P4-3: a staff checkout moved back 45 minutes is flagged once, with its branch", corr.map((f: any) => f.explanation));
}

// ── 4. The food queue end to end; stock; the supplier draft's partial unique index ──
{
  const inv = await insert("inventory_items", { branch_id: w.branch.id, name: `Tea packets ${Date.now()}`, quantity: 10 });
  const tea = await insert("food_items", { branch_id: w.branch.id, name: "P4 Tea", price: 10, quantity: null, is_active: true });
  const link = await call("set_food_item_stock_link", { itemId: tea.id, inventoryItemId: inv.id, perUnit: 2, supplierPhone: "9876543210" }, w.tO);
  await call("check_in_member", { branchId: w.branch.id, studentId: temp.id }, w.tS);
  const o = await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 2 }], note: "hot" }, tT);
  const q = await call("list_food_orders", { branchId: w.branch.id }, w.tS);
  check(link.status === 200 && o.status === 200 && o.order.total === 20 && q.orders?.[0]?.student === "Self Checker" && q.orders[0].stillCheckedIn === true && q.orders[0].foodPassBalance === 20,
    "P4-4: an order is queued (jsonb items) and the queue reads the student, the session and the pass through embeds", { o, q: q.orders?.[0] ?? q.error });
  const both = await Promise.all([call("deliver_food_order", { orderId: o.order.id }, w.tS), call("deliver_food_order", { orderId: o.order.id }, w.tS)]);
  const bills = (await where("food_bills", "student_id", temp.id)).filter((x: any) => Number(x.total) === 20);
  const invNow = await get("inventory_items", inv.id);
  const sold = (await where("inventory_logs", "inventory_item_id", inv.id)).filter((l: any) => l.action === "sold");
  check(both.filter((r) => r.status === 200).length === 1 && bills.length === 1 && bills[0].paid === true && invNow.quantity === 6 && sold.length === 1 && sold[0].quantity === 4,
    "P4-4: two deliveries at once bill once; ₹20 from the Food Pass; 2 teas × 2 packets come off stock, logged as 'sold' (the widened CHECK)", { statuses: both.map((r) => r.status), bills: bills.length, qty: invNow.quantity });
  const fc = await call("get_food_forecast", { branchId: w.branch.id }, w.tO);
  const d1 = await sys("cron_supplier_drafts");
  const d2 = await sys("cron_supplier_drafts");
  const drafts = (await where("supplier_orders", "branch_id", w.branch.id)).filter((x: any) => x.status === "draft");
  const { error: second } = await db.from("supplier_orders").insert({ branch_id: w.branch.id, items: [] });
  check(fc.status === 200 && d1.ok && d2.ok && drafts.length <= 1 && !!second === (drafts.length === 1), "P4-4: the forecast reads food_bill_items; the nightly draft never makes two open drafts for a branch (partial unique index)", { fc: fc.status, drafts: drafts.length, second: second?.message });
}

// ── 5. Tickets and photo tasks ──
{
  const t = await call("me_report_problem", { category: "wifi", details: "Wi-Fi drops every hour" }, tT);
  const list = await call("list_tickets", { branchId: w.branch.id }, w.tS);
  const up = await call("update_ticket", { ticketId: t.ticket?.id, status: "resolved", resolution: "Router replaced" }, w.tS);
  const n = (await where("portal_notifications", "student_id", temp.id)).filter((x: any) => x.kind === "ticket");
  check(t.status === 200 && t.ticket.priority === "high" && list.tickets?.[0]?.student === "Self Checker" && up.status === 200 && n.length === 1, "P4-5: a reported problem becomes a high-priority ticket; resolving it tells the student", { t: t.ticket, list: list.tickets?.length });
  const task = await call("create_task", { branchId: w.branch.id, assignedToStaffId: w.staff.id, title: "Clean the washrooms", repeatInterval: "daily" }, w.tO);
  const tick = await call("update_task_status", { taskId: task.tasks?.[0]?.id, done: true }, w.tS);
  check(task.tasks?.[0]?.needs_photo === true && tick.status === 400 && /photo/.test(tick.error), "P4-5: a daily cleaning task needs a photo before it can be ticked (C17)", { task: task.tasks?.[0]?.needs_photo, tick: tick.error });
}

// ── 6. Phase 3 review fixes on Postgres: resale embeds, the holds .or(), the exam filter ──
{
  const rel = await insert("seat_releases", { membership_id: permMem.id, student_id: perm.id, branch_id: w.branch.id, desk_id: cabin.id, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 4 * 3600e3).toISOString(), source: "member" });
  const sold = await call("create_walkin", { branchId: w.branch.id, name: "Walk In", phone: phone(), hours: 2, paymentMode: "cash", releaseId: rel.id }, w.tS);
  const a1 = await call("check_in_member", { branchId: w.branch.id, studentId: perm.id }, w.tS);
  const firstBk = (await db.from("bookings").select("id").eq("student_id", perm.id).eq("status", "active").single()).data!;
  await call("checkout_booking", { bookingId: firstBk.id, overtimeMinutes: 0 }, w.tS);
  const a2 = await call("check_in_member", { branchId: w.branch.id, studentId: perm.id }, w.tS);
  check(sold.status === 200 && a1.collision?.kind === "fallback_desk" && a2.collision?.kind === "fallback_desk" && (await get("desks", cabin.id)).current_booking_id === sold.booking.id,
    "P4-6: a second arrival during a sale is seated elsewhere again (seat_resales → bookings!booking_id); the walk-in keeps the cabin", { a1: a1.collision, a2: a2.collision });
  const job = await sys("cron_predict_releases");
  const prices = await sys("cron_yield_prices");
  check(job.ok !== false && !job.error && prices.ok, "P4-6: the hourly prediction (holds read with .or()) and the nightly prices (exam family filter) run on Postgres", { job, prices });
  const f = await integrityFindings(db as any);
  check(typeof f.counts.selfcheckins_without_session === "number" && typeof f.counts.staff_checkins_at_poster_branches === "number" && typeof f.counts.walkins_without_payment === "number", "P4-6: the nightly check's Phase 4 findings read on Postgres", f.counts);
}

done();
