// Database helpers and constants used by the api actions (ledger writes, student status, sign-up
// codes, sessions, alerts…). Moved unchanged from api/index.ts in PSS-AI P0.4.
// deno-lint-ignore-file no-explicit-any
import { IST_OFFSET_MS, addDays, daysBetween, endDateForMonths, istDayStart, toISTDateStr, todayISO } from "../_shared/dates.ts";
import { computeStudentStatus } from "../_shared/membership.ts";
import { type SettlementOwed, settlementIncomeRows } from "../_shared/settlement.ts";
import { overstayFromLastVisit } from "../_shared/overstay.ts";
import { adminClient } from "../_shared/auth.ts";

// Temporary dev-mode switch, code-level only (no UI toggle) — flip and redeploy to turn its
// gated behaviors on/off. Currently: lets join_permanent_waitlist succeed even when the
// branch has vacant permanent seats. Matching frontend switch is src/lib/devMode.js.
export const DEV_MODE = false;

export async function getOwnerStaffIds(db: ReturnType<typeof adminClient>): Promise<string[]> {
  const { data } = await db.from("staff").select("id").eq("role", "owner");
  return (data ?? []).map(r => r.id);
}

// admin is invisible to owner everywhere a staff list/grid/picker is built — the Staff tab,
// the branch grid, attendance, task-assignment pickers, all of it. Every query that lists
// staff for owner or staff-member consumption chains a plain .neq("role", "admin") — inline,
// not through a shared wrapper, because the Supabase query builder's generics don't survive
// being passed through an intermediate function without losing every later-chained method's
// return type. Never applied to the admin's own login/session lookup in authStaff, which has
// to find the row to authenticate it in the first place.

// Hopes branch lockers aren't numbered 1..capacity — the physical units are labeled
// 1-10, then 25-46, then 63-75 (45 lockers total), so the assignable numbers must
// follow those gaps instead of a plain sequential range.
export const HOPES_LOCKER_RANGES: [number, number][] = [[1, 10], [25, 46], [63, 75]];

export function lockerNumberSequence(branchName: string | undefined | null, capacity: number): string[] {
  if (branchName === "Hopes") {
    const numbers: string[] = [];
    for (const [start, end] of HOPES_LOCKER_RANGES) {
      for (let i = start; i <= end; i++) numbers.push(String(i));
    }
    return numbers.slice(0, capacity);
  }
  const numbers: string[] = [];
  for (let i = 1; i <= capacity; i++) numbers.push(String(i));
  return numbers;
}

// Fallback only — used if the app_settings row is ever missing (e.g. a fresh DB before the
// seed insert ran). The row from migration 048 is the actual source of truth once it exists.
export const DEFAULT_WELCOME_TEMPLATE = `Hi {name}, welcome to Perfect Study Space! 🎉

Thanks for joining us — we're excited to have you with us. Please take a moment to fill out this form so we can complete your registration:

📝 Fill out the form here:
https://docs.google.com/forms/d/e/1FAIpQLSeolzoVIDAsOq35SZ0MbsJb1qBrBcInBG4VER6As5yc8A0oEA/viewform?usp=header

If you have any questions, feel free to reach out anytime. We're happy to help! 😊`;

// A recurring task's "anchor" is its due_date (or, failing that, the day it was created).
// daily tasks are due every day from the anchor onward; weekly/monthly repeat on the
// anchor's weekday / day-of-month.
export function isTaskDueOn(task: { repeat_interval: string; due_date: string | null; created_at: string; status?: string }, dateStr: string): boolean {
  const anchor = task.due_date ?? toISTDateStr(task.created_at);
  if (task.repeat_interval === "none") return anchor === dateStr && task.status !== "done";
  if (anchor > dateStr) return false;
  if (task.repeat_interval === "daily") return true;
  const anchorDate = new Date(anchor + "T12:00:00");
  const target = new Date(dateStr + "T12:00:00");
  if (task.repeat_interval === "weekly") return anchorDate.getDay() === target.getDay();
  if (task.repeat_interval === "monthly") return anchorDate.getDate() === target.getDate();
  return false;
}

