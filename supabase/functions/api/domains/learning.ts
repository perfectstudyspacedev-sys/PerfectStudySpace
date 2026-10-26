// PSS-AI Phase 5 — the self-improving system, owner side. All code, no AI call:
//  - I8 (pssai_policy_learner): rules proposed from the owner's own decided approvals; the owner
//    signs or dismisses each; signed hold rules are applied by cron_apply_policy_rules (requests.ts).
//  - I6 (pssai_digital_twin): "what if" a grace period or a limit were different, on real past data.
//  - O6 (pssai_experiments, C20): A/B tests on win-back offers, next-exam plans and the featured menu
//    item; the owner keeps the winner, which writes the real setting.
//  - O7 (pssai_space_yield): occupancy by weekday and hour, and what it suggests.
//  - S1: how much the desk-staff modules are still used, before they retire (C18).
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, daysBetween, istDayStart, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { MEMBERSHIP_GRACE_DAYS } from "../../_shared/membership.ts";
import { OVERTIME_GRACE_MINUTES } from "../../_shared/overtime.ts";
import { learnPolicies } from "../../_shared/policy.ts";
import { simulateHoldLimit, simulateOvertimeGrace, simulateRenewalGrace } from "../../_shared/twin.ts";
import { abResult, cleanVariants, CONVERT_DAYS, variantFor } from "../../_shared/experiments.ts";
import { occupancyGrid, spaceSuggestions } from "../../_shared/study.ts";
import { fetchAllRows } from "../lib.ts";
import { SELF_HOLD_MAX_DAYS } from "./requests.ts";
import { PASSIVE_READS, RETIRING_ACTIONS } from "../../_shared/retire.ts";

const owner = (ctx: Ctx) => isOwnerOrAdmin(ctx.staff!);
const LEARN_DAYS = 180;
const TWIN_DAYS = 180;
const YIELD_WEEKS = 8;

/**
 * O6: the variant of a running experiment of this kind this student sees (a branch's own experiment
 * first, then one for every branch), recorded as an exposure; null when none runs (or the switch is off).
 */
export async function experimentVariant(db: Ctx["db"], kind: string, branchId: string | null, studentId: string, record = true): Promise<{ experimentId: string; key: string; value: any } | null> {
  if (!(await featureOn(db, "experiments"))) return null;
  const { data } = await db.from("experiments").select("id, branch_id, variants").eq("kind", kind).eq("status", "running").limit(20);
  const e = (data ?? []).find((x: any) => branchId && x.branch_id === branchId) ?? (data ?? []).find((x: any) => !x.branch_id);
  if (!e) return null;
  const key = variantFor(e.id, studentId, (e.variants ?? []).map((v: any) => v.key));
  const v = (e.variants ?? []).find((x: any) => x.key === key);
  if (!v) return null;
  if (record) await db.from("experiment_exposures").upsert({ experiment_id: e.id, student_id: studentId, variant: key }, { onConflict: "experiment_id,student_id", ignoreDuplicates: true });
  return { experimentId: e.id, key, value: v.value };
}

/** The setting a kept experiment writes (O6): one key each, a menu item per branch. */
export const featuredItemKey = (branchId: string) => `featured_food_item:${branchId}`;
async function keepWinner(db: Ctx["db"], e: any, value: any): Promise<{ error: { message: string } | null }> {
  const key = e.kind === "winback_offer" ? "winback_discount_pct" : e.kind === "next_exam_offer" ? "next_exam_months" : featuredItemKey(e.branch_id);
  return await db.from("app_settings").upsert({ key, value: String(value) }, { onConflict: "key" });
}

