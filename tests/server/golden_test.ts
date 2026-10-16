// Golden master: calls EVERY api action with realistic inputs on a fixed clock and seeded ids, then
// compares each response — and the whole database afterwards — with tests/server/golden.snapshot.json.
// Purpose: prove a refactor (e.g. moving action code between files) changes no behaviour at all.
// When behaviour changes on purpose, review the diff, then re-record:
//   npm run test:server -- golden --update
// deno-lint-ignore-file no-explicit-any
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, fake } from "./harness.ts";

const SNAPSHOT = new URL("./golden.snapshot.json", import.meta.url);
const UPDATE = Deno.args.includes("--update");
const g = globalThis as any;

const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString();
const D = (n: number) => { const x = new Date(Date.UTC(2026, 9, 16)); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const TODAY = D(0);

reset();
// ── seed ──────────────────────────────────────────────────────────────────────
const b1 = insert("branches", { name: "Hopes", desk_count: 6, locker_capacity: 20, is_active: true, shift_config: ["morning", "afternoon", "evening", "night"], signup_code: "abcdefgh2345" });
const b2 = insert("branches", { name: "Ram Nagar", desk_count: 2, locker_capacity: 10, is_active: true, shift_config: ["morning", "afternoon", "evening", "night"], signup_code: "zyxwvtsr9876" });
const owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
const admin = insert("staff", { username: "admin", display_name: "Admin", role: "admin", is_active: true, branch_id: null });
const priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
const ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: b2.id });
const desks = ["C1", "C2", "C3", "C4", "C5", "C6"].map((label, i) => insert("desks", { branch_id: b1.id, label, status: i === 1 ? "reserved" : i === 0 ? "occupied" : "free", sort_order: i }));
insert("desks", { branch_id: b2.id, label: "R1", status: "free", sort_order: 0 });
for (const [h, fee] of [[3, 35], [6, 60], [8, 80], [24, 100]]) insert("fee_config", { config_type: "walkin", max_hours: h, fee, sort_order: h });
for (const [h, fee] of [[4, 800], [6, 1250], [8, 1500]]) insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: h, fee, sort_order: h });
insert("fee_config", { config_type: "membership", cabin_type: "permanent", hours_per_day: 12, fee: 2100, sort_order: 12 });
insert("app_settings", { key: "welcome_template", value: "Hi {name}, welcome!" });

const student = (name: string, phone: string, extra: any = {}) => insert("students", { name, phone, branch_id: b1.id, status: "active", total_visits: 3, total_hours_studied: 12, emergency_contact: "9000000000", referral_source: "flex", course: "UPSC", ...extra });
const mem = (st: any, start: string, end: string, extra: any = {}) => insert("memberships", { student_id: st.id, branch_id: st.branch_id, category: "temporary", seat_type: "floating", hours_per_day: 6, hours_per_day_weekend: null, timings: "", start_date: start, end_date: end, due_date: end, months_paid: 1, discount_percent: 0, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true, is_paused: false, hold_days: 0, plan_amount: 1250, plan_days: 30, created_by_staff_id: owner.id, ...extra });

const asha = student("Asha Rao", "9100000001");          // active member, in a session now
const mAsha = mem(asha, D(-10), D(19));
const bala = student("Bala Kumar", "9100000002");        // permanent member, cabin C2
const mBala = mem(bala, D(-25), D(4), { category: "permanent", seat_type: "fixed", desk_id: desks[1].id, cabin_no: "C2", hours_per_day: 12, monthly_fee: 2100, total_paid: 2100, plan_amount: 2100 });
const chitra = student("Chitra Devi", "9100000003", { status: "pending" }); // expired 6 days ago → quit with overstay
const mChitra = mem(chitra, D(-36), D(-6));
const deepa = student("Deepa Nair", "9100000004");       // ends in 3 days → early renewal
const mDeepa = mem(deepa, D(-27), D(3));
const esha = student("Esha Shah", "9100000005", { status: "pending" }); // ended 3 days ago → grace renewal
const mEsha = mem(esha, D(-33), D(-3));
const farah = student("Farah Ali", "9100000006");        // locker + Food Pass
const mFarah = mem(farah, D(-5), D(24), { fee_due: 300, total_paid: 950 });
const gita = student("Gita Menon", "9100000007");        // will be deleted early (refund)
const mGita = mem(gita, D(-10), D(79), { months_paid: 3, discount_percent: 10, total_paid: 3375, plan_amount: 3375, plan_days: 90 });
const hari = student("Hari Prasad", "9100000008");       // paused later
const mHari = mem(hari, D(-8), D(21));
const ram = insert("students", { name: "Ram Walkin", phone: "9100000009", branch_id: b1.id, status: "inactive", total_visits: 1, total_hours_studied: 2 });