export function dateRange(period: string, dateFrom?: string, dateTo?: string) {
  const today = todayISO(); // IST calendar date
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    // The last 7 IST days including today (today-6 … today), derived from the IST date
    // itself (not the server's UTC clock) so the window doesn't shift by a day near IST
    // midnight. This was today-7 … today — 8 days — under a "Last 7 days" label.
    return { from: addDays(today, -6), to: today };
  }
  if (period === "month") {
    // First of the current IST month.
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  return { from: dateFrom ?? today, to: dateTo ?? today };
}

// Date range for a Revenue/transactions request: explicit dates always win. The Revenue page
// used to send its applied custom dates with no period, and `dateRange(period ?? "today", …)`
// then returned today and ignored them — every custom range silently showed today's figures.
export function requestedRange(period: string | undefined, dateFrom?: string, dateTo?: string) {
  if (dateFrom != null || dateTo != null) return dateRange("custom", dateFrom, dateTo);
  return dateRange(period ?? "today");
}

export function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// PostgREST caps every response at the project's max-rows setting (1000 on Supabase by
// default) and truncates silently — no error, just fewer rows. A report that sums rows over
// an open-ended range (a month of transactions across every branch passes 1000 easily)
// would under-report with nothing to show anything was missing, so those queries page
// through with .range() until a page comes back empty. Pages advance by however many rows
// actually arrived, so this stays correct even if max-rows is set below pageSize. The query
// must carry a deterministic .order() (ties broken by id) or pages can overlap or skip rows.
// deno-lint-ignore no-explicit-any
export async function fetchAllRows<T = Record<string, any>>(buildQuery: () => any, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await buildQuery().range(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

// Splits a [from, to] range into day-sized or week-sized buckets for trend charts — a
// "week" period buckets by day, a "month" period buckets by week (otherwise a month view
// would be a cramped 30-bar chart), and "custom" picks whichever keeps the bar count sane.
export function buildDateBuckets(from: string, to: string, granularity: "day" | "week") {
  const buckets: { label: string; start: string; end: string }[] = [];
  if (granularity === "day") {
    let d = from;
    while (d <= to) {
      buckets.push({ label: d, start: d, end: d });
      d = addDays(d, 1);
    }
  } else {
    let start = from;
    while (start <= to) {
      const end = addDays(start, 6) > to ? to : addDays(start, 6);
      buckets.push({ label: `${start} – ${end}`, start, end });
      start = addDays(end, 1);
    }
  }
  return buckets;
}

export async function getWalkinFee(db: ReturnType<typeof adminClient>, hours: number): Promise<number> {
  const { data } = await db.from("fee_config").select("*").eq("config_type", "walkin").order("max_hours");
  if (!data?.length) {
    if (hours <= 3) return 35;
    if (hours <= 6) return 60;
    if (hours <= 8) return 80;
    return 100;
  }
  for (const tier of data) {
    if (hours <= tier.max_hours) return Number(tier.fee);
  }
  return Number(data[data.length - 1].fee);
}

export async function getMembershipPackage(db: ReturnType<typeof adminClient>, hoursPerDay: number, category: string) {
  const { data } = await db.from("fee_config").select("*")
    .eq("config_type", "membership").eq("cabin_type", category).eq("hours_per_day", hoursPerDay).maybeSingle();
  if (data) return Number(data.fee);
  const defaults: Record<string, Record<number, number>> = {
    temporary: { 2: 500, 3: 650, 4: 800, 5: 1000, 6: 1250, 8: 1500 },
    permanent: { 12: 2100, 13: 2200, 14: 2300, 15: 2400, 24: 2500 },
  };
  return defaults[category]?.[hoursPerDay] ?? 0;
}

// A student can bank up multiple pending cashbacks (one per month, granted independently)
// and redeem them all together against a single renewal/closure — this sums every pending
// cashback's value, capped to `base` (scaled down proportionally if the sum exceeds it),
// and returns per-row contributions so callers can stamp each cashback row as consumed.
export async function settlePendingCashbacks(db: ReturnType<typeof adminClient>, studentId: string, base: number) {
  const { data: pending } = await db.from("cashbacks").select("*").eq("student_id", studentId).eq("status", "pending");
  const raw = (pending ?? []).map((c: { id: string; cashback_type: string; cashback_value: number }) => ({
    id: c.id,
    amount: c.cashback_type === "percent" ? base * (Number(c.cashback_value) / 100) : Number(c.cashback_value),
  }));
  const totalRaw = raw.reduce((s, c) => s + c.amount, 0);
  const cashbackAmount = Math.min(totalRaw, base);
  const scale = totalRaw > 0 ? cashbackAmount / totalRaw : 0;
  const contribs = raw.map(c => ({ id: c.id, amount: Math.round(c.amount * scale * 100) / 100 }));
  return { cashbackAmount, contribs };
}

export async function upsertStudent(db: ReturnType<typeof adminClient>, name: string, phone: string, branchId: string, extra: Record<string, unknown> = {}): Promise<{ id: string; isNew: boolean }> {
  const { data: existing } = await db.from("students").select("id").eq("phone", phone).maybeSingle();
  if (existing) {
    await db.from("students").update({ name, branch_id: branchId, ...extra, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return { id: existing.id, isNew: false };
  }
  const { count } = await db.from("students").select("*", { count: "exact", head: true });
  const { data: s, error } = await db.from("students").insert({
    name, phone, branch_id: branchId, s_no: (count ?? 0) + 1, status: "pending", ...extra,
  }).select("id").single();
  if (error) {
    // Unique-violation on `phone` means a concurrent request just created this student — attach to it instead of failing.
    if (error.code === "23505") {
      const { data: raced } = await db.from("students").select("id").eq("phone", phone).single();
      if (raced) {
        await db.from("students").update({ name, branch_id: branchId, ...extra, updated_at: new Date().toISOString() }).eq("id", raced.id);
        return { id: raced.id, isNew: false };
      }
    }
    throw new Error(error.message);
  }
  return { id: s!.id, isNew: true };
}


export async function refreshStudentStatus(db: ReturnType<typeof adminClient>, studentId: string) {
  const today = todayISO();
  const { data: mem } = await db.from("memberships").select("*")
    .eq("student_id", studentId).eq("is_active", true).order("end_date", { ascending: false }).limit(1).maybeSingle();
  const { data: locker } = await db.from("lockers").select("locker_due_date, fee_due")
    .eq("student_id", studentId).eq("is_active", true).maybeSingle();
  const status = computeStudentStatus(mem, locker, today);
  await db.from("students").update({ status, updated_at: new Date().toISOString() }).eq("id", studentId);
}

// A "split" payment isn't a real payment_mode value (the DB enum is only cash/upi/other),
// it's a UI convenience meaning "part cash, part UPI" — so it becomes two real transaction
// rows here (one per mode actually used), while the parent record (membership/locker/etc,
// whose own payment_mode column is the same restricted enum) just stores "other" for it.
export function storedPaymentMode(paymentMode?: string | null): string {
  return paymentMode === "split" ? "other" : (paymentMode ?? "cash");
}

// Every write to the revenue ledger (transactions = money in, payouts = money handed back)
// goes through these two. supabase-js reports a failed insert in its return value rather
// than throwing, and the call sites used to ignore it — so a rejected row (a category or
// payment mode the enum doesn't have, a dropped connection) vanished from Revenue with no
// trace while the rest of the action reported success. Failing loudly lets staff see the
// payment wasn't saved instead of the books silently coming up short.
export async function recordTransaction(db: ReturnType<typeof adminClient>, row: Record<string, unknown>) {
  const { error } = await db.from("transactions").insert(row);
  if (error) {
    console.error("transactions insert failed:", error.message, JSON.stringify(row));
    throw new Error(`The ₹${row.amount} ${row.category} payment could not be saved to the ledger (${error.message}). Note it down and add it from the student's Payment History.`);
  }
}

// RSP W2 — append-only log of money forgiven (overstay waived, overtime omitted/restored): who,
// how much and why. These two waivers used to leave no record at all.
export async function recordWaiver(db: ReturnType<typeof adminClient>, row: Record<string, unknown>) {
  const { error } = await db.from("waivers").insert(row);
  if (error) {
    console.error("waivers insert failed:", error.message, JSON.stringify(row));
    throw new Error(`The waiver could not be logged (${error.message}).`);
  }
}

// ─── SSP: self sign-up helpers ───
// Longest period the study-report WhatsApp message may cover (a line per day must fit in a wa.me link).
export const STUDY_REPORT_MAX_DAYS = 60;
export const SIGNUP_CLAIM_MINUTES = 15;
// Spam ceiling: a branch never legitimately has this many students waiting at the desk at once.
export const SIGNUP_PENDING_LIMIT = 50;
export const SIGNUP_REFERRALS = ["google_search", "instagram", "word_of_mouth", "flex", "ai_platform"];
// 32 symbols, so a random byte maps onto them without bias; no i/l/o/u to misread.
export const CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function randomCode(length: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
export const newSignupLinkCode = () => randomCode(12, CODE_ALPHABET);
export const newSignupRef = () => randomCode(4, "0123456789ABCDEF");
export const isSignupLinkCode = (v: unknown): v is string => typeof v === "string" && /^[0-9a-z]{12}$/.test(v);
export const signupClaimCutoff = () => new Date(Date.now() - SIGNUP_CLAIM_MINUTES * 60_000).toISOString();

// A sign-up not handled by the end of the IST day it was sent on is deleted (SSP decision 2).
// Run lazily wherever sign-ups are read or written instead of on a schedule.
export async function purgeExpiredSignups(db: ReturnType<typeof adminClient>) {
  // PSS-AI A3: a sign-up whose payment waits for the owner is kept until its keep_until (moved on
  // each time a proof is sent). An ID photo of a sign-up that was never registered goes with it.
  const { data: gone } = await db.from("signup_requests").delete().lt("created_at", istDayStart(todayISO()))
    .or(`keep_until.is.null,keep_until.lt.${new Date().toISOString()}`)
    // The .or() column must be selected too, or PostgREST 12.2 refuses the delete.
    .select("id_photo_path, keep_until");
  const photos = (gone ?? []).map((r: { id_photo_path: string | null }) => r.id_photo_path).filter((p: string | null): p is string => !!p);
  if (photos.length) await db.storage.from("id-photos").remove(photos);
}

// Same checks as New Registration, so staff never have to fix what the student typed.
export function validateSignupFields(p: Record<string, unknown>):
  { error: string } | { name: string; phone: string; emergencyContact: string; course: string | null; referralSource: string } {
  const name = String(p.name ?? "").trim().replace(/\s+/g, " ");
  const phone = String(p.phone ?? "").trim();
  const emergencyContact = String(p.emergencyContact ?? "").trim();
  const course = String(p.course ?? "").trim().replace(/\s+/g, " ");
  const referralSource = String(p.referralSource ?? "");
  if (!name) return { error: "Please enter your full name" };
  if (name.length > 80) return { error: "Name is too long (80 characters max)" };
  if (name.split(" ").length < 2) return { error: "Please enter your full name (first and last name)" };
  if (!/^\d{10}$/.test(phone)) return { error: "Phone must be a 10 digit number" };
  if (!/^\d{10}$/.test(emergencyContact)) return { error: "Emergency contact must be a 10 digit phone number" };
  if (phone === emergencyContact) return { error: "Emergency contact must be a different number from your own" };
  if (course.length > 80) return { error: "Course is too long (80 characters max)" };
  if (!SIGNUP_REFERRALS.includes(referralSource)) return { error: "Please tell us how you heard about us" };
  return { name, phone, emergencyContact, course: course || null, referralSource };
}

// Takes the "being handled" lock on a pending sign-up for this staff member. Each step is a
// single conditional UPDATE, so when two people press Approve together exactly one wins: free
// → mine, already mine → refreshed, someone else's but older than 15 minutes → taken over.
export async function claimSignup(db: ReturnType<typeof adminClient>, id: string, staffId: string) {
  const now = new Date().toISOString();
  const attempts = [
    (q: any) => q.is("claimed_by_staff_id", null),
    (q: any) => q.eq("claimed_by_staff_id", staffId),
    (q: any) => q.lt("claimed_at", signupClaimCutoff()),
  ];
  for (const narrow of attempts) {
    const { data } = await narrow(db.from("signup_requests").update({ claimed_by_staff_id: staffId, claimed_at: now }).eq("id", id)).select("*");
    if (data?.length) return data[0];
  }
  return null;
}

// Why a claim/deny failed, in words for the staff member.
export async function signupBusyMessage(db: ReturnType<typeof adminClient>, id: string): Promise<string> {
  const { data } = await db.from("signup_requests").select("id, staff:claimed_by_staff_id(display_name, username)").eq("id", id).maybeSingle();
  if (!data) return "This sign-up was already handled by someone else (or has expired).";
  const who = (data.staff as unknown as { display_name?: string; username?: string } | null);
  return `This sign-up is being handled by ${who?.display_name || who?.username || "another staff member"}.`;
}

export async function recordPayout(db: ReturnType<typeof adminClient>, row: Record<string, unknown>) {
  const { error } = await db.from("payouts").insert(row);
  if (error) {
    console.error("payouts insert failed:", error.message, JSON.stringify(row));
    throw new Error(`The ₹${row.amount} refund (${row.payout_type}) could not be saved to the ledger (${error.message}). Note it down and report it.`);
  }
}

export async function recordSettlementIncome(
  db: ReturnType<typeof adminClient>,
  base: { student_id: string; branch_id: string; membership_id: string; created_by_staff_id: string },
  s: SettlementOwed, paymentMode: string | undefined, label: string,
) {
  for (const row of settlementIncomeRows(s, paymentMode, label)) {
    await recordTransaction(db, { ...base, ...row });
  }
}

// RSP O1–O3 — overstay after a plan ends, for Quit and for Delete-after-expiry. Counted from the
// day after end_date up to the student's LAST MEMBER CHECK-IN after it (walk-in visits were paid
// for separately and don't count); ₹0 if they never came back. Check-in is refused once the
// MEMBERSHIP_GRACE_DAYS grace is over, so this naturally stops at 10 days — capped here as well.
// It used to charge every day since expiry, even weeks after the student could no longer get in.
// Rate is the plan's normal daily rate, monthly fee ÷ 30.
// The maths is overstayFromLastVisit (_shared/overstay.ts); this only looks up the last visit.
export async function computeOverstay(db: ReturnType<typeof adminClient>, mem: { student_id: string; end_date: string; monthly_fee: number }) {
  const today = todayISO();
  if (mem.end_date >= today) return overstayFromLastVisit(mem, null, today);
  const { data, error } = await db.from("bookings").select("start_time")
    .eq("student_id", mem.student_id).neq("booking_type", "walkin").neq("status", "cancelled")
    .gte("start_time", istDayStart(addDays(mem.end_date, 1)))
    .order("start_time", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const lastVisitDate = data?.[0] ? toISTDateStr(data[0].start_time) : null;
  return overstayFromLastVisit(mem, lastVisitDate, today);
}

// Food bills a student ran up without paying (no Food Pass, or more than the pass held).
// Checkout lets a member carry these for up to 3 days, so a membership can end with some
// still open — closing/deleting it now collects them in the final settlement instead of
// the food simply never being paid for.
export async function unpaidFoodBillsFor(db: ReturnType<typeof adminClient>, studentId: string) {
  const { data, error } = await db.from("food_bills").select("id, total").eq("student_id", studentId).eq("paid", false);
  if (error) throw new Error(error.message);
  const bills = (data ?? []) as { id: string; total: number }[];
  return { bills, total: Math.round(bills.reduce((sum, b) => sum + Number(b.total), 0) * 100) / 100 };
}

// F-1 (PSS-AI): the split rule insertPaymentTransactions enforces, checked before a handler writes
// anything, so a cash + UPI split that doesn't add up is refused with nothing changed instead of
// failing half-way. Same rounding and message as insertPaymentTransactions, which is unchanged.
export function splitPaymentError(paymentMode: string | undefined, amount: number, cashAmount?: number | string, upiAmount?: number | string): string | null {
  if (!(Number(amount) > 0) || paymentMode !== "split") return null;
  const cash = Math.round((Number(cashAmount) || 0) * 100) / 100;
  const upi = Math.round((Number(upiAmount) || 0) * 100) / 100;
  return Math.round((cash + upi) * 100) !== Math.round(Number(amount) * 100) ? "Cash + UPI amounts must add up to the total" : null;
}

// F-2/F-3 (PSS-AI): memberships whose end date matches neither way a plan is sold — by months
// (endDateForMonths) or by a custom number of days (start + plan_days − 1) — each plus hold days.
// Reads every row (paged past the 1,000-row default). Memberships whose end date was set by hand
// (a successful change_membership_plan event with newEndDate) are left out. The expected date
// follows the rule the plan was sold under: its own length (plan_days) decides.
export async function membershipDateDrift(db: ReturnType<typeof adminClient>) {
  const memberships = await fetchAllRows<any>(() => db.from("memberships")
    .select("id, branch_id, start_date, months_paid, plan_days, hold_days, end_date").order("id"));
  let edited = new Set<string>();
  try {
    const changes = await fetchAllRows<any>(() => db.from("events").select("id, payload")
      .eq("action", "change_membership_plan").eq("ok", true).order("id"));
    edited = new Set(changes.filter((e) => e.payload?.newEndDate).map((e) => e.payload?.membershipId).filter(Boolean));
  } catch { /* no event log yet (migration 052): nothing is known to be hand-edited */ }
  const drift: { membership_id: string; branch_id: string; end_date: string; expected_end_date: string }[] = [];
  for (const m of memberships) {
    if (edited.has(m.id)) continue;
    const holds = Number(m.hold_days ?? 0);
    const monthsEnd = endDateForMonths(m.start_date, m.months_paid);
    const byMonths = addDays(monthsEnd, holds);
    const byDays = m.plan_days ? addDays(m.start_date, Number(m.plan_days) - 1 + holds) : null;
    if (m.end_date === byMonths || m.end_date === byDays) continue;
    const soldByDays = byDays !== null && Number(m.plan_days) !== daysBetween(m.start_date, monthsEnd) + 1;
    drift.push({ membership_id: m.id, branch_id: m.branch_id, end_date: m.end_date, expected_end_date: soldByDays ? byDays! : byMonths });
  }
  return { checked: memberships.length, drift };
}

export async function insertPaymentTransactions(
  db: ReturnType<typeof adminClient>,
  base: Record<string, unknown>,
  paymentMode: string | undefined, amount: number,
  cashAmount?: number | string, upiAmount?: number | string,
) {
  // Nothing collected (Pay Later, a zero advance) — no ₹0 rows in the ledger.
  if (!(Number(amount) > 0)) return;
  if (paymentMode === "split") {
    const cash = Math.round((Number(cashAmount) || 0) * 100) / 100;
    const upi = Math.round((Number(upiAmount) || 0) * 100) / 100;
    if (Math.round((cash + upi) * 100) !== Math.round(Number(amount) * 100)) {
      throw new Error("Cash + UPI amounts must add up to the total");
    }
    if (cash > 0) await recordTransaction(db, { ...base, amount: cash, payment_mode: "cash" });
    if (upi > 0) await recordTransaction(db, { ...base, amount: upi, payment_mode: "upi" });
  } else {
    await recordTransaction(db, { ...base, amount, payment_mode: paymentMode ?? "cash" });
  }
}

// Any flow that ends, pauses, or relocates a membership must not run while the student is
// physically still checked in: the booking would be left status='active' forever with its
// membership gone (orphaning the row, and keeping a desk tied up), and any overtime/food
// owed for that session would never be billed because checkout never happens. Callers gate
// on this and tell staff to check the student out first.
export async function hasOpenSession(db: ReturnType<typeof adminClient>, studentId: string) {
  const { data } = await db.from("bookings").select("id")
    .eq("student_id", studentId).eq("status", "active").limit(1);
  return !!data?.length;
}

// One student can't be in two sessions at once. add_attendance / update_attendance write
// sessions straight into history with staff-typed times, skipping the one-active-session
// guard live check-in has — so re-saving a session that was already recorded silently made
// a duplicate: double the visits and hours studied, and a second unbilled overtime row that
// gets charged at the next renewal. An active session is open-ended (it runs until checkout,
// however long ago it started), so it's fetched separately from the time-windowed query.
export async function findOverlappingSession(
  db: ReturnType<typeof adminClient>, studentId: string, startIso: string, endIso: string, excludeBookingId?: string,
) {
  const startMs = new Date(startIso).getTime();
  // A closed session never runs past a day, so only ones that started in the 24h before this
  // one can reach into it — keeps this off the student's whole history.
  const windowStart = new Date(startMs - 86_400_000).toISOString();
  const [{ data: closed }, { data: open }] = await Promise.all([
    db.from("bookings").select("id, status, start_time, end_time")
      .eq("student_id", studentId).eq("status", "completed")
      .gte("start_time", windowStart).lt("start_time", endIso),
    db.from("bookings").select("id, status, start_time, end_time")
      .eq("student_id", studentId).eq("status", "active").lt("start_time", endIso),
  ]);
  return [...(open ?? []), ...(closed ?? [])].find(b =>
    b.id !== excludeBookingId && (b.status === "active" || new Date(b.end_time).getTime() > startMs),
  ) ?? null;
}

// "25-09-26, 09:00–15:00" in IST (or just "25-09-26, 09:00" without an end) — how the rest
// of the app shows a session to staff.
export function formatISTSession(startIso: string, endIso?: string) {
  const d = toISTDateStr(startIso);
  const hhmm = (iso: string) => new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
  return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}, ${hhmm(startIso)}${endIso ? `–${hhmm(endIso)}` : ""}`;
}

// Claims a desk for a student, atomically. Picking a free desk and then reserving it are two
// separate statements, so two registrations landing in the same moment could both read the
// same desk as free and both "claim" it — the second silently overwriting the first and
// leaving two students on one cabin. Constraining the UPDATE to rows still status='free' and
// checking what came back means exactly one caller can win; the loser is told to retry.
// Returns true if this call actually claimed the desk.
export async function claimDesk(db: ReturnType<typeof adminClient>, deskId: string, studentId: string) {
  const { data } = await db.from("desks")
    .update({ status: "reserved", seat_type: "fixed", assigned_student_id: studentId })
    .eq("id", deskId).eq("status", "free")
    .select("id");
  return !!data?.length;
}

// Remind staff to collect renewal during the student's final week of validity — kept alive
// (re-upserted) on every run, resolved on renew/close. Moved unchanged from the end of
// list_active_memberships (PSS-AI P0.7) so the 06:00 cron job runs the same loop.
export async function remindExpiringMembers(db: ReturnType<typeof adminClient>, members: { student_id?: string; branch_id: string; student_name?: string; end_date: string }[]) {
  const today = todayISO();
  const weekOut = addDays(today, 7);
  for (const m of members) {
    if (!m.student_id) continue;
    if (m.end_date >= today && m.end_date <= weekOut) {
      await createAlert(db, m.student_id, m.branch_id, "expiry", m.end_date,
        `${m.student_name}'s membership expires on ${m.end_date} — remind them to renew.`);
    }
  }
}

export async function createAlert(db: ReturnType<typeof adminClient>, studentId: string, branchId: string, type: string, dueDate: string, message: string) {
  const { data: existing } = await db.from("alerts").select("id")
    .eq("student_id", studentId).eq("alert_type", type).eq("status", "pending").maybeSingle();
  if (existing) {
    await db.from("alerts").update({ due_date: dueDate, message }).eq("id", existing.id);
  } else {
    await db.from("alerts").insert({ student_id: studentId, branch_id: branchId, alert_type: type, due_date: dueDate, message });
  }
}
