// PSS-AI Phase 3, O1 and SP10 — selling hours of a permanent member's cabin to walk-ins, and
// SP9 — joining the permanent-seat waitlist from the portal.
//  - A member releases hours in the portal (me_release_hours, pssai_hour_release).
//  - With pssai_overbooking on, cron_predict_releases offers hours a member is predicted not to
//    use (_shared/seats.ts; 20% safety margin, C7).
//  - The walk-in modal lists open releases (list_resellable_desks); create_walkin sells one with a
//    releaseId: the release is claimed first (open → sold, so an hour is never sold twice), the
//    unsold parts go back on sale, and the member's credit (D7: 50% for a member release) becomes a
//    pending fixed cashback, which the existing renewal code applies.
//  - A member who arrives during a resale gets the first free desk, or (predicted release, no free
//    desk) one free day as a credit (C7). Arriving while an unsold release covers now cancels it.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, istDayStart, todayISO } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import {
  CLOSE_HOUR, freeDayCredit, HISTORY_DAYS, hourlyUsage, istHour, istParts, leftovers, MIN_HISTORY_DAYS, MIN_WINDOW_HOURS,
  OPEN_HOUR, predictWindow, RELEASE_AHEAD_DAYS, releaseCredit,
} from "../../_shared/seats.ts";
import { fetchAllRows, isISODate } from "../lib.ts";
import { currentMembership } from "../portal-lib.ts";

const MAX_OPEN_RELEASES = 14;
const me = (ctx: Ctx) => ctx.student!;
const hm = (iso: string) => { const p = istParts(iso); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };
const dayLabel = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600e3).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

async function sourcesOn(db: Ctx["db"]) {
  const [member, predicted] = await Promise.all([featureOn(db, "hour_release"), featureOn(db, "overbooking")]);
  return { member, predicted, any: member || predicted, list: [...(member ? ["member"] : []), ...(predicted ? ["predicted"] : [])] };
}

/** Pending fixed cashback for a member's credit (the existing renewal code applies it). */
async function grantCredit(db: Ctx["db"], studentId: string, branchId: string, amount: number, notes: string) {
  if (!(amount > 0)) return null;
  const { data } = await db.from("cashbacks").insert({
    student_id: studentId, branch_id: branchId, month_label: new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }),
    cashback_type: "fixed", cashback_value: amount, notes, granted_by_staff_id: null,
  }).select("id").single();
  return data?.id ?? null;
}

/**
 * create_walkin with a releaseId, step 1: claim the release for this walk-in's window. The window
 * must lie inside the release; the claim is one conditional update, so two desks selling the
 * same hours at once can't both win. Returns the release (with its desk) or an error.
 */
export async function claimRelease(ctx: Ctx, releaseId: unknown, branchId: string, startIso: string, endIso: string) {
  const { db } = ctx;
  const on = await sourcesOn(db);
  if (!on.any) return { error: "Selling released hours is switched off" };
  if (typeof releaseId !== "string") return { error: "Choose a released desk" };
  const { data: rel } = await db.from("seat_releases").select("*, desks(id, label, branch_id)").eq("id", releaseId).maybeSingle();
  if (!rel || rel.branch_id !== branchId || !on.list.includes(rel.source)) return { error: "That released desk is not available" };
  if (rel.status !== "open") return { error: "Those hours were just sold or cancelled — choose another desk" };
  if (Date.parse(startIso) < Date.parse(rel.starts_at) - 60e3 || Date.parse(endIso) > Date.parse(rel.ends_at) + 60e3) {
    return { error: `That desk is free only ${hm(rel.starts_at)}–${hm(rel.ends_at)} — choose fewer hours or another desk` };
  }
  const { data: claimed } = await db.from("seat_releases").update({ status: "sold", closed_at: new Date().toISOString() })
    .eq("id", rel.id).eq("status", "open").select("id");
  if (!claimed?.length) return { error: "Those hours were just sold — choose another desk" };
  return { release: rel };
}

/** Step 1 failed after the claim (the booking could not be written): put the release back. */
export async function unclaimRelease(db: Ctx["db"], releaseId: string) {
  await db.from("seat_releases").update({ status: "open", closed_at: null }).eq("id", releaseId).eq("status", "sold");
}

