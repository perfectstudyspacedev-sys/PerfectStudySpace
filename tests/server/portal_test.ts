// P2.1 — the student portal against the REAL api function: the switch, setup codes, PIN login and
// lockout (D6), token separation (a staff token never works on me_*, a student token never works
// anywhere else), sessions, and isolation — a student only ever sees and changes their own data.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { SignJWT } from "npm:jose@5";
let TODAY = IST_TODAY(); // recomputed by setup(): sections move the clock forward
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};

let b1: any, b2: any, owner: any, priya: any, ravi: any, asha: any, bala: any, memA: any, memB: any, tO: string, tP: string, tR: string;
async function setup() {
  reset();
  TODAY = IST_TODAY();
  b1 = insert("branches", { name: "Hopes", is_active: true });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: b2.id });
  [tO, tP, tR] = await Promise.all([owner, priya, ravi].map((s) => tokenFor(s)));
  for (const [h, fee] of [[4, 800], [6, 1250], [8, 1500]]) insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: h, fee, sort_order: h });
  asha = insert("students", { name: "Asha Rao", phone: "9100000001", emergency_contact: "9000000001", branch_id: b1.id, status: "active" });
  bala = insert("students", { name: "Bala Kumar", phone: "9100000002", emergency_contact: "9000000002", branch_id: b2.id, status: "active" });
  memA = insert("memberships", { student_id: asha.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -25), end_date: addDays(TODAY, 4), due_date: addDays(TODAY, 4), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true, is_paused: false, plan_amount: 1250, plan_days: 30 });
  memB = insert("memberships", { student_id: bala.id, branch_id: b2.id, category: "temporary", seat_type: "floating", hours_per_day: 8, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 24), due_date: addDays(TODAY, 24), months_paid: 1, monthly_fee: 1500, total_paid: 1000, fee_due: 500, is_active: true, is_paused: false, plan_amount: 1500, plan_days: 30 });
  insert("transactions", { student_id: asha.id, branch_id: b1.id, membership_id: memA.id, amount: 1250, category: "membership", payment_mode: "upi", created_at: new Date(Date.now() - 25 * 86400e3).toISOString() });
  insert("transactions", { student_id: bala.id, branch_id: b2.id, membership_id: memB.id, amount: 1000, category: "membership", payment_mode: "cash", created_at: new Date(Date.now() - 5 * 86400e3).toISOString() });
  setSetting("pssai_portal", "on");
}
/** Desk makes a code; the student sets a PIN with it. Returns the student's token. */
async function enrol(student: any, staffToken: string, pin = "482915") {
  const code = await call("create_portal_setup_code", { studentId: student.id }, staffToken);
  const set = await call("me_set_pin", { phone: student.phone, code: code.code, pin, acceptPrivacy: true });
  return set.token as string;
}

// ── The switch ──
await setup();
{
  setSetting("pssai_portal", "off");
  const login = await call("me_login", { phone: asha.phone, pin: "482915" });
  const code = await call("create_portal_setup_code", { studentId: asha.id }, tP);
  const read = await call("me_profile", {}, "anything");
  check(login.status === 403 && code.status === 403 && read.status === 403 && /not open yet/.test(read.error), "P1: with pssai_portal off, login, setup codes and every me_* action are refused", { login, code, read });
}

