// PSS-AI Phase 3, I3 — walk-in yield pricing (closes G33). The nightly job writes one price change
// per branch per day from forecast occupancy and the exam calendar (_shared/yield.ts); with
// pssai_yield_pricing on, create_walkin charges fee_config × that change. The walk-in modal shows
// the server's price (quote_walkin) and sends it back, so a price that changed in between is
// refused rather than charged. The owner may set a day by hand (set_walkin_price_day, T3).
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, istDayEnd, istDayStart, todayISO } from "../../_shared/dates.ts";
import { EXAM_WINDOW_DAYS, peakConcurrency, yieldChange, yieldLimits, yieldPrice } from "../../_shared/yield.ts";
import { familyLabel } from "../../_shared/exams.ts";
import { getWalkinFee, isISODate } from "../lib.ts";

const LOOKBACK_WEEKS = 4;
const AHEAD_DAYS = 14;

async function limits(db: Ctx["db"]) {
  const { data } = await db.from("app_settings").select("key, value").in("key", ["yield_floor_pct", "yield_ceiling_pct"]);
  const v = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return yieldLimits(v.get("yield_floor_pct") ?? null, v.get("yield_ceiling_pct") ?? null);
}

/** Today's walk-in price for these hours at this branch (base fee_config price while the switch is off). */
export async function walkinPrice(db: Ctx["db"], branchId: string, hours: number, date = todayISO()) {
  const base = await getWalkinFee(db, hours);
  if (!(await featureOn(db, "yield_pricing"))) return { amount: base, base, pct: 0, reason: null as string | null };
  const { data: day } = await db.from("walkin_price_days").select("change_pct, reason").eq("branch_id", branchId).eq("price_date", date).maybeSingle();
  const pct = Number(day?.change_pct ?? 0);
  return { amount: yieldPrice(base, pct), base, pct, reason: day?.reason ?? null };
}

/** Forecast occupancy of a branch on a date: the average daily peak on the same weekday over 4 weeks ÷ desks. */
export async function forecastOccupancy(db: Ctx["db"], branchId: string, date: string): Promise<number | null> {
  const { count: desks } = await db.from("desks").select("*", { count: "exact", head: true }).eq("branch_id", branchId);
  if (!desks) return null;
  const peaks: number[] = [];
  for (let w = 1; w <= LOOKBACK_WEEKS; w++) {
    const day = addDays(date, -7 * w);
    const { data } = await db.from("bookings").select("start_time, end_time").eq("branch_id", branchId).neq("status", "cancelled")
      .gte("start_time", istDayStart(day)).lte("start_time", istDayEnd(day)).limit(2000);
    if (!data?.length) continue;
    peaks.push(peakConcurrency(data.map((b: any) => ({ start: Date.parse(b.start_time), end: Date.parse(b.end_time ?? b.start_time) }))));
  }
  if (!peaks.length) return null;
  return Math.min(1, peaks.reduce((a, b) => a + b, 0) / peaks.length / desks);
}

/** A confirmed exam within EXAM_WINDOW_DAYS of the date, as words for the reason, or null. */
async function examSoon(db: Ctx["db"], date: string): Promise<string | null> {
  const { data } = await db.from("exam_notices").select("exam_name, exam_family, exam_date").eq("status", "confirmed")
    .gte("exam_date", date).lte("exam_date", addDays(date, EXAM_WINDOW_DAYS)).order("exam_date").limit(1);
  const e = data?.[0];
  return e ? `${familyLabel(e.exam_family) || e.exam_name} on ${e.exam_date}` : null;
}

export function handlers(): Record<string, Handler> {
  return {
    quote_walkin: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { branchId } = payload;
      const hours = Number(payload.hours);
      if (!requireBranch(ctx.staff!, branchId)) return err("Branch access denied", 403);
      if (!(hours > 0 && hours <= 24)) return err("Choose the hours");
      return json(await walkinPrice(ctx.db, branchId, hours));
    },

    list_walkin_prices: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const today = todayISO();
      const [{ data: days }, { data: branches }, { data: tiers }, lim, on] = await Promise.all([
        db.from("walkin_price_days").select("branch_id, price_date, change_pct, occupancy, reason, source, computed_at")
          .gte("price_date", today).lte("price_date", addDays(today, AHEAD_DAYS)).order("price_date"),
        db.from("branches").select("id, name").eq("is_active", true).order("name"),
        db.from("fee_config").select("max_hours, fee").eq("config_type", "walkin").order("max_hours"),
        limits(db), featureOn(db, "yield_pricing"),
      ]);
      return json({
        on, limits: lim, branches: branches ?? [],
        tiers: (tiers ?? []).map((t: any) => ({ maxHours: Number(t.max_hours), fee: Number(t.fee) })),
        days: (days ?? []).map((d: any) => ({ ...d, change_pct: Number(d.change_pct) })),
      });
    },

    set_walkin_price_day: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { branchId, date } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const today = todayISO();
      if (!isISODate(date) || date < today || date > addDays(today, AHEAD_DAYS)) return err(`Pick a day from today to ${AHEAD_DAYS} days ahead`);
      if (payload.changePct === null) {
        // Back to the automatic price (the nightly job writes it).
        await db.from("walkin_price_days").delete().eq("branch_id", branchId).eq("price_date", date).eq("source", "owner");
        return json({ ok: true, cleared: true });
      }
      const pct = Number(payload.changePct);
      const lim = await limits(db);
      if (!Number.isFinite(pct) || pct < lim.floor || pct > lim.ceiling) return err(`Choose a change from ${lim.floor}% to +${lim.ceiling}%`);
      const { error } = await db.from("walkin_price_days").upsert({
        branch_id: branchId, price_date: date, change_pct: Math.round(pct * 100) / 100, occupancy: null,
        reason: typeof payload.reason === "string" && payload.reason.trim() ? `Set by the owner: ${payload.reason.trim().slice(0, 200)}` : "Set by the owner",
        source: "owner", set_by_staff_id: staff.id, computed_at: new Date().toISOString(),
      }, { onConflict: "branch_id,price_date" });
      if (error) return err(error.message, 500);
      return json({ ok: true });
    },

    // 00:05 IST: today's change per branch. A day the owner set by hand is left alone.
    cron_yield_prices: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "yield_pricing"))) return json({ skipped: "pssai_yield_pricing is off" });
      const date = todayISO();
      const [{ data: branches }, lim, exam] = await Promise.all([
        db.from("branches").select("id").eq("is_active", true), limits(db), examSoon(db, date),
      ]);
      let written = 0, kept = 0;
      for (const b of branches ?? []) {
        const { data: existing } = await db.from("walkin_price_days").select("source").eq("branch_id", b.id).eq("price_date", date).maybeSingle();
        if (existing?.source === "owner") { kept++; continue; }
        const occupancy = await forecastOccupancy(db, b.id, date);
        const { pct, reason } = yieldChange(occupancy, exam, lim);
        const { error } = await db.from("walkin_price_days").upsert({
          branch_id: b.id, price_date: date, change_pct: pct, occupancy: occupancy === null ? null : Math.round(occupancy * 10000) / 10000,
          reason, source: "auto", set_by_staff_id: null, computed_at: new Date().toISOString(),
        }, { onConflict: "branch_id,price_date" });
        if (!error) written++;
      }
      return json({ ok: true, date, written, keptOwnerPrices: kept });
    },
  };
}