const bookingAsha = insert("bookings", { student_id: asha.id, branch_id: b1.id, desk_id: desks[0].id, membership_id: mAsha.id, booking_type: "temporary", status: "active", start_time: ist(TODAY, "05:00"), end_time: ist(TODAY, "11:00"), hours: 6, scheduled_hours: 6, amount: 0, is_paused: false, total_pause_minutes: 0, created_by_staff_id: priya.id });
for (const n of [1, 2, 3]) insert("bookings", { student_id: asha.id, branch_id: b1.id, desk_id: desks[2].id, membership_id: mAsha.id, booking_type: "temporary", status: "completed", start_time: ist(D(-n), "09:00"), end_time: ist(D(-n), "14:30"), hours: 6, scheduled_hours: 6, amount: 0 });
insert("bookings", { student_id: chitra.id, branch_id: b1.id, membership_id: mChitra.id, booking_type: "temporary", status: "completed", start_time: ist(D(-2), "10:00"), end_time: ist(D(-2), "13:00"), hours: 3, scheduled_hours: 6, amount: 0 });
const walkinBooking = insert("bookings", { student_id: ram.id, branch_id: b1.id, desk_id: desks[3].id, booking_type: "walkin", status: "active", start_time: ist(TODAY, "08:00"), end_time: ist(TODAY, "11:00"), hours: 3, amount: 35, payment_mode: "cash", is_paused: false, total_pause_minutes: 0 });
const lockerFarah = insert("lockers", { branch_id: b1.id, student_id: farah.id, locker_no: "3", is_active: true, deposit_amount: 100, deposit_returned: false, monthly_fee: 100, amount_paid: 200, fee_due: 0, locker_due_date: D(15) });
insert("food_passes", { student_id: farah.id, branch_id: b1.id, balance: 150 });
const tea = insert("food_items", { branch_id: b1.id, name: "Tea", price: 15, is_active: true, quantity: null });
const sandwich = insert("food_items", { branch_id: b1.id, name: "Sandwich", price: 60, is_active: true, quantity: 5 });
const unpaidBill = insert("food_bills", { branch_id: b1.id, student_id: chitra.id, student_name: "Chitra Devi", student_phone: "9100000003", subtotal: 45, discount_amount: 0, total: 45, payment_mode: "cash", paid: false });
const ot = insert("overtime_sessions", { student_id: asha.id, branch_id: b1.id, membership_id: mAsha.id, booking_id: null, session_date: D(-1), overtime_minutes: 40, billed_amount: 20, excluded: false, billed_at: null });
insert("cashbacks", { student_id: deepa.id, branch_id: b1.id, month_label: "Sep 2026", cashback_type: "fixed", cashback_value: 100, status: "pending", granted_by_staff_id: owner.id });
const enq1 = insert("enquiries", { branch_id: b1.id, name: "Kiran", phone: "9200000001", source: "walk_in", status: "new", message: "Evening slot?" });
const enq2 = insert("enquiries", { branch_id: b1.id, name: "Kiran K", phone: "9200000002", source: "phone", status: "new" });
const fu = insert("enquiry_followups", { enquiry_id: enq1.id, branch_id: b1.id, note: "Call back", due_at: ist(D(1), "10:00"), done: false });
const task = insert("tasks", { branch_id: b1.id, title: "Clean desks", repeat_interval: "daily", due_date: null, status: "open", assigned_to_staff_id: priya.id, created_by_staff_id: owner.id });
const alert = insert("alerts", { student_id: deepa.id, branch_id: b1.id, alert_type: "expiry", due_date: D(3), message: "Deepa expires soon", status: "pending" });
insert("messages", { branch_id: b1.id, sender_staff_id: owner.id, recipient_type: "staff", content: "Hello team" });
const waitlist = insert("permanent_waitlist", { branch_id: b1.id, name: "Wait Person", phone: "9300000001", hours_per_day: 12, status: "waiting" });
const inv = insert("inventory_items", { branch_id: b1.id, name: "Milk", quantity: 10 });
const signupReq = insert("signup_requests", { branch_id: b1.id, ref_code: "0A1B", name: "New Student", phone: "9400000001", emergency_contact: "9400000002", course: null, referral_source: "flex", claimed_by_staff_id: null, claimed_at: null });

