// PSS-AI Phase 4 against the REAL api function: SP13 self check-in (poster key, consent, D9 100 m
// location check, check_in_member run as the student), self checkout (overtime from the clock,
// Pay Later; C14 food as dues), A5 session watch (C15 forgotten sessions, corrected checkout
// flags), I4/SP15 seat matching, SP14 live seats, the owner's poster settings and the O2 part 2
// integrity checks.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
import { CONSENT_VERSION } from "../../supabase/functions/_shared/checkin.ts";
import { integrityFindings } from "../../supabase/functions/api/domains/system.ts";

const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();
// Hopes (Coimbatore). 0.0002° of latitude is about 22 m; 0.01° about 1.1 km.
const HALL = { lat: 11.0168, lng: 76.9558 };
const near = { latitude: HALL.lat + 0.0002, longitude: HALL.lng, accuracy: 20 };

let b1: any, b2: any, owner: any, priya: any, ravi: any, tO: string, tP: string, tR: string;
let cabin: any, f1: any, f2: any, f3: any, arun: any, meena: any, memA: any, tA: string, tM: string, key: string;
async function portalToken(student: any) {
  const code = await call("create_portal_setup_code", { studentId: student.id }, tP);
  return (await call("me_set_pin", { phone: student.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
}
async function setup() {
  reset();
  const TODAY = IST_TODAY();
  b1 = insert("branches", { name: "Hopes", is_active: true, desk_count: 4, latitude: null, longitude: null, checkin_key: null });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true, desk_count: 1, latitude: null, longitude: null, checkin_key: null });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: b2.id });
  [tO, tP, tR] = await Promise.all([owner, priya, ravi].map((s) => tokenFor(s)));
  cabin = insert("desks", { branch_id: b1.id, label: "P1", status: "reserved", seat_type: "fixed", sort_order: 1, current_booking_id: null, tags: [] });
  f1 = insert("desks", { branch_id: b1.id, label: "F1", status: "free", seat_type: "floating", sort_order: 2, current_booking_id: null, tags: [] });
  f2 = insert("desks", { branch_id: b1.id, label: "F2", status: "free", seat_type: "floating", sort_order: 3, current_booking_id: null, tags: ["window"] });
  f3 = insert("desks", { branch_id: b1.id, label: "F3", status: "free", seat_type: "floating", sort_order: 4, current_booking_id: null, tags: ["power", "quiet"] });
  insert("desks", { branch_id: b2.id, label: "R1", status: "free", seat_type: "floating", sort_order: 1, current_booking_id: null, tags: [] });
  arun = insert("students", { name: "Arun Kumar", phone: "9100000002", branch_id: b1.id, status: "active", total_visits: 0 });
  meena = insert("students", { name: "Meena Raj", phone: "9100000001", branch_id: b1.id, status: "active", total_visits: 0 });
  memA = insert("memberships", { student_id: arun.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 12, start_date: addDays(TODAY, -10), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 21), monthly_fee: 1200, total_paid: 1200, fee_due: 0, is_active: true, is_paused: false });
  insert("memberships", { student_id: meena.id, branch_id: b1.id, category: "permanent", seat_type: "fixed", hours_per_day: 12, start_date: addDays(TODAY, -10), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 21), monthly_fee: 2100, total_paid: 2100, fee_due: 0, is_active: true, is_paused: false, desk_id: cabin.id });
  cabin.assigned_student_id = meena.id;
  setSetting("pssai_portal", "on");
  [tA, tM] = [await portalToken(arun), await portalToken(meena)];
}
async function setUpPoster() {
  await call("set_branch_location", { branchId: b1.id, latitude: HALL.lat, longitude: HALL.lng }, tO);
  key = new URL((await call("rotate_checkin_key", { branchId: b1.id }, tO)).posterUrl).searchParams.get("k")!;
}

