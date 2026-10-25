// PSS-AI Phase 4 — self check-in at a pilot branch.
//  - SP13: a student scans the branch's QR poster; me_check_in checks the poster key, the consent
//    (D9) and the phone's location (within 100 m), then runs check_in_member unchanged with a
//    branch-limited portal scope. me_check_out runs checkout_booking the same way, with the overtime
//    minutes worked out by the server from the clock and food that must be collected left as dues
//    (C14). Both switched by pssai_self_checkin; a branch takes part once the owner has saved its
//    location and printed its poster.
//  - A5: cron_close_forgotten_sessions (23:30 IST, pssai_session_watch) closes sessions past their
//    booked end at that end, with no overtime (C15), and flags staff checkouts moved back in time.
//  - I4/SP15: seat matching for temporary members (pssai_seat_matching); SP14 live seat counts.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { toISTDateStr } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { portalScope } from "../../_shared/student.ts";
import { computeOvertimeCharge } from "../../_shared/overtime.ts";
import {
  CHECKIN_TRIES, CHECKIN_TRY_WINDOW_MIN, CONSENT_TEXT, CONSENT_VERSION, CORRECTION_FLAG_MIN, forgottenSessionEnd,
  locationVerdict, newCheckinKey, overtimeMinutesAt, sameKey, validCoords,
} from "../../_shared/checkin.ts";
import { cleanTags, DESK_TAGS, deskUse, freeSeats, MAX_FAVOURITES, rankDesks, SEAT_HISTORY_DAYS } from "../../_shared/seatmatch.ts";
import { actionDef } from "../registry-ref.ts";
import { runNested } from "../run.ts";
import { fetchAllRows } from "../lib.ts";
import { currentMembership } from "../portal-lib.ts";
import { PORTAL_URL } from "./portal.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const me = (ctx: Ctx) => ctx.student!;
const MEMBER_TYPES = ["temporary", "permanent"];
const CLOSE_LIMIT = 300; // sessions closed per run; the rest wait for the next night
const hm = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600e3).toISOString().slice(11, 16);
export const posterUrl = (branchId: string, key: string) => `${PORTAL_URL()}/me/checkin?b=${branchId}&k=${encodeURIComponent(key)}`;

/** Free floating desks at a branch, best first for this student (I4). */
export async function rankedFreeDesks(db: Ctx["db"], branchId: string, studentId: string | null) {
  const { data: desks } = await db.from("desks").select("id, label, sort_order, tags")
    .eq("branch_id", branchId).eq("seat_type", "floating").eq("status", "free").order("sort_order").limit(500);
  if (!desks?.length) return [];
  let prefs = null, used = new Map<string, number>();
  if (studentId) {
    const since = new Date(Date.now() - SEAT_HISTORY_DAYS * 86400e3).toISOString();
    const [{ data: p }, { data: hist }] = await Promise.all([
      db.from("seat_preferences").select("desk_ids, tags").eq("student_id", studentId).maybeSingle(),
      db.from("bookings").select("desk_id").eq("student_id", studentId).eq("branch_id", branchId).not("desk_id", "is", null).gte("start_time", since).limit(500),
    ]);
    prefs = p ?? null;
    used = deskUse(hist ?? []);
  }
  return rankDesks(desks, prefs, used);
}