/** create_walkin with a releaseId, step 2: the resale record, the member's credit, the leftovers. */
export async function recordResale(ctx: Ctx, rel: any, booking: { id: string; start: string; end: string }, amount: number) {
  const { db } = ctx;
  const credit = rel.source === "member" ? releaseCredit(amount) : 0;
  const window = `${hm(booking.start)}–${hm(booking.end)} on ${dayLabel(booking.start)}`;
  const cashbackId = credit ? await grantCredit(db, rel.student_id, rel.branch_id, credit, `Released hours resold: ${window}`) : null;
  await db.from("seat_resales").insert({
    release_id: rel.id, booking_id: booking.id, branch_id: rel.branch_id, desk_id: rel.desk_id, member_student_id: rel.student_id,
    amount, credit_amount: credit, credit_cashback_id: cashbackId,
  });
  for (const part of leftovers(Date.parse(rel.starts_at), Date.parse(rel.ends_at), Date.parse(booking.start), Date.parse(booking.end))) {
    if (part.end <= Date.now()) continue;
    await db.from("seat_releases").insert({
      membership_id: rel.membership_id, student_id: rel.student_id, branch_id: rel.branch_id, desk_id: rel.desk_id,
      starts_at: new Date(part.start).toISOString(), ends_at: new Date(part.end).toISOString(), source: rel.source, probability: rel.probability, parent_id: rel.id,
    });
  }
  // The cabin stays the member's: only the booking link changes (checkout clears it, and a fixed
  // seat's status is never touched by checkout).
  await db.from("desks").update({ current_booking_id: booking.id }).eq("id", rel.desk_id);
  if (credit) {
    await notifyStudent(db, rel.student_id, { kind: "release_credit", title: `₹${credit} credit for your released hours`, body: `Your desk was used ${window}. The credit comes off your next renewal.`, actionUrl: "/me/release", dedupeKey: `resale:${rel.id}` });
  }
  return { credit };
}

/**
 * check_in_member, for a permanent member at their own desk: cancel their open releases that
 * cover now (they are here), and if their cabin is being used by a resale right now, give them
 * the first free desk — or, for a predicted release with no free desk, one free day (C7).
 * Returns the desk to use instead (null = no desk) and what happened, or null when nothing applies.
 */