g.__FAKE_RPC__ = (fn: string, args: any) => {
  if (fn === "verify_staff_login") {
    const s = rows("staff").find((x) => x.username.toLowerCase() === String(args.p_username).toLowerCase());
    if (!s || args.p_password !== "pw") return { data: [], error: null };
    const br = rows("branches").find((b) => b.id === s.branch_id);
    return { data: [{ id: s.id, username: s.username, role: s.role, display_name: s.display_name, branch_id: s.branch_id, branch_name: br?.name ?? null }], error: null };
  }
  return null;
};

const tO = await tokenFor(owner, "7d"), tA = await tokenFor(admin, "7d"), tP = await tokenFor(priya, "7d"), tR = await tokenFor(ravi, "7d");

// ── calls ─────────────────────────────────────────────────────────────────────
const log: any[] = [];
async function c(label: string, action: string, payload: any = {}, token?: string) {
  let res: any;
  try { res = await call(action, payload, token); } catch (e) { res = { thrown: String(e) }; }
  log.push({ label, action, res });
  return res;
}
const B = { branchId: b1.id };
const range = { period: "custom", dateFrom: D(-7), dateTo: TODAY };

// public
await c("login ok", "login", { username: "priya", password: "pw" });
await c("login bad", "login", { username: "priya", password: "nope" });
await c("enquiry no key", "public_create_enquiry", { name: "X", phone: "1" });
await c("enquiry", "public_create_enquiry", { siteKey: "site-key", name: "Web Lead", phone: "9500000001", branch: "Hopes", packageInterest: "6h", message: "hi" });
await c("signup info", "public_signup_info", { code: "abcdefgh2345" });
await c("signup submit", "public_signup_submit", { code: "abcdefgh2345", name: "Self Signer", phone: "9600000001", emergencyContact: "9600000002", course: "CA", referralSource: "instagram", website: "" });
await c("no token", "list_branches", {});
await c("unknown", "no_such_action", {}, tO);