async function openSession(db: Ctx["db"], studentId: string) {
  const { data } = await db.from("bookings").select("id, branch_id, booking_type, start_time, end_time, is_paused, paused_at, desks!desk_id(label), branches(name)")
    .eq("student_id", studentId).eq("status", "active").in("booking_type", MEMBER_TYPES)
    .order("start_time", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

async function record(db: Ctx["db"], row: Record<string, unknown>) {
  const { error } = await db.from("checkin_records").insert(row);
  if (error) console.error("checkin_records insert failed:", error.message);
}

async function flag(db: Ctx["db"], kind: string, bookingId: string, branchId: string | null, explanation: string) {
  const { data } = await db.from("anomaly_flags").upsert(
    { kind, ref_table: "bookings", ref_id: bookingId, branch_id: branchId, explanation },
    { onConflict: "kind,ref_table,ref_id", ignoreDuplicates: true },
  ).select("id");
  return !!data?.length;
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student: SP13 ───
    me_checkin_info: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      const [on, seatMatching, { data: consent }, session] = await Promise.all([
        featureOn(db, "self_checkin"), featureOn(db, "seat_matching"),
        db.from("checkin_consents").select("version").eq("student_id", s.id).maybeSingle(),
        openSession(db, s.id),
      ]);
      let branch = null;
      if (typeof payload.branchId === "string" && UUID.test(payload.branchId)) {
        const { data: b } = await db.from("branches").select("id, name, is_active, latitude, longitude, checkin_key").eq("id", payload.branchId).maybeSingle();
        if (b) branch = { id: b.id, name: b.name, ready: !!(b.is_active && b.checkin_key && b.latitude != null) };
      }
      return json({
        on, seatMatching, branch,
        consentNeeded: consent?.version !== CONSENT_VERSION, consentText: CONSENT_TEXT, consentVersion: CONSENT_VERSION,
        session: session ? {
          bookingId: session.id, start: session.start_time, end: session.end_time, paused: !!session.is_paused,
          desk: (session.desks as any)?.label ?? null, branch: (session.branches as any)?.name ?? null,
        } : null,
      });
    },

    me_check_in: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "self_checkin"))) return err("Self check-in is not open yet — please check in at the desk", 403);
      const branchId = payload.branchId;
      if (typeof branchId !== "string" || !UUID.test(branchId)) return err("Scan the poster at the hall again");
      const since = new Date(Date.now() - CHECKIN_TRY_WINDOW_MIN * 60e3).toISOString();
      const { count } = await db.from("checkin_records").select("*", { count: "exact", head: true }).eq("student_id", s.id).gte("created_at", since);
      if ((count ?? 0) >= CHECKIN_TRIES) return err("Too many tries — wait a few minutes, or check in at the desk", 429);

      const { data: branch } = await db.from("branches").select("id, name, is_active, latitude, longitude, checkin_key").eq("id", branchId).maybeSingle();
      if (!branch || !branch.is_active || !branch.checkin_key || branch.latitude == null || branch.longitude == null) {
        return err("Self check-in is not set up at this branch — please check in at the desk", 403);
      }
      const base = { student_id: s.id, branch_id: branch.id, kind: "in" };
      if (!sameKey(String(payload.key ?? ""), branch.checkin_key)) {
        await record(db, { ...base, result: "bad_key", detail: "Old or wrong poster code" });
        return err("This QR code is out of date — scan the poster at the hall", 403);
      }
      const { data: consent } = await db.from("checkin_consents").select("version").eq("student_id", s.id).maybeSingle();
      if (consent?.version !== CONSENT_VERSION) {
        if (payload.consent !== CONSENT_VERSION) return err("Please read the location notice and tick it first");
        await db.from("checkin_consents").upsert({ student_id: s.id, version: CONSENT_VERSION, consented_at: new Date().toISOString() }, { onConflict: "student_id" });
      }
      const verdict = locationVerdict({ lat: branch.latitude, lng: branch.longitude }, { lat: payload.latitude, lng: payload.longitude, accuracy: payload.accuracy });
      if (!verdict.ok) {
        await record(db, { ...base, result: verdict.result, distance_m: verdict.distance, accuracy_m: verdict.accuracy, detail: verdict.message.slice(0, 300) });
        return err(verdict.message, verdict.result === "too_far" ? 403 : 400);
      }
      const where = { distance_m: verdict.distance, accuracy_m: verdict.accuracy };

      // Desk: a permanent member at home gets their own cabin (check_in_member picks it); anyone else
      // gets the best free floating desk when seat matching is on, else none (as at the desk today).
      const mem = await currentMembership(db, s.id);
      const floating = !!mem && (mem.category !== "permanent" || (s.branch_id != null && s.branch_id !== branch.id));
      const ranked = floating && (await featureOn(db, "seat_matching")) ? (await rankedFreeDesks(db, branch.id, s.id)).slice(0, 2) : [];
      const def = actionDef("check_in_member");
      const scope = { staff: portalScope(branch.id) };
      let ran = await runNested(def, ctx, scope, { branchId: branch.id, studentId: s.id, deskId: ranked[0]?.desk.id ?? null });
      let reason: string | null = ranked[0]?.reason ?? null;
      // Someone took that desk a moment ago: the next one, then none.
      for (const next of [ranked[1] ?? null, null]) {
        if (ran.ok || !ranked.length || ran.body?.error !== "Selected desk is not available") break;
        ran = await runNested(def, ctx, scope, { branchId: branch.id, studentId: s.id, deskId: next?.desk.id ?? null });
        reason = next?.reason ?? null;
      }
      if (!ran.ok) {
        await record(db, { ...base, ...where, result: "refused", detail: String(ran.body?.error ?? "Refused").slice(0, 300) });
        return err(ran.body?.error ?? "Could not check you in — please ask at the desk", ran.status);
      }
      await record(db, { ...base, ...where, result: "ok", booking_id: ran.body.bookingId });
      return json({
        ok: true, branch: branch.name, bookingId: ran.body.bookingId, deskLabel: ran.body.deskLabel ?? null, deskReason: ran.body.deskLabel ? reason : null,
        endTime: ran.body.endTime, sessionHours: ran.body.sessionHours, expiredMembership: !!ran.body.expiredMembership,
        ...(ran.body.collision ? { collision: ran.body.collision } : {}),
      });
    },

    me_check_out: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "self_checkin"))) return err("Self checkout is not open yet — please check out at the desk", 403);
      const session = await openSession(db, s.id);
      if (!session) return err("You have no open session to check out of");
      const now = Date.now();
      const overtimeMinutes = overtimeMinutesAt(session, now);
      const ran = await runNested(actionDef("checkout_booking"), ctx, { staff: portalScope(session.branch_id) }, {
        bookingId: session.id, overtimeMinutes, overtimePayNow: false, actualEndTime: new Date(now).toISOString(), foodAsDues: true,
      });
      if (!ran.ok) return err(ran.body?.error ?? "Could not check you out — please ask at the desk", ran.status);
      if (ran.body?.needsFoodPassCollection) return err("Your Food Pass needs a top-up — please check out at the desk", 409);
      await record(db, { student_id: s.id, branch_id: session.branch_id, booking_id: session.id, kind: "out", result: "ok" });
      // Member overtime is Pay Later (billed at renewal or closure), exactly as the desk records it.
      const { overtimeHours, overtimeCharge } = computeOvertimeCharge(overtimeMinutes, 0, 0, false);
      return json({ ok: true, overtimeMinutes, overtimeCharge: overtimeHours > 0 ? overtimeCharge : 0, foodDue: Number(ran.body?.foodDue ?? 0) });
    },

    // ─── Student: SP14, SP15 ───
    me_live_seats: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "live_seats"))) return json({ on: false });
      const { data: branches } = await db.from("branches").select("id, name").eq("is_active", true).order("name");
      const ids = (branches ?? []).map((b: any) => b.id);
      if (!ids.length) return json({ on: true, branches: [] });
      const [{ data: desks }, { data: open }] = await Promise.all([
        db.from("desks").select("branch_id").in("branch_id", ids).eq("seat_type", "floating").limit(5000),
        db.from("bookings").select("branch_id, desks!desk_id(seat_type)").in("branch_id", ids).eq("status", "active").limit(5000),
      ]);
      return json({
        on: true, at: new Date().toISOString(),
        branches: (branches ?? []).map((b: any) => ({
          id: b.id, name: b.name,
          ...freeSeats((desks ?? []).filter((d: any) => d.branch_id === b.id).length,
            (open ?? []).filter((o: any) => o.branch_id === b.id).map((o: any) => ({ deskSeatType: o.desks?.seat_type ?? null }))),
        })),
      });
    },

    me_seat_prefs: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "seat_matching"))) return json({ on: false });
      if (!s.branch_id) return json({ on: true, desks: [], prefs: { deskIds: [], tags: [] }, tags: DESK_TAGS });
      const [{ data: desks }, { data: p }] = await Promise.all([
        db.from("desks").select("id, label, tags").eq("branch_id", s.branch_id).eq("seat_type", "floating").order("sort_order").limit(500),
        db.from("seat_preferences").select("desk_ids, tags").eq("student_id", s.id).maybeSingle(),
      ]);
      return json({
        on: true, tags: DESK_TAGS, maxFavourites: MAX_FAVOURITES,
        desks: (desks ?? []).map((d: any) => ({ id: d.id, label: d.label, tags: d.tags ?? [] })),
        prefs: { deskIds: p?.desk_ids ?? [], tags: p?.tags ?? [] },
      });
    },

    me_set_seat_prefs: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "seat_matching"))) return err("Seat preferences are not open yet", 403);
      const ids = Array.isArray(payload.deskIds) ? [...new Set(payload.deskIds.filter((x: unknown) => typeof x === "string" && UUID.test(x)))] as string[] : [];
      if (ids.length > MAX_FAVOURITES) return err(`Pick at most ${MAX_FAVOURITES} desks`);
      if (ids.length) {
        if (!s.branch_id) return err("Your branch is not set — ask the desk");
        const { data: ok } = await db.from("desks").select("id").in("id", ids).eq("branch_id", s.branch_id).eq("seat_type", "floating");
        if ((ok ?? []).length !== ids.length) return err("Pick desks from your own branch's open seats");
      }
      const tags = cleanTags(payload.tags);
      const { error } = await db.from("seat_preferences").upsert({ student_id: s.id, desk_ids: ids, tags, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
      if (error) return err(error.message, 500);
      return json({ ok: true, prefs: { deskIds: ids, tags } });
    },

    // ─── Staff and owner ───
    suggest_desk: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!requireBranch(staff, payload.branchId)) return err("Branch access denied", 403);
      if (!(await featureOn(db, "seat_matching"))) return json({ on: false, desk: null });
      const studentId = typeof payload.studentId === "string" && UUID.test(payload.studentId) ? payload.studentId : null;
      const ranked = await rankedFreeDesks(db, payload.branchId, studentId);
      const top = ranked[0];
      return json({ on: true, desk: top ? { id: top.desk.id, label: top.desk.label } : null, reason: top?.reason ?? null, free: ranked.length });
    },

    set_desk_tags: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { data: desk } = await db.from("desks").select("id, branch_id").eq("id", payload.deskId).maybeSingle();
      if (!desk) return err("Desk not found", 404);
      const tags = cleanTags(payload.tags);
      await db.from("desks").update({ tags }).eq("id", desk.id);
      return json({ ok: true, tags });
    },

    get_checkin_settings: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const branchId = typeof payload?.branchId === "string" && UUID.test(payload.branchId) ? payload.branchId : null;
      const [on, seatMatching, { data: branches }, { data: desks }] = await Promise.all([
        featureOn(db, "self_checkin"), featureOn(db, "seat_matching"),
        db.from("branches").select("id, name, latitude, longitude, checkin_key").eq("is_active", true).order("name"),
        // I4: a branch's open seats with their tags, for the owner to set.
        branchId ? db.from("desks").select("id, label, tags").eq("branch_id", branchId).eq("seat_type", "floating").order("sort_order").limit(500) : Promise.resolve({ data: null }),
      ]);
      return json({
        on, seatMatching, tags: DESK_TAGS,
        ...(desks ? { desks: desks.map((d: any) => ({ id: d.id, label: d.label, tags: d.tags ?? [] })) } : {}),
        branches: (branches ?? []).map((b: any) => ({
          id: b.id, name: b.name, latitude: b.latitude, longitude: b.longitude,
          posterUrl: b.checkin_key ? posterUrl(b.id, b.checkin_key) : null,
          ready: !!(b.checkin_key && b.latitude != null),
        })),
      });
    },

    set_branch_location: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const lat = Number(payload.latitude), lng = Number(payload.longitude);
      const clear = payload.latitude == null && payload.longitude == null;
      if (!clear && !validCoords(lat, lng)) return err("Enter a latitude between -90 and 90 and a longitude between -180 and 180");
      const { data } = await db.from("branches").update(clear ? { latitude: null, longitude: null } : { latitude: lat, longitude: lng })
        .eq("id", payload.branchId).select("id");
      if (!data?.length) return err("Branch not found", 404);
      return json({ ok: true });
    },

    rotate_checkin_key: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const key = newCheckinKey();
      const { data } = await db.from("branches").update({ checkin_key: key }).eq("id", payload.branchId).select("id");
      if (!data?.length) return err("Branch not found", 404);
      return json({ ok: true, posterUrl: posterUrl(payload.branchId, key) });
    },

    // ─── A5 session watch: 23:30 IST ───
    cron_close_forgotten_sessions: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "session_watch"))) return json({ skipped: "pssai_session_watch is off" });
      const now = Date.now();
      const open = await fetchAllRows<any>(() => db.from("bookings").select("id, student_id, branch_id, booking_type, start_time, end_time, is_paused, paused_at")
        .eq("status", "active").lt("start_time", new Date(now).toISOString()).order("start_time").order("id"));
      const def = actionDef("checkout_booking");
      let closed = 0, left = 0;
      const failed: { bookingId: string; error: string }[] = [];
      for (const b of open) {
        const at = forgottenSessionEnd(b, now);
        if (!at) { left++; continue; }
        if (closed + failed.length >= CLOSE_LIMIT) break;
        const ran = await runNested(def, ctx, { staff: portalScope(b.branch_id) }, { bookingId: b.id, overtimeMinutes: 0, actualEndTime: at, foodAsDues: true });
        if (!ran.ok) { failed.push({ bookingId: b.id, error: String(ran.body?.error ?? ran.status) }); continue; }
        closed++;
        const due = Number(ran.body?.foodDue ?? 0);
        const day = toISTDateStr(b.start_time);
        await flag(db, "session_auto_closed", b.id, b.branch_id,
          `No checkout by 23:30 IST: closed at its booked end, ${hm(at)} on ${day}, with no overtime${due > 0 ? `; ₹${due} of food left as dues` : ""}.`);
        await notifyStudent(db, b.student_id, {
          kind: "session_closed", title: "Your session was closed for you",
          body: `You didn't check out on ${day}, so your session was closed at its booked end time, ${hm(at)}. No overtime was charged.${due > 0 ? ` ₹${due} of food is still due — please pay at the desk.` : ""}`,
          dedupeKey: `auto-close:${b.id}`,
        });
      }

      // Staff checkouts in the last day whose time was moved back more than CORRECTION_FLAG_MIN.
      const since = new Date(now - 26 * 3600e3).toISOString();
      const events = await fetchAllRows<any>(() => db.from("events").select("id, occurred_at, actor_type, actor_id, payload")
        .eq("action", "checkout_booking").eq("ok", true).in("actor_type", ["staff", "owner", "admin"]).gte("occurred_at", since).order("id"));
      const moved = events.filter((e) => {
        const at = Date.parse(e.payload?.actualEndTime ?? "");
        return typeof e.payload?.bookingId === "string" && Number.isFinite(at) && Date.parse(e.occurred_at) - at > CORRECTION_FLAG_MIN * 60e3;
      });
      let corrected = 0;
      const branchOf = new Map<string, string>();
      for (let i = 0; i < moved.length; i += 100) {
        const ids = moved.slice(i, i + 100).map((e) => e.payload.bookingId).filter((x: string) => UUID.test(x));
        if (!ids.length) continue;
        const { data } = await db.from("bookings").select("id, branch_id").in("id", ids);
        for (const r of data ?? []) branchOf.set(r.id, r.branch_id);
      }
      for (const e of moved) {
        const mins = Math.round((Date.parse(e.occurred_at) - Date.parse(e.payload.actualEndTime)) / 60e3);
        if (await flag(db, "checkout_corrected", e.payload.bookingId, branchOf.get(e.payload.bookingId) ?? null,
          `Checkout time set to ${hm(e.payload.actualEndTime)}, ${mins} minutes before it was entered (${Number(e.payload.overtimeMinutes) || 0} min overtime billed).`)) corrected++;
      }
      return json({ ok: true, open: open.length, closed, leftOpen: left, failed: failed.length, failures: failed.slice(0, 20), corrected });
    },
  };
}

