import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, jwtVerify } from "https://esm.sh/jose@5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

// A staff member's session token lasts 7 days, and the frontend keeps it in sessionStorage —
// which survives as long as the browser tab stays open (very common on an always-on
// front-desk computer). That means a staff member can be actively using the app all day
// without ever hitting the `login` action again, so attendance marked ONLY at login was
// silently never recording their presence on later days. This upsert (unique on
// staff_id+attendance_date, ignoreDuplicates) is cheap and idempotent, so it runs on every
// authenticated request rather than caching "already marked" in memory — an in-memory cache
// here would permanently mask a single failed attempt (e.g. a transient DB hiccup) for the
// rest of that day, which is worse than the negligible cost of a few extra no-op upserts.
async function markAttendanceIfNeeded(db: ReturnType<typeof adminClient>, staffId: string, role: string, branchId: string | null) {
  if (role === "owner") return;
  const { error } = await db.from("staff_attendance").upsert(
    { staff_id: staffId, branch_id: branchId, attendance_date: todayISO() },
    { onConflict: "staff_id,attendance_date", ignoreDuplicates: true },
  );
  if (error) console.error("Failed to mark staff attendance:", error.message);
}

// No hardcoded fallback: a guessable default secret would let anyone forge staff JWTs
// (full account takeover). If the real secret isn't configured, fall back to a random
// value generated fresh per cold start — this fails safe (existing sessions/tokens just
// stop validating) instead of failing open with a publicly-known signing key.
const JWT_SECRET = Deno.env.get("STAFF_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? (() => {
  console.error("STAFF_JWT_SECRET is not set — using an ephemeral per-instance secret. Set STAFF_JWT_SECRET in Supabase project secrets.");
  return crypto.randomUUID() + crypto.randomUUID();
})();

async function signToken(payload: Record<string, unknown>) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

async function verifyToken(token: string) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as { sub: string; role: string; username: string };
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

type StaffRow = { id: string; username: string; role: string; display_name: string | null; branch_id: string | null; is_active: boolean; homeBranchId: string | null; isOverrideToday: boolean };

async function authStaff(req: Request): Promise<StaffRow | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = await verifyToken(auth.slice(7));
    const db = adminClient();
    // Tolerate override_branch_id/override_date not existing yet (migration 029 not applied
    // to this environment) — fall back to a plain lookup instead of failing every request.
    let data: { id: string; username: string; role: string; display_name: string | null; branch_id: string | null; is_active: boolean; override_branch_id?: string | null; override_date?: string | null } | null = null;
    const withOverride = await db.from("staff")
      .select("id, username, role, display_name, branch_id, is_active, override_branch_id, override_date")
      .eq("id", payload.sub).single();
    if (withOverride.error) {
      const plain = await db.from("staff").select("id, username, role, display_name, branch_id, is_active").eq("id", payload.sub).single();
      data = plain.data;
    } else {
      data = withOverride.data;
    }
    if (!data?.is_active) return null;
    // Cuts off an already-open tab/device too, not just fresh logins — once "End Session"
    // has been recorded for today, every subsequent request from this staff member (any
    // token) is treated as unauthorized until tomorrow's attendance row resets it.
    if (data.role !== "owner") {
      const { data: att } = await db.from("staff_attendance").select("last_logout_at")
        .eq("staff_id", data.id).eq("attendance_date", todayISO()).maybeSingle();
      if (att?.last_logout_at) return null;
    }
    // A same-day branch override (covering an absent colleague) swaps in as the effective
    // branch_id for every requireBranch() check downstream — the staff member's actual
    // `branch_id` column (their permanent home branch) is untouched in the DB.
    const isOverrideToday = !!data.override_branch_id && data.override_date === todayISO();
    return {
      id: data.id, username: data.username, role: data.role, display_name: data.display_name,
      is_active: data.is_active,
      branch_id: isOverrideToday ? data.override_branch_id! : data.branch_id,
      homeBranchId: data.branch_id, isOverrideToday,
    };
  } catch { return null; }
}

function isOwner(staff: StaffRow) { return staff.role === "owner"; }

function requireBranch(staff: StaffRow, branchId: string) {
  if (isOwner(staff)) return true;
  return staff.branch_id === branchId;
}

async function getOwnerStaffIds(db: ReturnType<typeof adminClient>): Promise<string[]> {
  const { data } = await db.from("staff").select("id").eq("role", "owner");
  return (data ?? []).map(r => r.id);
}

// The edge function runs on UTC infrastructure with no "local" timezone, but the app is
// used in India — so "today" must be computed in IST (UTC+5:30), not the server's UTC
// date. Without this shift, the calendar day would flip 5.5 hours early (at UTC midnight,
// i.e. 5:30 AM IST) instead of at actual IST midnight, throwing off attendance, "due
// today" checks, daily reports, and the End Session day-lockout.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function todayISO() { return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); }
// Same IST shift as todayISO(), but for an arbitrary timestamp (e.g. a stored paused_at)
// instead of "now" — needed to compare calendar dates rather than raw elapsed hours.
function toISTDateStr(isoTimestamp: string) { return new Date(new Date(isoTimestamp).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10); }

// Pure UTC calendar arithmetic — "dateStr + T12:00:00" (no timezone designator) is parsed
// as *local* time by the JS Date constructor, and if the runtime's local timezone doesn't
// happen to be UTC, that silently shifts the result by a day. Using Date.UTC directly and
// getUTCDate/etc. sidesteps that ambiguity entirely, so a start date always advances by
// exactly N months (clamped to the last day of the target month on overflow, e.g. Jan 31 +
// 1 month -> Feb 28/29, not a roll into March).
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + months);
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

// Hopes branch lockers aren't numbered 1..capacity — the physical units are labeled
// 1-10, then 25-46, then 63-75 (45 lockers total), so the assignable numbers must
// follow those gaps instead of a plain sequential range.
const HOPES_LOCKER_RANGES: [number, number][] = [[1, 10], [25, 46], [63, 75]];

function lockerNumberSequence(branchName: string | undefined | null, capacity: number): string[] {
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

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A membership's end date is billing-cycle style: one day short of the same day N months
// out, so a period never spills into the day it would "restart" on (e.g. 1 month from the
// 15th ends the 14th, not the 15th). Starting on the 1st is the case that makes this
// legible — 1 month from the 1st ends the last day of that same month, not the 1st of the
// next one.
//
// Starting on the 29th/30th/31st needs special care: addMonths() clamps to the target
// month's last day when that day-of-month doesn't exist there (e.g. Jan 31 + 1 month ->
// Feb 28). That clamped value is already the correct end date — subtracting one more day
// would double-truncate the period by a day it shouldn't lose. Only subtract when
// addMonths preserved the exact day-of-month (i.e. no clamping happened).
function endDateForMonths(startDate: string, months: number): string {
  const startDay = Number(startDate.split("-")[2]);
  const target = addMonths(startDate, months);
  const targetDay = Number(target.split("-")[2]);
  return targetDay === startDay ? addDays(target, -1) : target;
}

// A recurring task's "anchor" is its due_date (or, failing that, the day it was created).
// daily tasks are due every day from the anchor onward; weekly/monthly repeat on the
// anchor's weekday / day-of-month.
function isTaskDueOn(task: { repeat_interval: string; due_date: string | null; created_at: string; status?: string }, dateStr: string): boolean {
  const anchor = task.due_date ?? task.created_at.slice(0, 10);
  if (task.repeat_interval === "none") return anchor === dateStr && task.status !== "done";
  if (anchor > dateStr) return false;
  if (task.repeat_interval === "daily") return true;
  const anchorDate = new Date(anchor + "T12:00:00");
  const target = new Date(dateStr + "T12:00:00");
  if (task.repeat_interval === "weekly") return anchorDate.getDay() === target.getDay();
  if (task.repeat_interval === "monthly") return anchorDate.getDate() === target.getDate();
  return false;
}

function multiMonthDiscount(months: number): number {
  if (months >= 6) return 15;
  if (months >= 3) return 10;
  if (months >= 2) return 5;
  return 0;
}

const OVERTIME_GRACE_MINUTES = 15;

// Overtime is billed in whole-hour blocks after the grace period, flat-rate — not prorated
// per minute against whatever the person's own hourly rate happens to be. Any overshoot past
// grace immediately bills a full hour block; going further into a second block bills another
// full hour, and so on. A walk-in whose *original* booking was exactly 3 hours gets a
// discounted first overtime hour (hour 4, ₹5 instead of ₹10) as a one-off special case — every
// other hour, for anyone (walk-in or member), is a flat ₹10. Once total hours used for this
// visit (booked/allotted hours + overtime hours) reaches 10, the total cost for the visit is
// capped at a flat ₹100 rather than continuing to add up — computed once, at checkout, per
// visit (never re-aggregated across separate days/sessions).
function computeOvertimeCharge(overtimeMinutes: number, bookedHours: number, baseFee: number, isWalkinThreeHour: boolean) {
  const overtimeHours = Math.ceil(Math.max(0, overtimeMinutes - OVERTIME_GRACE_MINUTES) / 60);
  let addOn = 0;
  for (let h = 1; h <= overtimeHours; h++) {
    addOn += isWalkinThreeHour && h === 1 ? 5 : 10;
  }
  const totalHours = bookedHours + overtimeHours;
  const totalCost = totalHours >= 10 ? 100 : baseFee + addOn;
  const overtimeCharge = Math.max(totalCost - baseFee, 0);
  return { overtimeHours, overtimeCharge, totalCost };
}

function dateRange(period: string, dateFrom?: string, dateTo?: string) {
  const today = todayISO();
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (period === "month") {
    const d = new Date();
    return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: today };
  }
  return { from: dateFrom ?? today, to: dateTo ?? today };
}