// ── The owner's poster settings ──
await setup();
{
  const staffTries = await Promise.all([
    call("get_checkin_settings", {}, tP), call("set_branch_location", { branchId: b1.id, latitude: 11, longitude: 77 }, tP), call("rotate_checkin_key", { branchId: b1.id }, tP),
  ]);
  check(staffTries.every((r) => r.status === 403), "K1: staff can't read or change the check-in settings", staffTries.map((r) => r.status));
  check((await call("set_branch_location", { branchId: b1.id, latitude: 95, longitude: 77 }, tO)).status === 400, "K1: an impossible latitude is refused");
  await setUpPoster();
  const s = await call("get_checkin_settings", {}, tO);
  const hopes = s.branches.find((b: any) => b.id === b1.id);
  check(hopes.ready && hopes.posterUrl.includes(`/me/checkin?b=${b1.id}&k=`) && b1.latitude === HALL.lat && key.length >= 20, "K2: the owner saves the location and gets a poster link with a random key", hopes);
  check(!s.branches.find((b: any) => b.id === b2.id).ready, "K2: a branch without a poster is not ready (the pilot is Hopes only)");
}

// ── SP13: self check-in ──
{
  check((await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA)).status === 403, "C1: with pssai_self_checkin off the portal can't check in");
  const info0 = await call("me_checkin_info", { branchId: b1.id }, tA);
  check(info0.on === false && info0.consentNeeded && info0.branch?.ready, "C1: the info call says it is off, consent is needed and the branch has a poster", info0);
  setSetting("pssai_self_checkin", "on");
  const noConsent = await call("me_check_in", { branchId: b1.id, key, ...near }, tA);
  check(noConsent.status === 400 && rows("bookings").length === 0, "C2: without the consent tick nothing happens", noConsent.error);
  const badKey = await call("me_check_in", { branchId: b1.id, key: "old-poster-key", ...near, consent: CONSENT_VERSION }, tA);
  check(badKey.status === 403 && rows("checkin_records").some((r) => r.result === "bad_key"), "C2: an old or wrong poster key is refused and recorded", badKey.error);
  const notSetUp = await call("me_check_in", { branchId: b2.id, key, ...near, consent: CONSENT_VERSION }, tA);
  check(notSetUp.status === 403, "C2: a branch without a poster refuses self check-in");
  const far = await call("me_check_in", { branchId: b1.id, key, latitude: HALL.lat + 0.01, longitude: HALL.lng, accuracy: 15, consent: CONSENT_VERSION }, tA);
  const farRec = rows("checkin_records").find((r) => r.result === "too_far");
  check(far.status === 403 && farRec && farRec.distance_m > 1000 && farRec.distance_m < 1200 && farRec.accuracy_m === 15, "C3: 1.1 km away is refused (D9: 100 m); only the distance and accuracy are kept", { error: far.error, farRec });
  const rough = await call("me_check_in", { branchId: b1.id, key, ...near, accuracy: 400, consent: CONSENT_VERSION }, tA);
  const noLoc = await call("me_check_in", { branchId: b1.id, key, latitude: "x", consent: CONSENT_VERSION }, tA);
  check(rough.status === 400 && noLoc.status === 400 && rows("bookings").length === 0, "C3: a ±400 m reading and a missing location are refused", [rough.error, noLoc.error]);

  const ok = await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  const booking = rows("bookings").find((b) => b.student_id === arun.id);
  const rec = rows("checkin_records").find((r) => r.result === "ok");
  check(ok.status === 200 && booking?.status === "active" && booking.booking_type === "temporary" && booking.desk_id === null && booking.created_by_staff_id === null && booking.actor_type === "student",
    "C4: inside the hall the student is checked in by check_in_member, as the student, with no desk while seat matching is off", { ok, booking });
  check(rec?.booking_id === booking?.id && rec.distance_m >= 15 && rec.distance_m <= 30 && rows("checkin_consents").find((c) => c.student_id === arun.id)?.version === CONSENT_VERSION,
    "C4: the record links the session; the consent is stored once", rec);
  const everything = JSON.stringify([rows("events"), rows("checkin_records")]);
  check(!everything.includes(String(HALL.lat + 0.0002)) && !everything.includes(key) && rows("events").some((e) => e.action === "me_check_in" && e.payload.latitude === "[omitted]"),
    "C4: the phone's coordinates and the poster key never reach the event log or the records");
  check(rows("events").some((e) => e.action === "check_in_member" && e.actor_type === "student" && e.ok), "C4: the nested check_in_member has its own event with the student as actor");
  const twice = await call("me_check_in", { branchId: b1.id, key, ...near }, tA);
  check(twice.status === 400 && /already checked in/.test(twice.error) && rows("checkin_records").some((r) => r.result === "refused"), "C5: a second check-in is refused by the same rule as at the desk (consent is not asked again)", twice.error);

  const perm = await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tM);
  const mb = rows("bookings").find((b) => b.student_id === meena.id);
  check(perm.status === 200 && perm.deskLabel === "P1" && mb.desk_id === cabin.id && cabin.status === "reserved" && cabin.current_booking_id === mb.id, "C6: a permanent member gets their own cabin, which stays reserved", perm);

  const info = await call("me_checkin_info", { branchId: b1.id }, tA);
  check(info.on && !info.consentNeeded && info.session?.bookingId === booking.id, "C7: the info call shows the open session", info.session);

  // Rotating the key stops the old poster.
  const old = key;
  await setUpPoster();
  await call("me_check_out", {}, tA);
  check((await call("me_check_in", { branchId: b1.id, key: old, ...near }, tA)).status === 403, "C8: after a reprint the old poster's key is refused");
}