// reads (owner, staff, other-branch staff)
for (const [lbl, tok] of [["owner", tO], ["staff", tP], ["other", tR], ["admin", tA]] as const) {
  await c(`whoami ${lbl}`, "whoami", {}, tok);
  await c(`list_branches ${lbl}`, "list_branches", B, tok);
  await c(`dashboard ${lbl}`, "get_dashboard", B, tok);
  await c(`profile ${lbl}`, "get_student_profile", { studentId: asha.id }, tok);
  await c(`active members ${lbl}`, "list_active_memberships", B, tok);
}
const reads: [string, any][] = [
  ["list_transfer_branches", B], ["list_transfer_desks", B], ["get_recent_activity", { ...B, date: TODAY }],
  ["get_seat_map", { ...B, shift: "morning" }], ["get_combined_hall", {}], ["get_combined_seatmap", { date: TODAY }], ["get_combined_pending", { date: TODAY }],
  ["lookup_student", { phone: "9100000001" }], ["lookup_student", { phone: "9999999999" }], ["search_students_by_name", { ...B, query: "as" }],
  ["get_student_study_report", { studentId: asha.id, dateFrom: D(-5), dateTo: TODAY }], ["list_signup_requests", B], ["list_signup_requests", { allBranches: true }],
  ["get_signup_link", B], ["get_permanent_waitlist", B], ["get_locker_status", B], ["list_lockers", B],
  ["get_locker_removal_summary", { lockerId: lockerFarah.id }], ["list_students", B], ["list_students", { allBranches: true }],
  ["get_top_students", { ...B, sortBy: "hours", period: "month" }], ["list_cashbacks", B], ["get_food_pass", { studentId: farah.id }],
  ["list_food_items", B], ["list_inventory_items", B], ["list_inventory_log", B], ["list_food_bills", { ...B, dateFrom: D(-7), dateTo: TODAY }],
  ["get_revenue", { ...B, ...range }], ["get_revenue", { allBranches: true, period: "today" }], ["get_referral_stats", B],
  ["get_discounts_waivers", { ...B, ...range }], ["list_transactions", { ...B, ...range }], ["get_daily_report", { ...B, date: TODAY }],
  ["list_fee_config", {}], ["get_welcome_template", {}], ["list_staff", {}], ["get_staff_grid", { staffId: priya.id, branchId: b1.id }],
  ["list_branch_staff", B], ["list_tasks", { ...B, date: TODAY }], ["get_my_tasks_today", { ...B, date: TODAY }],
  ["get_task_completion_report", { ...B, date: TODAY }], ["list_incomplete_tasks", B], ["list_messages", { ...B, channel: "branch" }],
  ["list_messages", { allBranches: true }], ["list_alerts", B], ["get_actionable_items", B], ["list_today_bookings", B],
  ["get_membership_closure_summary", { membershipId: mChitra.id }], ["get_membership_delete_summary", { membershipId: mGita.id }],
  ["list_enquiries", B], ["list_enquiry_activities", { enquiryId: enq1.id }], ["list_enquiry_followups", { enquiryId: enq1.id }],
  ["list_open_enquiry_followups", B],
];
for (const [a, p] of reads) await c(`read ${a}`, a, p, tO);
for (const [a, p] of reads.slice(0, 20)) await c(`read-staff ${a}`, a, p, tP);
await c("staff attendance (pw)", "list_staff_attendance", { password: "pw" }, tO);

// sessions
await c("walk-in", "create_walkin", { ...B, name: "Walk Two", phone: "9700000001", hours: 3, paymentMode: "cash", deskId: desks[4].id }, tO);
await c("walk-in staff", "create_walkin", { ...B, name: "Walk Two", phone: "9700000001", hours: 3, paymentMode: "split", cashAmount: 20, upiAmount: 15, deskId: desks[5].id }, tP);
await c("check-in Deepa", "check_in_member", { ...B, studentId: deepa.id, deskId: desks[2].id }, tP);
await c("check-in again", "check_in_member", { ...B, studentId: deepa.id, deskId: desks[2].id }, tP);
await c("check-in expired", "check_in_member", { ...B, studentId: chitra.id, deskId: desks[5].id }, tP);
await c("pause session", "pause_session", { bookingId: bookingAsha.id }, tP);
advanceClock(10 * 60_000);
await c("resume session", "resume_session", { bookingId: bookingAsha.id }, tP);
await c("add attendance", "add_attendance", { ...B, studentId: hari.id, startTime: ist(D(-1), "09:00"), endTime: ist(D(-1), "12:00") }, tO);
await c("add attendance overlap", "add_attendance", { ...B, studentId: asha.id, startTime: ist(D(-1), "10:00"), endTime: ist(D(-1), "11:00") }, tO);
await c("update attendance", "update_attendance", { bookingId: walkinBooking.id, startTime: ist(TODAY, "08:00"), endTime: ist(TODAY, "10:30"), hours: 2.5, status: "active" }, tO);
advanceClock(60 * 60_000); // 12:10 IST: Asha's 6 h session (ended 11:00 + 10 min pause) is in overtime
await c("food bill on pass", "create_food_bill", { ...B, studentId: farah.id, items: [{ foodItemId: tea.id, quantity: 2 }, { foodItemId: sandwich.id, quantity: 1 }], paymentMode: "cash" }, tP);
await c("food bill walk-in", "create_food_bill", { ...B, studentName: "Guest", studentPhone: "9800000001", items: [{ foodItemId: tea.id, quantity: 1 }], paymentMode: "upi", discountType: "flat", discountValue: 5, discountAmount: 5 }, tP);
await c("food bill too many", "create_food_bill", { ...B, items: [{ foodItemId: sandwich.id, quantity: 99 }], paymentMode: "cash" }, tP);
await c("food bill for session", "create_food_bill", { ...B, studentId: asha.id, bookingId: bookingAsha.id, items: [{ foodItemId: tea.id, quantity: 1 }], paymentMode: "cash", skipFoodPass: true }, tP);
await c("checkout Asha overtime", "checkout_booking", { bookingId: bookingAsha.id, overtimeMinutes: 70, overtimePaymentMode: "cash", overtimePayNow: true }, tP);
await c("checkout twice", "checkout_booking", { bookingId: bookingAsha.id, overtimeMinutes: 70 }, tP);
await c("checkout walk-in", "checkout_booking", { bookingId: walkinBooking.id, overtimeMinutes: 0 }, tP);
await c("collect shortfall", "collect_food_bill_shortfall", { billId: unpaidBill.id, paymentMode: "cash" }, tO);
await c("overtime omit no reason", "set_overtime_excluded", { overtimeSessionId: ot.id, excluded: true }, tO);
await c("overtime omit", "set_overtime_excluded", { overtimeSessionId: ot.id, excluded: true, reason: "clock late" }, tO);