export async function memberArrives(ctx: Ctx, membership: any, desk: any): Promise<null | { desk: any | null; collision: { kind: string; credit: number; message: string } | null }> {
  const { db } = ctx;
  const on = await sourcesOn(db);
  if (!on.any || !desk) return null;
  const now = new Date().toISOString();
  await db.from("seat_releases").update({ status: "cancelled", closed_at: now })
    .eq("membership_id", membership.id).eq("status", "open").lte("starts_at", now).gt("ends_at", now);
  if (!desk.current_booking_id) return null;
  const { data: resale } = await db.from("seat_resales").select("id, release_id, booking_id, seat_releases!release_id(source)")
    .eq("booking_id", desk.current_booking_id).is("collision", null).maybeSingle();
  if (!resale) return null;
  const { data: walkin } = await db.from("bookings").select("id, status").eq("id", resale.booking_id).maybeSingle();
  if (walkin?.status !== "active") return null;
  const source = (resale as any).seat_releases?.source ?? "predicted";
  const { data: free } = await db.from("desks").select("*").eq("branch_id", membership.branch_id).eq("status", "free").order("sort_order").order("label").limit(1);
  if (free?.length) {
    await db.from("seat_resales").update({ collision: "fallback_desk", collision_at: now }).eq("id", resale.id);
    return { desk: free[0], collision: { kind: "fallback_desk", credit: 0, message: `Their cabin is in use by a walk-in until later today — seat them at ${free[0].label}.` } };
  }
  if (source === "predicted") {
    const credit = freeDayCredit(membership);
    const cashbackId = await grantCredit(db, membership.student_id, membership.branch_id, credit, "One free day: your cabin was in use when you arrived");
    await db.from("seat_resales").update({ collision: "free_day", collision_at: now, collision_cashback_id: cashbackId }).eq("id", resale.id);
    await notifyStudent(db, membership.student_id, { kind: "free_day", title: `Sorry — ₹${credit} credit (one free day)`, body: "Your cabin was in use when you arrived. The credit comes off your next renewal.", actionUrl: "/me/release", dedupeKey: `free-day:${resale.id}` });
    return { desk: null, collision: { kind: "free_day", credit, message: `Their cabin is in use and no desk is free — they get one free day (₹${credit} credit), already added.` } };
  }
  await db.from("seat_resales").update({ collision: "no_desk", collision_at: now }).eq("id", resale.id);
  return { desk: null, collision: { kind: "no_desk", credit: 0, message: "They released these hours and the cabin is in use; no desk is free — offer the next free one." } };
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student (SP10) ───
    me_release_hours: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "hour_release"))) return err("Releasing hours is not open yet", 403);
      const s = me(ctx);
      const mem = await currentMembership(db, s.id);
      if (!mem || mem.category !== "permanent" || !mem.desk_id) return err("Only members with their own cabin can release hours");
      if (mem.is_paused) return err("Your membership is on hold");
      const today = todayISO();
      const date = payload.date;
      if (!isISODate(date) || date < today || date > addDays(today, RELEASE_AHEAD_DAYS)) return err(`Choose a day from today to ${RELEASE_AHEAD_DAYS} days ahead`);
      if (date > mem.end_date || date < mem.start_date) return err("That day is outside your plan");
      const from = Number(payload.fromHour), to = Number(payload.toHour);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < OPEN_HOUR || to > CLOSE_HOUR || to - from < MIN_WINDOW_HOURS) {
        return err(`Choose whole hours between ${OPEN_HOUR}:00 and ${CLOSE_HOUR}:00, at least ${MIN_WINDOW_HOURS} hours`);
      }
      const startsAt = istHour(date, from), endsAt = istHour(date, to);
      if (Date.parse(startsAt) < Date.now()) return err("Choose hours that have not started yet");
      const { data: clash } = await db.from("seat_releases").select("id").eq("membership_id", mem.id).in("status", ["open", "sold"])
        .lt("starts_at", endsAt).gt("ends_at", startsAt).limit(1);
      if (clash?.length) return err("You have already released some of those hours");
      const { count } = await db.from("seat_releases").select("*", { count: "exact", head: true }).eq("membership_id", mem.id).eq("status", "open").eq("source", "member");
      if ((count ?? 0) >= MAX_OPEN_RELEASES) return err("You have many releases waiting already");
      const { data, error } = await db.from("seat_releases").insert({
        membership_id: mem.id, student_id: s.id, branch_id: mem.branch_id, desk_id: mem.desk_id, starts_at: startsAt, ends_at: endsAt, source: "member",
      }).select("id, starts_at, ends_at, status").single();
      if (error || !data) return err(error?.message ?? "Could not save", 500);
      return json({ release: data });
    },

    me_cancel_release: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { data } = typeof payload.releaseId === "string"
        ? await ctx.db.from("seat_releases").update({ status: "cancelled", closed_at: new Date().toISOString() })
          .eq("id", payload.releaseId).eq("student_id", me(ctx).id).eq("source", "member").eq("status", "open").select("id")
        : { data: null };
      if (!data?.length) return err("Only hours not yet used can be cancelled", 409);
      return json({ ok: true });
    },

    me_releases: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      const [on, mem, { data: rel }, { data: sold }] = await Promise.all([
        featureOn(db, "hour_release"), currentMembership(db, s.id),
        db.from("seat_releases").select("id, starts_at, ends_at, status, source").eq("student_id", s.id).eq("source", "member")
          .gte("ends_at", new Date(Date.now() - 30 * 86400e3).toISOString()).order("starts_at", { ascending: false }).limit(60),
        db.from("seat_resales").select("amount, credit_amount, created_at, collision").eq("member_student_id", s.id).order("created_at", { ascending: false }).limit(60),
      ]);
      return json({
        on, eligible: !!mem && mem.category === "permanent" && !!mem.desk_id && !mem.is_paused,
        hours: { open: OPEN_HOUR, close: CLOSE_HOUR, minHours: MIN_WINDOW_HOURS, aheadDays: RELEASE_AHEAD_DAYS },
        releases: (rel ?? []).map((r: any) => ({ id: r.id, from: r.starts_at, to: r.ends_at, status: r.status })),
        credits: (sold ?? []).filter((x: any) => Number(x.credit_amount) > 0).map((x: any) => ({ amount: Number(x.credit_amount), at: x.created_at })),
        creditTotal: (sold ?? []).reduce((t: number, x: any) => t + Number(x.credit_amount || 0), 0),
      });
    },

    // ─── Staff: what can be sold now ───
    list_resellable_desks: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { branchId } = payload;
      if (!requireBranch(ctx.staff!, branchId)) return err("Branch access denied", 403);
      const on = await sourcesOn(db);
      if (!on.any) return json({ on: false, desks: [] });
      const start = payload.startTime ? Date.parse(payload.startTime) : Date.now();
      const hours = Number(payload.hours) > 0 ? Number(payload.hours) : 1;
      if (!Number.isFinite(start)) return err("Invalid start time");
      const end = start + hours * 3600e3;
      const { data } = await db.from("seat_releases").select("id, starts_at, ends_at, source, probability, desks(label, current_booking_id)")
        .eq("branch_id", branchId).eq("status", "open").in("source", on.list)
        .lte("starts_at", new Date(start + 60e3).toISOString()).gte("ends_at", new Date(end - 60e3).toISOString()).order("starts_at").limit(50);
      return json({
        on: true,
        desks: (data ?? []).filter((r: any) => !r.desks?.current_booking_id).map((r: any) => ({
          releaseId: r.id, deskLabel: r.desks?.label ?? "?", from: r.starts_at, to: r.ends_at, source: r.source,
          probability: r.probability == null ? null : Number(r.probability),
        })),
      });
    },

    list_seat_resales: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const since = istDayStart(isISODate(payload.from) ? payload.from : addDays(todayISO(), -30));
      const rows = await fetchAllRows<any>(() => db.from("seat_resales")
        .select("id, branch_id, amount, credit_amount, collision, created_at, seat_releases!release_id(source, starts_at, ends_at), bookings(start_time, end_time), desks(label), branches(name)")
        .gte("created_at", since).order("created_at", { ascending: false }).order("id"));
      const sum = (f: (r: any) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0) * 100) / 100;
      return json({
        summary: {
          resales: rows.length, revenue: sum((r) => Number(r.amount)), credits: sum((r) => Number(r.credit_amount)),
          hours: sum((r) => (Date.parse(r.bookings?.end_time ?? r.created_at) - Date.parse(r.bookings?.start_time ?? r.created_at)) / 3600e3),
          collisions: rows.filter((r) => r.collision).length, freeDays: rows.filter((r) => r.collision === "free_day").length,
        },
        resales: rows.slice(0, 200).map((r) => ({
          id: r.id, branch: r.branches?.name ?? null, desk: r.desks?.label ?? null, source: r.seat_releases?.source ?? null,
          from: r.bookings?.start_time ?? null, to: r.bookings?.end_time ?? null, amount: Number(r.amount), credit: Number(r.credit_amount), collision: r.collision,
        })),
      });
    },

    // ─── System: predicted free hours (O1), hourly ───
    cron_predict_releases: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const nowIso = new Date().toISOString();
      // Releases whose time has passed unsold are closed (whatever the switches say).
      const { data: expired } = await db.from("seat_releases").update({ status: "expired", closed_at: nowIso }).eq("status", "open").lte("ends_at", nowIso).select("id");
      if (!(await featureOn(db, "overbooking"))) return json({ skipped: "pssai_overbooking is off", expired: expired?.length ?? 0 });
      const today = todayISO();
      const { hour } = istParts(Date.now());
      const fromHour = Math.max(OPEN_HOUR, hour + 1);
      if (CLOSE_HOUR - fromHour < MIN_WINDOW_HOURS) return json({ ok: true, offered: 0, expired: expired?.length ?? 0 });
      const members = await fetchAllRows<any>(() => db.from("memberships")
        .select("id, student_id, branch_id, desk_id, start_date, end_date, is_paused, category")
        .eq("is_active", true).eq("category", "permanent").eq("is_paused", false).not("desk_id", "is", null)
        .lte("start_date", addDays(today, -MIN_HISTORY_DAYS)).gte("end_date", today).order("id"));
      if (!members.length) return json({ ok: true, offered: 0, expired: expired?.length ?? 0 });
      const since = new Date(Date.parse(istDayStart(addDays(today, -HISTORY_DAYS)))).toISOString();
      const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, -HISTORY_DAYS + i));
      let offered = 0, skipped = 0;
      for (const m of members) {
        // Already in today, or already releasing something today: leave them alone.
        const { data: todays } = await db.from("bookings").select("id").eq("student_id", m.student_id).gte("start_time", istDayStart(today)).limit(1);
        const { data: hasRel } = await db.from("seat_releases").select("id").eq("membership_id", m.id).in("status", ["open", "sold"]).gte("ends_at", nowIso).lte("starts_at", istHour(today, CLOSE_HOUR)).limit(1);
        if (todays?.length || hasRel?.length) { skipped++; continue; }
        const { data: hist } = await db.from("bookings").select("start_time, end_time").eq("student_id", m.student_id).neq("status", "cancelled").gte("start_time", since).limit(500);
        const { data: holds } = await db.from("membership_holds").select("paused_at, resumed_at").eq("membership_id", m.id).gte("paused_at", since);
        // Days on hold are left out: the member wasn't expected then.
        const away = new Set<string>();
        for (const h of holds ?? []) for (const d of days) if (d >= istParts(h.paused_at).date && (!h.resumed_at || d <= istParts(h.resumed_at).date)) away.add(d);
        const usable = days.filter((d) => !away.has(d) && d >= m.start_date);
        if (usable.length < MIN_HISTORY_DAYS) { skipped++; continue; }
        const usage = hourlyUsage((hist ?? []).map((b: any) => ({ start: Date.parse(b.start_time), end: Date.parse(b.end_time ?? b.start_time) })), usable);
        const win = predictWindow(usage, fromHour, CLOSE_HOUR);
        if (!win) continue;
        const { error } = await db.from("seat_releases").insert({
          membership_id: m.id, student_id: m.student_id, branch_id: m.branch_id, desk_id: m.desk_id,
          starts_at: istHour(today, win.start), ends_at: istHour(today, win.end), source: "predicted", probability: win.probability,
        });
        if (!error) offered++;
      }
      return json({ ok: true, offered, skipped, expired: expired?.length ?? 0 });
    },

    // ─── SP9: the permanent-seat waitlist from the portal ───
    me_waitlist: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      const on = await featureOn(db, "portal_r2");
      const { data: mine } = await db.from("permanent_waitlist").select("id, branch_id, hours_per_day, status, offer_status, created_at")
        .eq("phone", s.phone).eq("status", "waiting").order("created_at").limit(1).maybeSingle();
      let position: number | null = null;
      if (mine) {
        const { count } = await db.from("permanent_waitlist").select("*", { count: "exact", head: true })
          .eq("branch_id", mine.branch_id).eq("status", "waiting").lt("created_at", mine.created_at);
        position = (count ?? 0) + 1;
      }
      const mem = await currentMembership(db, s.id);
      const { data: plans } = await db.from("fee_config").select("hours_per_day, fee").eq("config_type", "membership").eq("cabin_type", "permanent").order("hours_per_day");
      return json({
        on, waiting: mine ? { id: mine.id, hoursPerDay: mine.hours_per_day, since: mine.created_at, position, offer: mine.offer_status } : null,
        hasPermanent: mem?.category === "permanent",
        plans: (plans ?? []).map((p: any) => ({ hoursPerDay: Number(p.hours_per_day), monthlyFee: Number(p.fee) })),
      });
    },

    me_join_waitlist: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal_r2"))) return err("Joining the waitlist from the portal is not open yet — ask at the desk", 403);
      const s = me(ctx);
      if (!s.branch_id) return err("Ask the desk to add you");
      const mem = await currentMembership(db, s.id);
      if (mem?.category === "permanent") return err("You already have a permanent seat");
      const hours = payload.hoursPerDay == null ? null : Number(payload.hoursPerDay);
      if (hours !== null) {
        const { data: plan } = await db.from("fee_config").select("id").eq("config_type", "membership").eq("cabin_type", "permanent").eq("hours_per_day", hours).maybeSingle();
        if (!plan) return err("Choose one of the permanent plans");
      }
      const { data: already } = await db.from("permanent_waitlist").select("id").eq("phone", s.phone).eq("status", "waiting").limit(1);
      if (already?.length) return err("You are already on the waitlist");
      const { data, error } = await db.from("permanent_waitlist").insert({
        branch_id: s.branch_id, name: s.name, phone: s.phone, student_id: s.id, hours_per_day: hours, notes: "Joined from the student portal", created_by_staff_id: null,
      }).select("id").single();
      if (error || !data) return err(error?.message ?? "Could not add you", 500);
      return json({ ok: true, id: data.id });
    },

    me_leave_waitlist: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("permanent_waitlist").update({ status: "cancelled" })
        .eq("phone", me(ctx).phone).eq("status", "waiting").neq("offer_status", "accepted").select("id");
      const { data: plain } = data?.length ? { data } : await ctx.db.from("permanent_waitlist").update({ status: "cancelled" })
        .eq("phone", me(ctx).phone).eq("status", "waiting").is("offer_status", null).select("id");
      if (!plain?.length) return err("You are not on the waitlist (an accepted seat is finished at the desk)", 404);
      return json({ ok: true });
    },
  };
}