// Ten tries in ten minutes at most.
await setup();
{
  await setUpPoster();
  setSetting("pssai_self_checkin", "on");
  for (let i = 0; i < 10; i++) await call("me_check_in", { branchId: b1.id, key: "wrong", ...near, consent: CONSENT_VERSION }, tA);
  const r = await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  check(r.status === 429 && rows("bookings").length === 0, "C9: the eleventh try in ten minutes is refused, even with the right key", r.error);
}

// ── I4/SP15: seat matching ──
await setup();
{
  await setUpPoster();
  setSetting("pssai_self_checkin", "on");
  check((await call("me_seat_prefs", {}, tA)).on === false && (await call("me_set_seat_prefs", { deskIds: [f3.id] }, tA)).status === 403, "M1: with pssai_seat_matching off there are no preferences");
  setSetting("pssai_seat_matching", "on");
  const r1 = rows("desks").find((d) => d.label === "R1");
  check((await call("me_set_seat_prefs", { deskIds: [r1.id] }, tA)).status === 400, "M2: a desk of another branch can't be a favourite");
  check((await call("me_set_seat_prefs", { deskIds: [cabin.id] }, tA)).status === 400, "M2: a permanent cabin can't be a favourite");
  check((await call("me_set_seat_prefs", { deskIds: [f1.id, f2.id, f3.id, f1.id], tags: ["quiet", "nonsense"] }, tA)).status === 200 && rows("seat_preferences")[0].tags.join() === "quiet", "M2: duplicates are dropped; unknown tags are ignored");
  await call("me_set_seat_prefs", { deskIds: [f3.id], tags: ["window"] }, tA);
  const prefs = await call("me_seat_prefs", {}, tA);
  check(prefs.desks.length === 3 && prefs.prefs.deskIds[0] === f3.id, "M3: the student sees their branch's open seats and their choice", prefs.prefs);
  const s = await call("suggest_desk", { branchId: b1.id, studentId: arun.id }, tP);
  check(s.desk?.label === "F3" && /favourite/.test(s.reason), "M4: the desk suggests the student's favourite desk", s);
  check((await call("suggest_desk", { branchId: b1.id, studentId: arun.id }, tR)).status === 403, "M4: staff of another branch can't ask");
  // The favourite is taken: the next best is the one with the wanted tag.
  f3.status = "occupied";
  const ok = await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  check(ok.status === 200 && ok.deskLabel === "F2" && /window/.test(ok.deskReason) && f2.status === "occupied" && f2.current_booking_id === ok.bookingId, "M5: with the favourite taken the student is seated at the desk with a window", ok);
  // Checking out frees the floating desk.
  const out = await call("me_check_out", {}, tA);
  check(out.status === 200 && f2.status === "free" && f2.current_booking_id === null && rows("checkin_records").some((r) => r.kind === "out" && r.result === "ok"), "M6: self checkout frees the floating desk", out);
  // History: with no favourite left, the desk used most comes first.
  await call("me_set_seat_prefs", { deskIds: [], tags: [] }, tA);
  insert("bookings", { student_id: arun.id, branch_id: b1.id, desk_id: f3.id, booking_type: "temporary", start_time: new Date(Date.now() - 3 * 86400e3).toISOString(), end_time: new Date(Date.now() - 3 * 86400e3 + 3600e3).toISOString(), status: "completed", is_paused: false });
  insert("bookings", { student_id: arun.id, branch_id: b1.id, desk_id: f3.id, booking_type: "temporary", start_time: new Date(Date.now() - 4 * 86400e3).toISOString(), end_time: new Date(Date.now() - 4 * 86400e3 + 3600e3).toISOString(), status: "completed", is_paused: false });
  f3.status = "free";
  check((await call("suggest_desk", { branchId: b1.id, studentId: arun.id }, tP)).desk?.label === "F3", "M7: with no preferences the desk the student used most comes first");
}