// memberships
await c("create membership", "create_membership", { ...B, name: "New Member", phone: "9110000001", category: "temporary", hoursPerDay: 6, monthsPaid: 3, paymentMode: "cash", emergencyContact: "9110000002", referralSource: "google_search", course: "NEET", withLocker: true, lockerNo: "5", advanceAmount: null }, tP);
await c("create membership dup", "create_membership", { ...B, name: "Asha Rao", phone: "9100000001", category: "temporary", hoursPerDay: 6, monthsPaid: 1, paymentMode: "cash", emergencyContact: "9110000002", referralSource: "flex" }, tP);
await c("create permanent", "create_membership", { ...B, name: "Perm One", phone: "9110000003", category: "permanent", hoursPerDay: 12, monthsPaid: 1, paymentMode: "upi", emergencyContact: "9110000004", referralSource: "word_of_mouth", deskId: desks[5].id, advanceAmount: 1000 }, tO);
await c("create from signup (not claimed)", "create_membership", { ...B, name: "New Student", phone: "9400000001", category: "temporary", hoursPerDay: 4, monthsPaid: 1, paymentMode: "cash", emergencyContact: "9400000002", referralSource: "flex", signupId: signupReq.id }, tR);
await c("claim signup", "claim_signup_request", { id: signupReq.id }, tP);
await c("claim signup other", "claim_signup_request", { id: signupReq.id }, tO);
await c("create from signup", "create_membership", { ...B, name: "New Student", phone: "9400000001", category: "temporary", hoursPerDay: 4, monthsPaid: 1, paymentMode: "cash", emergencyContact: "9400000002", referralSource: "flex", signupId: signupReq.id }, tP);
const selfReq = rows("signup_requests").find((r) => r.phone === "9600000001");
await c("release signup", "release_signup_request", { id: selfReq?.id }, tP);
await c("deny signup", "deny_signup_request", { id: selfReq?.id }, tP);
await c("rotate link staff", "rotate_signup_link", B, tP);
await c("rotate link owner", "rotate_signup_link", B, tO);
await c("renew early", "renew_membership", { membershipId: mDeepa.id, monthsPaid: 1, paymentMode: "cash", category: "temporary", hoursPerDay: 6, expectedTotal: 1150 }, tP);
await c("renew early again", "renew_membership", { membershipId: mDeepa.id, monthsPaid: 1, paymentMode: "cash", category: "temporary", hoursPerDay: 6 }, tP);
const newDeepa = rows("memberships").find((m) => m.student_id === deepa.id && m.is_active);
await c("change plan in gap", "change_membership_plan", { membershipId: newDeepa?.id, newCategory: "temporary", newHoursPerDay: 8 }, tO);
await c("cancel early renewal", "cancel_early_renewal", { membershipId: newDeepa?.id, reason: "mistake" }, tO);
await c("renew grace", "renew_membership", { membershipId: mEsha.id, monthsPaid: 1, paymentMode: "upi", category: "temporary", hoursPerDay: 8, expectedTotal: 1500 }, tP);
await c("record payment", "record_payment", { membershipId: mFarah.id, amount: 300, paymentMode: "split", cashAmount: 100, upiAmount: 200 }, tP);
await c("record payment bad split", "record_payment", { membershipId: mFarah.id, amount: 100, paymentMode: "split", cashAmount: 10, upiAmount: 20 }, tP);
await c("loyalty discount", "apply_loyalty_discount", { membershipId: mHari.id, discountType: "fixed", discountValue: 100, remarks: "top" }, tO);
await c("loyalty discount 150%", "apply_loyalty_discount", { membershipId: mHari.id, discountType: "percent", discountValue: 150 }, tO);
await c("grant cashback", "grant_cashback", { studentId: hari.id, branchId: b1.id, cashbackType: "percent", cashbackValue: 10, monthLabel: "Oct 2026" }, tO);
await c("redeem cashback now", "redeem_cashback_now", { studentId: hari.id }, tO);
await c("manual payment", "add_manual_payment", { studentId: hari.id, date: TODAY, reason: "fine", amount: 50, paymentMode: "cash" }, tO);
await c("pause membership", "pause_membership", { membershipId: mHari.id }, tP);
advanceClock(24 * 3600_000);
await c("resume membership", "resume_membership", { membershipId: mHari.id }, tP);
await c("change plan", "change_membership_plan", { membershipId: mHari.id, newCategory: "temporary", newHoursPerDay: 8 }, tO);
await c("change cabin", "change_membership_cabin", { membershipId: mBala.id, deskId: desks[3].id }, tO);
await c("transfer branch", "transfer_student_branch", { studentId: hari.id, newBranchId: b2.id }, tO);
await c("update student", "update_student_details", { studentId: farah.id, name: "Farah Ali Khan", phone: "9100000006", emergencyContact: "9000000001", course: "CA", referralSource: "instagram" }, tP);
await c("fix dates", "fix_membership_dates", {}, tO);
await c("fix food pass", "fix_negative_food_pass_balances", {}, tO);
await c("topup food pass", "topup_food_pass", { studentId: farah.id, branchId: b1.id, amount: 200, paymentMode: "upi" }, tP);

