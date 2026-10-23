// PSS-AI Phase 1 (data brain): the focus pulse at checkout and the owner's reads of what the
// behaviour models publish (ml/publish.py). Nothing here changes money, and no AI writes anything.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addDays, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { isISODate } from "../lib.ts";

// The switches the app needs to know about (R9). Missing rows mean off.
const FLAGS = {
  focusPulse: "pssai_focus_pulse", anomaly: "pssai_anomaly", analyst: "pssai_analyst",
  // Phase 2
  portal: "pssai_portal", upiPay: "pssai_upi_pay", concierge: "pssai_concierge", collections: "pssai_collections",
  autoApprove: "pssai_auto_approve", aiMessages: "pssai_ai_messages", realtime: "pssai_realtime",
  // Phase 3
  hourRelease: "pssai_hour_release", overbooking: "pssai_overbooking", yieldPricing: "pssai_yield_pricing",
  enquiryChat: "pssai_enquiry_chat", leadTools: "pssai_lead_tools", referralLinks: "pssai_referral_links",
  examRadar: "pssai_exam_radar", winback: "pssai_winback", nextExam: "pssai_next_exam",
  paylaterAdvice: "pssai_paylater_advice", exceptionDesk: "pssai_exception_desk", portalR2: "pssai_portal_r2",
} as const;
const DISCOUNT_CONFIRM_KEY = "pssai_discount_confirm_over";
export const DISCOUNT_CONFIRM_DEFAULT = 1000;
const MAX_LIST = 500;
const RATE_WITHIN_MS = 48 * 3600e3; // a session can be rated up to two days after it started
const MAX_BRIEF = 4000;