// ── Self checkout: overtime from the clock; C14 food as dues ──
await setup();
{
  await setUpPoster();
  setSetting("pssai_self_checkin", "on");
  check((await call("me_check_out", {}, tA)).status === 400, "O1: with no open session there is nothing to check out of");
  await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  const bk = rows("bookings").find((b) => b.student_id === arun.id);
  bk.start_time = new Date(Date.now() - 6 * 3600e3).toISOString();
  bk.end_time = new Date(Date.now() - 2 * 3600e3).toISOString();
  const out = await call("me_check_out", {}, tA);
  const ot = rows("overtime_sessions").find((o) => o.booking_id === bk.id);
  check(out.status === 200 && out.overtimeMinutes === 120 && out.overtimeCharge === 20 && ot && ot.overtime_minutes === 120 && Number(ot.billed_amount) === 20 && ot.billed_at === null && rows("transactions").length === 0,
    "O2: two hours past the booked end: 120 minutes, ₹20 logged as Pay Later (billed at renewal, as at the desk); no money taken now", { out, ot });
  check(bk.status === "completed" && Math.abs(Date.parse(bk.end_time) - Date.now()) < 5000, "O2: the session ends now");
}
await setup();
{
  await setUpPoster();
  setSetting("pssai_self_checkin", "on");
  await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  const bk = rows("bookings").find((b) => b.student_id === arun.id);
  const pass = insert("food_passes", { student_id: arun.id, branch_id: b1.id, balance: 20 });
  const bill = insert("food_bills", { branch_id: b1.id, student_id: arun.id, booking_id: bk.id, subtotal: 50, total: 50, paid: false, payment_mode: null });
  const staffTry = await call("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0, foodAsDues: true }, tP);
  check(staffTry.needsFoodPassCollection && staffTry.shortfall === 30 && bk.status === "active", "O3: at the desk a ₹30 Food Pass shortfall must still be collected — foodAsDues is ignored for staff (R6)", staffTry);
  const out = await call("me_check_out", {}, tA);
  check(out.status === 200 && out.foodDue === 30 && bk.status === "completed" && bill.paid === false && Number(pass.balance) === 20 && rows("transactions").length === 0,
    "O3: self checkout goes through (C14); the bill stays unpaid as dues, the pass is untouched, nothing is charged", { out, pass: pass.balance, bill: bill.paid });
}
await setup();
{
  await setUpPoster();
  setSetting("pssai_self_checkin", "on");
  insert("food_bills", { branch_id: b1.id, student_id: arun.id, booking_id: null, subtotal: 40, total: 40, paid: false, payment_mode: null, created_at: new Date(Date.now() - 5 * 86400e3).toISOString() });
  await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  const bk = rows("bookings").find((b) => b.student_id === arun.id);
  check((await call("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, tP)).status === 400, "O4: at the desk a 5-day-old food bill blocks checkout, as before");
  const out = await call("me_check_out", {}, tA);
  check(out.status === 200 && out.foodDue === 40 && bk.status === "completed", "O4: self checkout leaves it as ₹40 of dues", out);
}

// ── A5 session watch: 23:30 IST ──
await setup();
{
  const now = Date.now();
  check((await run("cron_close_forgotten_sessions")).skipped, "W1: with pssai_session_watch off nothing is closed");
  setSetting("pssai_session_watch", "on");
  setSetting("pssai_portal", "on");
  const forgot = insert("bookings", { student_id: arun.id, branch_id: b1.id, desk_id: f1.id, membership_id: memA.id, booking_type: "temporary", start_time: new Date(now - 8 * 3600e3).toISOString(), end_time: new Date(now - 2 * 3600e3).toISOString(), hours: 6, scheduled_hours: 6, amount: 0, status: "active", is_paused: false, paused_at: null, total_pause_minutes: 0 });
  f1.status = "occupied"; f1.current_booking_id = forgot.id;
  const late = insert("bookings", { student_id: meena.id, branch_id: b1.id, desk_id: cabin.id, booking_type: "permanent", start_time: new Date(now - 3600e3).toISOString(), end_time: new Date(now + 2 * 3600e3).toISOString(), hours: 3, amount: 0, status: "active", is_paused: false, paused_at: null, total_pause_minutes: 0 });
  const walk = insert("students", { name: "Walk In", phone: "9800000009", branch_id: b1.id, status: "active" });
  const onBreak = insert("bookings", { student_id: walk.id, branch_id: b1.id, desk_id: null, booking_type: "walkin", start_time: new Date(now - 5 * 3600e3).toISOString(), end_time: new Date(now - 1800e3).toISOString(), hours: 4.5, scheduled_hours: 4.5, amount: 60, payment_mode: "cash", status: "active", is_paused: true, paused_at: new Date(now - 4 * 3600e3).toISOString(), total_pause_minutes: 0 });
  // Review #8: on a break but booked past now — left alone.
  const walk2 = insert("students", { name: "Late Break", phone: "9800000008", branch_id: b1.id, status: "active" });
  const breakAhead = insert("bookings", { student_id: walk2.id, branch_id: b1.id, desk_id: null, booking_type: "walkin", start_time: new Date(now - 2 * 3600e3).toISOString(), end_time: new Date(now + 3 * 3600e3).toISOString(), hours: 5, scheduled_hours: 5, amount: 50, payment_mode: "cash", status: "active", is_paused: true, paused_at: new Date(now - 3600e3).toISOString(), total_pause_minutes: 0 });
  const walkBill = insert("food_bills", { branch_id: b1.id, student_id: walk.id, booking_id: onBreak.id, subtotal: 25, total: 25, paid: false, payment_mode: null });
  const r = await run("cron_close_forgotten_sessions");
  check(r.closed === 2 && r.leftOpen === 2 && late.status === "active" && breakAhead.status === "active", "W2: two forgotten sessions are closed; one within its booked time and one on a break booked past now are left open", r);
  check(forgot.status === "completed" && forgot.end_time === new Date(now - 2 * 3600e3).toISOString() && !rows("overtime_sessions").length && f1.status === "free",
    "W2: closed at the booked end, no overtime (C15), the desk freed", forgot.end_time);
  check(onBreak.status === "completed" && onBreak.end_time === new Date(now - 4 * 3600e3).toISOString() && walkBill.paid === false && !rows("transactions").some((t) => t.category === "food"),
    "W2: a session left on a break closes when the break began; the walk-in's unpaid food stays unpaid (nobody collected it)", onBreak.end_time);
  const flags = rows("anomaly_flags").filter((f) => f.kind === "session_auto_closed");
  check(flags.length === 2 && flags.some((f) => /₹25 of food/.test(f.explanation) && /when its break began/.test(f.explanation)) && rows("portal_notifications").some((n) => n.kind === "session_closed" && n.student_id === arun.id && !/No overtime/.test(n.body) && /Please check out/.test(n.body)),
    "W2: each close is a flag for the owner, and the student is told in the portal", flags.map((f) => f.explanation));
  check(rows("events").some((e) => e.action === "checkout_booking" && e.actor_type === "system" && e.ok), "W2: each close is logged as checkout_booking by the system");
  const again = await run("cron_close_forgotten_sessions");
  check(again.closed === 0 && rows("anomaly_flags").filter((f) => f.kind === "session_auto_closed").length === 2, "W3: a second run closes nothing more and flags nothing twice", again);

  // Staff corrections of the checkout time.
  const moved = insert("bookings", { student_id: arun.id, branch_id: b1.id, desk_id: null, booking_type: "temporary", start_time: new Date(now - 5 * 3600e3).toISOString(), end_time: new Date(now - 3600e3).toISOString(), hours: 4, amount: 0, status: "active", is_paused: false, paused_at: null, total_pause_minutes: 0 });
  await call("checkout_booking", { bookingId: moved.id, overtimeMinutes: 0, actualEndTime: new Date(now - 50 * 60e3).toISOString(), endTimeEdited: true }, tP);
  // Review #13: a form left open 40 minutes (time not edited) is not a correction.
  const leftOpen = insert("bookings", { student_id: walk.id, branch_id: b1.id, desk_id: null, booking_type: "temporary", start_time: new Date(now - 5 * 3600e3).toISOString(), end_time: new Date(now - 3600e3).toISOString(), hours: 4, amount: 0, status: "active", is_paused: false, paused_at: null, total_pause_minutes: 0 });
  await call("checkout_booking", { bookingId: leftOpen.id, overtimeMinutes: 0, actualEndTime: new Date(now - 40 * 60e3).toISOString(), endTimeEdited: false }, tP);
  const small = insert("bookings", { student_id: meena.id, branch_id: b1.id, desk_id: null, booking_type: "permanent", start_time: new Date(now - 4 * 3600e3).toISOString(), end_time: new Date(now - 3600e3).toISOString(), hours: 3, amount: 0, status: "active", is_paused: false, paused_at: null, total_pause_minutes: 0 });
  late.status = "completed";
  await call("checkout_booking", { bookingId: small.id, overtimeMinutes: 0, actualEndTime: new Date(now - 5 * 60e3).toISOString(), endTimeEdited: true }, tP);
  const r2 = await run("cron_close_forgotten_sessions");
  const corr = rows("anomaly_flags").filter((f) => f.kind === "checkout_corrected");
  check(r2.corrected === 1 && corr.length === 1 && corr[0].ref_id === moved.id && corr[0].branch_id === b1.id && /50 minutes before/.test(corr[0].explanation),
    "W4: a staff checkout moved back 50 minutes is flagged; one moved back 5 minutes, or a form left open, is not", corr.map((f) => f.explanation));
}

// ── SP14 live seats; session reminders; O2 part 2 ──
await setup();
{
  check((await call("me_live_seats", {}, tA)).on === false, "L1: with pssai_live_seats off there are no counts");
  setSetting("pssai_live_seats", "on");
  insert("bookings", { student_id: arun.id, branch_id: b1.id, desk_id: null, booking_type: "temporary", start_time: new Date().toISOString(), end_time: new Date(Date.now() + 3600e3).toISOString(), status: "active", is_paused: false });
  insert("bookings", { student_id: meena.id, branch_id: b1.id, desk_id: cabin.id, booking_type: "permanent", start_time: new Date().toISOString(), end_time: new Date(Date.now() + 3600e3).toISOString(), status: "active", is_paused: false });
  const live = await call("me_live_seats", {}, tA);
  const hopes = live.branches.find((b: any) => b.name === "Hopes");
  check(hopes.total === 3 && hopes.inUse === 1 && hopes.free === 2 && !JSON.stringify(live).includes("Arun"), "L1: Hopes shows 2 of 3 open seats free (a member in their own cabin doesn't count); no names", hopes);

  setSetting("pssai_session_reminders", "on");
  setSetting("pssai_self_checkin", "on");
  rows("bookings")[0].end_time = new Date(Date.now() + 5 * 60e3).toISOString();
  await run("cron_session_reminders");
  check(rows("portal_notifications").some((n) => n.kind === "session_end" && /at the desk/.test(n.body)), "L2: at a branch without a poster the reminder says to check out at the desk (review #2)");
  rows("portal_notifications").length = 0;
  await setUpPoster();
  await run("cron_session_reminders");
  check(rows("portal_notifications").some((n) => n.kind === "session_end" && /in the portal/.test(n.body)), "L2: at a poster branch with self check-in on it says to check out in the portal");

  insert("checkin_records", { student_id: arun.id, branch_id: b1.id, kind: "in", result: "ok", booking_id: null });
  await call("check_in_member", { branchId: b1.id, studentId: arun.id }, tP).catch(() => null);
  rows("bookings")[0].status = "completed";
  const atDesk = await call("check_in_member", { branchId: b1.id, studentId: arun.id }, tP);
  const paidWalkin = await call("create_walkin", { branchId: b1.id, name: "Walk In", phone: "9800000001", hours: 3, paymentMode: "cash" }, tP);
  rows("transactions").splice(0, rows("transactions").length);
  rows("bookings").find((b) => b.id === paidWalkin.booking.id).created_at = new Date(Date.now() - 3600e3).toISOString();
  const f = await integrityFindings(adminClient());
  check(atDesk.status === 200 && f.counts.selfcheckins_without_session === 1 && f.counts.staff_checkins_at_poster_branches >= 1 && f.counts.walkins_without_payment === 1,
    "I1: the nightly check lists a self check-in with no session, a staff check-in at a poster branch and a paid walk-in with no payment", f.counts);
}

// ── Phase 4 review fixes ──
await setup();
{
  setSetting("pssai_self_checkin", "on");
  await setUpPoster();
  // #11: bad coordinates never save as 0 or wipe the location.
  const bad = await Promise.all([
    call("set_branch_location", { branchId: b1.id, latitude: null, longitude: HALL.lng }, tO),
    call("set_branch_location", { branchId: b1.id, latitude: "13.08° N", longitude: HALL.lng }, tO),
    call("set_branch_location", { branchId: b1.id, latitude: null, longitude: null }, tO),
  ]);
  check(bad.every((r) => r.status === 400) && b1.latitude === HALL.lat && b1.longitude === HALL.lng, "X11: a missing or non-number coordinate is refused; the saved location stays", bad.map((r) => r.error));
  check((await call("set_branch_location", { branchId: b2.id, clear: true }, tO)).ok && b2.latitude === null, "X11: clearing needs clear: true");

  // #2: self checkout only where self check-in runs (a branch with a poster).
  const visitor = insert("students", { name: "Ram Member", phone: "9100000007", branch_id: b2.id, status: "active", total_visits: 0 });
  insert("memberships", { student_id: visitor.id, branch_id: b2.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(IST_TODAY(), -3), end_date: addDays(IST_TODAY(), 20), due_date: addDays(IST_TODAY(), 21), monthly_fee: 1200, total_paid: 1200, fee_due: 0, is_active: true, is_paused: false });
  const code = await call("create_portal_setup_code", { studentId: visitor.id }, tR);
  const tV = (await call("me_set_pin", { phone: visitor.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
  await call("check_in_member", { branchId: b2.id, studentId: visitor.id }, tR);
  const info = await call("me_checkin_info", {}, tV);
  const refused = await call("me_check_out", {}, tV);
  check(info.session && info.session.canSelfCheckout === false && refused.status === 403 && rows("bookings").find((b) => b.student_id === visitor.id)?.status === "active",
    "X2: at Ram Nagar (no poster) the portal offers no checkout and refuses one — the desk checks out", { canSelf: info.session?.canSelfCheckout, refused: refused.error });
  await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tA);
  const infoA = await call("me_checkin_info", {}, tA);
  check(infoA.session?.canSelfCheckout === true && (await call("me_check_out", {}, tA)).status === 200, "X2: at Hopes (poster) self checkout works");

  // #3: two check-ins for the same free desk at the same moment: one gets it.
  const s1 = insert("students", { name: "Desk One", phone: "9100000011", branch_id: b1.id, status: "active", total_visits: 0 });
  const s2 = insert("students", { name: "Desk Two", phone: "9100000012", branch_id: b1.id, status: "active", total_visits: 0 });
  for (const st of [s1, s2]) insert("memberships", { student_id: st.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(IST_TODAY(), -3), end_date: addDays(IST_TODAY(), 20), due_date: addDays(IST_TODAY(), 21), monthly_fee: 1200, total_paid: 1200, fee_due: 0, is_active: true, is_paused: false });
  const both = await Promise.all([s1, s2].map((st) => call("check_in_member", { branchId: b1.id, studentId: st.id, deskId: f3.id }, tP)));
  const okOnes = both.filter((r) => r.status === 200);
  check(okOnes.length === 1 && both.some((r) => r.error === "Selected desk is not available") && f3.status === "occupied" && f3.current_booking_id === okOnes[0].bookingId,
    "X3: one of two simultaneous check-ins gets F3; the other is told it is taken", both.map((r) => r.status + " " + (r.error ?? r.deskLabel)));
  // Checking out a session whose desk now belongs to someone else leaves that desk alone.
  const winner = rows("bookings").find((b) => b.id === okOnes[0].bookingId)!;
  f3.current_booking_id = "00000000-0000-4000-8000-0000000fffff";
  await call("checkout_booking", { bookingId: winner.id, overtimeMinutes: 0 }, tP);
  check(winner.status === "completed" && f3.status === "occupied", "X3: checkout frees a floating desk only while it still points at that session");

  // #4: a cabin member self-checks in while a walk-in sold their hours is past time.
  setSetting("pssai_hour_release", "on");
  const walk = insert("students", { name: "Sold Walkin", phone: "9800000021", branch_id: b1.id, status: "active" });
  const wb = insert("bookings", { student_id: walk.id, branch_id: b1.id, desk_id: cabin.id, booking_type: "walkin", status: "active", start_time: new Date(Date.now() - 4 * 3600e3).toISOString(), end_time: new Date(Date.now() - 3600e3).toISOString(), hours: 3, amount: 60 });
  insert("seat_resales", { desk_id: cabin.id, booking_id: wb.id, release_id: null, collision: null, branch_id: b1.id });
  rows("messages").length = 0;
  const inM = await call("me_check_in", { branchId: b1.id, key, ...near, consent: CONSENT_VERSION }, tM);
  const alert = rows("messages").find((m) => m.content.startsWith("[desk_alert]"));
  check(inM.status === 200 && inM.collision?.kind === "walkin_overstay" && /desk has been told/.test(inM.collision.message) && !/please move them/.test(inM.collision.message),
    "X4: the student is told in their own words (not the desk's)", inM.collision);
  check(alert && alert.branch_id === b1.id && /Meena Raj/.test(alert.content) && /move them/.test(alert.content), "X4: and the desk gets an alert with the staff wording", alert?.content);

  // #12: food orders still open at closing are cancelled by the nightly job, even with session watch off.
  setSetting("pssai_food_orders", "on");
  const stale = insert("food_orders", { branch_id: b1.id, student_id: arun.id, status: "accepted", items: [], total: 20, created_at: new Date(Date.now() - 5 * 3600e3).toISOString() });
  const fresh = insert("food_orders", { branch_id: b1.id, student_id: arun.id, status: "placed", items: [], total: 10, created_at: new Date(Date.now() - 600e3).toISOString() });
  const night = await run("cron_close_forgotten_sessions");
  check(night.skipped && night.ordersCancelled === 1 && stale.status === "cancelled" && fresh.status === "placed" && rows("portal_notifications").some((n) => n.kind === "food" && n.student_id === arun.id && /Nothing was charged/.test(n.body)),
    "X12: an order open for hours is cancelled at closing (nothing charged, the student told); a new one stays", night);

  // #14: unpaid food on a finished walk-in shows in the nightly integrity report.
  const done1 = insert("bookings", { student_id: walk.id, branch_id: b1.id, desk_id: null, booking_type: "walkin", status: "completed", start_time: new Date(Date.now() - 6 * 3600e3).toISOString(), end_time: new Date(Date.now() - 3 * 3600e3).toISOString(), hours: 3, amount: 0 });
  insert("food_bills", { branch_id: b1.id, student_id: walk.id, booking_id: done1.id, subtotal: 30, total: 30, paid: false, payment_mode: null });
  const f = await integrityFindings(adminClient());
  check(f.counts.unpaid_food_on_closed_walkins === 1 && f.unpaid_food_on_closed_walkins[0].booking_id === done1.id, "X14: the integrity report lists unpaid food left on a finished walk-in", f.counts);
}

done();
