// Scheduled jobs (PSS-AI P0.7, P0.8). Callers: system only — they run through the cron function,
// which checks CRON_SECRET; the api router refuses them. Plus the owner's read of the last
// integrity report.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addDays, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { writeEvent } from "../../_shared/audit.ts";
import { fetchAllRows, membershipDateDrift, purgeExpiredSignups, remindExpiringMembers } from "../lib.ts";
import { selfCheckinFindings } from "./checkin.ts";
import { TASK_PHOTO_KEEP_DAYS } from "../../_shared/tickets.ts";

const CHECKIN_RECORD_KEEP_DAYS = 180;
export const IDEMPOTENCY_KEY_HOURS = 48;
export const STALE_SESSION_HOURS = 24;
export const PROOF_IMAGE_KEEP_DAYS = 180;
const LIST_LIMIT = 100; // rows listed per finding; the counts are always complete

/** Read-only checks for the nightly integrity report (P0.8). Writes nothing. */
export async function integrityFindings(db: Ctx["db"]) {
  // 1. End dates that match neither the months rule nor the custom-days rule (plus holds); hand-set
  //    end dates and due dates are left out. The same check fix_membership_dates now uses (F-2/F-3).
  const { checked, drift: membershipDates } = await membershipDateDrift(db);
  // 2. Same selection as fix_negative_food_pass_balances (money.ts).
  const passes = await fetchAllRows<any>(() => db.from("food_passes").select("id, student_id, branch_id, balance").lt("balance", 0).order("id"));
  // 3. Sessions still open more than a day after they started.
  const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 3600e3).toISOString();
  const stale = await fetchAllRows<any>(() => db.from("bookings").select("id, student_id, branch_id, booking_type, start_time")
    .eq("status", "active").lt("start_time", cutoff).order("start_time").order("id"));
  // 4. UPI payments marked confirmed whose action wrote no transaction (a crash between the two).
  const settled = new Date(Date.now() - 15 * 60e3).toISOString();
  const confirmed = await fetchAllRows<any>(() => db.from("payment_proofs").select("id, reference, student_id, branch_id, amount_expected, transaction_ids, decided_at")
    .eq("status", "confirmed").lt("decided_at", settled).gte("decided_at", new Date(Date.now() - 30 * 86400e3).toISOString()).order("id"));
  const noTx = confirmed.filter((p) => !Array.isArray(p.transaction_ids) || p.transaction_ids.length === 0);
  // 5. AI runs that never finished (the function was stopped mid-call): their cost is not counted.
  const stuck = await fetchAllRows<any>(() => db.from("agent_runs").select("id, agent, started_at").eq("status", "running").lt("started_at", settled).order("id"));
  // 6–8. Phase 4 (O2 part 2): self check-ins with no session, staff check-ins at branches with a
  //      poster, and paid walk-ins with no desk payment.
  const self = await selfCheckinFindings(db);
  return {
    counts: {
      membership_dates: membershipDates.length, negative_food_pass: passes.length, stale_active_bookings: stale.length,
      proofs_without_transactions: noTx.length, stuck_agent_runs: stuck.length,
      selfcheckins_without_session: self.orphan.length, staff_checkins_at_poster_branches: self.staffIns.length,
      walkins_without_payment: self.unpaid.length, unpaid_food_on_closed_walkins: self.foodUnpaid.length,
    },
    selfcheckins_without_session: self.orphan.slice(0, LIST_LIMIT).map((r) => ({ record_id: r.id, student_id: r.student_id, branch_id: r.branch_id, at: r.created_at })),
    staff_checkins_at_poster_branches: self.staffIns.slice(0, LIST_LIMIT).map((e) => ({ event_id: e.id, branch_id: e.branch_id, student_id: e.student_id, staff_id: e.actor_id, at: e.occurred_at })),
    walkins_without_payment: self.unpaid.slice(0, LIST_LIMIT).map((w) => ({ booking_id: w.id, student_id: w.student_id, branch_id: w.branch_id, amount: w.amount, at: w.created_at })),
    unpaid_food_on_closed_walkins: self.foodUnpaid.slice(0, LIST_LIMIT).map((f) => ({ food_bill_id: f.id, booking_id: f.booking_id, student_id: f.student_id, branch_id: f.branch_id, total: f.total, at: f.created_at })),
    proofs_without_transactions: noTx.slice(0, LIST_LIMIT).map((p) => ({ proof_id: p.id, reference: p.reference, student_id: p.student_id, branch_id: p.branch_id, amount: p.amount_expected, decided_at: p.decided_at })),
    stuck_agent_runs: stuck.slice(0, LIST_LIMIT).map((r) => ({ run_id: r.id, agent: r.agent, started_at: r.started_at })),
    checked: { memberships: checked },
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
    // 03:00 IST: payment screenshots are kept for proof_image_keep_days (default 180) after the
    // payment was sent, then deleted from storage (the reading and the decision stay).
    cron_purge_images: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data: setting } = await db.from("app_settings").select("value").eq("key", "proof_image_keep_days").maybeSingle();
      const days = Number(setting?.value) >= 30 ? Number(setting!.value) : PROOF_IMAGE_KEEP_DAYS;
      const old = await fetchAllRows<any>(() => db.from("payment_proofs").select("id, image_path")
        .in("status", ["confirmed", "rejected", "cancelled"]).not("image_path", "is", null)
        .lt("created_at", new Date(Date.now() - days * 86400e3).toISOString()).order("id"));
      let removed = 0;
      for (let i = 0; i < old.length; i += 100) {
        const batch = old.slice(i, i + 100);
        const removedBatch: { error: { message: string } | null } = await db.storage.from("payment-proofs").remove(batch.map((p) => p.image_path));
        if (removedBatch.error) return err(removedBatch.error.message, 500);
        await db.from("payment_proofs").update({ image_path: null }).in("id", batch.map((p) => p.id));
        removed += batch.length;
      }
      // Phase 4 (C17): housekeeping task photos, after task_photo_keep_days (default 30).
      const { data: taskSetting } = await db.from("app_settings").select("value").eq("key", "task_photo_keep_days").maybeSingle();
      const taskDays = Number(taskSetting?.value) >= 7 ? Number(taskSetting!.value) : TASK_PHOTO_KEEP_DAYS;
      const oldPhotos = await fetchAllRows<any>(() => db.from("task_photos").select("id, photo_path")
        .lt("created_at", new Date(Date.now() - taskDays * 86400e3).toISOString()).order("id"));
      let taskPhotos = 0;
      for (let i = 0; i < oldPhotos.length; i += 100) {
        const batch = oldPhotos.slice(i, i + 100);
        const removedBatch: { error: { message: string } | null } = await db.storage.from("task-photos").remove(batch.map((p) => p.photo_path));
        if (removedBatch.error) return err(removedBatch.error.message, 500);
        await db.from("task_photos").delete().in("id", batch.map((p) => p.id));
        taskPhotos += batch.length;
      }
      // Phase 4 review: self check-in records (distance and accuracy only) are kept 180 days.
      await db.from("checkin_records").delete().lt("created_at", new Date(Date.now() - CHECKIN_RECORD_KEEP_DAYS * 86400e3).toISOString());
      return json({ ok: true, removed, keepDays: days, taskPhotos, taskKeepDays: taskDays });
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