async function branchNames(db: Ctx["db"], ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await db.from("branches").select("id, name").in("id", unique);
  return new Map((data ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
}

// The branch to rank: one the caller may see, or null for every branch (allBranches).
function branchFor(staff: NonNullable<Ctx["staff"]>, payload: any): string | null | Response {
  if (payload.allBranches) return null;
  const bid = payload.branchId;
  if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
  return bid;
}

// One model's scores, highest first, filtered by the student's branch through the join (no long id
// list in the URL). Names only — phone numbers stay on the student's profile.
async function rankedScores(db: Ctx["db"], model: string, branchId: string | null, limit: number) {
  let q = db.from("student_scores").select("student_id, model, version, score, reason, computed_at, students!inner(name, branch_id)")
    .eq("model", model).order("score", { ascending: false }).order("student_id").limit(limit);
  if (branchId) q = q.eq("students.branch_id", branchId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function handlers(): Record<string, Handler> {
  return {
    // Which Phase 1 features are switched on, for the app to show or hide them.
    get_feature_flags: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("app_settings").select("key, value")
        .in("key", [...Object.values(FLAGS), DISCOUNT_CONFIRM_KEY]);
      const value = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
      const over = Number(value.get(DISCOUNT_CONFIRM_KEY));
      return json({
        ...Object.fromEntries(Object.entries(FLAGS).map(([k, key]) => [k, value.get(key) === "on"])),
        discountConfirmOver: Number.isFinite(over) && over > 0 ? over : DISCOUNT_CONFIRM_DEFAULT,
      });
    },

    // P1.1 — "How focused was today?" after a member's checkout. One rating per session (a second
    // answer replaces the first); walk-ins are never rated.
    record_focus_rating: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!(await featureOn(db, "focus_pulse"))) return err("Focus ratings are switched off", 403);
      const rating = Number(payload.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err("Rating must be a whole number from 1 to 5");
      const { data: booking } = typeof payload.bookingId === "string"
        ? await db.from("bookings").select("id, student_id, branch_id, booking_type, status, start_time").eq("id", payload.bookingId).maybeSingle()
        : { data: null };
      if (!booking) return err("Session not found", 404);
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);
      if (booking.booking_type === "walkin") return err("Walk-in sessions are not rated");
      if (booking.status !== "completed") return err("A session can be rated only after checkout");
      if (Date.now() - new Date(booking.start_time).getTime() > RATE_WITHIN_MS) return err("This session is too old to rate");
      const { error } = await db.from("focus_ratings").upsert(
        { booking_id: booking.id, student_id: booking.student_id, rating, source: "desk" },
        { onConflict: "booking_id" },
      );
      if (error) return err(error.message, 500);
      return json({ ok: true });
    },

    // P1.3 — one student's scores and fingerprint, or a branch's ranking for one model.
    get_student_scores: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      if (payload.studentId) {
        const [{ data: scores }, { data: fingerprint }] = await Promise.all([
          db.from("student_scores").select("model, version, score, reason, computed_at").eq("student_id", payload.studentId).order("model"),
          db.from("fingerprints").select("version, cluster, computed_at").eq("student_id", payload.studentId).maybeSingle(),
        ]);
        return json({ scores: scores ?? [], fingerprint: fingerprint ?? null });
      }
      const branch = branchFor(staff, payload);
      if (branch instanceof Response) return branch;
      const model = typeof payload.model === "string" ? payload.model : "churn";
      const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), MAX_LIST);
      return json({ model, scores: await rankedScores(db, model, branch, limit) });
    },

    // P1.7 — engagement ranking (published by the ML job from fingerprints and churn scores).
    // get_top_students stays until the UI switches over.
    get_engagement_ranking: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const branch = branchFor(staff, payload);
      if (branch instanceof Response) return branch;
      const limit = Math.min(Math.max(Number(payload.limit) || 50, 1), MAX_LIST);
      const rows = await rankedScores(db, "engagement", branch, limit);
      const sids = rows.map((r: any) => r.student_id);
      const { data: prints } = sids.length
        ? await db.from("fingerprints").select("student_id, cluster").in("student_id", sids)
        : { data: [] };
      const cluster = new Map((prints ?? []).map((p: { student_id: string; cluster: string }) => [p.student_id, p.cluster]));
      return json({
        ranking: rows.map((r: any, i: number) => ({
          rank: i + 1, studentId: r.student_id, name: r.students?.name ?? null, score: r.score, reason: r.reason,
          cluster: cluster.get(r.student_id) ?? null, computedAt: r.computed_at,
        })),
      });
    },

    // P1.6 — anomaly flags for the owner's Flags page.
    list_anomaly_flags: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const status = payload.status ?? "open";
      if (!["open", "ok", "problem", "all"].includes(status)) return err("Unknown status");
      let q = db.from("anomaly_flags").select("id, kind, ref_table, ref_id, branch_id, score, explanation, status, reviewed_by_staff_id, created_at")
        .order("created_at", { ascending: false }).order("id").limit(MAX_LIST);
      if (status !== "all") q = q.eq("status", status);
      if (payload.branchId) q = q.eq("branch_id", payload.branchId);
      const { data } = await q;
      const names = await branchNames(db, (data ?? []).map((f: any) => f.branch_id));
      return json({ flags: (data ?? []).map((f: any) => ({ ...f, branch_name: names.get(f.branch_id) ?? null })) });
    },

    review_anomaly_flag: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      if (!["ok", "problem"].includes(payload.status)) return err("Mark the flag ok or problem");
      if (typeof payload.flagId !== "string") return err("Flag not found", 404);
      const { data } = await db.from("anomaly_flags").update({ status: payload.status, reviewed_by_staff_id: staff.id })
        .eq("id", payload.flagId).select("id, status, reviewed_by_staff_id");
      if (!data?.length) return err("Flag not found", 404);
      return json({ flag: data[0] });
    },

    // P1.7 — weekly expected income for the coming weeks (latest published run).
    get_forecast: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const kind = typeof payload.kind === "string" ? payload.kind : "cash_inflow";
      const { data } = await ctx.db.from("forecasts").select("period_start, value, low, high, computed_at")
        .eq("kind", kind).gte("period_start", addDays(todayISO(), -6)).order("period_start").limit(20);
      return json({ kind, rows: data ?? [], computedAt: data?.length ? data[0].computed_at : null });
    },

    // P1.8 writes these; until then there is none.
    get_owner_brief: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      if (payload.date !== undefined && !isISODate(payload.date)) return err("Invalid date");
      let q = ctx.db.from("owner_briefs").select("brief_date, body, figures, created_at");
      q = payload.date ? q.eq("brief_date", payload.date) : q.order("brief_date", { ascending: false }).limit(1);
      const { data } = await q.maybeSingle();
      return json({ brief: data ?? null });
    },

    // P1.8 — the analyst's 07:00 brief (agent/analyst.ts). Agent runs only; one brief per day, a
    // re-run replaces it.
    save_owner_brief: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      if (!isISODate(payload.briefDate)) return err("Invalid date");
      const body = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!body || body.length > MAX_BRIEF) return err(`The brief must be 1–${MAX_BRIEF} characters`);
      const figures = payload.figures && typeof payload.figures === "object" && !Array.isArray(payload.figures) ? payload.figures : null;
      if (figures && JSON.stringify(figures).length > 8192) return err("Figures too large");
      const { error } = await ctx.db.from("owner_briefs")
        .upsert({ brief_date: payload.briefDate, body, figures, created_at: new Date().toISOString() }, { onConflict: "brief_date" });
      if (error) return err(error.message, 500);
      return json({ ok: true, briefDate: payload.briefDate });
    },
  };
}