// lockers
await c("add locker", "add_locker", { studentId: asha.id, branchId: b1.id, lockerNo: "7", paymentMode: "cash" }, tP);
const lockerAsha = rows("lockers").find((l) => l.student_id === asha.id && l.is_active);
await c("locker payment", "record_locker_payment", { lockerId: lockerFarah.id, amount: 100, paymentMode: "cash" }, tP);
await c("renew locker", "renew_locker", { lockerId: lockerFarah.id, paymentMode: "upi" }, tP);
await c("locker due date", "update_locker_due_date", { lockerId: lockerFarah.id, dueDate: D(40) }, tO);
await c("locker number", "update_locker_number", { lockerId: lockerFarah.id, lockerNo: "4" }, tO);
await c("remove locker", "remove_locker", { lockerId: lockerAsha?.id, paymentMode: "cash", withholdDeposit: false }, tO);

// settlements
await c("quit no mode", "close_membership", { membershipId: mChitra.id }, tO);
await c("quit waive no reason", "close_membership", { membershipId: mChitra.id, paymentMode: "cash", waiveOverstayCharge: true }, tO);
await c("quit", "close_membership", { membershipId: mChitra.id, paymentMode: "cash" }, tO);
await c("delete early", "delete_membership", { membershipId: mGita.id, reason: "moving", paymentMode: "cash" }, tO);
await c("delete staff", "delete_membership", { membershipId: mBala.id, reason: "x" }, tP);

// waitlist, food menu, inventory
await c("join waitlist", "join_permanent_waitlist", { ...B, name: "Wait Two", phone: "9300000002", hoursPerDay: 12 }, tP);
await c("remove waitlist", "remove_from_waitlist", { waitlistId: waitlist.id, status: "converted" }, tP);
await c("create food item", "create_food_item", { ...B, name: "Coffee", price: 20 }, tO);
await c("update food item", "update_food_item", { itemId: tea.id, price: 18 }, tO);
await c("add inventory", "add_inventory_item", { ...B, name: "Milk", addQuantity: 5 }, tP);
await c("avail inventory", "avail_inventory_item", { itemId: inv.id, quantity: 3 }, tP);