// ── Setup codes and PIN setup ──
await setup();
{
  const other = await call("create_portal_setup_code", { studentId: asha.id }, tR);
  check(other.status === 403, "P2: staff of another branch cannot make a code for this student", other);
  const c = await call("create_portal_setup_code", { studentId: asha.id }, tP);
  const stored = rows("student_setup_codes")[0];
  check(c.status === 200 && /^\d{6}$/.test(c.code) && c.message.includes(c.code) && c.message.includes("/me/setup") && c.phone === asha.phone, "P2: the desk gets a 6-digit code and a WhatsApp message with it", c);
  check(stored && !JSON.stringify(stored).includes(c.code) && /^pbkdf2-sha256\$100000\$/.test(stored.code_hash), "P2: only a hash of the code is stored", stored);
  check(!JSON.stringify(rows("events")).includes(c.code) && rows("idempotency_keys").length === 0, "P2: the code is in no event and no retry record");

  const weak = await Promise.all(["111111", "123456", "654321", "12345", "abcdef"].map((pin) => call("me_set_pin", { phone: asha.phone, code: c.code, pin, acceptPrivacy: true })));
  check(weak.every((r) => r.status === 400), "P2: repeated digits, straight runs and anything but 6 digits are refused as PINs", weak.map((r) => r.error));
  const noConsent = await call("me_set_pin", { phone: asha.phone, code: c.code, pin: "482915" });
  check(noConsent.status === 400 && /privacy/.test(noConsent.error), "P2: the privacy notice must be accepted", noConsent);
  const wrong = c.code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++) await call("me_set_pin", { phone: asha.phone, code: wrong, pin: "482915", acceptPrivacy: true });
  const late = await call("me_set_pin", { phone: asha.phone, code: c.code, pin: "482915", acceptPrivacy: true });
  check(late.status === 401 && rows("student_credentials").length === 0, "P2: after 5 wrong codes even the right code no longer works", late);

  const c2 = await call("create_portal_setup_code", { studentId: asha.id }, tP);
  const ok = await call("me_set_pin", { phone: asha.phone, code: c2.code, pin: "482915", acceptPrivacy: true });
  const cred = rows("student_credentials")[0];
  check(ok.status === 200 && typeof ok.token === "string" && rows("student_setup_codes").length === 0 && cred.privacy_accepted_at && !JSON.stringify(cred).includes("482915"),
    "P2: a new code sets the PIN, is used up, records the consent, and stores only a hash", { ok, cred });
  const reuse = await call("me_set_pin", { phone: asha.phone, code: c2.code, pin: "739164", acceptPrivacy: true });
  check(reuse.status === 401, "P2: a used code cannot be used again", reuse);

  const expired = await call("create_portal_setup_code", { studentId: bala.id }, tR);
  advanceClock(25 * 3600e3);
  const tooLate = await call("me_set_pin", { phone: bala.phone, code: expired.code, pin: "739164", acceptPrivacy: true });
  check(tooLate.status === 401, "P2: a code older than 24 hours is refused", tooLate);
}

// ── Login and lockout ──
await setup();
{
  await enrol(asha, tP);
  const good = await call("me_login", { phone: asha.phone, pin: "482915" });
  check(good.status === 200 && good.token && good.student.name === "Asha Rao", "P3: phone + PIN logs in", good);
  const unknown = await call("me_login", { phone: "9999999999", pin: "482915" });
  const noPin = await call("me_login", { phone: bala.phone, pin: "482915" });
  const wrong = await call("me_login", { phone: asha.phone, pin: "000000" });
  check([unknown, noPin, wrong].every((r) => r.status === 401 && r.error === "Phone number or PIN is wrong"), "P3: unknown phone, no PIN yet and a wrong PIN all get the same answer", [unknown, noPin, wrong]);
  for (let i = 0; i < 4; i++) await call("me_login", { phone: asha.phone, pin: "000000" });
  const locked = await call("me_login", { phone: asha.phone, pin: "482915" });
  check(locked.status === 429 && /15 minutes/.test(locked.error), "P3: after 5 wrong PINs the account is locked for 15 minutes, even for the right PIN (D6)", locked);
  advanceClock(16 * 60e3);
  const after = await call("me_login", { phone: asha.phone, pin: "482915" });
  check(after.status === 200 && rows("student_credentials")[0].failed_attempts === 0, "P3: after 15 minutes the right PIN works and the counter resets", after);
  check(rows("events").filter((e) => e.action === "me_login").every((e) => JSON.stringify(e.payload) === "{}"), "P3: login events store no phone and no PIN");

  // Reset (D6): the desk sends a new code; the new PIN ends every older session.
  const oldToken = after.token;
  const fresh = await enrol(asha, tO, "739164");
  const oldUse = await call("me_profile", {}, oldToken);
  const newUse = await call("me_profile", {}, fresh);
  const oldPin = await call("me_login", { phone: asha.phone, pin: "482915" });
  check(oldUse.status === 401 && newUse.status === 200 && oldPin.status === 401, "P3: a PIN reset logs out every old session and the old PIN stops working", { oldUse, newUse, oldPin });
}