/** O2 part 2 checks for the nightly integrity report (system.ts). Read only. */
export async function selfCheckinFindings(db: Ctx["db"]) {
  const now = Date.now();
  const since48 = new Date(now - 48 * 3600e3).toISOString(), since24 = new Date(now - 24 * 3600e3).toISOString();
  const settled = new Date(now - 15 * 60e3).toISOString();
  // A successful self check-in always opens a session; one without is a crash between the two.
  const orphan = await fetchAllRows<any>(() => db.from("checkin_records").select("id, student_id, branch_id, created_at")
    .eq("kind", "in").eq("result", "ok").is("booking_id", null).gte("created_at", since48).order("id"));
  // Staff check-ins at branches with a poster: each should have a reason (exit gate, Phase 4).
  const { data: posterBranches } = await db.from("branches").select("id").not("checkin_key", "is", null);
  const pb = (posterBranches ?? []).map((b: any) => b.id);
  const staffIns = pb.length ? await fetchAllRows<any>(() => db.from("events").select("id, occurred_at, branch_id, student_id, actor_id")
    .eq("action", "check_in_member").eq("ok", true).in("actor_type", ["staff", "owner", "admin"]).in("branch_id", pb).gte("occurred_at", since24).order("id")) : [];
  // Paid walk-ins with no desk payment recorded.
  const walkins = await fetchAllRows<any>(() => db.from("bookings").select("id, student_id, branch_id, amount, created_at")
    .eq("booking_type", "walkin").gt("amount", 0).gte("created_at", since48).lt("created_at", settled).order("id"));
  const paid = new Set<string>();
  for (let i = 0; i < walkins.length; i += 200) {
    const ids = walkins.slice(i, i + 200).map((w) => w.id);
    const { data } = await db.from("transactions").select("booking_id").in("booking_id", ids).eq("category", "desk");
    for (const t of data ?? []) paid.add(t.booking_id);
  }
  const unpaid = walkins.filter((w) => !paid.has(w.id));
  return { orphan, staffIns, unpaid };
}
