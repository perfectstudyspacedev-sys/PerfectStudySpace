// Scheduled jobs (PSS-AI P0.7, P0.8). Callers: system only — they run through the cron function,
// which checks CRON_SECRET; the api router refuses them. Plus the owner's read of the last
// integrity report.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addDays, endDateForMonths, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { writeEvent } from "../../_shared/audit.ts";
import { fetchAllRows, purgeExpiredSignups, remindExpiringMembers } from "../lib.ts";

export const IDEMPOTENCY_KEY_HOURS = 48;
export const STALE_SESSION_HOURS = 24;
const LIST_LIMIT = 100; // rows listed per finding; the counts are always complete

/** Read-only checks for the nightly integrity report (P0.8). Writes nothing. */
export async function integrityFindings(db: Ctx["db"]) {
  // 1. Same computation as fix_membership_dates (members.ts), without the update.
  const memberships = await fetchAllRows<any>(() => db.from("memberships")
    .select("id, branch_id, start_date, months_paid, hold_days, end_date, due_date").order("id"));
  const membershipDates = memberships.flatMap((m) => {
    const correctEndDate = addDays(endDateForMonths(m.start_date, m.months_paid), m.hold_days ?? 0);
    const correctDueDate = addDays(endDateForMonths(m.start_date, 1), 1);
    return correctEndDate !== m.end_date || correctDueDate !== m.due_date
      ? [{ membership_id: m.id, branch_id: m.branch_id, end_date: m.end_date, correct_end_date: correctEndDate, due_date: m.due_date, correct_due_date: correctDueDate }]
      : [];
  });
  // 2. Same selection as fix_negative_food_pass_balances (money.ts).
  const passes = await fetchAllRows<any>(() => db.from("food_passes").select("id, student_id, branch_id, balance").lt("balance", 0).order("id"));
  // 3. Sessions still open more than a day after they started.
  const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 3600e3).toISOString();
  const stale = await fetchAllRows<any>(() => db.from("bookings").select("id, student_id, branch_id, booking_type, start_time")
    .eq("status", "active").lt("start_time", cutoff).order("start_time").order("id"));
  return {
    counts: { membership_dates: membershipDates.length, negative_food_pass: passes.length, stale_active_bookings: stale.length },
    checked: { memberships: memberships.length },
    membership_dates: membershipDates.slice(0, LIST_LIMIT),
    negative_food_pass: passes.slice(0, LIST_LIMIT).map((p) => ({ food_pass_id: p.id, student_id: p.student_id, branch_id: p.branch_id, balance: p.balance })),
    stale_active_bookings: stale.slice(0, LIST_LIMIT).map((b) => ({ booking_id: b.id, student_id: b.student_id, branch_id: b.branch_id, booking_type: b.booking_type, start_time: b.start_time })),
  };
}

export function handlers(): Record<string, Handler> {
  return {
    // 06:00 IST: the renewal-reminder loop list_active_memberships runs on every load, for every
    // active branch. That loop stops once pssai_cron is on.
    cron_expiry_alerts: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data: branches } = await db.from("branches").select("id").eq("is_active", true);
      const branchIds = (branches ?? []).map((b: { id: string }) => b.id);
      if (!branchIds.length) return json({ ok: true, checked: 0 });
      const today = todayISO();
      const rows = await fetchAllRows<any>(() => db.from("memberships")
        .select("id, branch_id, end_date, students(id, name)")
        .in("branch_id", branchIds).eq("is_active", true)
        .gte("end_date", today).lte("end_date", addDays(today, 7))
        .order("end_date").order("id"));
      await remindExpiringMembers(db, rows.map((m) => ({ student_id: m.students?.id, branch_id: m.branch_id, student_name: m.students?.name, end_date: m.end_date })));
      return json({ ok: true, checked: rows.length });
    },
    // 00:05 IST: deletes sign-ups not handled on the day they were sent (SSP decision 2).
    cron_purge_signups: async (ctx: Ctx): Promise<Response | undefined> => {
      await purgeExpiredSignups(ctx.db);
      return json({ ok: true });
    },
    // Hourly: idempotency keys are only needed while a retry is likely.
    cron_purge_idempotency: async (ctx: Ctx): Promise<Response | undefined> => {
      const cutoff = new Date(Date.now() - IDEMPOTENCY_KEY_HOURS * 3600e3).toISOString();
      const { error } = await ctx.db.from("idempotency_keys").delete().lt("created_at", cutoff);
      if (error) return err(error.message, 500);
      return json({ ok: true });
    },
    // 02:00 IST: read-only checks, stored as one events row (action 'integrity_report').
    cron_integrity_report: async (ctx: Ctx): Promise<Response | undefined> => {
      const findings = await integrityFindings(ctx.db);
      await writeEvent(ctx.db, {
        action: "integrity_report", tier: "T0", actor_type: "system", actor_id: null, run_id: null,
        branch_id: null, student_id: null, ok: true, error: null, payload: findings, reason: null,
      });
      return json({ ok: true, counts: findings.counts });
    },
    get_integrity_report: async (ctx: Ctx): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const { data } = await ctx.db.from("events").select("occurred_at, payload")
        .eq("action", "integrity_report").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
      return json({ report: data ? { occurredAt: data.occurred_at, ...data.payload } : null });
    },
  };
}