// ── Token separation and sessions ──
await setup();
{
  const tA = await enrol(asha, tP);
  const studentOnStaff = await call("list_students", { branchId: b1.id }, tA);
  const staffOnPortal = await call("me_profile", {}, tP);
  check(studentOnStaff.status === 401 && staffOnPortal.status === 401, "P4: a student token is refused on staff actions; a staff token is refused on me_* actions", { studentOnStaff, staffOnPortal });
  const forgedWithStaffSecret = await new SignJWT({ typ: "student", sid: rows("student_sessions")[0].id }).setProtectedHeader({ alg: "HS256" }).setSubject(asha.id).setExpirationTime("1h").sign(new TextEncoder().encode("test-secret"));
  const studentTypedStaff = await new SignJWT({ typ: "student", sub: priya.id, role: "staff", username: "priya" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode("test-secret"));
  const f1 = await call("me_profile", {}, forgedWithStaffSecret);
  const f2 = await call("list_students", { branchId: b1.id }, studentTypedStaff);
  check(f1.status === 401 && f2.status === 401, "P4: a student token signed with the staff secret fails, and the staff path refuses any typ=student token", { f1, f2 });
  const otherSession = await new SignJWT({ typ: "student", sid: rows("student_sessions")[0].id }).setProtectedHeader({ alg: "HS256" }).setSubject(bala.id).setExpirationTime("1h").sign(new TextEncoder().encode("student-test-secret"));
  check((await call("me_profile", {}, otherSession)).status === 401, "P4: a session id belonging to another student is refused");
  await call("me_logout", {}, tA);
  check((await call("me_profile", {}, tA)).status === 401, "P4: after logout the token stops working");
  const tA2 = (await call("me_login", { phone: asha.phone, pin: "482915" })).token;
  advanceClock(31 * 86400e3);
  check((await call("me_profile", {}, tA2)).status === 401, "P4: a session ends after 30 days");
}

// ── Isolation: a student sees and changes only their own data ──
await setup();
{
  const tA = await enrol(asha, tP);
  const tB = await enrol(bala, tR, "739164");
  insert("portal_notifications", { student_id: bala.id, kind: "info", title: "For Bala" });
  insert("portal_notifications", { student_id: asha.id, kind: "info", title: "For Asha" });
  const nB = rows("portal_notifications").find((n) => n.student_id === bala.id);
  insert("food_passes", { student_id: bala.id, branch_id: b2.id, balance: 300 });

  const asB = { studentId: bala.id, membershipId: memB.id, phone: bala.phone, branchId: b2.id };
  const profile = await call("me_profile", asB, tA);
  const mem = await call("me_membership", asB, tA);
  const receipts = await call("me_receipts", asB, tA);
  const notes = await call("me_notifications", asB, tA);
  const report = await call("me_study_report", asB, tA);
  await call("me_mark_read", { notificationId: nB.id }, tA);
  await call("me_update_contact", { ...asB, emergencyContact: "9555555555" }, tA);
  const all = JSON.stringify([profile, mem, receipts, notes, report]);
  check(profile.profile.name === "Asha Rao" && mem.membership.id === memA.id && receipts.receipts.length === 1 && receipts.receipts[0].amount === 1250 && notes.notifications.length === 1 && notes.notifications[0].title === "For Asha",
    "P5: with another student's ids in the payload, every read still answers for the token's student", { profile: profile.profile, mem: mem.membership?.id });
  check(!all.includes("Bala") && !all.includes(bala.phone) && !all.includes(memB.id) && mem.foodPass === null, "P5: nothing of the other student appears anywhere");
  check(!nB.read_at && rows("students").find((s) => s.id === bala.id).emergency_contact === "9000000002" && rows("students").find((s) => s.id === asha.id).emergency_contact === "9555555555",
    "P5: marking another student's notice and changing contact details only ever touch the token's student");
  check((await call("me_profile", {}, tB)).profile.name === "Bala Kumar", "P5: the other student still sees their own profile");
  const ev = rows("events").filter((e) => e.actor_type === "student");
  check(ev.length > 0 && ev.every((e) => e.actor_id === asha.id || e.actor_id === bala.id) && ev.some((e) => e.action === "me_profile" && e.tier === "T0"), "P5: portal reads and writes are events with actor student and the student's id", ev.map((e) => e.action));
}

// ── Membership, quotes, contact, report ──
await setup();
{
  const tA = await enrol(asha, tP);
  const off = await call("me_membership", {}, tA);
  check(off.membership.daysLeft === 4 && off.membership.renewalKind === "early" && off.renewalQuotes.length === 0 && off.upiPay === false, "P6: membership with days left and renewal kind; no quotes while UPI pay is off", off);
  setSetting("pssai_upi_pay", "on");
  const q = await call("me_membership", {}, tA);
  check(JSON.stringify(q.renewalQuotes) === JSON.stringify([{ months: 1, amount: 1250 }, { months: 2, amount: 2375 }, { months: 3, amount: 3375 }, { months: 6, amount: 6375 }]),
    "P6: renewal quotes use the plan fee and the 5/10/15% multi-month discount", q.renewalQuotes);
  insert("cashbacks", { student_id: asha.id, status: "pending", cashback_type: "fixed", cashback_value: 100 });
  insert("overtime_sessions", { student_id: asha.id, overtime_minutes: 40, billed_amount: 30, billed_at: null, excluded: false });
  insert("overtime_sessions", { student_id: asha.id, overtime_minutes: 40, billed_amount: 30, billed_at: null, excluded: true });
  const q2 = await call("me_membership", {}, tA);
  check(q2.renewalQuotes[0].amount === 1250 - 100 + 30, "P6: pending cashback is taken off and unbilled overtime added, like renew_membership", q2.renewalQuotes);
  memA.fee_due = 200;
  const q3 = await call("me_membership", {}, tA);
  check(q3.renewalQuotes.length === 0 && /₹200/.test(q3.renewalBlockedBy), "P6: with dues, no renewal is offered and the reason is given", q3.renewalBlockedBy);
  const own = await call("me_update_contact", { emergencyContact: asha.phone }, tA);
  check(own.status === 400, "P6: the student's own number cannot be the emergency contact", own);
  const name = await call("me_update_contact", { emergencyContact: "9444444444", name: "Hacker", branch_id: b2.id }, tA);
  const s = rows("students").find((x) => x.id === asha.id);
  check(name.status === 200 && s.name === "Asha Rao" && s.branch_id === b1.id && s.emergency_contact === "9444444444", "P6: only the emergency contact changes", s);

  const bk = insert("bookings", { student_id: asha.id, branch_id: b1.id, booking_type: "temporary", status: "completed", start_time: new Date(Date.now() - 5 * 3600e3).toISOString(), end_time: new Date(Date.now() - 1 * 3600e3).toISOString(), hours: 6, amount: 0, total_pause_minutes: 10 });
  insert("focus_ratings", { booking_id: bk.id, student_id: asha.id, rating: 4 });
  const rep = await call("me_study_report", {}, tA);
  check(rep.status === 200 && rep.bookings.length === 1 && rep.bookings[0].focus === 4 && rep.bookings[0].pauseMinutes === 10 && rep.dateFrom === addDays(TODAY, -6), "P6: the study report covers the last 7 days with focus ratings", rep);
  const bad = await Promise.all([call("me_study_report", { dateFrom: addDays(TODAY, -70), dateTo: TODAY }, tA), call("me_study_report", { dateFrom: TODAY, dateTo: addDays(TODAY, 1) }, tA)]);
  check(bad.every((r) => r.status === 400), "P6: over-long or future ranges are refused", bad);
  setSetting("grievance_contact_name", "R. Kumar");
  const priv = await call("me_privacy", {}, tA);
  check(priv.businessName === "Perfect Study Space" && priv.grievance.name === "R. Kumar" && priv.privacyAcceptedAt, "P6: the privacy page shows the grievance contact (C5) and when the student accepted", priv);
  const plans = await call("me_plans", {}, tA);
  check(plans.plans.length === 3 && plans.plans[1].monthlyFee === 1250, "P6: plans list the fee table", plans);
}

done();