// branch, staff, settings
await c("update branch", "update_branch", { branchId: b1.id, lockerCapacity: 25 }, tO);
await c("update branch staff", "update_branch", { branchId: b1.id, lockerCapacity: 1 }, tP);
await c("add desk", "add_desk", { ...B, label: "C7" }, tO);
await c("remove desk", "remove_desk", { deskId: desks[4].id }, tO);
const feeRow = rows("fee_config").find((f) => f.config_type === "walkin");
await c("update fee", "update_fee_config", { id: feeRow.id, fee: 40 }, tO);
await c("update template", "update_welcome_template", { value: "Hello {name}" }, tO);
await c("create staff", "create_staff", { username: "newstaff", password: "secret1", displayName: "New", role: "staff", branchId: b1.id }, tO);
await c("update staff", "update_staff", { staffId: ravi.id, displayName: "Ravi K" }, tO);
await c("override", "assign_staff_override", { staffId: ravi.id, branchId: b1.id }, tO);
await c("clear override", "clear_staff_override", { staffId: ravi.id }, tO);
await c("create task", "create_task", { ...B, assignedToStaffIds: [priya.id], title: "Refill water", repeatInterval: "once", dueDate: TODAY }, tO);
await c("update task", "update_task_status", { taskId: task.id, done: true, date: TODAY }, tP);
await c("send message", "send_message", { ...B, channel: "branch", recipientType: "staff", content: "Hi" }, tP);
await c("resolve alert", "resolve_alert", { alertId: alert.id }, tP);

// enquiries
await c("create enquiry", "create_enquiry", { ...B, name: "Lead", phone: "9200000003", source: "walk_in", message: "Morning?" }, tP);
await c("update enquiry", "update_enquiry", { id: enq1.id, fields: { status: "contacted" } }, tP);
await c("add activity", "add_enquiry_activity", { enquiryId: enq1.id, type: "call", note: "Spoke" }, tP);
await c("add followup", "add_enquiry_followup", { enquiryId: enq1.id, note: "Visit", dueAt: ist(D(2), "11:00") }, tP);
await c("update followup", "update_enquiry_followup", { id: fu.id, fields: { done: true } }, tP);
await c("delete enquiries", "delete_enquiries", { ids: [enq2.id] }, tO);

// end of day
await c("end session (staff)", "end_staff_session", { password: "pw" }, tP);
await c("after end session", "whoami", {}, tP);

// ── compare ───────────────────────────────────────────────────────────────────
const sortKeys = (v: any): any => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const tables = Object.fromEntries(Object.keys(fake.tables).sort().map((t) => [t, fake.tables[t]]));
const actual = sortKeys({ calls: log, tables });
const actualText = JSON.stringify(actual, null, 1);

const covered = new Set(log.map((l) => l.action));
console.log(`${log.length} calls covering ${covered.size} actions`);

let expectedText: string | null = null;
try { expectedText = await Deno.readTextFile(SNAPSHOT); } catch { /* none yet */ }
if (UPDATE || expectedText === null) {
  await Deno.writeTextFile(SNAPSHOT, actualText + "\n");
  console.log(`golden snapshot ${expectedText === null ? "created" : "updated"}: ${SNAPSHOT.pathname}`);
} else if (expectedText.trimEnd() === actualText) {
  console.log("all passed (golden master identical)");
} else {
  const exp = JSON.parse(expectedText);
  let shown = 0;
  const n = Math.max(exp.calls.length, actual.calls.length);
  for (let i = 0; i < n && shown < 8; i++) {
    const a = JSON.stringify(actual.calls[i]), e = JSON.stringify(exp.calls[i]);
    if (a !== e) { shown++; console.log(`FAIL - call #${i} ${actual.calls[i]?.label ?? exp.calls[i]?.label}\n  expected ${e?.slice(0, 600)}\n  actual   ${a?.slice(0, 600)}`); }
  }
  for (const t of new Set([...Object.keys(exp.tables), ...Object.keys(actual.tables)])) {
    if (shown >= 12) break;
    if (JSON.stringify(exp.tables[t]) !== JSON.stringify(actual.tables[t])) { shown++; console.log(`FAIL - table ${t} differs (${exp.tables[t]?.length ?? 0} → ${actual.tables[t]?.length ?? 0} rows)`); }
  }
  console.log("\ngolden master differs — if the change is intended, re-record with: npm run test:server -- golden --update");
  Deno.exit(1);
}