// Splits a [from, to] range into day-sized or week-sized buckets for trend charts — a
// "week" period buckets by day, a "month" period buckets by week (otherwise a month view
// would be a cramped 30-bar chart), and "custom" picks whichever keeps the bar count sane.
function buildDateBuckets(from: string, to: string, granularity: "day" | "week") {
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

async function getWalkinFee(db: ReturnType<typeof adminClient>, hours: number): Promise<number> {
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

async function getMembershipPackage(db: ReturnType<typeof adminClient>, hoursPerDay: number, category: string) {
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
async function settlePendingCashbacks(db: ReturnType<typeof adminClient>, studentId: string, base: number) {
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

async function upsertStudent(db: ReturnType<typeof adminClient>, name: string, phone: string, branchId: string, extra: Record<string, unknown> = {}): Promise<{ id: string; isNew: boolean }> {
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


async function refreshStudentStatus(db: ReturnType<typeof adminClient>, studentId: string) {
  const today = todayISO();
  const { data: mem } = await db.from("memberships").select("*")
    .eq("student_id", studentId).eq("is_active", true).order("end_date", { ascending: false }).limit(1).maybeSingle();
  let status = "inactive";
  if (mem) {
    if (mem.fee_due > 0 || mem.due_date < today) status = "pending";
    else if (mem.end_date >= today) status = "active";
    else status = "inactive";
  }
  // An otherwise-active membership still reads as Pending if the student's locker rent is
  // overdue — a student shouldn't look fully settled while they owe locker money.
  if (status === "active") {
    const { data: locker } = await db.from("lockers").select("locker_due_date")
      .eq("student_id", studentId).eq("is_active", true).maybeSingle();
    if (locker?.locker_due_date && locker.locker_due_date < today) status = "pending";
  }
  await db.from("students").update({ status, updated_at: new Date().toISOString() }).eq("id", studentId);
}

// A "split" payment isn't a real payment_mode value (the DB enum is only cash/upi/other),
// it's a UI convenience meaning "part cash, part UPI" — so it becomes two real transaction
// rows here (one per mode actually used), while the parent record (membership/locker/etc,
// whose own payment_mode column is the same restricted enum) just stores "other" for it.
function storedPaymentMode(paymentMode?: string | null): string {
  return paymentMode === "split" ? "other" : (paymentMode ?? "cash");
}

async function insertPaymentTransactions(
  db: ReturnType<typeof adminClient>,
  base: Record<string, unknown>,
  paymentMode: string | undefined, amount: number,
  cashAmount?: number | string, upiAmount?: number | string,
) {
  if (paymentMode === "split") {
    const cash = Math.round((Number(cashAmount) || 0) * 100) / 100;
    const upi = Math.round((Number(upiAmount) || 0) * 100) / 100;
    if (Math.round((cash + upi) * 100) !== Math.round(Number(amount) * 100)) {
      throw new Error("Cash + UPI amounts must add up to the total");
    }
    if (cash > 0) await db.from("transactions").insert({ ...base, amount: cash, payment_mode: "cash" });
    if (upi > 0) await db.from("transactions").insert({ ...base, amount: upi, payment_mode: "upi" });
  } else {
    await db.from("transactions").insert({ ...base, amount, payment_mode: paymentMode ?? "cash" });
  }
}

async function createAlert(db: ReturnType<typeof adminClient>, studentId: string, branchId: string, type: string, dueDate: string, message: string) {
  const { data: existing } = await db.from("alerts").select("id")
    .eq("student_id", studentId).eq("alert_type", type).eq("status", "pending").maybeSingle();
  if (existing) {
    await db.from("alerts").update({ due_date: dueDate, message }).eq("id", existing.id);
  } else {
    await db.from("alerts").insert({ student_id: studentId, branch_id: branchId, alert_type: type, due_date: dueDate, message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, ...payload } = body;
    const db = adminClient();

    // ─── PUBLIC ───
    if (action === "login") {
      const { username, password } = payload;
      if (!username || !password) return err("Username and password required");
      const { data, error } = await db.rpc("verify_staff_login", { p_username: username, p_password: password });
      if (error || !data?.length) return err("Invalid login credentials", 401);
      const row = data[0];

      // Once a staff member has ended their session for the day, they're locked out of
      // logging back in until tomorrow — mirrors clocking out at a physical front desk.
      // Owner is exempt (End Session isn't offered to them in the first place).
      if (row.role !== "owner") {
        const { data: att } = await db.from("staff_attendance").select("last_logout_at")
          .eq("staff_id", row.id).eq("attendance_date", todayISO()).maybeSingle();
        if (att?.last_logout_at) {
          return err("You've already ended your session for today — you can log in again tomorrow.", 403);
        }
      }

      const token = await signToken({ sub: row.id, role: row.role, username: row.username });

      // Auto-mark attendance on first login of the day (no-op if already marked) — owner is exempt
      await markAttendanceIfNeeded(db, row.id, row.role, row.branch_id);

      // If the owner reassigned this staff member to a different branch for today (covering
      // an absence), log them into that branch instead of their permanent home branch.
      let effectiveBranchId = row.branch_id;
      let effectiveBranchName = row.branch_name;
      let isOverrideToday = false;
      const { data: overrideRow } = await db.from("staff").select("override_branch_id, override_date").eq("id", row.id).single();
      if (overrideRow?.override_branch_id && overrideRow.override_date === todayISO()) {
        const { data: overrideBranch } = await db.from("branches").select("id, name").eq("id", overrideRow.override_branch_id).single();
        if (overrideBranch) {
          effectiveBranchId = overrideBranch.id;
          effectiveBranchName = overrideBranch.name;
          isOverrideToday = true;
        }
      }

      return json({
        token,
        staff: {
          id: row.id, username: row.username, role: row.role,
          displayName: row.display_name, branchId: effectiveBranchId, branchName: effectiveBranchName,
          homeBranchId: row.branch_id, isOverrideToday,
        },
      });
    }

    const staff = await authStaff(req);
    if (!staff) return err("Unauthorized", 401);
    await markAttendanceIfNeeded(db, staff.id, staff.role, staff.homeBranchId);

    // Lets the frontend re-sync a staff member's own profile (display name, branch
    // reassignment, etc.) without needing to log out and back in — polled periodically
    // so an owner's edit shows up in that staff member's already-open session promptly.
    // Also doubles as a lightweight "am I still allowed in" check: since it goes through
    // the same authStaff() gate above, a deactivated account or an ended-for-today
    // session gets a 401 here just like any other action.
    if (action === "whoami") {
      const { data: branch } = staff.branch_id
        ? await db.from("branches").select("name").eq("id", staff.branch_id).single()
        : { data: null };
      return json({
        staff: {
          id: staff.id, username: staff.username, role: staff.role,
          displayName: staff.display_name, branchId: staff.branch_id, branchName: branch?.name ?? null,
          homeBranchId: staff.homeBranchId, isOverrideToday: staff.isOverrideToday,
        },
      });
    }

    // ─── BRANCHES ───
    if (action === "list_branches") {
      let q = db.from("branches").select("id, name, desk_count, shift_config, locker_capacity").eq("is_active", true).order("name");
      if (!isOwner(staff)) q = q.eq("id", staff.branch_id!);
      const { data } = await q;
      return json({ branches: data ?? [] });
    }

    if (action === "update_branch") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { branchId, deskCount, shiftConfig, lockerCapacity } = payload;
      const updates: Record<string, unknown> = {};
      if (deskCount !== undefined) updates.desk_count = deskCount;
      if (shiftConfig !== undefined) updates.shift_config = shiftConfig;
      if (lockerCapacity !== undefined) {
        const cap = Number(lockerCapacity);
        if (!Number.isFinite(cap) || cap < 0) return err("Locker capacity must be a non-negative number");
        updates.locker_capacity = cap;
      }
      await db.from("branches").update(updates).eq("id", branchId);
      return json({ ok: true });
    }

    if (action === "add_desk") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { branchId, label } = payload;
      const { data: maxSort } = await db.from("desks").select("sort_order").eq("branch_id", branchId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
      await db.from("desks").insert({ branch_id: branchId, label, sort_order: (maxSort?.sort_order ?? 0) + 1 });
      await db.from("branches").update({ desk_count: (await db.from("desks").select("*", { count: "exact", head: true }).eq("branch_id", branchId)).count }).eq("id", branchId);
      return json({ ok: true });
    }

    if (action === "remove_desk") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { deskId } = payload;
      const { data: desk } = await db.from("desks").select("*").eq("id", deskId).single();
      if (desk?.status !== "free") return err("Cannot remove occupied desk");
      await db.from("desks").delete().eq("id", deskId);
      return json({ ok: true });
    }

    // ─── DASHBOARD ───
    if (action === "get_dashboard") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: desks } = await db.from("desks").select("status").eq("branch_id", branchId);
      const free = desks?.filter(d => d.status === "free").length ?? 0;
      const occupied = desks?.filter(d => d.status === "occupied").length ?? 0;
      const reserved = desks?.filter(d => d.status === "reserved").length ?? 0;

      const today = todayISO();
      // Count from memberships — avoids walk-in students inflating the "active" count
      const { count: active } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).gte("end_date", today);
      const { count: pending } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).gt("fee_due", 0);
      const { count: temporaryCount } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).eq("category", "temporary").gte("end_date", today);
      const { count: permanentCount } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).eq("category", "permanent").gte("end_date", today);

      // Students currently in an active session right now (scoped to today, same as list_today_bookings)
      const { count: currentlyStudying } = await db.from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "active").eq("is_paused", false)
        .gte("created_at", today + "T00:00:00Z").lte("created_at", today + "T23:59:59Z");

      const { data: alerts } = await db.from("alerts").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("status", "pending").order("due_date").limit(10);

      // Not just "due/expired exactly today" — any membership that's overdue and hasn't
      // been settled/renewed yet should keep showing up until it's dealt with.
      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lte("due_date", today).gt("fee_due", 0);

      const { data: expiredToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("end_date", today);

      const { count: checkedInToday } = await db.from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .gte("created_at", today + "T00:00:00Z").lte("created_at", today + "T23:59:59Z");

      return json({
        seats: { free, occupied, reserved, total: desks?.length ?? 0 },
        students: {
          active: active ?? 0,
          pending: pending ?? 0,
          temporary: temporaryCount ?? 0,
          permanent: permanentCount ?? 0,
          currentlyStudying: currentlyStudying ?? 0,
          checkedInToday: checkedInToday ?? 0,
        },
        alerts: alerts ?? [],
        actionable: {
          dueToday: dueToday ?? [],
          expiredToday: expiredToday ?? [],
        },
      });
    }

    // Full activity feed branch-wide, newest first — every new booking/check-in, every new
    // membership, and every payment-related transaction (walk-in fee, membership payment,
    // food, locker, overtime), merged into one timeline. Moved off the Dashboard onto the
    // Reports page as its own lightweight action so Reports doesn't need the full
    // get_dashboard payload just to show this feed.
    if (action === "get_recent_activity") {
      const { branchId, date, period, dateFrom, dateTo } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      // Same range logic as get_daily_report — staff only ever see a single day; the
      // owner's Day/Week/Month/Custom picker at the top of Reports scopes this too.
      const range = period && isOwner(staff) ? dateRange(period, dateFrom, dateTo) : { from: date ?? todayISO(), to: date ?? todayISO() };
      const fromTs = range.from + "T00:00:00Z";
      const toTs = range.to + "T23:59:59Z";

      const [{ data: recentBookings }, { data: recentMemberships }, { data: recentTxns }, { data: recentCashbacks }, { data: recentPayouts }] = await Promise.all([
        db.from("bookings").select("id, booking_type, status, created_at, students(name, phone)")
          .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs),
        db.from("memberships").select("id, category, total_paid, created_at, students(name, phone)")
          .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs),
        db.from("transactions").select("id, category, amount, payment_mode, created_at, students(name, phone)")
          .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs),
        // Granted and redeemed/settled can each fall in range independently of one
        // another, so fetch anything touched (created OR redeemed) within the window.
        db.from("cashbacks").select("id, cashback_type, cashback_value, status, redeemed_amount, created_at, redeemed_at, students(name, phone)")
          .eq("branch_id", branchId)
          .or(`and(created_at.gte.${fromTs},created_at.lte.${toTs}),and(redeemed_at.gte.${fromTs},redeemed_at.lte.${toTs})`),
        db.from("payouts").select("id, payout_type, amount, created_at, students(name, phone)")
          .eq("branch_id", branchId).eq("payout_type", "membership_refund")
          .gte("created_at", fromTs).lte("created_at", toTs),
      ]);

      const cashbackFeed: Record<string, unknown>[] = [];
      for (const c of recentCashbacks ?? []) {
        const valueLabel = c.cashback_type === "percent" ? `${c.cashback_value}%` : `₹${Number(c.cashback_value)}`;
        if (c.created_at >= fromTs && c.created_at <= toTs) {
          cashbackFeed.push({
            id: `cashback-grant-${c.id}`, kind: "cashback", label: `Cashback granted (${valueLabel})`,
            studentName: c.students?.name, studentPhone: c.students?.phone,
            time: c.created_at, status: "pending", amount: c.cashback_type === "fixed" ? Number(c.cashback_value) : null,
          });
        }
        if (c.redeemed_at && c.status !== "pending" && c.redeemed_at >= fromTs && c.redeemed_at <= toTs) {
          cashbackFeed.push({
            id: `cashback-${c.status}-${c.id}`, kind: "cashback", label: `Cashback ${c.status}`,
            studentName: c.students?.name, studentPhone: c.students?.phone,
            time: c.redeemed_at, status: c.status, amount: c.redeemed_amount != null ? Number(c.redeemed_amount) : null,
          });
        }
      }

      const feed = [
        ...(recentBookings ?? []).map(b => ({
          id: `booking-${b.id}`, kind: "booking", label: b.booking_type,
          studentName: b.students?.name, studentPhone: b.students?.phone,
          time: b.created_at, status: b.status, amount: null,
        })),
        ...(recentMemberships ?? []).map(m => ({
          id: `membership-${m.id}`, kind: "membership", label: `New ${m.category} membership`,
          studentName: m.students?.name, studentPhone: m.students?.phone,
          time: m.created_at, status: null, amount: Number(m.total_paid),
        })),
        ...(recentTxns ?? []).map(t => ({
          id: `transaction-${t.id}`, kind: "transaction", label: t.category,
          studentName: t.students?.name, studentPhone: t.students?.phone,
          time: t.created_at, status: t.payment_mode, amount: Number(t.amount),
        })),
        ...cashbackFeed,
        ...(recentPayouts ?? []).map(p => ({
          id: `payout-${p.id}`, kind: "membership_refund", label: "Membership deleted — refund",
          studentName: p.students?.name, studentPhone: p.students?.phone,
          time: p.created_at, status: "refunded", amount: -Number(p.amount),
        })),
      ].sort((a: { time: string }, b: { time: string }) => b.time.localeCompare(a.time));

      return json({ recentActivity: feed });
    }

    // ─── SEAT MAP ───
    if (action === "get_seat_map") {
      const { branchId, shift } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: desks } = await db.from("desks").select(`
        id, label, status, seat_type, assigned_student_id,
        students:assigned_student_id(name),
        bookings:current_booking_id(id, start_time, end_time, hours, booking_type, students(name, phone))
      `).eq("branch_id", branchId).order("sort_order");

      // Seat map only shows two colors — yellow (free or occupied floating desks) and grey (permanent/reserved)
      const permanent = desks?.filter(d => d.status === "reserved").length ?? 0;
      const free = (desks?.length ?? 0) - permanent;
      const occupied = desks?.filter(d => d.status === "occupied").length ?? 0;

      return json({ desks: desks ?? [], summary: { free, occupied, permanent, total: desks?.length ?? 0 }, shift });
    }

    // ─── COMBINED HALL (owner, all branches) ───
    if (action === "get_combined_hall") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { data: branchesList } = await db.from("branches").select("id, name").eq("is_active", true).order("name");
      const today = todayISO();

      const rows = [];
      for (const b of branchesList ?? []) {
        const { data: desks } = await db.from("desks").select("status").eq("branch_id", b.id);
        const permanentDesks = desks?.filter(d => d.status === "reserved").length ?? 0;
        const freeDesks = (desks?.length ?? 0) - permanentDesks;

        const { count: currentlyStudying } = await db.from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("branch_id", b.id).eq("status", "active").eq("is_paused", false)
          .gte("created_at", today + "T00:00:00Z").lte("created_at", today + "T23:59:59Z");
        const { count: activeMemberships } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).gte("end_date", today);
        const { count: temporary } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).eq("category", "temporary").gte("end_date", today);
        const { count: permanent } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).eq("category", "permanent").gte("end_date", today);
        // "Pending" = any outstanding balance, regardless of due_date — due_date is always
        // set a month out on creation/renewal even for a partial payment made today, so
        // gating on it would hide a real balance for a full month.
        const { count: pending } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).gt("fee_due", 0);

        rows.push({
          id: b.id, name: b.name,
          freeDesks, permanentDesks, totalDesks: desks?.length ?? 0,
          currentlyStudying: currentlyStudying ?? 0, activeMemberships: activeMemberships ?? 0,
          temporary: temporary ?? 0, permanent: permanent ?? 0, pending: pending ?? 0,
        });
      }

      const totals = rows.reduce((acc, r) => ({
        freeDesks: acc.freeDesks + r.freeDesks, permanentDesks: acc.permanentDesks + r.permanentDesks,
        totalDesks: acc.totalDesks + r.totalDesks, currentlyStudying: acc.currentlyStudying + r.currentlyStudying,
        activeMemberships: acc.activeMemberships + r.activeMemberships, temporary: acc.temporary + r.temporary,
        permanent: acc.permanent + r.permanent, pending: acc.pending + r.pending,
      }), { freeDesks: 0, permanentDesks: 0, totalDesks: 0, currentlyStudying: 0, activeMemberships: 0, temporary: 0, permanent: 0, pending: 0 });

      return json({ branches: rows, totals });
    }

    if (action === "get_combined_seatmap") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { data: branchesList } = await db.from("branches").select("id, name").eq("is_active", true).order("name");

      const branchesOut = [];
      for (const b of branchesList ?? []) {
        const { data: desks } = await db.from("desks").select(`
          id, label, status, seat_type, assigned_student_id,
          students:assigned_student_id(name),
          bookings:current_booking_id(id, start_time, end_time, hours, booking_type, students(name, phone))
        `).eq("branch_id", b.id).order("sort_order");
        const permanent = desks?.filter(d => d.status === "reserved").length ?? 0;
        const free = (desks?.length ?? 0) - permanent;
        branchesOut.push({ id: b.id, name: b.name, desks: desks ?? [], summary: { free, permanent, total: desks?.length ?? 0 } });
      }

      return json({ branches: branchesOut });
    }

    if (action === "get_combined_pending") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { date } = payload;
      const targetDate = date || todayISO();

      // Any outstanding balance counts as pending, regardless of due_date — due_date is
      // always set a month out even on a same-day partial payment, so gating on it would
      // hide a real balance for a full month. Still sorted by due_date so overdue-longest
      // shows first.
      const { data: duePayments } = await db.from("memberships")
        .select("*, students(name, phone, course), branches(name)")
        .eq("is_active", true).gt("fee_due", 0)
        .order("due_date");
      const { data: expiredMemberships } = await db.from("memberships")
        .select("*, students(name, phone, course), branches(name)")
        .eq("is_active", true).eq("end_date", targetDate)
        .order("end_date");

      return json({ date: targetDate, duePayments: duePayments ?? [], expiredMemberships: expiredMemberships ?? [] });
    }

    // ─── STUDENT LOOKUP ───
    if (action === "lookup_student") {
      const { phone } = payload;
      const { data, error: lookupErr } = await db.from("students").select("id, name, phone, course, status")
        .eq("phone", phone).maybeSingle();
      if (lookupErr) return err(lookupErr.message);
      if (!data) return json({ student: null });
      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", data.id).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      return json({ student: { ...data, active_membership: membership ?? null, is_member: !!membership } });
    }

    if (action === "search_students_by_name") {
      const { branchId, query } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const q = (query ?? "").trim();
      if (q.length < 2) return json({ students: [] });
      // Recognize a student by full name or phone number in the same search box.
      const { data } = await db.from("students").select("id, name, phone")
        .eq("branch_id", branchId).or(`name.ilike.%${q}%,phone.ilike.%${q}%`).order("name").limit(8);
      return json({ students: data ?? [] });
    }

    // ─── WALK-IN ───
    if (action === "create_walkin") {
      const { branchId, name, phone, hours, paymentMode, startTime: startTimeStr, deskId: manualDeskId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name || !phone || !hours) return err("Name, phone, and hours required");

      const { id: studentId, isNew: isNewStudent } = await upsertStudent(db, name, phone, branchId);

      // Desk is optional for walk-ins — staff no longer assigns a desk
      let desk = null;
      if (manualDeskId) {
        const { data: d } = await db.from("desks").select("*").eq("id", manualDeskId).eq("branch_id", branchId).single();
        if (!d || d.status !== "free") return err("Selected desk is not available");
        desk = d;
      }

      const amount = await getWalkinFee(db, Number(hours));
      // startTimeStr is a full UTC ISO string sent by the frontend after local→UTC conversion
      const startTime = startTimeStr ? new Date(startTimeStr).toISOString() : new Date().toISOString();
      const endTime = new Date(new Date(startTime).getTime() + Number(hours) * 3600000).toISOString();

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: desk?.id ?? null,
        booking_type: "walkin", start_time: startTime, end_time: endTime,
        hours: Number(hours), scheduled_hours: Number(hours), amount, status: "active", payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      if (desk) {
        await db.from("desks").update({ status: "occupied", current_booking_id: booking!.id }).eq("id", desk.id);
      }
      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, booking_id: booking!.id,
        category: "desk", amount, payment_mode: paymentMode ?? "cash", created_by_staff_id: staff.id,
      });
      const { data: st } = await db.from("students").select("total_visits, total_hours_studied").eq("id", studentId).single();
      await db.from("students").update({
        total_visits: (st?.total_visits ?? 0) + 1,
        total_hours_studied: Number(st?.total_hours_studied ?? 0) + Number(hours),
        status: "active",
      }).eq("id", studentId);

      return json({ booking: { ...booking, deskLabel: desk?.label ?? null, amount, studentName: name }, isNewStudent });
    }

    // ─── MEMBERSHIP ───
    if (action === "create_membership") {
      const {
        branchId, name, phone, category, hoursPerDay, timings, monthsPaid,
        paymentMode, cashAmount, upiAmount, course, lockerNo, withLocker,
        advanceAmount, emergencyContact, referralSource, startDate: customStartDate,
        isCustomPlan, customAmount, weekendHours,
      } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!emergencyContact) return err("Emergency contact is required");
      if (phone === emergencyContact) return err("Emergency contact cannot be the same as the primary phone number");
      const validReferrals = ["google_search", "instagram", "word_of_mouth", "flex", "ai_platform"];
      if (!validReferrals.includes(referralSource)) return err("Please select how the student heard about us");

      const { id: studentId } = await upsertStudent(db, name, phone, branchId, {
        course, status: "active",
        emergency_contact: emergencyContact, referral_source: referralSource,
      });

      // A Custom plan skips the fixed fee_config tiers entirely — staff enter a negotiated
      // monthly amount directly, plus separate weekday/weekend hour allotments (enforced at
      // check-in). hours_per_day_weekend being set is what marks a membership as custom
      // everywhere else (renewal, check-in) — a normal package never sets it.
      let monthlyFee: number;
      let weekdayHoursValue: number;
      let weekendHoursValue: number | null = null;
      if (isCustomPlan) {
        monthlyFee = Number(customAmount);
        if (!(monthlyFee > 0)) return err("Enter a valid custom amount");
        weekdayHoursValue = Number(hoursPerDay);
        if (!(weekdayHoursValue > 0)) return err("Enter valid weekday hours");
        weekendHoursValue = Number(weekendHours) || weekdayHoursValue;
      } else {
        const pkgFee = await getMembershipPackage(db, Number(hoursPerDay), category);
        if (!pkgFee) return err("Invalid membership package");
        monthlyFee = pkgFee;
        weekdayHoursValue = Number(hoursPerDay);
      }

      const months = Number(monthsPaid) || 1;
      const discount = multiMonthDiscount(months);
      const gross = monthlyFee * months;
      const totalPaid = gross * (1 - discount / 100);
      const startDate = isOwner(staff) && customStartDate ? customStartDate : todayISO();
      if (startDate > todayISO()) return err("Start date cannot be in the future");
      const endDate = endDateForMonths(startDate, months);
      // Derived the same clamp-aware way as endDate (not a raw addMonths) so a start date
      // on the 29th/30th/31st can't make dueDate collide with a 1-month endDate instead of
      // landing the day after it.
      const dueDate = addDays(endDateForMonths(startDate, 1), 1);
      const seatType = category === "permanent" ? "fixed" : "floating";
      let deskId = null;
      let cabinNo = null;

      if (category === "permanent") {
        const { data: freeDesk } = await db.from("desks").select("*")
          .eq("branch_id", branchId).eq("status", "free").order("sort_order").limit(1).maybeSingle();
        if (!freeDesk) return err("No cabin available for permanent membership — add them to the Waitlist tab instead");
        deskId = freeDesk.id;
        cabinNo = freeDesk.label;
        await db.from("desks").update({
          status: "reserved", seat_type: "fixed", assigned_student_id: studentId,
        }).eq("id", deskId);
      }

      const monthLabel = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

      const { data: mem, error: mErr } = await db.from("memberships").insert({
        student_id: studentId, branch_id: branchId, category, seat_type: seatType,
        desk_id: deskId, cabin_no: cabinNo, month: monthLabel,
        hours_per_day: weekdayHoursValue, hours_per_day_weekend: weekendHoursValue,
        timings: timings ?? '', start_date: startDate, end_date: endDate,
        due_date: dueDate, months_paid: months, discount_percent: discount,
        monthly_fee: monthlyFee,
        total_paid: advanceAmount != null ? Number(advanceAmount) : totalPaid,
        fee_due: advanceAmount != null ? Math.max(totalPaid - Number(advanceAmount), 0) : 0,
        payment_mode: storedPaymentMode(paymentMode), created_by_staff_id: staff.id,
      }).select("id").single();
      if (mErr) return err(mErr.message);

      const actualPaid = advanceAmount != null ? Number(advanceAmount) : totalPaid;
      await insertPaymentTransactions(db, {
        student_id: studentId, branch_id: branchId, membership_id: mem!.id,
        category: "membership", created_by_staff_id: staff.id,
      }, paymentMode, actualPaid, cashAmount, upiAmount);

      if (withLocker && lockerNo) {
        const { data: branchRow } = await db.from("branches").select("locker_capacity").eq("id", branchId).single();
        const { count: usedLockers } = await db.from("lockers")
          .select("*", { count: "exact", head: true }).eq("branch_id", branchId).eq("is_active", true);
        if ((usedLockers ?? 0) >= (branchRow?.locker_capacity ?? 0)) return err("No lockers available at this branch");

        const lockerDue = addMonths(startDate, 1);
        await db.from("lockers").insert({
          branch_id: branchId, student_id: studentId, locker_no: lockerNo,
          locker_due_date: lockerDue, deposit_amount: 100, monthly_fee: 100,
        });
        await db.from("transactions").insert({
          student_id: studentId, branch_id: branchId, category: "locker",
          amount: 200, payment_mode: storedPaymentMode(paymentMode) === "other" ? "cash" : storedPaymentMode(paymentMode),
          notes: "Locker rent + deposit", created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, studentId);
      return json({ membership: mem, totalPaid, cabinNo });
    }

    // ─── PERMANENT MEMBERSHIP WAITLIST ───
    // "Full" means zero free desks at the branch — any free desk can become a permanent
    // cabin, so this is the same condition create_membership itself checks.
    if (action === "get_permanent_waitlist") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { count: freeDesks } = await db.from("desks").select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "free");
      const { data: waitlist } = await db.from("permanent_waitlist").select("*")
        .eq("branch_id", branchId).eq("status", "waiting").order("created_at", { ascending: true });
      return json({ isFull: (freeDesks ?? 0) === 0, freeDesks: freeDesks ?? 0, waitlist: waitlist ?? [] });
    }

    if (action === "join_permanent_waitlist") {
      const { branchId, name, phone, hoursPerDay, notes } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name || !phone) return err("Name and phone are required");
      const { count: freeDesks } = await db.from("desks").select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "free");
      if ((freeDesks ?? 0) > 0) return err("Permanent seats are still available — register directly instead of waitlisting");

      const { error } = await db.from("permanent_waitlist").insert({
        branch_id: branchId, name, phone, hours_per_day: hoursPerDay || null, notes: notes || null,
        created_by_staff_id: staff.id,
      });
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "remove_from_waitlist") {
      const { waitlistId, status } = payload;
      const { data: entry } = await db.from("permanent_waitlist").select("branch_id").eq("id", waitlistId).single();
      if (!entry) return err("Waitlist entry not found");
      if (!requireBranch(staff, entry.branch_id)) return err("Branch access denied", 403);
      await db.from("permanent_waitlist").update({
        status: status === "fulfilled" ? "fulfilled" : "cancelled",
        fulfilled_at: status === "fulfilled" ? new Date().toISOString() : null,
      }).eq("id", waitlistId);
      return json({ ok: true });
    }

    // ─── LOCKERS (add / remove after registration) ───
    if (action === "get_locker_status") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: branchRow } = await db.from("branches").select("name, locker_capacity").eq("id", branchId).single();
      const capacity = branchRow?.locker_capacity ?? 0;
      const { data: activeLockers } = await db.from("lockers").select("locker_no").eq("branch_id", branchId).eq("is_active", true);
      const used = activeLockers?.map(l => l.locker_no) ?? [];
      const usedSet = new Set(used);
      const allNumbers = lockerNumberSequence(branchRow?.name, capacity);
      const availableNumbers = allNumbers.filter(label => !usedSet.has(label));
      return json({ capacity, used: used.length, available: capacity - used.length, availableNumbers });
    }

    if (action === "add_locker") {
      const { studentId, branchId, lockerNo, paymentMode, cashAmount, upiAmount, payLater } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: lockerStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!lockerStudent || lockerStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);

      const { data: existing } = await db.from("lockers").select("id").eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (existing) return err("Student already has an active locker");

      const { data: branchRow } = await db.from("branches").select("locker_capacity").eq("id", branchId).single();
      const { count: usedLockers } = await db.from("lockers")
        .select("*", { count: "exact", head: true }).eq("branch_id", branchId).eq("is_active", true);
      if ((usedLockers ?? 0) >= (branchRow?.locker_capacity ?? 0)) return err("No lockers available at this branch");

      const { data: membership } = await db.from("memberships").select("end_date")
        .eq("student_id", studentId).eq("is_active", true).order("end_date", { ascending: false }).limit(1).maybeSingle();
      const today = todayISO();
      const endDate = membership?.end_date && membership.end_date > today ? membership.end_date : addMonths(today, 1);
      const daysRemaining = Math.max(1, Math.ceil((new Date(endDate + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86_400_000));
      const proratedFee = Math.round((100 / 30) * daysRemaining);
      const deposit = 100;

      // The ₹100 caution deposit is mandatory and collected upfront, always — a locker is
      // never assigned without it. Only the prorated monthly rent can be deferred.
      const amountPaid = deposit + (payLater ? 0 : proratedFee);
      const feeDue = payLater ? proratedFee : 0;

      const { data: locker, error: lErr } = await db.from("lockers").insert({
        branch_id: branchId, student_id: studentId, locker_no: lockerNo,
        locker_due_date: endDate, deposit_amount: deposit, monthly_fee: 100,
        amount_paid: amountPaid, fee_due: feeDue,
      }).select("*").single();
      if (lErr) return err(lErr.message);

      await insertPaymentTransactions(db, {
        student_id: studentId, branch_id: branchId, category: "locker",
        notes: payLater
          ? `Locker deposit (₹${deposit}) — rent (₹${proratedFee} for ${daysRemaining}d) deferred`
          : `Locker — prorated ${daysRemaining}d rent (₹${proratedFee}) + deposit (₹${deposit})`,
        created_by_staff_id: staff.id,
      }, paymentMode, amountPaid, cashAmount, upiAmount);

      return json({ ok: true, locker, amountCharged: amountPaid, proratedFee, deposit, daysRemaining, payLater: !!payLater });
    }

    if (action === "remove_locker") {
      const { lockerId } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      await db.from("lockers").update({ is_active: false, deposit_returned: true }).eq("id", lockerId);
      return json({ ok: true });
    }

    if (action === "update_locker_due_date") {
      const { lockerId, dueDate } = payload;
      if (!dueDate) return err("Due date is required");
      const { data: locker } = await db.from("lockers").select("branch_id").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      await db.from("lockers").update({ locker_due_date: dueDate }).eq("id", lockerId);
      return json({ ok: true });
    }

    // ─── MEMBER CHECK-IN (attendance) ───
    if (action === "check_in_member") {
      const { branchId, studentId, deskId: passedDeskId, startTime: startTimeStr } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");

      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", studentId).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      if (!membership) return err("No active membership found");
      if (membership.is_paused) return err("Membership is currently on hold");

      const today = todayISO();
      const isExpiredMembership = membership.end_date < today;
      if (isExpiredMembership) {
        const daysSinceExpiry = Math.floor((new Date(today + "T12:00:00").getTime() - new Date(membership.end_date + "T12:00:00").getTime()) / 86_400_000);
        const GRACE_DAYS = 10;
        if (daysSinceExpiry > GRACE_DAYS) {
          const dueAmount = Number(membership.fee_due);
          if (dueAmount > 0) {
            return err(`Dues not cleared (₹${dueAmount} pending) even ${daysSinceExpiry} days after membership expiration — the ${GRACE_DAYS}-day grace period is over. Please clear dues and renew before checking in.`);
          }
          return err(`Membership expired ${daysSinceExpiry} days ago — the ${GRACE_DAYS}-day grace period is over. Please renew before checking in.`);
        }
      }

      // Can't check in twice at once — but a member CAN split their daily hour quota across
      // multiple sessions the same day (e.g. 3h morning + 3h evening on a 6h/day plan), as
      // long as they've checked out of the previous one first.
      const { data: activeToday } = await db.from("bookings").select("id")
        .eq("student_id", studentId)
        .in("booking_type", ["temporary", "permanent"])
        .eq("status", "active")
        .maybeSingle();
      if (activeToday) return err("Student is already checked in — check them out first");

      // Sum actual time already used today (completed sessions' real duration, since end_time
      // is stamped with the true checkout time) to figure out how much of the daily quota
      // remains for a possible additional split session.
      const { data: todaysSessions } = await db.from("bookings").select("start_time, end_time")
        .eq("student_id", studentId)
        .in("booking_type", ["temporary", "permanent"])
        .eq("status", "completed")
        .gte("created_at", today + "T00:00:00Z")
        .lte("created_at", today + "T23:59:59Z");
      const usedMinutesToday = (todaysSessions ?? []).reduce((sum: number, b: { start_time: string; end_time: string }) => {
        return sum + Math.max(0, (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60_000);
      }, 0);
      // A custom-plan membership (hours_per_day_weekend set) gets a different daily quota
      // on Sat/Sun than on weekdays — everyone else's hours_per_day applies every day.
      const istDayOfWeek = new Date(Date.now() + IST_OFFSET_MS).getUTCDay();
      const isWeekendToday = istDayOfWeek === 0 || istDayOfWeek === 6;
      const effectiveHoursPerDay = isWeekendToday && membership.hours_per_day_weekend != null
        ? Number(membership.hours_per_day_weekend)
        : Number(membership.hours_per_day);

      const remainingMinutes = effectiveHoursPerDay * 60 - usedMinutesToday;
      if (remainingMinutes <= 0) {
        return err(`Daily quota of ${effectiveHoursPerDay}h has already been used today (split across earlier sessions).`);
      }

      // A member visiting a branch other than their registered home branch can't use their
      // home cabin (it physically doesn't exist here) — treat them as floating for the day.
      const isCrossBranchVisit = student.branch_id != null && student.branch_id !== branchId;
      const deskId = membership.category === "permanent" && !isCrossBranchVisit ? membership.desk_id : (passedDeskId ?? null);

      let desk = null;
      if (deskId) {
        const { data: d } = await db.from("desks").select("*").eq("id", deskId).eq("branch_id", branchId).single();
        if (!d) return err("Desk not found");
        if (membership.category !== "permanent" && d.status !== "free") return err("Selected desk is not available");
        desk = d;
      }

      // startTimeStr is a full UTC ISO string sent by the frontend after local→UTC conversion
      const checkInTime = startTimeStr ? new Date(startTimeStr).toISOString() : new Date().toISOString();
      const sessionHours = remainingMinutes / 60;
      const endTime = new Date(new Date(checkInTime).getTime() + remainingMinutes * 60_000).toISOString();
      const bookingType = membership.category === "permanent" ? "permanent" : "temporary";

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: desk?.id ?? null,
        membership_id: membership.id, booking_type: bookingType,
        start_time: checkInTime, end_time: endTime,
        hours: sessionHours, scheduled_hours: sessionHours, amount: 0, status: "active",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      // Update desk status if a desk was assigned
      if (desk) {
        if (membership.category === "permanent") {
          // Permanent cabin stays 'reserved' — just link the booking
          await db.from("desks").update({ current_booking_id: booking!.id }).eq("id", desk.id);
        } else {
          await db.from("desks").update({ status: "occupied", current_booking_id: booking!.id }).eq("id", desk.id);
        }
      }
      await db.from("students").update({
        total_visits: (student.total_visits ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", studentId);

      // Intimate the student's home branch that they attended a different branch today.
      // The [cross_branch] tag lets the frontend's notification hook (useMessageAlerts)
      // recognize this as a distinct alert type — its own icon/title — instead of showing
      // up as an indistinguishable generic chat message.
      if (isCrossBranchVisit) {
        const { data: currentBranch } = await db.from("branches").select("name").eq("id", branchId).single();
        await db.from("messages").insert({
          branch_id: student.branch_id, sender_staff_id: staff.id, recipient_type: "staff",
          content: `[cross_branch] ${student.name} (home branch) checked in at ${currentBranch?.name ?? "another branch"} today.`,
        });
      }

      return json({
        ok: true, bookingId: booking!.id, deskLabel: desk?.label ?? null, endTime,
        expiredMembership: isExpiredMembership, crossBranchVisit: isCrossBranchVisit,
        sessionHours: Math.round(sessionHours * 100) / 100,
        isSplitSession: usedMinutesToday > 0,
      });
    }

    // Edit a student's attendance record (check-in time / check-out time / hours / status) —
    // corrects mistakes like a wrong check-in or checkout time punched in by staff. Available
    // to both staff (their own branch) and owner (any branch). If an explicit endTime is given
    // it wins (and hours is derived from the gap); otherwise hours (or the existing hours) is
    // used to derive the end time, same as before.
    if (action === "update_attendance") {
      const { bookingId, startTime, endTime, hours, status, scheduledHours } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Attendance record not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      // The originally booked/allotted session length — a stable baseline for recomputing
      // overtime that survives repeated edits. Deliberately read from scheduled_hours, NOT
      // the mutable `hours` column: `hours` gets overwritten below with the actual total
      // duration, so on a *second* edit it would no longer reflect the true original session
      // length, silently corrupting the overtime baseline. scheduled_hours is set once at
      // booking creation and never touched again — except here: an explicit scheduledHours
      // in the payload is a deliberate staff correction (e.g. a row whose scheduled_hours
      // was itself corrupted before this baseline existed), the one legitimate way to change it.
      const originalBookedHours = scheduledHours !== undefined && scheduledHours !== null && scheduledHours !== ""
        ? Number(scheduledHours)
        : Number(booking.scheduled_hours ?? booking.hours ?? 0);

      const newStartTime = startTime ? new Date(startTime).toISOString() : booking.start_time;
      let newEndTime: string;
      let newHours: number;
      if (endTime) {
        newEndTime = new Date(endTime).toISOString();
        if (new Date(newEndTime).getTime() <= new Date(newStartTime).getTime()) {
          return err("Check-out time must be after check-in time");
        }
        newHours = Math.round(((new Date(newEndTime).getTime() - new Date(newStartTime).getTime()) / 3_600_000) * 100) / 100;
      } else {
        newHours = hours !== undefined && hours !== null && hours !== "" ? Number(hours) : Number(booking.hours ?? 0);
        newEndTime = new Date(new Date(newStartTime).getTime() + newHours * 3_600_000).toISOString();
      }
      const newStatus = status || booking.status;

      await db.from("bookings").update({
        start_time: newStartTime, end_time: newEndTime, hours: newHours, status: newStatus,
        scheduled_hours: originalBookedHours,
      }).eq("id", bookingId);

      // Log the correction to the same Edit History a cabin/end-date edit shows up in — a
      // member session's start/end time only, since membership_edits.membership_id is
      // NOT NULL and a walk-in booking has none.
      if (booking.membership_id && (newStartTime !== booking.start_time || newEndTime !== booking.end_time)) {
        await db.from("membership_edits").insert({
          membership_id: booking.membership_id, student_id: booking.student_id, branch_id: booking.branch_id,
          edit_type: "attendance",
          old_value: JSON.stringify({ start: booking.start_time, end: booking.end_time }),
          new_value: JSON.stringify({ start: newStartTime, end: newEndTime }),
          changed_by_staff_id: staff.id,
        });
      }

      const hoursDelta = newHours - Number(booking.hours ?? 0);
      if (hoursDelta !== 0) {
        const { data: st } = await db.from("students").select("total_hours_studied").eq("id", booking.student_id).single();
        await db.from("students").update({
          total_hours_studied: Math.max(0, Number(st?.total_hours_studied ?? 0) + hoursDelta),
        }).eq("id", booking.student_id);
      }

      // Recompute overtime against the corrected times — scheduled end is derived from the
      // *original* booked length (not the just-recomputed total-duration newHours), same
      // basis checkout_booking used when it first logged this booking's overtime.
      let overtimeAlreadyBilled = false;
      if (booking.status === "completed" || newStatus === "completed") {
        const scheduledEndMs = new Date(newStartTime).getTime() + originalBookedHours * 3_600_000;
        const otMinutes = Math.max(0, Math.round((new Date(newEndTime).getTime() - scheduledEndMs) / 60_000));
        const isWalkinBooking = booking.booking_type === "walkin";

        // The 10-hour/₹100 cap is walk-in-only (total visit hours vs. total visit cost) — for
        // a member, bookedHoursForCap=0 makes the cap trigger purely on overtimeHours itself.
        const bookedHoursForCap = isWalkinBooking ? originalBookedHours : 0;
        const baseFee = isWalkinBooking ? Number(booking.amount) : 0;
        const isWalkinThreeHour = isWalkinBooking && originalBookedHours === 3;
        const { overtimeCharge } = computeOvertimeCharge(otMinutes, bookedHoursForCap, baseFee, isWalkinThreeHour);

        // .maybeSingle() would silently return nothing (not an error) if more than one row
        // ever matched — risking a duplicate insert on top of stale rows instead of updating
        // in place. Fetching as a list and taking the first is robust either way.
        if (isWalkinBooking) {
          const { data: existingTxns } = await db.from("transactions").select("id, amount")
            .eq("booking_id", bookingId).eq("category", "overtime").order("created_at", { ascending: true });
          const existingTxn = existingTxns?.[0];
          if (existingTxn) {
            if (overtimeCharge > 0) {
              await db.from("transactions").update({ amount: overtimeCharge }).eq("id", existingTxn.id);
            } else {
              await db.from("transactions").delete().eq("id", existingTxn.id);
            }
          } else if (overtimeCharge > 0) {
            await db.from("transactions").insert({
              student_id: booking.student_id, branch_id: booking.branch_id,
              booking_id: bookingId, category: "overtime", amount: overtimeCharge,
              payment_mode: booking.payment_mode ?? "cash",
              notes: "Overtime recomputed after editing attendance", created_by_staff_id: staff.id,
            });
          }
        } else {
          const { data: existingRows } = await db.from("overtime_sessions").select("id, billed_at")
            .eq("booking_id", bookingId).order("created_at", { ascending: true });
          const existingRow = existingRows?.[0];
          if (existingRow) {
            if (existingRow.billed_at) {
              // Already collected/settled — leave the historical record alone rather than
              // rewrite money that's already changed hands; just flag it in the response.
              overtimeAlreadyBilled = true;
            } else if (otMinutes > OVERTIME_GRACE_MINUTES) {
              await db.from("overtime_sessions").update({
                overtime_minutes: otMinutes, billed_amount: overtimeCharge,
              }).eq("id", existingRow.id);
            } else {
              await db.from("overtime_sessions").delete().eq("id", existingRow.id);
            }
          } else if (otMinutes > OVERTIME_GRACE_MINUTES) {
            await db.from("overtime_sessions").insert({
              booking_id: bookingId, student_id: booking.student_id,
              membership_id: booking.membership_id ?? null, branch_id: booking.branch_id,
              overtime_minutes: otMinutes,
              session_date: todayISO(), billed_amount: overtimeCharge, billed_at: null,
            });
          }
        }
      }

      return json({ ok: true, overtimeAlreadyBilled });
    }

    // Record a past attendance the staff forgot to punch in at the time (e.g. "she came in
    // yesterday evening but nobody checked her in"). Bypasses the daily-quota/one-active-
    // session checks that live check-in enforces, since this is a deliberate manual
    // correction of the historical record, not a new live session.
    if (action === "add_attendance") {
      const { branchId, studentId, startTime, endTime } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!startTime || !endTime) return err("Check-in and check-out time are required");
      const newStartTime = new Date(startTime).toISOString();
      const newEndTime = new Date(endTime).toISOString();
      if (new Date(newEndTime).getTime() <= new Date(newStartTime).getTime()) {
        return err("Check-out time must be after check-in time");
      }

      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");

      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", studentId).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      if (!membership) return err("No active membership found");

      const hours = Math.round(((new Date(newEndTime).getTime() - new Date(newStartTime).getTime()) / 3_600_000) * 100) / 100;
      const bookingType = membership.category === "permanent" ? "permanent" : "temporary";
      const isCrossBranchVisit = student.branch_id != null && student.branch_id !== branchId;
      const deskId = membership.category === "permanent" && !isCrossBranchVisit ? membership.desk_id : null;

      // Overtime must always be measured against the student's actual plan allotment for
      // the day this session falls on, never the duration the staff member happened to type
      // in — otherwise a manually-added session's "scheduled hours" always equals its actual
      // hours and overtime silently never triggers.
      const attendanceDayOfWeek = new Date(new Date(newStartTime).getTime() + IST_OFFSET_MS).getUTCDay();
      const isWeekendAttendance = attendanceDayOfWeek === 0 || attendanceDayOfWeek === 6;
      const scheduledHours = isWeekendAttendance && membership.hours_per_day_weekend != null
        ? Number(membership.hours_per_day_weekend)
        : Number(membership.hours_per_day);

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: deskId,
        membership_id: membership.id, booking_type: bookingType,
        start_time: newStartTime, end_time: newEndTime,
        hours, scheduled_hours: scheduledHours, amount: 0, status: "completed",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      await db.from("students").update({
        total_visits: (student.total_visits ?? 0) + 1,
        total_hours_studied: Number(student.total_hours_studied ?? 0) + hours,
        updated_at: new Date().toISOString(),
      }).eq("id", studentId);

      // Log overtime immediately (unbilled — Pay Later — since there's no live checkout
      // moment for a backfilled session to ask Pay Now/Later), same basis as a normal
      // checkout: scheduled end = check-in + the plan's actual allotment for that day.
      const scheduledEndMs = new Date(newStartTime).getTime() + scheduledHours * 3_600_000;
      const otMinutes = Math.max(0, Math.round((new Date(newEndTime).getTime() - scheduledEndMs) / 60_000));
      if (otMinutes > OVERTIME_GRACE_MINUTES) {
        const { overtimeCharge } = computeOvertimeCharge(otMinutes, 0, 0, false);
        await db.from("overtime_sessions").insert({
          booking_id: booking!.id, student_id: studentId,
          membership_id: membership.id, branch_id: branchId,
          overtime_minutes: otMinutes,
          session_date: toISTDateStr(newStartTime), billed_amount: overtimeCharge, billed_at: null,
        });
      }

      return json({ ok: true, bookingId: booking!.id });
    }

    // ─── PAUSE / RESUME MEMBERSHIP ───
    if (action === "pause_membership") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (mem.is_paused) return err("Membership is already on hold");
      const pausedAtNow = new Date().toISOString();

      // A permanent member's cabin sits idle while they're on hold — free it up so it can
      // be assigned to someone else in the meantime, rather than reserving a seat nobody's
      // using. Resuming will require picking a cabin again (possibly a different one).
      const releasingDesk = mem.category === "permanent" && !!mem.desk_id;
      if (releasingDesk) {
        const { error: deskErr } = await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
        if (deskErr) return err(deskErr.message);
      }

      await db.from("memberships").update({
        is_paused: true, paused_at: pausedAtNow,
        ...(releasingDesk ? { desk_id: null, cabin_no: null } : {}),
      }).eq("id", membershipId);
      await db.from("membership_holds").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        paused_at: pausedAtNow,
      });
      return json({ ok: true, deskReleased: releasingDesk });
    }

    if (action === "resume_membership") {
      const { membershipId, deskId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_paused) return err("Membership is not on hold");

      // Their old cabin was freed for reuse when they paused, so a permanent membership
      // needs a (possibly new) cabin picked before it can resume, to avoid two students
      // colliding on the same seat.
      let newDeskId = mem.desk_id;
      let newCabinNo = mem.cabin_no;
      if (mem.category === "permanent" && !mem.desk_id) {
        if (!deskId) return err("Select a cabin to resume this permanent membership");
        const { data: desk } = await db.from("desks").select("*").eq("id", deskId).eq("branch_id", mem.branch_id).single();
        if (!desk) return err("Cabin not found");
        if (desk.status !== "free") return err("Selected cabin is not available");
        const { error: deskErr } = await db.from("desks").update({ status: "reserved", seat_type: "fixed", assigned_student_id: mem.student_id }).eq("id", deskId);
        if (deskErr) return err(deskErr.message);
        newDeskId = deskId;
        newCabinNo = desk.label;
      }

      // Calendar-day difference (IST), not raw elapsed hours — pausing and resuming on the
      // same IST calendar day is 0 days paused, not a floored-up 1. Using millisecond
      // elapsed time here previously rounded any same-day hold up to a full day, extending
      // the membership by a day it never actually lost.
      const pausedDateStr = toISTDateStr(mem.paused_at);
      const daysPaused = Math.max(0, Math.round(
        (new Date(todayISO() + "T00:00:00Z").getTime() - new Date(pausedDateStr + "T00:00:00Z").getTime()) / 86_400_000,
      ));
      const newEndDate = addDays(mem.end_date, daysPaused);

      await db.from("memberships").update({
        is_paused: false, paused_at: null,
        hold_days: (mem.hold_days ?? 0) + daysPaused,
        end_date: newEndDate, desk_id: newDeskId, cabin_no: newCabinNo,
      }).eq("id", membershipId);
      await db.from("membership_holds")
        .update({ resumed_at: new Date().toISOString(), days_paused: daysPaused })
        .eq("membership_id", membershipId).is("resumed_at", null);
      return json({ ok: true, daysPaused, newEndDate, cabinNo: newCabinNo });
    }

    // ─── CHECKOUT ───
    if (action === "checkout_booking") {
      const { bookingId, overtimeMinutes, overtimePaymentMode, overtimePayNow, settleFoodNow, foodPassPaymentMode } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Booking not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      const isMember = booking.booking_type !== "walkin";
      const FOOD_CARRY_DAYS = 3;

      // A Food Pass holder never pays cash for food at checkout — any bill still marked
      // unpaid (e.g. from before the pass existed) is deducted from the pass automatically.
      const { data: foodPass } = isMember
        ? await db.from("food_passes").select("*").eq("student_id", booking.student_id).maybeSingle()
        : { data: null };

      // A Food Pass balance is never allowed to end a session negative — ordering food
      // against an insufficient balance gets one grace window (skippable at order time),
      // but by checkout the shortfall must be collected, no skip option this time. Checked
      // before any mutation below so a "needs collection" response leaves nothing half-done.
      let passUnpaidBillIds: string[] = [];
      let foodPassNewBalance = 0;
      let foodPassShortfall = 0;
      if (foodPass) {
        const { data: passUnpaidBills } = await db.from("food_bills").select("id, total")
          .eq("student_id", booking.student_id).eq("paid", false);
        passUnpaidBillIds = (passUnpaidBills ?? []).map((b: { id: string }) => b.id);
        const passTotal = (passUnpaidBills ?? []).reduce((s: number, b: { total: number }) => s + Number(b.total), 0);
        const resultingBalance = Number(foodPass.balance) - passTotal;
        if (resultingBalance < 0) {
          foodPassShortfall = -resultingBalance;
          if (!foodPassPaymentMode) {
            return json({ needsFoodPassCollection: true, shortfall: foodPassShortfall });
          }
          // The shortfall is collected as cash/UPI below, so the pass itself settles at 0
          // rather than carrying a negative balance forward.
          foodPassNewBalance = 0;
        } else {
          foodPassNewBalance = resultingBalance;
        }
      }

      // Membership students without a pass can carry an unpaid food bill for up to 3 days
      // across sessions — check by student, not just this booking, since each day is a new booking.
      const { data: memberUnpaidBills } = isMember && !foodPass
        ? await db.from("food_bills").select("id, total, created_at").eq("student_id", booking.student_id).eq("paid", false)
        : { data: null };
      if (memberUnpaidBills?.length) {
        const cutoff = Date.now() - FOOD_CARRY_DAYS * 86_400_000;
        const overdue = memberUnpaidBills.filter(b => new Date(b.created_at).getTime() < cutoff);
        if (overdue.length) {
          const overdueTotal = overdue.reduce((s, b) => s + Number(b.total), 0);
          return err(`Food bill of ₹${overdueTotal} is more than ${FOOD_CARRY_DAYS} days old — settle it before checking out.`);
        }
      }

      // end_time was only ever the *scheduled* end time set at check-in — record the real
      // checkout time here so attendance history (and anything reading end_time) is accurate,
      // especially when the student stayed into overtime.
      await db.from("bookings").update({
        status: "completed", end_time: new Date().toISOString(),
        is_paused: false, paused_at: null, total_pause_minutes: 0,
      }).eq("id", bookingId);

      if (booking.desk_id) {
        const { data: desk } = await db.from("desks").select("seat_type").eq("id", booking.desk_id).single();
        if (desk?.seat_type === "floating") {
          await db.from("desks").update({ status: "free", current_booking_id: null }).eq("id", booking.desk_id);
        } else {
          await db.from("desks").update({ current_booking_id: null }).eq("id", booking.desk_id);
        }
      }

      if (foodPass) {
        // Deduct straight from the pass — no cash prompt, no 3-day rule (that's only for
        // students without a pass). Any shortfall was already gated above: if it would've
        // gone negative, foodPassPaymentMode is guaranteed to be set here, so the balance
        // is topped up by exactly that much in the same breath — it can never end negative.
        if (passUnpaidBillIds.length) {
          await db.from("food_passes").update({
            balance: foodPassNewBalance, updated_at: new Date().toISOString(),
          }).eq("id", foodPass.id);
          for (const billId of passUnpaidBillIds) {
            await db.from("food_bills").update({ paid: true, payment_mode: "other" }).eq("id", billId);
          }
        }
        if (foodPassShortfall > 0) {
          await db.from("transactions").insert({
            student_id: booking.student_id, branch_id: booking.branch_id,
            category: "food", amount: foodPassShortfall, payment_mode: foodPassPaymentMode,
            notes: "Food Pass shortfall collected at checkout", created_by_staff_id: staff.id,
          });
        }
      } else {
        // Walk-ins always settle unpaid food at checkout (no carry-forward concept — the
        // session ends here). Members only settle now if staff explicitly chose to collect it
        // (settleFoodNow); otherwise it carries forward within the 3-day window checked above.
        const unpaidBillsQuery = isMember
          ? db.from("food_bills").select("id, total").eq("student_id", booking.student_id).eq("paid", false)
          : db.from("food_bills").select("id, total").eq("booking_id", bookingId).eq("paid", false);
        const shouldSettleNow = !isMember || settleFoodNow;
        const { data: unpaidBills } = shouldSettleNow ? await unpaidBillsQuery : { data: null };
        if (unpaidBills?.length) {
          const settleMode = overtimePaymentMode ?? booking.payment_mode ?? "cash";
          for (const bill of unpaidBills) {
            await db.from("food_bills").update({ paid: true, payment_mode: settleMode }).eq("id", bill.id);
            await db.from("transactions").insert({
              student_id: booking.student_id, branch_id: booking.branch_id,
              food_bill_id: bill.id, category: "food", amount: bill.total,
              payment_mode: settleMode, created_by_staff_id: staff.id,
            });
          }
        }
      }

      const otMinutes = Number(overtimeMinutes) || 0;

      if (otMinutes > 0) {
        if (booking.booking_type === "walkin") {
          const bookedHours = Number(booking.scheduled_hours ?? booking.hours) || 1;
          const baseFee = Number(booking.amount);
          const isWalkinThreeHour = bookedHours === 3;
          const { overtimeCharge } = computeOvertimeCharge(otMinutes, bookedHours, baseFee, isWalkinThreeHour);
          if (overtimeCharge > 0) {
            await db.from("transactions").insert({
              student_id: booking.student_id, branch_id: booking.branch_id,
              booking_id: bookingId, category: "overtime",
              amount: overtimeCharge,
              payment_mode: overtimePaymentMode ?? booking.payment_mode ?? "cash",
              notes: `${otMinutes}m overtime, flat-rate billed`,
              created_by_staff_id: staff.id,
            });
          }
        } else {
          // Member overtime is always logged (hours + computed amount) regardless of the
          // Pay Now / Pay Later choice, so the record exists either way. Pay Now settles it
          // immediately (billed_at set, transaction recorded today); Pay Later leaves it
          // unbilled — exactly as before this feature — to be picked up at the membership's
          // next renewal/closure settlement instead of today's bill.
          // The 10-hour/₹100 cap is walk-in-only (total visit hours vs. total visit cost) —
          // for a member there's no per-visit "total cost" to cap, so bookedHours=0 here makes
          // the cap trigger purely on overtimeHours itself reaching 10.
          const { overtimeHours, overtimeCharge } = computeOvertimeCharge(otMinutes, 0, 0, false);
          if (overtimeHours > 0) {
            const payNow = !!overtimePayNow;
            await db.from("overtime_sessions").insert({
              booking_id: bookingId,
              student_id: booking.student_id,
              membership_id: booking.membership_id ?? null,
              branch_id: booking.branch_id,
              overtime_minutes: otMinutes,
              session_date: todayISO(),
              billed_amount: overtimeCharge,
              billed_at: payNow ? new Date().toISOString() : null,
            });
            if (payNow && overtimeCharge > 0) {
              await db.from("transactions").insert({
                student_id: booking.student_id, branch_id: booking.branch_id,
                booking_id: bookingId, category: "overtime",
                amount: overtimeCharge, payment_mode: overtimePaymentMode ?? "cash",
                notes: `${otMinutes}m overtime, flat-rate billed`, created_by_staff_id: staff.id,
              });
            }
          }
        }
      }

      return json({ ok: true });
    }

    // ─── STUDENTS LIST (spreadsheet view) ───
    if (action === "list_students") {
      const { branchId, allBranches } = payload;
      let branchIds: string[];
      if (allBranches) {
        if (!isOwner(staff)) return err("Owner only", 403);
        const { data: branchesList } = await db.from("branches").select("id").eq("is_active", true);
        branchIds = (branchesList ?? []).map(b => b.id);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        branchIds = [branchId];
      }

      const { data: students } = await db.from("students").select("*, branches(name)").in("branch_id", branchIds).order("s_no");
      const { data: memberships } = await db.from("memberships").select("*").in("branch_id", branchIds).eq("is_active", true);
      const { data: lockers } = await db.from("lockers").select("*").in("branch_id", branchIds).eq("is_active", true);

      const memByStudent = new Map(memberships?.map(m => [m.student_id, m]) ?? []);
      const lockerByStudent = new Map(lockers?.map(l => [l.student_id, l]) ?? []);

      const rows = (students ?? []).map((s, i) => {
        const mem = memByStudent.get(s.id);
        const locker = lockerByStudent.get(s.id);
        return {
          sNo: s.s_no ?? i + 1,
          id: s.id,
          name: s.name,
          branches: s.branches,
          cabin: mem?.cabin_no ?? "-",
          dueDate: mem?.due_date ?? "-",
          month: mem?.month ?? "-",
          hours: mem?.hours_per_day ?? "-",
          timings: mem?.timings ?? "-",
          locker: locker?.locker_no ?? "-",
          lockerDue: locker?.locker_due_date ?? "-",
          course: s.course ?? "-",
          contact: s.phone,
          status: s.status,
          isOverdue: mem ? mem.due_date < todayISO() && mem.fee_due > 0 : false,
          lockerOverdue: locker ? locker.locker_due_date && locker.locker_due_date < todayISO() : false,
          totalVisits: s.total_visits,
          totalHours: s.total_hours_studied,
        };
      });

      return json({ students: rows });
    }

    if (action === "get_student_profile") {
      const { studentId } = payload;
      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);

      const { data: memberships } = await db.from("memberships").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
      const { data: bookings } = await db.from("bookings").select("*, desks!desk_id(label)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: transactions } = await db.from("transactions").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: locker } = await db.from("lockers").select("*").eq("student_id", studentId).eq("is_active", true).maybeSingle();
      const { data: overtimeSessions } = await db.from("overtime_sessions").select("*").eq("student_id", studentId).order("session_date", { ascending: false }).limit(50);
      const { data: holds } = await db.from("membership_holds").select("*").eq("student_id", studentId).order("paused_at", { ascending: false }).limit(50);
      const { data: discounts } = await db.from("membership_discounts").select("*, staff(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: cashbacksRaw } = await db.from("cashbacks").select("*, staff:granted_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: planChanges } = await db.from("membership_plan_changes").select("*, staff:changed_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: edits } = await db.from("membership_edits").select("*, staff:changed_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);

      // Percent-type cashbacks that are still pending have no fixed rupee value yet — same
      // estimate as the Students page Cashback tab, off this student's current active
      // membership (monthly_fee * months_paid), so the Value column can show it alongside
      // the raw percentage instead of just "5%" with no sense of what that's actually worth.
      const activeMemForCashback = (memberships ?? []).find((m: { is_active: boolean }) => m.is_active);
      const cashbacks = (cashbacksRaw ?? []).map((c: Record<string, unknown>) => {
        let estimatedAmount = null;
        if (c.cashback_type === "fixed") {
          estimatedAmount = Number(c.cashback_value);
        } else if (c.status === "pending") {
          if (activeMemForCashback) {
            estimatedAmount = Number(activeMemForCashback.monthly_fee) * Number(activeMemForCashback.months_paid) * (Number(c.cashback_value) / 100);
          }
        } else {
          estimatedAmount = c.redeemed_amount != null ? Number(c.redeemed_amount) : null;
        }
        return { ...c, estimatedAmount };
      });

      return json({
        student, memberships, bookings, transactions, locker,
        overtimeSessions: overtimeSessions ?? [], holds: holds ?? [], discounts: discounts ?? [],
        cashbacks, planChanges: planChanges ?? [], edits: edits ?? [],
      });
    }

    // Owner-only: permanently move a student (and their active membership) to a
    // different branch. A permanent-cabin desk is physically tied to its old branch, so
    // it's released there rather than dragged along — a permanent member must be handed
    // a specific free desk at the destination branch instead, and the transfer is refused
    // outright if none are available, rather than silently leaving them without a seat.
    if (action === "transfer_student_branch") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { studentId, newBranchId, deskId } = payload;
      if (!studentId || !newBranchId) return err("Student and destination branch are required");

      const { data: student } = await db.from("students").select("id, branch_id").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (student.branch_id === newBranchId) return err("Student is already at this branch");

      const { data: newBranch } = await db.from("branches").select("id").eq("id", newBranchId).eq("is_active", true).maybeSingle();
      if (!newBranch) return err("Destination branch not found");

      const { data: activeMem } = await db.from("memberships").select("id, desk_id, category").eq("student_id", studentId).eq("is_active", true).maybeSingle();

      let newDesk: { id: string; label: string } | null = null;
      if (activeMem?.category === "permanent") {
        if (!deskId) return err("Select a cabin at the destination branch");
        const { data: desk } = await db.from("desks").select("id, label, status").eq("id", deskId).eq("branch_id", newBranchId).maybeSingle();
        if (!desk) return err("Cabin not found at the destination branch");
        if (desk.status !== "free") return err("Selected cabin is no longer available — pick another one");
        newDesk = desk;
      }

      if (activeMem?.desk_id) {
        const { error: releaseErr } = await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", activeMem.desk_id);
        if (releaseErr) return err(releaseErr.message);
      }
      if (newDesk) {
        const { error: reserveErr } = await db.from("desks").update({ status: "reserved", seat_type: "fixed", assigned_student_id: studentId }).eq("id", newDesk.id);
        if (reserveErr) return err(reserveErr.message);
      }
      if (activeMem) {
        const { error: memErr } = await db.from("memberships").update({
          branch_id: newBranchId,
          desk_id: newDesk?.id ?? null, cabin_no: newDesk?.label ?? null,
          seat_type: newDesk ? "fixed" : activeMem.category === "permanent" ? "floating" : undefined,
        }).eq("id", activeMem.id);
        if (memErr) return err(memErr.message);
      }

      await db.from("lockers").update({ is_active: false, deposit_returned: true }).eq("student_id", studentId).eq("is_active", true);

      const { error } = await db.from("students").update({ branch_id: newBranchId }).eq("id", studentId);
      if (error) return err(error.message);

      return json({ ok: true });
    }

    // One-off owner-triggered repair for rows written before the addMonths/addDays
    // timezone fix and the switch to an inclusive-end billing convention — recomputes
    // end_date/due_date purely from each membership's own start_date, months_paid and
    // accumulated hold_days (the source-of-truth fields, which were never wrong), so
    // it's safe to run more than once and only touches rows that actually drifted.
    if (action === "fix_membership_dates") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { data: memberships } = await db.from("memberships")
        .select("id, start_date, months_paid, hold_days, end_date, due_date");
      let fixed = 0;
      for (const m of memberships ?? []) {
        const correctEndDate = addDays(endDateForMonths(m.start_date, m.months_paid), m.hold_days ?? 0);
        const correctDueDate = addDays(endDateForMonths(m.start_date, 1), 1);
        if (correctEndDate !== m.end_date || correctDueDate !== m.due_date) {
          await db.from("memberships").update({ end_date: correctEndDate, due_date: correctDueDate }).eq("id", m.id);
          fixed++;
        }
      }
      return json({ ok: true, checked: (memberships ?? []).length, fixed });
    }

    // One-off owner-triggered repair for Food Pass balances left negative by orders placed
    // before the "never go negative" fix was deployed — that fix only stops *new* orders
    // from overdrawing the pass, it doesn't retroactively correct a balance a pre-fix order
    // already pushed below zero. For each negative balance, the shortfall is converted into
    // a proper unpaid food_bills row (so it's still owed and gets compulsorily collected at
    // the student's next checkout, same as any other shortfall) and the balance is reset to
    // 0. Safe to run more than once — it only touches rows still sitting below zero.
    if (action === "fix_negative_food_pass_balances") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { data: passes } = await db.from("food_passes").select("*").lt("balance", 0);
      let fixed = 0;
      for (const p of passes ?? []) {
        const shortfall = -Number(p.balance);
        await db.from("food_bills").insert({
          branch_id: p.branch_id, student_id: p.student_id,
          subtotal: shortfall, total: shortfall, payment_mode: null, paid: false,
          created_by_staff_id: staff.id,
        });
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", p.id);
        fixed++;
      }
      return json({ ok: true, checked: (passes ?? []).length, fixed });
    }

    if (action === "get_top_students") {
      const { branchId, sortBy, period } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      if (period === "month") {
        const d = new Date();
        const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const { data: bookings } = await db.from("bookings")
          .select("student_id, hours, students(id, name, phone, course)")
          .eq("branch_id", branchId).gte("created_at", monthStart + "T00:00:00Z");
        const byStudent = new Map<string, { id: string; name: string; phone: string; course: string | null; visits: number; hours: number }>();
        for (const b of bookings ?? []) {
          const s = b.students as unknown as { id: string; name: string; phone: string; course: string | null } | null;
          if (!s) continue;
          const row = byStudent.get(s.id) ?? { id: s.id, name: s.name, phone: s.phone, course: s.course, visits: 0, hours: 0 };
          row.visits += 1;
          row.hours += Number(b.hours ?? 0);
          byStudent.set(s.id, row);
        }
        const col = sortBy === "hours" ? "hours" : "visits";
        const rows = [...byStudent.values()].sort((a, b) => b[col] - a[col]).slice(0, 20)
          .map(r => ({ id: r.id, name: r.name, phone: r.phone, course: r.course, total_visits: r.visits, total_hours_studied: r.hours }));
        const { data: activeMemStudents } = rows.length
          ? await db.from("memberships").select("student_id").in("student_id", rows.map(r => r.id)).eq("is_active", true)
          : { data: [] as { student_id: string }[] };
        const memberIds = new Set((activeMemStudents ?? []).map((m: { student_id: string }) => m.student_id));
        return json({ students: rows.map(r => ({ ...r, is_member: memberIds.has(r.id) })) });
      }

      const col = sortBy === "hours" ? "total_hours_studied" : "total_visits";
      const { data } = await db.from("students").select("id, name, phone, total_visits, total_hours_studied, loyalty_tag, course")
        .eq("branch_id", branchId).order(col, { ascending: false }).limit(20);
      const { data: activeMemStudents } = data?.length
        ? await db.from("memberships").select("student_id").in("student_id", data.map((r: { id: string }) => r.id)).eq("is_active", true)
        : { data: [] as { student_id: string }[] };
      const memberIds = new Set((activeMemStudents ?? []).map((m: { student_id: string }) => m.student_id));
      return json({ students: (data ?? []).map((r: { id: string }) => ({ ...r, is_member: memberIds.has(r.id) })) });
    }

    if (action === "record_payment") {
      const { membershipId, amount, paymentMode, cashAmount, upiAmount } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const newDue = Math.max(Number(mem.fee_due) - Number(amount), 0);
      // Only push the due date forward once the balance is fully cleared — otherwise a
      // partial payment would make a still-overdue membership vanish from overdue views.
      const newDueDate = newDue === 0 ? addMonths(mem.due_date, 1) : mem.due_date;
      await db.from("memberships").update({
        fee_due: newDue, due_date: newDueDate, total_paid: Number(mem.total_paid) + Number(amount),
      }).eq("id", membershipId);

      await insertPaymentTransactions(db, {
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
        category: "membership", created_by_staff_id: staff.id,
      }, paymentMode, Number(amount), cashAmount, upiAmount);

      if (newDue === 0) {
        await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      }
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true });
    }

    // Owner-only: reward a loyal/high-hours student by knocking a % or fixed ₹ amount
    // off their currently pending membership fee. No money changes hands — this only
    // reduces fee_due — so it's tracked in its own audited table, not `transactions`.
    if (action === "apply_loyalty_discount") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { membershipId, discountType, discountValue, remarks } = payload;
      if (!["percent", "fixed"].includes(discountType)) return err("Invalid discount type");
      const value = Number(discountValue);
      if (!(value > 0)) return err("Discount value must be greater than 0");

      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      // Available even with nothing pending — a discount on a fully-paid membership (or one
      // larger than what's left owing) banks the leftover as a cashback instead of being wasted.
      const feeDue = Number(mem.fee_due);
      const discountBase = feeDue > 0 ? feeDue : Number(mem.monthly_fee) * Number(mem.months_paid);
      const rawAmount = discountType === "percent" ? discountBase * (value / 100) : value;
      const appliedToFee = Math.min(rawAmount, feeDue);
      const bankedAsCashback = Math.max(rawAmount - feeDue, 0);
      const newDue = feeDue - appliedToFee;

      await db.from("memberships").update({ fee_due: newDue }).eq("id", membershipId);
      await db.from("membership_discounts").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        discount_type: discountType, discount_value: value, discount_amount: appliedToFee,
        remarks: remarks || null, applied_by_staff_id: staff.id,
      });

      let cashbackBankedNote = null;
      if (bankedAsCashback > 0) {
        // Cashbacks can stack — no need to merge into an existing pending one anymore, they're
        // all redeemed together at the next renewal/closure.
        await db.from("cashbacks").insert({
          student_id: mem.student_id, branch_id: mem.branch_id,
          month_label: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
          cashback_type: "fixed", cashback_value: bankedAsCashback,
          notes: `Banked from a discount that exceeded the pending fee${remarks ? ` — ${remarks}` : ""}`,
          granted_by_staff_id: staff.id,
        });
      }

      if (newDue === 0) {
        await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      }
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, discountAmount: appliedToFee, newFeeDue: newDue, bankedAsCashback, cashbackBankedNote });
    }

    // Cashback for a top-hours student this month — staff or owner grants it after checking
    // the leaderboard. Sits pending until consumed at the student's next renewal (discount)
    // or, if they close out instead of renewing, paid out in cash at closure.
    if (action === "grant_cashback") {
      const { studentId, branchId, cashbackType, cashbackValue, monthLabel, notes } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: cbStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!cbStudent || cbStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);
      if (!["percent", "fixed"].includes(cashbackType)) return err("Invalid cashback type");
      const value = Number(cashbackValue);
      if (!(value > 0)) return err("Cashback value must be greater than 0");
      if (cashbackType === "percent" && value > 100) return err("Percentage cashback cannot exceed 100");

      // Redemption only makes sense against a renewal or closure, both of which require
      // an active membership — walk-in-only students have neither.
      const { data: activeMem } = await db.from("memberships").select("id")
        .eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (!activeMem) return err("This student doesn't have an active membership — cashback can only be granted to membership students");

      // Multiple cashbacks can sit pending at once — they're all redeemed together at the
      // student's next renewal or closure, whichever comes first.
      await db.from("cashbacks").insert({
        student_id: studentId, branch_id: branchId, month_label: monthLabel || new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
        cashback_type: cashbackType, cashback_value: value, notes: notes || null, granted_by_staff_id: staff.id,
      });
      return json({ ok: true });
    }

    // Pays out a student's pending cashback(s) in cash right away, without waiting for a
    // renewal (discount) or closure (payout) — e.g. the student wants it now instead.
    // Same base and settlement convention as membership closure: current active
    // membership's monthly_fee * months_paid, marked "settled", logged as a payout.
    if (action === "redeem_cashback_now") {
      const { studentId } = payload;
      const { data: mem } = await db.from("memberships").select("*")
        .eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (!mem) return err("This student doesn't have an active membership");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount, contribs } = await settlePendingCashbacks(db, studentId, cashbackBase);
      if (cashbackAmount <= 0) return err("No pending cashback to redeem");

      for (const c of contribs) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
      await db.from("payouts").insert({
        student_id: studentId, branch_id: mem.branch_id, payout_type: "cashback",
        amount: cashbackAmount, notes: "Cashback redeemed immediately as cash, outside a renewal/closure",
        created_by_staff_id: staff.id,
      });

      return json({ ok: true, cashbackAmount });
    }

    // All cashback grants for a branch, newest first — lets staff/owner see who still has
    // a cashback pending (yet to avail) vs. already redeemed or settled at closure.
    if (action === "list_cashbacks") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: cashbacks } = await db.from("cashbacks")
        .select("*, students(name, phone)")
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });

      // Percent-type cashbacks that are still pending have no fixed rupee value yet — the
      // amount depends on the membership fee it's applied against at renewal/closure. Estimate
      // it off each student's current active membership (monthly_fee * months_paid), the same
      // base renew_membership/close_membership use, so staff can see roughly what it's worth.
      const pendingStudentIds = [...new Set(
        (cashbacks ?? []).filter((c) => c.status === "pending" && c.cashback_type === "percent").map((c) => c.student_id),
      )];
      const { data: activeMems } = pendingStudentIds.length
        ? await db.from("memberships").select("student_id, monthly_fee, months_paid").in("student_id", pendingStudentIds).eq("is_active", true)
        : { data: [] };
      const memByStudent = new Map((activeMems ?? []).map((m: { student_id: string; monthly_fee: number; months_paid: number }) => [m.student_id, m]));

      const rows = (cashbacks ?? []).map((c: Record<string, unknown>) => {
        let estimatedAmount = null;
        if (c.cashback_type === "fixed") {
          estimatedAmount = Number(c.cashback_value);
        } else if (c.status === "pending") {
          const mem = memByStudent.get(c.student_id as string);
          if (mem) estimatedAmount = Number(mem.monthly_fee) * Number(mem.months_paid) * (Number(c.cashback_value) / 100);
        } else {
          estimatedAmount = c.redeemed_amount != null ? Number(c.redeemed_amount) : null;
        }
        return {
          id: c.id,
          studentId: c.student_id,
          studentName: (c.students as { name?: string } | null)?.name ?? "-",
          studentPhone: (c.students as { phone?: string } | null)?.phone ?? "-",
          monthLabel: c.month_label,
          cashbackType: c.cashback_type,
          cashbackValue: c.cashback_value,
          estimatedAmount,
          status: c.status,
          redeemedAmount: c.redeemed_amount,
          redeemedAt: c.redeemed_at,
          notes: c.notes,
          createdAt: c.created_at,
        };
      });

      return json({ cashbacks: rows });
    }

    if (action === "record_locker_payment") {
      const { lockerId, amount, paymentMode, cashAmount, upiAmount } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      const newDue = Math.max(Number(locker.fee_due) - Number(amount), 0);
      await db.from("lockers").update({
        fee_due: newDue, amount_paid: Number(locker.amount_paid) + Number(amount),
      }).eq("id", lockerId);

      await insertPaymentTransactions(db, {
        student_id: locker.student_id, branch_id: locker.branch_id,
        category: "locker", notes: "Locker pending payment", created_by_staff_id: staff.id,
      }, paymentMode, Number(amount), cashAmount, upiAmount);

      return json({ ok: true });
    }

    // ─── FOOD PASS (prepaid wallet) ───
    if (action === "get_food_pass") {
      const { studentId } = payload;
      const { data: student } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);
      const { data: pass } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
      return json({ pass: pass ?? null });
    }

    if (action === "topup_food_pass") {
      const { studentId, branchId, amount, paymentMode } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: passStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!passStudent || passStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);
      const amt = Number(amount);
      if (!(amt > 0)) return err("Top-up amount must be greater than 0");

      // Same eligibility rule as cashback — a currently active membership, not just having
      // held one at some point (so a walk-in, or a student whose membership has since ended,
      // can't top up a Food Pass).
      const { count: activeMembershipCount } = await db.from("memberships")
        .select("*", { count: "exact", head: true }).eq("student_id", studentId).eq("is_active", true);
      if (!activeMembershipCount) return err("Food Pass is only available to students with an active membership");

      const { data: existing } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
      let newBalance;
      if (existing) {
        newBalance = Number(existing.balance) + amt;
        await db.from("food_passes").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        newBalance = amt;
        await db.from("food_passes").insert({ student_id: studentId, branch_id: branchId, balance: newBalance });
      }
      // Real revenue collected now — record it (topups are the only Food Pass event that's actual new money).
      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, category: "food",
        amount: amt, payment_mode: paymentMode ?? "cash", notes: "Food Pass top-up",
        created_by_staff_id: staff.id,
      });
      return json({ ok: true, balance: newBalance });
    }

    // Settles one specific unpaid food bill directly for cash/UPI right at order time — used
    // when a Food Pass order exceeds the available balance and staff choose to collect the
    // shortfall immediately instead of leaving it for compulsory collection at checkout.
    // Deliberately does NOT touch food_passes.balance: the shortfall was never deducted from
    // the pass (create_food_bill leaves it unpaid rather than overdrawing), so collecting cash
    // for it now just settles the bill in place, exactly like a non-pass-holder's unpaid bill.
    if (action === "collect_food_bill_shortfall") {
      const { billId, paymentMode } = payload;
      const { data: bill } = await db.from("food_bills").select("*").eq("id", billId).single();
      if (!bill) return err("Food bill not found");
      if (!requireBranch(staff, bill.branch_id)) return err("Branch access denied", 403);
      if (bill.paid) return err("This bill is already settled");
      await db.from("food_bills").update({ paid: true, payment_mode: paymentMode ?? "cash" }).eq("id", billId);
      await db.from("transactions").insert({
        student_id: bill.student_id, branch_id: bill.branch_id, food_bill_id: bill.id,
        category: "food", amount: bill.total, payment_mode: paymentMode ?? "cash",
        notes: "Food Pass shortfall collected at order time", created_by_staff_id: staff.id,
      });
      return json({ ok: true });
    }

    // Per-row "omit from billing" toggle on the student profile's Overtime History table —
    // waives that specific overtime session without deleting its record. Only meaningful for
    // still-unbilled rows: once a row's already been collected/settled, toggling this after
    // the fact wouldn't undo the money that already changed hands.
    if (action === "set_overtime_excluded") {
      const { overtimeSessionId, excluded } = payload;
      const { data: row } = await db.from("overtime_sessions").select("*").eq("id", overtimeSessionId).single();
      if (!row) return err("Overtime session not found");
      if (!requireBranch(staff, row.branch_id)) return err("Branch access denied", 403);
      if (row.billed_at) return err("This overtime was already billed/settled and can't be excluded");
      await db.from("overtime_sessions").update({ excluded: !!excluded }).eq("id", overtimeSessionId);
      return json({ ok: true });
    }

    // ─── FOOD ───
    if (action === "list_food_items") {
      const { branchId } = payload;
      let q = db.from("food_items").select("*").eq("is_active", true).order("name");
      if (branchId) {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ items: data ?? [] });
    }

    if (action === "create_food_bill") {
      const { branchId, studentId, studentName, studentPhone, bookingId, items, paymentMode, discountType, discountValue, discountAmount, skipFoodPass } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (studentId) {
        const { data: billStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
        if (!billStudent || billStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);
      }

      let subtotal = 0;
      const lineItems = [];
      for (const item of items) {
        const { data: fi } = await db.from("food_items").select("*").eq("id", item.foodItemId).single();
        if (!fi) continue;
        const qty = item.quantity || 1;
        if (fi.quantity != null && qty > fi.quantity) return err(`Only ${fi.quantity} of ${fi.name} available`);
        subtotal += Number(fi.price) * qty;
        lineItems.push({ food_item_id: fi.id, name: fi.name, price: fi.price, quantity: qty });
        if (fi.quantity != null) await db.from("food_items").update({ quantity: fi.quantity - qty }).eq("id", fi.id);
      }

      const disc = Number(discountAmount) || 0;
      const total = Math.max(subtotal - disc, 0);

      // A student with a Food Pass pays through it exclusively — not a choice, a rule. The
      // pass balance itself must never go negative: if this order exceeds what's available,
      // the balance is left untouched and the bill is left unpaid, so it shows up in
      // checkout_booking's unpaid-bills query — collection is compulsory there, not here.
      // Exception: a pass with nothing left on it (skipFoodPass, set by the frontend when the
      // balance is 0) isn't usable at all — treated exactly like the student has no pass, so
      // staff get the normal Pay Now / Pay Later choice instead.
      let payFromPass = false;
      let newPassBalance = null;
      let pass = null;
      let passCoversOrder = false;
      if (studentId && !skipFoodPass) {
        const { data: p } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
        pass = p;
      }
      if (pass) {
        payFromPass = true;
        passCoversOrder = Number(pass.balance) >= total;
        if (passCoversOrder) {
          newPassBalance = Number(pass.balance) - total;
          await db.from("food_passes").update({
            balance: newPassBalance, updated_at: new Date().toISOString(),
          }).eq("id", pass.id);
        } else {
          newPassBalance = Number(pass.balance);
        }
      }

      // Otherwise: no payment mode ⇒ bill is recorded unpaid, carried on the student's tab
      // (membership students get up to 3 days before it must be settled at checkout).
      const isPaid = (payFromPass && passCoversOrder) || (!payFromPass && paymentMode != null);

      const { data: bill, error } = await db.from("food_bills").insert({
        branch_id: branchId, student_id: studentId, booking_id: bookingId,
        student_name: studentName, student_phone: studentPhone,
        subtotal, discount_type: discountType, discount_value: discountValue ?? 0,
        discount_amount: disc, total,
        payment_mode: passCoversOrder ? "other" : (isPaid ? paymentMode : null), paid: isPaid,
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (error) return err(error.message);

      for (const li of lineItems) {
        await db.from("food_bill_items").insert({ food_bill_id: bill!.id, ...li });
      }

      if (isPaid && !payFromPass) {
        await db.from("transactions").insert({
          student_id: studentId, branch_id: branchId, food_bill_id: bill!.id,
          category: "food", amount: total, payment_mode: paymentMode,
          created_by_staff_id: staff.id,
        });
      }

      return json({
        bill: { id: bill!.id, total, subtotal, discountAmount: disc, items: lineItems, paid: isPaid, paidFromPass: payFromPass },
        foodPassBalance: newPassBalance,
        foodPassShortfall: payFromPass && !passCoversOrder ? Math.round((total - Number(newPassBalance)) * 100) / 100 : null,
      });
    }

    if (action === "create_food_item") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { branchId, name, price } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name?.trim() || !price) return err("Name and price are required");
      const { data, error } = await db.from("food_items").insert({
        branch_id: branchId, name: name.trim(), price: Number(price), is_active: true,
      }).select("id").single();
      if (error) return err(error.message);
      return json({ ok: true, item: data });
    }

    if (action === "update_food_item") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { itemId, isActive, price } = payload;
      const updates: Record<string, unknown> = {};
      if (isActive !== undefined) updates.is_active = isActive;
      if (price !== undefined) updates.price = Number(price);
      await db.from("food_items").update(updates).eq("id", itemId);
      return json({ ok: true });
    }

    if (action === "list_food_bills") {
      const { branchId, dateFrom, dateTo } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("food_bills").select("*, food_bill_items(*)").eq("branch_id", branchId)
        .gte("created_at", dateFrom + "T00:00:00Z").lte("created_at", dateTo + "T23:59:59Z")
        .order("created_at", { ascending: false });
      return json({ bills: data ?? [] });
    }

    // ─── REVENUE (owner + staff see own branch only) ───
    if (action === "get_revenue") {
      const { branchId, period, dateFrom, dateTo, allBranches } = payload;
      const range = dateRange(period ?? "today", dateFrom, dateTo);

      let branchFilter: string[] = [];
      if (allBranches && isOwner(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }

      const { data: txns } = await db.from("transactions").select("*")
        .in("branch_id", branchFilter)
        .gte("created_at", range.from + "T00:00:00Z")
        .lte("created_at", range.to + "T23:59:59Z");

      const cats = { desk: 0, membership: 0, food: 0, locker: 0, overtime: 0, fine: 0 };
      const modes = { cash: 0, upi: 0, other: 0 };
      for (const t of txns ?? []) {
        cats[t.category as keyof typeof cats] = (cats[t.category as keyof typeof cats] ?? 0) + Number(t.amount);
        modes[t.payment_mode as keyof typeof modes] = (modes[t.payment_mode as keyof typeof modes] ?? 0) + Number(t.amount);
      }
      const total = Object.values(cats).reduce((a, b) => a + b, 0);

      // Daily trend
      const byDay: Record<string, number> = {};
      for (const t of txns ?? []) {
        const day = t.created_at.slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + Number(t.amount);
      }
      const trend = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));

      // Branch breakdown (useful when allBranches = true)
      const byBranchMap: Record<string, number> = {};
      for (const t of txns ?? []) {
        byBranchMap[t.branch_id] = (byBranchMap[t.branch_id] ?? 0) + Number(t.amount);
      }
      let branchRevenue: { name: string; amount: number }[] = [];
      if (Object.keys(byBranchMap).length > 1) {
        const { data: branchRows } = await db.from("branches").select("id, name").in("id", Object.keys(byBranchMap));
        const nameMap = new Map(branchRows?.map(b => [b.id, b.name]) ?? []);
        branchRevenue = Object.entries(byBranchMap)
          .map(([id, amount]) => ({ name: nameMap.get(id) ?? id, amount }))
          .sort((a, b) => b.amount - a.amount);
      }

      // Cashback payouts, locker deposit refunds, and unused Food Pass balances handed back
      // to students aren't revenue transactions — net them out to show the real final figure.
      const { data: payouts } = await db.from("payouts").select("payout_type, amount")
        .in("branch_id", branchFilter)
        .gte("created_at", range.from + "T00:00:00Z")
        .lte("created_at", range.to + "T23:59:59Z");
      const payoutTotals = { cashback: 0, locker_deposit: 0, food_pass_refund: 0, membership_refund: 0 };
      for (const p of payouts ?? []) {
        payoutTotals[p.payout_type as keyof typeof payoutTotals] = (payoutTotals[p.payout_type as keyof typeof payoutTotals] ?? 0) + Number(p.amount);
      }
      const totalPayouts = Object.values(payoutTotals).reduce((a, b) => a + b, 0);
      const netRevenue = total - totalPayouts;

      return json({
        total, byCategory: cats, byPaymentMode: modes, trend, byBranch: branchRevenue,
        dateFrom: range.from, dateTo: range.to,
        payouts: payoutTotals, totalPayouts, netRevenue,
      });
    }

    if (action === "get_referral_stats") {
      const { branchId, allBranches } = payload;
      let branchFilter: string[] = [];
      if (allBranches && isOwner(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }

      const { data: students } = await db.from("students").select("referral_source")
        .in("branch_id", branchFilter).not("referral_source", "is", null);
      const counts: Record<string, number> = {};
      for (const s of students ?? []) {
        const key = s.referral_source || "unknown";
        counts[key] = (counts[key] ?? 0) + 1;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const rows = Object.entries(counts)
        .map(([source, count]) => ({ source, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 }))
        .sort((a, b) => b.count - a.count);

      return json({ rows, total });
    }

    if (action === "list_transactions") {
      const { branchId, period, dateFrom, dateTo, category, search } = payload;
      const range = dateRange(period ?? "month", dateFrom, dateTo);
      const bid = branchId ?? staff.branch_id;
      if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
      const fromTs = range.from + "T00:00:00Z";
      const toTs = range.to + "T23:59:59Z";

      const wantCashbacks = !category || category === "cashback";
      const wantMembershipRefunds = !category || category === "membership_refund";
      const wantTxns = !category || (category !== "cashback" && category !== "membership_refund");

      let q = db.from("transactions").select("*, students(name, phone), branches(name)")
        .eq("branch_id", bid).gte("created_at", fromTs).lte("created_at", toTs)
        .order("created_at", { ascending: false });
      if (category && wantTxns) q = q.eq("category", category);

      const [{ data }, { data: cashbackRows }, { data: refundRows }] = await Promise.all([
        wantTxns ? q : Promise.resolve({ data: [] as unknown[] }),
        wantCashbacks
          ? db.from("cashbacks").select("id, cashback_type, cashback_value, status, redeemed_amount, created_at, redeemed_at, students(name, phone), branches(name)")
            .eq("branch_id", bid)
            .or(`and(created_at.gte.${fromTs},created_at.lte.${toTs}),and(redeemed_at.gte.${fromTs},redeemed_at.lte.${toTs})`)
          : Promise.resolve({ data: [] as unknown[] }),
        wantMembershipRefunds
          ? db.from("payouts").select("id, amount, created_at, students(name, phone), branches(name)")
            .eq("branch_id", bid).eq("payout_type", "membership_refund")
            .gte("created_at", fromTs).lte("created_at", toTs)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);

      // Shaped to match a normal transaction row (category/amount/payment_mode/created_at,
      // same students/branches joins) so the existing table/CSV export doesn't need two
      // different row shapes — "category" is a readable label since these aren't real rows
      // in the transactions table with a fixed category value to translate.
      type CbRow = { id: string; cashback_type: string; cashback_value: number; status: string; redeemed_amount: number | null; created_at: string; redeemed_at: string | null; students?: unknown; branches?: unknown };
      const cashbackFeed: Record<string, unknown>[] = [];
      for (const c of (cashbackRows as CbRow[] ?? [])) {
        const valueLabel = c.cashback_type === "percent" ? `${c.cashback_value}%` : `₹${Number(c.cashback_value)}`;
        if (c.created_at >= fromTs && c.created_at <= toTs) {
          cashbackFeed.push({
            id: `cashback-grant-${c.id}`, category: `Cashback granted (${valueLabel})`,
            amount: c.cashback_type === "fixed" ? Number(c.cashback_value) : null,
            payment_mode: null, created_at: c.created_at, students: c.students, branches: c.branches,
          });
        }
        if (c.redeemed_at && c.status !== "pending" && c.redeemed_at >= fromTs && c.redeemed_at <= toTs) {
          cashbackFeed.push({
            id: `cashback-${c.status}-${c.id}`, category: `Cashback ${c.status}`,
            amount: c.redeemed_amount != null ? Number(c.redeemed_amount) : null,
            payment_mode: null, created_at: c.redeemed_at, students: c.students, branches: c.branches,
          });
        }
      }

      type RefundRow = { id: string; amount: number; created_at: string; students?: unknown; branches?: unknown };
      const refundFeed = (refundRows as RefundRow[] ?? []).map(r => ({
        id: `membership-refund-${r.id}`, category: "Membership deleted — refund",
        amount: -Number(r.amount), payment_mode: null, created_at: r.created_at,
        students: r.students, branches: r.branches,
      }));

      let rows = [...(data ?? []), ...cashbackFeed, ...refundFeed].sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at));
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r: { students?: { name?: string; phone?: string } }) => r.students?.name?.toLowerCase().includes(s) || r.students?.phone?.includes(s));
      }
      return json({ transactions: rows });
    }

    if (action === "get_daily_report") {
      const { branchId, date, period, dateFrom, dateTo } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      // Staff only ever see a single day; the owner can additionally pick week/month/custom
      // (period-based) to see the same stats aggregated over a range.
      const range = period && isOwner(staff) ? dateRange(period, dateFrom, dateTo) : { from: date ?? todayISO(), to: date ?? todayISO() };
      const fromTs = range.from + "T00:00:00Z";
      const toTs = range.to + "T23:59:59Z";

      const { data: walkins } = await db.from("bookings").select("*, students(name)")
        .eq("branch_id", branchId).eq("booking_type", "walkin")
        .gte("created_at", fromTs).lte("created_at", toTs);

      const { data: newMembers } = await db.from("memberships").select("*, students(name)")
        .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs);

      // Attendance breakdown over the range — how many sessions were temporary vs permanent
      // members vs plain walk-ins, counted by distinct student (not by session, so a member
      // who split their day into two sessions only counts once).
      const { data: rangeBookingsRaw } = await db.from("bookings").select("student_id, booking_type, created_at")
        .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs);
      const rangeBookings = (rangeBookingsRaw ?? []) as { student_id: string; booking_type: string; created_at: string }[];
      const attendanceBreakdown = {
        temporary: new Set(rangeBookings.filter(b => b.booking_type === "temporary").map(b => b.student_id)).size,
        permanent: new Set(rangeBookings.filter(b => b.booking_type === "permanent").map(b => b.student_id)).size,
        walkin: new Set(rangeBookings.filter(b => b.booking_type === "walkin").map(b => b.student_id)).size,
        total: new Set(rangeBookings.map(b => b.student_id)).size,
      };

      // New registrations — brand-new students created at this branch in the range (membership
      // or walk-in, whichever brought them in first).
      const { count: newRegistrations } = await db.from("students")
        .select("*", { count: "exact", head: true }).eq("branch_id", branchId)
        .gte("created_at", fromTs).lte("created_at", toTs);

      // Trend charts (owner, non-single-day views only) — attendance and new-membership
      // registrations bucketed day-by-day, every date shown separately (never combined into
      // week-range buckets), so the owner can see day-on-day movement at a glance.
      let attendanceTrend = null;
      let registrationsTrend = null;
      if (isOwner(staff) && period && period !== "day") {
        const buckets = buildDateBuckets(range.from, range.to, "day");
        attendanceTrend = buckets.map(b => ({
          label: b.label,
          count: new Set(
            rangeBookings.filter(r => { const d = r.created_at.slice(0, 10); return d >= b.start && d <= b.end; }).map(r => r.student_id),
          ).size,
        }));
        registrationsTrend = buckets.map(b => ({
          label: b.label,
          count: (newMembers ?? []).filter((m: { created_at: string }) => { const d = m.created_at.slice(0, 10); return d >= b.start && d <= b.end; }).length,
        }));
      }

      return json({
        date: range.to, dateFrom: range.from, dateTo: range.to,
        walkins, newMembers, attendanceTrend, registrationsTrend,
        attendanceBreakdown, newRegistrations: newRegistrations ?? 0,
      });
    }

    // ─── FEE CONFIG ───
    if (action === "list_fee_config") {
      const { data } = await db.from("fee_config").select("*").order("config_type").order("sort_order");
      return json({ config: data ?? [] });
    }

    if (action === "update_fee_config") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { id, fee } = payload;
      await db.from("fee_config").update({ fee }).eq("id", id);
      return json({ ok: true });
    }

    // ─── STAFF MANAGEMENT ───
    if (action === "list_staff") {
      if (!isOwner(staff)) return err("Owner only", 403);
      // Disambiguated FK hint (!branch_id) is required — staff now has two FKs to branches
      // (branch_id and override_branch_id from the branch-reassignment feature), so the
      // plain `branches(name)` embed is ambiguous to PostgREST and errors out silently.
      const { data } = await db.from("staff").select("id, username, role, display_name, branch_id, is_active, branches!branch_id(name)").order("username");
      return json({ staff: data ?? [] });
    }

    // Kanban board data: every active staff member grouped under their EFFECTIVE branch for
    // today (override branch if one's set for today, otherwise their home branch) — so a
    // substitute shows up under the branch they're covering, not their home branch.
    if (action === "get_staff_grid") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { data: branches } = await db.from("branches").select("id, name").eq("is_active", true).order("name");
      const { data: allStaff } = await db.from("staff").select("id, username, display_name, role, branch_id, override_branch_id, override_date")
        .eq("is_active", true).neq("role", "owner").order("display_name");

      const today = todayISO();
      const staffRows = (allStaff ?? []).map((s: { id: string; username: string; display_name: string | null; role: string; branch_id: string | null; override_branch_id: string | null; override_date: string | null }) => {
        const isOverrideToday = !!s.override_branch_id && s.override_date === today;
        return {
          id: s.id, username: s.username, displayName: s.display_name || s.username,
          homeBranchId: s.branch_id, effectiveBranchId: isOverrideToday ? s.override_branch_id : s.branch_id,
          isOverrideToday,
        };
      });

      return json({ date: today, branches: branches ?? [], staff: staffRows });
    }

    // Owner drags a staff card onto a different branch column — assigns them there for
    // today only. Dropping back onto their own home branch column clears the override.
    if (action === "assign_staff_override") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { staffId, branchId } = payload;
      const { data: target } = await db.from("staff").select("id, role, branch_id").eq("id", staffId).single();
      if (!target) return err("Staff not found");
      if (target.role === "owner") return err("Can't reassign an owner account");
      const { data: branch } = await db.from("branches").select("id").eq("id", branchId).single();
      if (!branch) return err("Branch not found");

      const today = todayISO();
      if (branchId === target.branch_id) {
        await db.from("staff").update({ override_branch_id: null, override_date: null }).eq("id", staffId);
      } else {
        await db.from("staff").update({ override_branch_id: branchId, override_date: today }).eq("id", staffId);
      }
      return json({ ok: true });
    }

    // Manually revert a staff member to their home branch before the day is over.
    if (action === "clear_staff_override") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { staffId } = payload;
      await db.from("staff").update({ override_branch_id: null, override_date: null }).eq("id", staffId);
      return json({ ok: true });
    }

    // ─── TASKS (two-way assignment) ───
    if (action === "list_branch_staff") {
      const { branchId } = payload;
      let q = db.from("staff").select("id, username, display_name, role, branch_id").eq("is_active", true).order("display_name");
      if (isOwner(staff)) {
        // Include the owner themself (branch_id is null for owner accounts) so they can
        // self-assign a task regardless of which branch they're currently viewing.
        if (branchId) q = q.or(`branch_id.eq.${branchId},role.eq.owner`);
      } else {
        // Staff can also assign tasks to the owner, so include owner accounts (branch_id is
        // null for them) alongside this staff member's own branch.
        q = q.or(`branch_id.eq.${staff.branch_id!},role.eq.owner`);
      }
      const { data } = await q;
      const results = data ?? [];
      // Owner may not be tied to any single branch — always let them self-assign
      if (isOwner(staff) && !results.some(s => s.id === staff.id)) {
        const { data: ownerRow } = await db.from("staff").select("id, username, display_name, role, branch_id").eq("id", staff.id).single();
        if (ownerRow) results.push(ownerRow);
      }
      return json({ staff: results });
    }

    if (action === "create_task") {
      const { branchId, assignedToStaffId, assignedToStaffIds, title, description, dueDate, repeatInterval } = payload;
      // Accepts either the older single assignedToStaffId, or a list to assign the same
      // task to several staff members at once — each gets their own independent task row
      // (own completion status), just created together in one go.
      const staffIds: string[] = assignedToStaffIds?.length ? assignedToStaffIds : (assignedToStaffId ? [assignedToStaffId] : []);
      if (!title) return err("Title is required");
      if (!staffIds.length) return err("Please select at least one person to assign this task to");
      if (repeatInterval && !["none", "daily", "weekly", "monthly"].includes(repeatInterval)) return err("Invalid repeat interval");
      const targetBranchId = branchId ?? staff.branch_id;
      if (!isOwner(staff)) {
        if (!targetBranchId || targetBranchId !== staff.branch_id) return err("Branch access denied", 403);
        if (dueDate && dueDate < todayISO()) return err("Cannot assign a task on a past date");
        const { data: assignees } = await db.from("staff").select("id, branch_id, role").in("id", staffIds);
        const allValid = assignees?.length === staffIds.length
          && assignees.every(a => a.role === "owner" || a.branch_id === staff.branch_id);
        if (!allValid) return err("Can only assign tasks to staff in your branch, or the owner");
      }
      const rows = staffIds.map(sid => ({
        branch_id: targetBranchId, assigned_by_staff_id: staff.id, assigned_to_staff_id: sid,
        title, description: description ?? null, due_date: dueDate ?? null,
        repeat_interval: repeatInterval ?? "none",
      }));
      const { data: tasks, error: tErr } = await db.from("tasks").insert(rows).select("*");
      if (tErr) return err(tErr.message);
      return json({ ok: true, tasks });
    }

    if (action === "list_tasks") {
      const { branchId, allBranches, date } = payload;
      const targetDate = date || todayISO();
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username, is_active), assigned_by:assigned_by_staff_id(display_name, username), branches(name)")
        .order("created_at", { ascending: false });
      if (isOwner(staff)) {
        if (!allBranches && branchId) q = q.eq("branch_id", branchId);
      } else {
        const bid = staff.branch_id;
        if (!bid) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid).or(`assigned_to_staff_id.eq.${staff.id},assigned_by_staff_id.eq.${staff.id}`);
        const ownerIds = await getOwnerStaffIds(db);
        if (ownerIds.length) q = q.not("assigned_to_staff_id", "in", `(${ownerIds.join(",")})`);
      }
      const { data, error: lErr } = await q;
      if (lErr) return err(lErr.message);

      const recurringIds = (data ?? []).filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", targetDate).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));

      const tasks = (data ?? []).map(t => ({
        ...t,
        dueToday: isTaskDueOn(t, targetDate) && (t.assigned_to?.is_active !== false || targetDate < todayISO()),
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));

      return json({ tasks });
    }

    if (action === "update_task_status") {
      const { taskId, done, date } = payload;
      const targetDate = date || todayISO();
      const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
      if (!task) return err("Task not found");
      // Only the assignee can mark their own task complete — except the owner, who can
      // manually set completion status on any staff member's task (e.g. clearing missed
      // items in the Incomplete Tasks list).
      if (task.assigned_to_staff_id !== staff.id && !isOwner(staff)) {
        return err("Only the person a task is assigned to can complete it", 403);
      }
      if (task.repeat_interval === "none") {
        await db.from("tasks").update({
          status: done ? "done" : "pending", completed_at: done ? new Date().toISOString() : null,
        }).eq("id", taskId);
      } else if (done) {
        await db.from("task_completions").upsert(
          { task_id: taskId, completion_date: targetDate },
          { onConflict: "task_id,completion_date", ignoreDuplicates: true },
        );
      } else {
        await db.from("task_completions").delete().eq("task_id", taskId).eq("completion_date", targetDate);
      }
      return json({ ok: true });
    }

    if (action === "get_my_tasks_today") {
      const { data } = await db.from("tasks").select("*, branches(name)").eq("assigned_to_staff_id", staff.id);
      const today = todayISO();
      const dueTasks = (data ?? []).filter(t => isTaskDueOn(t, today));
      const recurringIds = dueTasks.filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", today).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));
      const tasks = dueTasks.map(t => ({
        ...t,
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));
      return json({ tasks });
    }

    if (action === "get_task_completion_report") {
      const { branchId, allBranches, date } = payload;
      const targetDate = date || todayISO();
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username, is_active), branches(name)");
      if (isOwner(staff)) {
        if (!allBranches && branchId) q = q.eq("branch_id", branchId);
      } else {
        const bid = staff.branch_id;
        if (!bid) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid);
        const ownerIds = await getOwnerStaffIds(db);
        if (ownerIds.length) q = q.not("assigned_to_staff_id", "in", `(${ownerIds.join(",")})`);
      }
      const { data, error: rErr } = await q;
      if (rErr) return err(rErr.message);

      const dueTasks = (data ?? []).filter(t => isTaskDueOn(t, targetDate) && (t.assigned_to?.is_active !== false || targetDate < todayISO()));
      const recurringIds = dueTasks.filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", targetDate).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));

      const tasks = dueTasks.map(t => ({
        ...t,
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));

      return json({ date: targetDate, tasks });
    }

    if (action === "list_incomplete_tasks") {
      const { branchId, allBranches } = payload;
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username), assigned_by:assigned_by_staff_id(display_name, username), branches(name)");
      if (isOwner(staff)) {
        if (!allBranches && branchId) q = q.eq("branch_id", branchId);
      } else {
        const bid = staff.branch_id;
        if (!bid) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid).or(`assigned_to_staff_id.eq.${staff.id},assigned_by_staff_id.eq.${staff.id}`);
        const ownerIds = await getOwnerStaffIds(db);
        if (ownerIds.length) q = q.not("assigned_to_staff_id", "in", `(${ownerIds.join(",")})`);
      }
      const { data, error: tErr } = await q;
      if (tErr) return err(tErr.message);

      const today = todayISO();
      const LOOKBACK_DAYS = 7;
      const windowStart = addDays(today, -LOOKBACK_DAYS);

      const recurringIds = (data ?? []).filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id, completion_date").in("task_id", recurringIds).gte("completion_date", windowStart)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => `${c.task_id}:${c.completion_date}`));

      const missed: Array<Record<string, unknown>> = [];
      for (const t of data ?? []) {
        if (t.repeat_interval === "none") {
          if (t.due_date && t.due_date < today && t.due_date >= windowStart && t.status !== "done") {
            missed.push({
              id: `${t.id}:${t.due_date}`, taskId: t.id, title: t.title, description: t.description,
              repeatInterval: t.repeat_interval, missedDate: t.due_date, branchName: t.branches?.name ?? null,
              assignedTo: t.assigned_to, assignedBy: t.assigned_by, assignedToStaffId: t.assigned_to_staff_id,
            });
          }
          continue;
        }
        const anchor = t.due_date ?? t.created_at.slice(0, 10);
        let cursor = anchor > windowStart ? anchor : windowStart;
        while (cursor < today) {
          if (isTaskDueOn(t, cursor) && !completedSet.has(`${t.id}:${cursor}`)) {
            missed.push({
              id: `${t.id}:${cursor}`, taskId: t.id, title: t.title, description: t.description,
              repeatInterval: t.repeat_interval, missedDate: cursor, branchName: t.branches?.name ?? null,
              assignedTo: t.assigned_to, assignedBy: t.assigned_by, assignedToStaffId: t.assigned_to_staff_id,
            });
          }
          cursor = addDays(cursor, 1);
        }
      }

      missed.sort((a, b) => (b.missedDate as string).localeCompare(a.missedDate as string));
      return json({ tasks: missed });
    }

    if (action === "list_staff_attendance") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const targetDate = payload?.date || todayISO();

      // Disambiguated FK hint — see the comment in list_staff for why this is required now.
      const { data: allStaff } = await db.from("staff").select("id, username, display_name, branch_id, is_active, branches!branch_id(name)")
        .eq("is_active", true).neq("role", "owner").order("display_name");
      const { data: present } = await db.from("staff_attendance").select("staff_id, first_login_at, last_logout_at")
        .eq("attendance_date", targetDate);
      const presentMap = new Map((present ?? []).map((p: { staff_id: string; first_login_at: string; last_logout_at: string | null }) => [p.staff_id, p]));

      const rows = (allStaff ?? []).map(s => {
        const rec = presentMap.get(s.id);
        return {
          staffId: s.id, displayName: s.display_name || s.username,
          branchId: s.branch_id ?? null, branchName: s.branches?.name ?? null,
          present: !!rec, firstLoginAt: rec?.first_login_at ?? null, lastLogoutAt: rec?.last_logout_at ?? null,
        };
      });

      return json({ date: targetDate, rows });
    }

    // Self-service: any staff (including owner) can mark when they end their session for
    // the day. No-op if they never logged in today (nothing to end).
    if (action === "end_staff_session") {
      const { password } = payload;
      if (!password) return err("Password required");
      // Confirms it's really this staff member ending their own day, not someone else
      // grabbing an unlocked, unattended computer — re-verifies their password the same
      // way login does, without issuing a new token.
      const { data: check } = await db.rpc("verify_staff_login", { p_username: staff.username, p_password: password });
      if (!check?.length || check[0].id !== staff.id) return err("Incorrect password", 401);

      const today = todayISO();
      await db.from("staff_attendance").update({ last_logout_at: new Date().toISOString() })
        .eq("staff_id", staff.id).eq("attendance_date", today);
      return json({ ok: true });
    }

    if (action === "create_staff") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { username, password, displayName, role, branchId } = payload;
      const { data: hash } = await db.rpc("hash_staff_password", { plain_password: password });
      const { error } = await db.from("staff").insert({
        username, password_hash: hash, role: role ?? "staff",
        display_name: displayName, branch_id: branchId,
      });
      if (error) return err(error.code === "23505" ? "That username is already taken (usernames aren't case-sensitive)" : error.message);
      return json({ ok: true });
    }

    // Edit an existing staff account's credentials/branch, or toggle is_active.
    // verify_staff_login already requires is_active = true, so deactivating here
    // immediately blocks that account from signing in — and authStaff() re-checks
    // is_active on every request, so an already-issued token stops working too.
    if (action === "update_staff") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { staffId, username, newPassword, displayName, branchId, isActive } = payload;
      if (!staffId) return err("Staff ID required");
      const { data: target } = await db.from("staff").select("id, role, is_active").eq("id", staffId).single();
      if (!target) return err("Staff not found");
      if (target.role === "owner") return err("Owner accounts can't be edited here");
      if (staffId === staff.id) return err("You can't edit your own account from here");
      // Deactivation is permanent — once a staff account is turned off it can never be
      // switched back on, so this deliberately does not accept isActive: true on an
      // already-inactive account.
      if (!target.is_active) return err("This staff account has been permanently removed and cannot be reactivated");

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (username !== undefined && username !== "") updates.username = username;
      if (displayName !== undefined) updates.display_name = displayName;
      if (branchId !== undefined && branchId !== "") updates.branch_id = branchId;
      if (isActive === false) updates.is_active = false;
      if (newPassword) {
        const { data: hash } = await db.rpc("hash_staff_password", { plain_password: newPassword });
        updates.password_hash = hash;
      }

      const { error } = await db.from("staff").update(updates).eq("id", staffId);
      if (error) return err(error.code === "23505" ? "That username is already taken (usernames aren't case-sensitive)" : error.message);

      // Deactivation removes the account permanently, so its tasks (recurring and
      // one-time alike) are removed too rather than left dangling — new occurrences
      // were already blocked by the is_active gate in list_tasks/get_task_completion_report,
      // this clears out what already existed.
      if (isActive === false) {
        const { data: ownTasks } = await db.from("tasks").select("id").eq("assigned_to_staff_id", staffId);
        const taskIds = (ownTasks ?? []).map(t => t.id);
        if (taskIds.length) await db.from("task_completions").delete().in("task_id", taskIds);
        await db.from("tasks").delete().eq("assigned_to_staff_id", staffId);
      }

      return json({ ok: true });
    }

    // ─── MESSAGES ───
    if (action === "list_messages") {
      const { branchId, channel } = payload;
      let q = db.from("messages")
        .select("*, staff:sender_staff_id(display_name, username), students:recipient_student_id(name, phone)")
        .order("sent_at", { ascending: false }).limit(50);
      if (channel === "all") {
        q = q.is("branch_id", null);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ messages: data ?? [] });
    }

    if (action === "send_message") {
      const { branchId, channel, recipientType, recipientStudentId, recipientStaffId, content } = payload;
      const isAllStaffChannel = channel === "all";
      if (!isAllStaffChannel && !requireBranch(staff, branchId)) return err("Branch access denied", 403);
      await db.from("messages").insert({
        branch_id: isAllStaffChannel ? null : branchId, sender_staff_id: staff.id,
        recipient_type: recipientType, recipient_student_id: recipientStudentId,
        recipient_staff_id: recipientStaffId, content,
      });
      return json({ ok: true });
    }

    // ─── ALERTS ───
    if (action === "list_alerts") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("alerts").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("status", "pending").order("due_date");
      return json({ alerts: data ?? [] });
    }

    if (action === "resolve_alert") {
      const { alertId } = payload;
      const { data: alert } = await db.from("alerts").select("branch_id").eq("id", alertId).single();
      if (!alert) return err("Alert not found", 404);
      if (!requireBranch(staff, alert.branch_id)) return err("Branch access denied", 403);
      await db.from("alerts").update({ status: "resolved" }).eq("id", alertId);
      return json({ ok: true });
    }

    // ─── ACTIONABLE ITEMS ───
    if (action === "get_actionable_items") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const today = todayISO();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

      // Any outstanding balance is actionable, regardless of due_date — due_date is always
      // set a month out even on a same-day partial payment, so gating on it would hide a
      // real balance for a full month.
      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone, course)")
        .eq("branch_id", branchId).eq("is_active", true).gt("fee_due", 0);

      const { data: expiringSoon } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true)
        .gte("end_date", today).lte("end_date", addDays(today, 7));

      const { data: expiredMemberships } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("end_date", today);

      const { data: overdueLockers } = await db.from("lockers").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("locker_due_date", today);

      return json({
        dueToday: dueToday ?? [], expiringSoon: expiringSoon ?? [],
        expiredMemberships: expiredMemberships ?? [], overdueLockers: overdueLockers ?? [],
      });
    }

    // ─── TODAY'S BOOKINGS ───
    if (action === "list_today_bookings") {
      const { branchId, allBranches } = payload;
      let branchIds: string[];
      if (allBranches) {
        if (!isOwner(staff)) return err("Owner only", 403);
        const { data: branchesList } = await db.from("branches").select("id").eq("is_active", true);
        branchIds = (branchesList ?? []).map(b => b.id);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        branchIds = [branchId];
      }
      // status = "active" already means "not yet checked out" — that's true regardless of
      // which day the session started, so no date filter here. A leftover date range meant a
      // session staff forgot to check out would silently vanish from this tab the next day
      // even though it was still genuinely open; sessions now only ever leave this list when
      // checkout_booking explicitly closes them.
      const { data, error: bErr } = await db.from("bookings")
        .select("*, students(name, phone, course), desks!desk_id(label, seat_type), memberships:membership_id(total_paid, fee_due, monthly_fee, category, end_date), branches(name)")
        .in("branch_id", branchIds)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (bErr) return err(bErr.message);

      const bookingIds = (data ?? []).map(b => b.id);
      const { data: foodBills } = bookingIds.length
        ? await db.from("food_bills").select("booking_id, total, paid").in("booking_id", bookingIds)
        : { data: [] };
      const foodTotals = new Map<string, number>();
      const unpaidFoodTotalsByBooking = new Map<string, number>();
      for (const fb of foodBills ?? []) {
        foodTotals.set(fb.booking_id, (foodTotals.get(fb.booking_id) ?? 0) + Number(fb.total));
        if (!fb.paid) unpaidFoodTotalsByBooking.set(fb.booking_id, (unpaidFoodTotalsByBooking.get(fb.booking_id) ?? 0) + Number(fb.total));
      }

      // A student can renew mid-session — pull each member's *current* active membership
      // rather than trusting the (possibly now-superseded) membership_id stored on the booking.
      const memberStudentIds = [...new Set((data ?? []).filter((b: any) => b.booking_type !== "walkin").map((b: any) => b.student_id))];
      const { data: activeMems } = memberStudentIds.length
        ? await db.from("memberships").select("student_id, total_paid, fee_due, monthly_fee, category, end_date")
            .in("student_id", memberStudentIds).eq("is_active", true)
        : { data: [] };
      const activeMemByStudent = new Map((activeMems ?? []).map((m: any) => [m.student_id, m]));

      // Members can carry an unpaid food bill across days (different booking_id each day),
      // so their unpaid total must be summed by student, not by today's booking alone.
      const { data: memberUnpaidBills } = memberStudentIds.length
        ? await db.from("food_bills").select("student_id, total").in("student_id", memberStudentIds).eq("paid", false)
        : { data: [] };
      const unpaidFoodTotalsByStudent = new Map<string, number>();
      for (const fb of memberUnpaidBills ?? []) {
        unpaidFoodTotalsByStudent.set(fb.student_id, (unpaidFoodTotalsByStudent.get(fb.student_id) ?? 0) + Number(fb.total));
      }

      // Food Pass holders never see a "pending, pay cash" food bill — it's auto-settled from
      // the pass at checkout — so the frontend needs to know who has one.
      const { data: foodPasses } = memberStudentIds.length
        ? await db.from("food_passes").select("student_id").in("student_id", memberStudentIds)
        : { data: [] };
      const foodPassStudentIds = new Set((foodPasses ?? []).map((p: { student_id: string }) => p.student_id));

      const bookings = (data ?? []).map(b => ({
        ...b,
        memberships: activeMemByStudent.get(b.student_id) ?? b.memberships,
        foodTotal: foodTotals.get(b.id) ?? 0,
        unpaidFoodTotal: b.booking_type === "walkin" ? (unpaidFoodTotalsByBooking.get(b.id) ?? 0) : (unpaidFoodTotalsByStudent.get(b.student_id) ?? 0),
        hasFoodPass: foodPassStudentIds.has(b.student_id),
      }));
      return json({ bookings });
    }

    // ─── PAUSE / RESUME SESSION ───
    if (action === "pause_session") {
      const { bookingId } = payload;
      const { data: bk } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!bk) return err("Booking not found");
      if (!requireBranch(staff, bk.branch_id)) return err("Branch access denied", 403);
      if (bk.is_paused) return err("Session is already on break");
      await db.from("bookings").update({
        is_paused: true, paused_at: new Date().toISOString(),
      }).eq("id", bookingId);
      return json({ ok: true });
    }

    if (action === "resume_session") {
      const { bookingId } = payload;
      const { data: bk } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!bk) return err("Booking not found");
      if (!requireBranch(staff, bk.branch_id)) return err("Branch access denied", 403);
      if (!bk.is_paused) return err("Session is not on break");

      const pausedAt = new Date(bk.paused_at);
      const minutesPaused = Math.ceil((Date.now() - pausedAt.getTime()) / 60_000);
      const totalPause = (bk.total_pause_minutes ?? 0) + minutesPaused;
      const newEnd = new Date(new Date(bk.end_time).getTime() + minutesPaused * 60_000).toISOString();

      await db.from("bookings").update({
        is_paused: false, paused_at: null,
        total_pause_minutes: totalPause, end_time: newEnd,
      }).eq("id", bookingId);
      return json({ ok: true, minutesPaused, newEndTime: newEnd });
    }

    // ─── ACTIVE MEMBERSHIPS ───
    if (action === "list_active_memberships") {
      const { branchId, allBranches } = payload;
      let branchIds: string[];
      if (allBranches) {
        if (!isOwner(staff)) return err("Owner only", 403);
        const { data: branchesList } = await db.from("branches").select("id").eq("is_active", true);
        branchIds = (branchesList ?? []).map(b => b.id);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        branchIds = [branchId];
      }
      const { data } = await db.from("memberships")
        .select("id, branch_id, category, hours_per_day, start_date, end_date, cabin_no, is_paused, hold_days, fee_due, total_paid, students(id, name, phone), branches(name)")
        .in("branch_id", branchIds)
        .eq("is_active", true)
        .order("end_date");
      type MemRow = { id: string; branch_id: string; category: string; hours_per_day: number; start_date: string; end_date: string; cabin_no: string | null; is_paused: boolean; hold_days: number; fee_due: number; total_paid: number; students: { id: string; name: string; phone: string } | null; branches: { name: string } | null };
      const studentIds = (data as MemRow[] ?? []).map(m => m.students?.id).filter((id): id is string => !!id);
      const { data: pendingCashbacks } = studentIds.length
        ? await db.from("cashbacks").select("student_id, cashback_type, cashback_value").in("student_id", studentIds).eq("status", "pending")
        : { data: [] };
      const cashbackByStudent = new Map((pendingCashbacks ?? []).map((c: { student_id: string; cashback_type: string; cashback_value: number }) => [c.student_id, c]));

      const members = (data as MemRow[] ?? []).map(m => ({
        membership_id: m.id,
        branch_id: m.branch_id,
        branches: m.branches,
        student_id: m.students?.id,
        student_name: m.students?.name,
        student_phone: m.students?.phone,
        category: m.category,
        hours_per_day: m.hours_per_day,
        cabin_no: m.cabin_no,
        start_date: m.start_date,
        end_date: m.end_date,
        is_paused: m.is_paused,
        hold_days: m.hold_days,
        fee_due: m.fee_due,
        total_paid: m.total_paid,
        pending_cashback: m.students?.id ? (cashbackByStudent.get(m.students.id) ?? null) : null,
      }));

      // Remind staff to collect renewal during the student's final week of validity —
      // kept alive (re-upserted) every time this list loads, resolved on renew/close.
      const today = todayISO();
      const weekOut = addDays(today, 7);
      for (const m of members) {
        if (!m.student_id) continue;
        if (m.end_date >= today && m.end_date <= weekOut) {
          await createAlert(db, m.student_id, m.branch_id, "expiry", m.end_date,
            `${m.student_name}'s membership expires on ${m.end_date} — remind them to renew.`);
        }
      }

      return json({ members });
    }

    // Mid-cycle plan change (temp <-> permanent, or an hours/day change) on the CURRENT
    // active membership — doesn't touch the expiry date or months_paid, just prorates the
    // difference between old and new daily rate over the days remaining in the cycle.
    // Logged to membership_plan_changes so the closure summary can show every plan a
    // student was on during this membership period.
    if (action === "change_membership_plan") {
      const { membershipId, newCategory, newHoursPerDay, newEndDate } = payload;
      if (!["temporary", "permanent"].includes(newCategory)) return err("Invalid category");
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_active) return err("Membership is not active");
      if (mem.end_date < todayISO()) return err("Membership has expired — renew it before changing the plan");

      const newHours = Number(newHoursPerDay);
      const newMonthlyFee = await getMembershipPackage(db, newHours, newCategory);
      if (!newMonthlyFee) return err("Invalid membership package for that category/hours combination");
      const planUnchanged = newCategory === mem.category && newHours === Number(mem.hours_per_day);
      const wantsEndDateChange = newEndDate && newEndDate !== mem.end_date;
      if (planUnchanged && !wantsEndDateChange) {
        return err("That's already the current plan");
      }

      const today = todayISO();
      const remainingDays = Math.max(1, Math.ceil((new Date(mem.end_date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86_400_000));
      const oldDailyRate = Number(mem.monthly_fee) / 30;
      const newDailyRate = newMonthlyFee / 30;
      const proratedAmount = Math.round((newDailyRate - oldDailyRate) * remainingDays);

      // Reassign the cabin/seat if the category is changing, same as at renewal.
      let seatType = mem.seat_type;
      let deskId = mem.desk_id;
      let cabinNo = mem.cabin_no;
      if (newCategory !== mem.category) {
        if (mem.desk_id) {
          await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
          deskId = null;
          cabinNo = null;
        }
        seatType = newCategory === "permanent" ? "fixed" : "floating";
        if (newCategory === "permanent") {
          const { data: freeDesk } = await db.from("desks").select("*")
            .eq("branch_id", mem.branch_id).eq("status", "free").order("sort_order").limit(1).maybeSingle();
          if (!freeDesk) return err("No cabin available for permanent membership");
          deskId = freeDesk.id;
          cabinNo = freeDesk.label;
          await db.from("desks").update({ status: "reserved", seat_type: "fixed", assigned_student_id: mem.student_id }).eq("id", deskId);
        }
      }

      // A cheaper plan credits the difference against fee_due (and banks any leftover as
      // cashback, same pattern as a discount); a pricier plan adds to fee_due to be collected.
      let newFeeDue = Number(mem.fee_due);
      let bankedAsCashback = 0;
      if (proratedAmount > 0) {
        newFeeDue += proratedAmount;
      } else if (proratedAmount < 0) {
        const credit = -proratedAmount;
        const appliedToFee = Math.min(credit, newFeeDue);
        newFeeDue -= appliedToFee;
        bankedAsCashback = credit - appliedToFee;
        if (bankedAsCashback > 0) {
          await db.from("cashbacks").insert({
            student_id: mem.student_id, branch_id: mem.branch_id,
            month_label: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
            cashback_type: "fixed", cashback_value: bankedAsCashback,
            notes: "Banked from a plan downgrade credit that exceeded the pending fee",
            granted_by_staff_id: staff.id,
          });
        }
      }

      // due_date is always the day right after end_date (the inclusive-end billing
      // convention — see endDateForMonths) — a manual end-date edit must shift it in step
      // so the two never drift apart.
      await db.from("memberships").update({
        category: newCategory, hours_per_day: newHours, monthly_fee: newMonthlyFee,
        seat_type: seatType, desk_id: deskId, cabin_no: cabinNo, fee_due: newFeeDue,
        ...(wantsEndDateChange ? { end_date: newEndDate, due_date: addDays(newEndDate, 1) } : {}),
      }).eq("id", membershipId);

      if (!planUnchanged) {
        await db.from("membership_plan_changes").insert({
          membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
          old_category: mem.category, old_hours_per_day: mem.hours_per_day, old_monthly_fee: mem.monthly_fee,
          new_category: newCategory, new_hours_per_day: newHours, new_monthly_fee: newMonthlyFee,
          prorated_amount: proratedAmount, changed_by_staff_id: staff.id,
        });
      }
      if (wantsEndDateChange) {
        await db.from("membership_edits").insert({
          membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
          edit_type: "end_date", old_value: mem.end_date, new_value: newEndDate,
          changed_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, proratedAmount, newFeeDue, bankedAsCashback, remainingDays });
    }

    // Reassign a permanent member to a different cabin/desk — e.g. they asked to move, or
    // the current desk needs to be freed up for maintenance.
    if (action === "change_membership_cabin") {
      const { membershipId, deskId: newDeskId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_active) return err("Membership is not active");
      if (mem.end_date < todayISO()) return err("Membership has expired — renew it before changing the cabin");
      if (mem.category !== "permanent") return err("Only permanent memberships have an assigned cabin");

      const { data: newDesk } = await db.from("desks").select("*").eq("id", newDeskId).eq("branch_id", mem.branch_id).single();
      if (!newDesk) return err("Desk not found");
      if (newDesk.status !== "free") return err("Selected cabin is not available");

      if (mem.desk_id) {
        await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
      }
      await db.from("desks").update({ status: "reserved", seat_type: "fixed", assigned_student_id: mem.student_id }).eq("id", newDesk.id);
      await db.from("memberships").update({ desk_id: newDesk.id, cabin_no: newDesk.label }).eq("id", membershipId);
      await db.from("membership_edits").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        edit_type: "cabin", old_value: mem.cabin_no, new_value: newDesk.label,
        changed_by_staff_id: staff.id,
      });

      // If they're currently mid-session in the old cabin, move the active booking's desk too.
      const { data: activeBooking } = await db.from("bookings").select("id, desk_id")
        .eq("membership_id", membershipId).eq("status", "active").maybeSingle();
      if (activeBooking) {
        await db.from("bookings").update({ desk_id: newDesk.id }).eq("id", activeBooking.id);
        await db.from("desks").update({ current_booking_id: activeBooking.id }).eq("id", newDesk.id);
      }

      return json({ ok: true, cabinNo: newDesk.label });
    }

    // ─── RENEW MEMBERSHIP ───
    if (action === "renew_membership") {
      const {
        membershipId, monthsPaid, paymentMode, cashAmount, upiAmount, advanceAmount, category, hoursPerDay,
        isCustomPlan, customAmount, weekendHours,
      } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (Number(mem.fee_due ?? 0) > 0) {
        return err(`This membership still has ₹${Number(mem.fee_due)} pending — clear it before renewing.`);
      }

      const wasCustomPlan = mem.hours_per_day_weekend != null;
      const newCategory = category ?? mem.category;

      // A custom plan renews the same way it was created — a negotiated amount and
      // weekday/weekend hours instead of a fee_config package lookup. If the renewal
      // doesn't explicitly re-specify custom terms, the expiring membership's own custom
      // amount/hours just carry forward unchanged.
      let monthlyFee: number;
      let newHoursPerDay: number;
      let newWeekendHours: number | null = null;
      if (isCustomPlan || (wasCustomPlan && isCustomPlan === undefined)) {
        monthlyFee = customAmount != null ? Number(customAmount) : Number(mem.monthly_fee);
        if (!(monthlyFee > 0)) return err("Enter a valid custom amount");
        newHoursPerDay = hoursPerDay != null ? Number(hoursPerDay) : Number(mem.hours_per_day);
        if (!(newHoursPerDay > 0)) return err("Enter valid weekday hours");
        newWeekendHours = weekendHours != null ? Number(weekendHours) : Number(mem.hours_per_day_weekend ?? newHoursPerDay);
      } else {
        newHoursPerDay = Number(hoursPerDay ?? mem.hours_per_day);
        const pkgFee = await getMembershipPackage(db, newHoursPerDay, newCategory);
        if (!pkgFee) return err("Invalid membership package");
        monthlyFee = pkgFee;
      }

      const discount = multiMonthDiscount(months);
      const gross = monthlyFee * months;
      const totalBeforeCashback = gross * (1 - discount / 100);

      const { cashbackAmount, contribs: cashbackContribs } = await settlePendingCashbacks(db, mem.student_id, totalBeforeCashback);

      // Any "Pay Later" overtime logged since the last settlement gets folded into this
      // renewal's bill — each row already carries its own flat-rate-computed charge from
      // checkout time (computeOvertimeCharge), so this just sums what's still unbilled
      // rather than re-deriving an amount from raw minutes.
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      const totalFee = totalBeforeCashback - cashbackAmount + overtimeDue;

      const feePaid = advanceAmount != null ? Number(advanceAmount) : totalFee;
      const feeDue = Math.max(totalFee - feePaid, 0);

      const today = todayISO();
      // A renewal made before the current period lapses picks up the very next day — the
      // current end_date is already the last day the student is covered through under the
      // inclusive-end convention above, so starting there again would double-count it.
      const startDate = mem.end_date < today ? today : addDays(mem.end_date, 1);
      const endDate = endDateForMonths(startDate, months);
      const dueDate = addDays(endDateForMonths(startDate, 1), 1);
      const monthLabel = new Date(startDate).toLocaleString("en-US", { month: "long", year: "numeric" });

      // Plan can change on renewal — reassign the cabin/seat if the category changed
      let seatType = mem.seat_type;
      let deskId = mem.desk_id;
      let cabinNo = mem.cabin_no;
      if (newCategory !== mem.category) {
        if (mem.desk_id) {
          await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
          deskId = null;
          cabinNo = null;
        }
        seatType = newCategory === "permanent" ? "fixed" : "floating";
        if (newCategory === "permanent") {
          const { data: freeDesk } = await db.from("desks").select("*")
            .eq("branch_id", mem.branch_id).eq("status", "free").order("sort_order").limit(1).maybeSingle();
          if (!freeDesk) return err("No cabin available for permanent membership");
          deskId = freeDesk.id;
          cabinNo = freeDesk.label;
          await db.from("desks").update({ status: "reserved", seat_type: "fixed", assigned_student_id: mem.student_id }).eq("id", deskId);
        }
      }

      const { data: newMem, error: mErr } = await db.from("memberships").insert({
        student_id: mem.student_id, branch_id: mem.branch_id,
        category: newCategory, seat_type: seatType,
        desk_id: deskId, cabin_no: cabinNo,
        month: monthLabel, hours_per_day: newHoursPerDay, hours_per_day_weekend: newWeekendHours,
        timings: mem.timings ?? '', start_date: startDate, end_date: endDate,
        due_date: dueDate, months_paid: months, discount_percent: discount,
        monthly_fee: monthlyFee, total_paid: feePaid, fee_due: feeDue,
        payment_mode: storedPaymentMode(paymentMode), created_by_staff_id: staff.id,
      }).select("id").single();
      if (mErr) return err(mErr.message);

      await insertPaymentTransactions(db, {
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: newMem!.id,
        category: "membership", notes: "Renewal", created_by_staff_id: staff.id,
      }, paymentMode, feePaid, cashAmount, upiAmount);

      // Deactivate old membership
      await db.from("memberships").update({ is_active: false }).eq("id", membershipId);
      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      for (const c of cashbackContribs) {
        await db.from("cashbacks").update({
          status: "redeemed", redeemed_membership_id: newMem!.id,
          redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }

      if (unbilledOvertime?.length) {
        // billed_amount is already correct per-row (set at checkout time) — only mark
        // settled, don't overwrite each row with the aggregate sum.
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString() })
          .in("id", unbilledOvertime.map((o: { id: string }) => o.id));
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, membershipId: newMem!.id,
        cashbackApplied: cashbackAmount > 0 ? cashbackAmount : null,
        overtimeCharged: overtimeDue > 0 ? overtimeDue : null,
      });
    }

    // ─── CLOSE MEMBERSHIP ───
    if (action === "get_membership_closure_summary") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
      const { data: planChanges } = await db.from("membership_plan_changes").select("*")
        .eq("membership_id", membershipId).order("created_at", { ascending: true });

      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      // The caution deposit is owed back to the student once the locker is given up —
      // it's a credit against whatever else they owe, not revenue.
      const lockerDepositRefund = locker && !locker.deposit_returned ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount } = await settlePendingCashbacks(db, mem.student_id, cashbackBase);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      const totalOwed = membershipDue + lockerDue + foodPassOwed + overtimeDue;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount;
      const netAmount = totalOwed - totalCredit;

      return json({
        membershipDue, lockerDue, lockerDepositRefund,
        foodPassBalance, foodPassRefund, foodPassOwed,
        cashbackAmount, overtimeMinutes, overtimeDue,
        totalOwed, totalCredit, netAmount,
        canClose: true,
        locker: locker ?? null,
        planChanges: planChanges ?? [],
      });
    }

    // Shared by get_membership_delete_summary and delete_membership so the preview and
    // the actual execution can never disagree — computes every owed/credit line close_membership
    // does (locker, food pass, cashback, overtime), plus the prorated refund for unused days
    // that's unique to a deletion. "Membership amount paid" for the prorated formula is the
    // pre-multi-month-discount gross (monthly_fee * months_paid), per how it was specified;
    // the raw result is capped at what was actually collected (total_paid) so a discounted
    // or partially-paid membership never refunds more than the student actually paid.
    async function computeDeleteSettlement(mem: Record<string, any>) {
      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
      const { data: planChanges } = await db.from("membership_plan_changes").select("*")
        .eq("membership_id", mem.id).order("created_at", { ascending: true });

      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      const lockerDepositRefund = locker && !locker.deposit_returned ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount, contribs: cashbackContribs } = await settlePendingCashbacks(db, mem.student_id, cashbackBase);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      const today = todayISO();
      const grossFee = Number(mem.monthly_fee) * Number(mem.months_paid);
      const totalDays = Math.max(1, Math.round(
        (new Date(mem.end_date + "T00:00:00Z").getTime() - new Date(mem.start_date + "T00:00:00Z").getTime()) / 86_400_000,
      ));
      const remainingDays = Math.max(0, Math.round(
        (new Date(mem.end_date + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86_400_000,
      ));
      const rawProratedRefund = (grossFee / totalDays) * remainingDays;
      const proratedRefund = Math.round(Math.max(0, Math.min(rawProratedRefund, Number(mem.total_paid))));

      const totalOwed = membershipDue + lockerDue + foodPassOwed + overtimeDue;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount + proratedRefund;
      const netAmount = totalOwed - totalCredit;

      return {
        membershipDue, lockerDue, lockerDepositRefund,
        foodPassBalance, foodPassRefund, foodPassOwed,
        cashbackAmount, cashbackContribs, overtimeMinutes, overtimeDue,
        proratedRefund, remainingDays, totalDays, grossFee,
        totalOwed, totalCredit, netAmount,
        locker: locker ?? null, foodPass: foodPass ?? null, unbilledOvertime: unbilledOvertime ?? [],
        planChanges: planChanges ?? [],
      };
    }

    // Preview for the Delete Membership confirmation modal — same shape/checks as
    // get_membership_closure_summary, plus the proratedRefund/remainingDays/totalDays lines.
    if (action === "get_membership_delete_summary") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_active) return err("Membership is not active");

      const settlement = await computeDeleteSettlement(mem);
      return json({ ...settlement, canDelete: true });
    }

    // Ends a membership immediately — runs every check/settlement close_membership does
    // (locker deposit, Food Pass balance, pending cashback, unbilled overtime) plus the
    // prorated refund for the membership's unused days, all netted into one final amount.
    // A positive net still owed blocks the delete until a payment mode is chosen, exactly
    // like close_membership; a negative net pays out each credit as its own ledger entry.
    if (action === "delete_membership") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { membershipId, paymentMode } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_active) return err("Membership is not active");

      const s = await computeDeleteSettlement(mem);

      if (s.netAmount > 0 && !paymentMode) {
        return err(`₹${s.netAmount.toFixed(2)} still needs to be collected before deleting — choose a payment mode.`);
      }

      await db.from("memberships").update({ is_active: false, fee_due: 0 }).eq("id", membershipId);

      if (mem.desk_id) {
        await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
      }

      if (s.unbilledOvertime.length) {
        // billed_amount is already correct per-row (set at checkout time) — only mark
        // settled, don't overwrite each row with the aggregate sum.
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString() })
          .in("id", s.unbilledOvertime.map((o: { id: string }) => o.id));
      }

      if (s.locker) {
        await db.from("lockers").update({ is_active: false, fee_due: 0, deposit_returned: true }).eq("id", s.locker.id);
        if (s.lockerDepositRefund > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "locker_deposit",
            amount: s.lockerDepositRefund, notes: "Locker caution deposit returned — membership deleted",
            created_by_staff_id: staff.id,
          });
        }
      }
      if (s.foodPass) {
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", s.foodPass.id);
        if (s.foodPassRefund > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "food_pass_refund",
            amount: s.foodPassRefund, notes: "Unused Food Pass balance returned — membership deleted",
            created_by_staff_id: staff.id,
          });
        }
      }
      for (const c of s.cashbackContribs) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
      if (s.cashbackAmount > 0) {
        await db.from("payouts").insert({
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "cashback",
          amount: s.cashbackAmount, notes: "Cashback settled — membership deleted",
          created_by_staff_id: staff.id,
        });
      }
      if (s.proratedRefund > 0) {
        await db.from("payouts").insert({
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "membership_refund",
          amount: s.proratedRefund, notes: `Prorated refund for ${s.remainingDays} unused of ${s.totalDays} day(s) — membership deleted`,
          created_by_staff_id: staff.id,
        });
      }

      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      // Only a positive net is real revenue collected — money flowing the other way is
      // already logged per-type as payouts above, same convention as close_membership.
      if (s.netAmount > 0) {
        await db.from("transactions").insert({
          student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
          category: "membership", amount: s.netAmount, payment_mode: paymentMode,
          notes: "Final settlement at membership deletion", created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, netAmount: s.netAmount,
        collectedAmount: Math.max(s.netAmount, 0), refundAmount: Math.max(-s.netAmount, 0),
        proratedRefund: s.proratedRefund, remainingDays: s.remainingDays, totalDays: s.totalDays,
        lockerDepositRefund: s.lockerDepositRefund, foodPassRefund: s.foodPassRefund, cashbackAmount: s.cashbackAmount,
        overtimeDue: s.overtimeDue,
      });
    }

    if (action === "close_membership") {
      const { membershipId, paymentMode } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);

      // Final settlement: what's owed to the business nets against what's owed back to
      // the student (locker deposit, unredeemed Food Pass balance, unredeemed cashback).
      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      const lockerDepositRefund = locker && !locker.deposit_returned ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount, contribs: cashbackContribs } = await settlePendingCashbacks(db, mem.student_id, cashbackBase);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      const totalOwed = membershipDue + lockerDue + foodPassOwed + overtimeDue;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount;
      const netAmount = totalOwed - totalCredit;

      if (netAmount > 0 && !paymentMode) {
        return err(`₹${netAmount.toFixed(2)} still needs to be collected before closing — choose a payment mode.`);
      }

      await db.from("memberships").update({ is_active: false, fee_due: 0 }).eq("id", membershipId);

      if (unbilledOvertime?.length) {
        // billed_amount is already correct per-row (set at checkout time) — only mark
        // settled, don't overwrite each row with the aggregate sum.
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString() })
          .in("id", unbilledOvertime.map((o: { id: string }) => o.id));
      }

      if (locker) {
        await db.from("lockers").update({
          is_active: false, fee_due: 0, deposit_returned: true,
        }).eq("id", locker.id);
        if (lockerDepositRefund > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "locker_deposit",
            amount: lockerDepositRefund, notes: "Locker caution deposit returned at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }
      if (foodPass) {
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", foodPass.id);
        if (foodPassRefund > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "food_pass_refund",
            amount: foodPassRefund, notes: "Unused Food Pass balance returned at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }
      for (const c of cashbackContribs) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
      if (cashbackAmount > 0) {
        await db.from("payouts").insert({
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "cashback",
          amount: cashbackAmount, notes: "Cashback settled at membership closure",
          created_by_staff_id: staff.id,
        });
      }

      // Release reserved desk if permanent
      if (mem.desk_id) {
        await db.from("desks").update({
          status: "free", seat_type: "floating", assigned_student_id: null,
        }).eq("id", mem.desk_id);
      }

      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      // Only a positive net is real revenue collected — a refund going the other way
      // isn't logged as a transaction, same as the cashback-payout convention.
      if (netAmount > 0) {
        await db.from("transactions").insert({
          student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
          category: "membership", amount: netAmount, payment_mode: paymentMode,
          notes: "Final settlement at membership closure", created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, netAmount,
        collectedAmount: Math.max(netAmount, 0), refundAmount: Math.max(-netAmount, 0),
        cashbackAmount, lockerDepositRefund, foodPassRefund, overtimeDue,
      });
    }

    // ─── ENQUIRIES (leads pipeline) ───
    if (action === "list_enquiries") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiries").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
      return json({ enquiries: data ?? [] });
    }

    if (action === "create_enquiry") {
      const { branchId, name, phone, email, source, message } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name?.trim()) return err("Name is required");
      const { data, error } = await db.from("enquiries").insert({
        branch_id: branchId, name: name.trim(), phone: phone || null, email: email || null,
        source: source || "walk_in", message: message || null, created_by_staff_id: staff.id,
      }).select("*").single();
      if (error) return err(error.message);
      return json({ enquiry: data });
    }

    if (action === "update_enquiry") {
      const { id, fields } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", id).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiries").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "delete_enquiries") {
      const ids: string[] = payload.ids ?? (payload.id ? [payload.id] : []);
      if (!ids.length) return err("No enquiry ids provided");
      const { data: rows } = await db.from("enquiries").select("id, branch_id").in("id", ids);
      if (!rows?.length) return err("Enquiry not found");
      if (!rows.every(r => requireBranch(staff, r.branch_id))) return err("Branch access denied", 403);
      const { error } = await db.from("enquiries").delete().in("id", ids);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "add_enquiry_activity") {
      const { enquiryId, type, note } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiry_activities").insert({ enquiry_id: enquiryId, type, note: note || null });
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "list_enquiry_activities") {
      const { enquiryId } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_activities").select("*").eq("enquiry_id", enquiryId).order("created_at", { ascending: true });
      return json({ activities: data ?? [] });
    }

    if (action === "add_enquiry_followup") {
      const { enquiryId, note, dueAt } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      if (!dueAt) return err("Due date/time is required");
      const { error } = await db.from("enquiry_followups").insert({
        enquiry_id: enquiryId, branch_id: enq.branch_id, note: note || "Follow up", due_at: dueAt,
      });
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "list_enquiry_followups") {
      const { enquiryId } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_followups").select("*").eq("enquiry_id", enquiryId).order("due_at", { ascending: true });
      return json({ followups: data ?? [] });
    }

    if (action === "update_enquiry_followup") {
      const { id, fields } = payload;
      const { data: fu } = await db.from("enquiry_followups").select("branch_id").eq("id", id).single();
      if (!fu) return err("Follow-up not found");
      if (!requireBranch(staff, fu.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiry_followups").update(fields).eq("id", id);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "list_open_enquiry_followups") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_followups").select("*").eq("branch_id", branchId).eq("done", false).order("due_at", { ascending: true });
      return json({ followups: data ?? [] });
    }

    return err(`Unknown action: ${action}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
});