/** Per variant: students shown it and how many converted. */
async function experimentStats(db: Ctx["db"], e: any) {
  const rows = await fetchAllRows<any>(() => db.from("experiment_exposures").select("student_id, variant, converted_at").eq("experiment_id", e.id).order("student_id"));
  return abResult((e.variants ?? []).map((v: any) => ({ key: v.key, n: rows.filter((r) => r.variant === v.key).length, k: rows.filter((r) => r.variant === v.key && r.converted_at).length })));
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── I8 ───
    cron_policy_rules: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "policy_learner"))) return json({ skipped: "pssai_policy_learner is off" });
      const since = new Date(Date.now() - LEARN_DAYS * 86400e3).toISOString();
      const decided = await fetchAllRows<any>(() => db.from("approvals").select("id, kind, action, payload, status, requested_by_type, policy_rule_id")
        .in("status", ["approved", "denied"]).gte("decided_at", since).order("id"));
      // Decisions a rule made are not evidence for a rule.
      const proposals = learnPolicies(decided.filter((d) => !d.policy_rule_id));
      const { data: existing } = await db.from("policy_rules").select("id, scope, bucket, status").in("status", ["proposed", "active", "dismissed"]);
      let proposed = 0, refreshed = 0;
      for (const p of proposals) {
        const same = (existing ?? []).filter((r: any) => r.scope === p.scope && r.bucket === p.bucket);
        if (same.some((r: any) => r.status === "dismissed")) continue;   // the owner said no: never proposed again
        const live = same.find((r: any) => r.status === "proposed" || r.status === "active");
        if (live) {
          // A signed rule keeps the numbers it was signed on; only a proposal is refreshed.
          const { data: upd } = await db.from("policy_rules").update({ support: p.support, agreement: p.agreement, description: p.description, outcome: p.outcome, updated_at: new Date().toISOString() }).eq("id", live.id).eq("status", "proposed").select("id");
          if (upd?.length) refreshed++;
        } else {
          const { error } = await db.from("policy_rules").insert({ ...p });
          if (!error) proposed++;
        }
      }
      return json({ ok: true, decisions: decided.length, proposed, refreshed });
    },

    list_policy_rules: async (ctx: Ctx): Promise<Response | undefined> => {
      if (!owner(ctx)) return err("Owner only", 403);
      const { data } = await ctx.db.from("policy_rules").select("id, scope, bucket, outcome, support, agreement, description, status, decided_at, applied_count, created_at")
        .in("status", ["proposed", "active", "retired"]).order("created_at", { ascending: false }).limit(200);
      return json({ on: await featureOn(ctx.db, "policy_learner"), rules: data ?? [] });
    },

    decide_policy_rule: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!owner(ctx)) return err("Owner only", 403);
      const to = ({ sign: "active", dismiss: "dismissed", retire: "retired" } as Record<string, string>)[payload.decision];
      if (!to) return err("Sign, dismiss or retire");
      const from = to === "retired" ? "active" : "proposed";
      const { data } = await db.from("policy_rules").update({ status: to, decided_by_staff_id: ctx.staff!.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", payload.ruleId).eq("status", from).select("id, scope, outcome");
      if (!data?.length) return err(`Only a ${from} rule can be ${({ sign: "signed", dismiss: "dismissed", retire: "retired" } as Record<string, string>)[payload.decision]}`, 409);
      return json({ ok: true, ruleStatus: to });
    },

    // ─── I6 ───
    simulate_policy: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!owner(ctx)) return err("Owner only", 403);
      if (!(await featureOn(db, "digital_twin"))) return err("The digital twin is switched off", 403);
      const since = addDays(todayISO(), -TWIN_DAYS);
      const value = Number(payload.value);
      if (payload.policy === "renewal_grace") {
        if (!Number.isInteger(value) || value < 0 || value > 30) return err("Choose 0 to 30 days");
        const renewed = await fetchAllRows<any>(() => db.from("memberships").select("id, created_at, renewed_from_membership_id, plan_amount, plan_days, monthly_fee")
          .not("renewed_from_membership_id", "is", null).gte("created_at", istDayStart(since)).order("id"));
        const prevIds = [...new Set(renewed.map((m) => m.renewed_from_membership_id))];
        const prev = new Map<string, any>();
        for (let i = 0; i < prevIds.length; i += 200) {
          const part = await fetchAllRows<any>(() => db.from("memberships").select("id, end_date, student_id").in("id", prevIds.slice(i, i + 200)).order("id"));
          for (const p of part) prev.set(p.id, p);
        }
        const cases = renewed.map((m) => {
          const p = prev.get(m.renewed_from_membership_id);
          const rate = Number(m.plan_amount) > 0 && Number(m.plan_days) > 0 ? Number(m.plan_amount) / Number(m.plan_days) : Number(m.monthly_fee) / 30;
          return p ? { daysLate: Math.max(0, daysBetween(p.end_date, toISTDateStr(m.created_at))), dailyRate: Math.round(rate * 100) / 100 } : null;
        }).filter(Boolean) as { daysLate: number; dailyRate: number }[];
        // Check-ins made after a plan had ended (still inside today's grace).
        const ended = await fetchAllRows<any>(() => db.from("memberships").select("id, end_date").gte("end_date", since).lte("end_date", todayISO()).order("id"));
        const endOf = new Map(ended.map((m) => [m.id, m.end_date]));
        const late: number[] = [];
        for (let i = 0; i < ended.length; i += 200) {
          const ids = ended.slice(i, i + 200).map((m) => m.id);
          const bk = await fetchAllRows<any>(() => db.from("bookings").select("id, membership_id, start_time").in("membership_id", ids).order("id"));
          for (const b of bk) {
            const k = daysBetween(endOf.get(b.membership_id), toISTDateStr(b.start_time));
            if (k > 0) late.push(k);
          }
        }
        return json({ policy: "renewal_grace", current: MEMBERSHIP_GRACE_DAYS, proposed: value, days: TWIN_DAYS, ...simulateRenewalGrace(cases, late, value, MEMBERSHIP_GRACE_DAYS) });
      }
      if (payload.policy === "overtime_grace") {
        if (!Number.isInteger(value) || value < 0 || value > 60) return err("Choose 0 to 60 minutes");
        // Every checkout's overtime minutes as the desk (or the portal) worked them out, from the
        // event log — including those under today's grace, which overtime_sessions never keeps, so a
        // shorter grace is priced too (review fix). A re-sent checkout counts once (the last one).
        const evs = await fetchAllRows<any>(() => db.from("events").select("id, payload").eq("action", "checkout_booking").eq("ok", true).gte("occurred_at", istDayStart(since)).order("id"));
        const minutesOf = new Map<string, number>();
        for (const e of evs) {
          const id = e.payload?.bookingId, m = Number(e.payload?.overtimeMinutes);
          if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) && Number.isFinite(m)) minutesOf.set(id, m);
        }
        const ids = [...minutesOf.entries()].filter(([, m]) => m > 0).map(([id]) => id);
        const booked = new Map<string, any>();
        for (let i = 0; i < ids.length; i += 200) {
          const part = await fetchAllRows<any>(() => db.from("bookings").select("id, status, booking_type, scheduled_hours, hours, amount").in("id", ids.slice(i, i + 200)).order("id"));
          for (const b of part) booked.set(b.id, b);
        }
        const cases = ids.map((id) => {
          const b = booked.get(id);
          if (!b || b.status !== "completed") return null;
          const walkin = b.booking_type === "walkin";
          const hours = walkin ? Number(b.scheduled_hours ?? b.hours) || 1 : 0;
          return { minutes: minutesOf.get(id)!, bookedHours: hours, baseFee: walkin ? Number(b.amount) || 0 : 0, walkinThreeHour: walkin && hours === 3 };
        }).filter(Boolean) as { minutes: number; bookedHours: number; baseFee: number; walkinThreeHour: boolean }[];
        return json({ policy: "overtime_grace", current: OVERTIME_GRACE_MINUTES, proposed: value, days: TWIN_DAYS, ...simulateOvertimeGrace(cases, value) });
      }
      if (payload.policy === "self_hold_days") {
        if (!Number.isInteger(value) || value < 0 || value > 31) return err("Choose 0 to 31 days");
        // Requests that were taken (ok), and of those the ones that go to the owner whatever the
        // limit: a cabin, or a second hold in the month (review fix).
        const [holds, queued] = await Promise.all([
          fetchAllRows<any>(() => db.from("events").select("id, payload").eq("action", "me_request_hold").eq("ok", true).gte("occurred_at", istDayStart(since)).order("id")),
          fetchAllRows<any>(() => db.from("approvals").select("id, payload").eq("kind", "student_request").eq("action", "hold").gte("created_at", istDayStart(since)).order("id")),
        ]);
        const days = holds.map((h) => Number(h.payload?.days)).filter((d) => Number.isInteger(d) && d > 0);
        const always = queued.filter((a) => /permanent|second hold/.test(String(a.payload?.why ?? ""))).map((a) => Number(a.payload?.days)).filter((d) => Number.isInteger(d) && d > 0);
        return json({ policy: "self_hold_days", current: SELF_HOLD_MAX_DAYS, proposed: value, days: TWIN_DAYS, ...simulateHoldLimit(days, value, SELF_HOLD_MAX_DAYS, always) });
      }
      return err("Choose what to try: renewal_grace, overtime_grace or self_hold_days");
    },

    // ─── O6 ───
    list_experiments: async (ctx: Ctx): Promise<Response | undefined> => {
      if (!owner(ctx)) return err("Owner only", 403);
      const { data } = await ctx.db.from("experiments").select("*, branches(name)").order("created_at", { ascending: false }).limit(50);
      const out = [];
      for (const e of data ?? []) out.push({ ...e, branch: e.branches?.name ?? null, branches: undefined, live: e.status === "running" ? await experimentStats(ctx.db, e) : null });
      return json({ on: await featureOn(ctx.db, "experiments"), experiments: out });
    },

    create_experiment: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!owner(ctx)) return err("Owner only", 403);
      if (!(await featureOn(db, "experiments"))) return err("Experiments are switched off", 403);
      const variants = cleanVariants(payload.kind, payload.variants);
      if ("error" in variants) return err(variants.error);
      const name = String(payload.name ?? "").trim().slice(0, 120);
      if (name.length < 2) return err("Give the experiment a name");
      const weeks = Number(payload.weeks ?? 4);
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) return err("Run it for 1 to 12 weeks");
      if (payload.kind === "menu_feature") {
        if (!payload.branchId) return err("A menu test is for one branch");
        const { data: items } = await db.from("food_items").select("id").in("id", variants.map((v) => v.value)).eq("branch_id", payload.branchId).eq("is_active", true);
        if ((items ?? []).length !== 2) return err("Choose two menu items of that branch");
      }
      const { data, error } = await db.from("experiments").insert({
        kind: payload.kind, name, branch_id: payload.branchId ?? null, variants, status: "running",
        started_at: new Date().toISOString(), ends_at: new Date(Date.now() + weeks * 7 * 86400e3).toISOString(), created_by_staff_id: ctx.staff!.id,
      }).select("id").single();
      if (error?.code === "23505") return err("An experiment of this kind is already running there", 409);
      if (error || !data) return err(error?.message ?? "Could not start it", 500);
      return json({ ok: true, id: data.id });
    },

    update_experiment: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!owner(ctx)) return err("Owner only", 403);
      const { data: e } = await db.from("experiments").select("*").eq("id", payload.experimentId).maybeSingle();
      if (!e) return err("Experiment not found", 404);
      if (payload.decision === "stop") {
        const { data } = await db.from("experiments").update({ status: "ended", ends_at: new Date().toISOString(), result: await experimentStats(db, e) }).eq("id", e.id).eq("status", "running").select("id");
        if (!data?.length) return err("Only a running experiment can be stopped", 409);
        return json({ ok: true });
      }
      if (payload.decision !== "keep" && payload.decision !== "drop") return err("Keep a variant, drop the experiment, or stop it");
      if (!["running", "ended"].includes(e.status)) return err("This experiment is already decided", 409);
      const variant = (e.variants ?? []).find((v: any) => v.key === payload.variant);
      if (payload.decision === "keep" && !variant) return err("Choose the variant to keep");
      if (payload.decision === "keep" && e.kind === "menu_feature" && !e.branch_id) return err("A menu test is for one branch");
      const { data } = await db.from("experiments").update({
        status: payload.decision === "keep" ? "kept" : "dropped", winner: variant?.key ?? null, decided_by_staff_id: ctx.staff!.id, decided_at: new Date().toISOString(),
        result: e.result ?? await experimentStats(db, e), ...(e.status === "running" ? { ends_at: new Date().toISOString() } : {}),
      }).eq("id", e.id).in("status", ["running", "ended"]).select("id");
      if (!data?.length) return err("This experiment was just decided", 409);
      // Kept only if the real setting is saved: otherwise the experiment goes back as it was.
      if (payload.decision === "keep") {
        const { error } = await keepWinner(db, e, variant.value);
        if (error) {
          await db.from("experiments").update({ status: e.status, winner: null, decided_by_staff_id: null, decided_at: null, ends_at: e.ends_at, result: e.result ?? null }).eq("id", e.id).eq("status", "kept");
          return err(`Could not save the setting: ${error.message}`, 500);
        }
      }
      return json({ ok: true });
    },

    cron_experiments: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "experiments"))) return json({ skipped: "pssai_experiments is off" });
      const { data: running } = await db.from("experiments").select("*").eq("status", "running");
      let converted = 0, ended = 0;
      for (const e of running ?? []) {
        const open = await fetchAllRows<any>(() => db.from("experiment_exposures").select("student_id, variant, exposed_at").eq("experiment_id", e.id).is("converted_at", null).order("student_id"));
        const days = (CONVERT_DAYS as any)[e.kind] ?? 21;
        for (const x of open) {
          const until = new Date(Date.parse(x.exposed_at) + days * 86400e3).toISOString();
          let hit: string | null = null;
          if (e.kind === "menu_feature") {
            const item = (e.variants ?? []).find((v: any) => v.key === x.variant)?.value;
            const { data: bills } = await db.from("food_bills").select("id, created_at, food_bill_items(food_item_id)").eq("student_id", x.student_id).gte("created_at", x.exposed_at).lte("created_at", until).limit(50);
            hit = (bills ?? []).find((b: any) => (b.food_bill_items ?? []).some((li: any) => li.food_item_id === item))?.created_at ?? null;
          } else {
            const { data: mem } = await db.from("memberships").select("created_at").eq("student_id", x.student_id).gte("created_at", x.exposed_at).lte("created_at", until).order("created_at").limit(1);
            hit = mem?.[0]?.created_at ?? null;
          }
          if (hit) { await db.from("experiment_exposures").update({ converted_at: hit }).eq("experiment_id", e.id).eq("student_id", x.student_id).is("converted_at", null); converted++; }
        }
        if (e.ends_at && Date.parse(e.ends_at) <= Date.now()) {
          await db.from("experiments").update({ status: "ended", result: await experimentStats(db, e) }).eq("id", e.id).eq("status", "running");
          ended++;
        }
      }
      return json({ ok: true, converted, ended });
    },

    // ─── O7 ───
    get_space_yield: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!owner(ctx)) return err("Owner only", 403);
      if (!payload.branchId) return err("Choose a branch");
      const since = new Date(Date.now() - YIELD_WEEKS * 7 * 86400e3).toISOString();
      const [{ data: desks }, sessions, { count: waitlist }] = await Promise.all([
        db.from("desks").select("id, seat_type").eq("branch_id", payload.branchId).limit(2000),
        fetchAllRows<any>(() => db.from("bookings").select("id, start_time, end_time, desk_id, desks!desk_id(seat_type)").eq("branch_id", payload.branchId).neq("status", "cancelled").gte("start_time", since).order("id")),
        db.from("permanent_waitlist").select("*", { count: "exact", head: true }).eq("branch_id", payload.branchId).eq("status", "waiting"),
      ]);
      const seats = (desks ?? []).filter((d: any) => d.seat_type !== "fixed").length;
      const cabins = (desks ?? []).filter((d: any) => d.seat_type === "fixed").length;
      const span = (b: any) => ({ start: Date.parse(b.start_time), end: Date.parse(b.end_time ?? b.start_time) });
      const open = sessions.filter((b) => b.desks?.seat_type !== "fixed").map(span);
      const fixed = sessions.filter((b) => b.desks?.seat_type === "fixed").map(span);
      const grid = occupancyGrid(open, seats, YIELD_WEEKS);
      const cabinGrid = occupancyGrid(fixed, cabins, YIELD_WEEKS);
      // Cabin use over the hall's day (06:00–23:00).
      const cabinUse = cabins ? Math.round((cabinGrid.flatMap((row) => row.slice(6, 23)).reduce((a, b) => a + b, 0) / (7 * 17)) * 1000) / 1000 : 0;
      return json({ on: await featureOn(db, "space_yield"), weeks: YIELD_WEEKS, seats, cabins, waitlist: waitlist ?? 0, grid, cabinUse, suggestions: spaceSuggestions({ grid, seats, cabins, cabinUse, waitlist: waitlist ?? 0 }) });
    },

    // ─── S1 ───
    get_staff_module_usage: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!owner(ctx)) return err("Owner only", 403);
      const since = new Date(Date.now() - 30 * 86400e3).toISOString();
      const usage: Record<string, number> = {};
      for (const a of RETIRING_ACTIONS) {
        const { count } = await db.from("events").select("*", { count: "exact", head: true }).eq("action", a).in("actor_type", ["staff", "owner", "admin"]).gte("occurred_at", since);
        usage[a] = count ?? 0;
      }
      // The attendance list and the cover board load by themselves when the owner opens Staff, so
      // they are views, not use (review fix): only the other four count toward "unused for a month".
      const active = RETIRING_ACTIONS.filter((a) => !PASSIVE_READS.has(a));
      const { data: last } = await db.from("events").select("occurred_at").in("action", active).in("actor_type", ["staff", "owner", "admin"]).order("occurred_at", { ascending: false }).limit(1);
      const total = active.reduce((n, a) => n + usage[a], 0);
      const views = [...PASSIVE_READS].reduce((n, a) => n + (usage[a] ?? 0), 0);
      // Desk accounts can't sign in once the screens retire (C18): the owner sets each one's duty first.
      const desk = await db.from("staff").select("id, username, display_name").eq("is_active", true).eq("role", "staff").eq("duty", "desk").limit(200);
      return json({
        on: await featureOn(db, "retire_staff_ops"), days: 30, usage, total, views, lastUsedAt: last?.[0]?.occurred_at ?? null, unusedForAMonth: total === 0,
        deskAccounts: desk.error ? null : (desk.data ?? []).map((d: any) => d.display_name || d.username),
      });
    },
  };
}
