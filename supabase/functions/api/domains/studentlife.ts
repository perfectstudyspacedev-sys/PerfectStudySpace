// PSS-AI Phase 5 portal release 4 and Phase 6. All code, no AI call:
//  - SP18 focus profile, SP19 exam coach, SP20 Study Wrapped (pssai_portal_r4).
//  - SP21 study buddy (pssai_study_buddy, C20): both opt in, both accept; then each sees the other's
//    first name and study window only — never a phone number.
//  - I33/SP22 study certificates (pssai_certificates, C21): signed with HMAC-SHA256 under the
//    CERTIFICATE_SECRET secret over exactly what the public check page shows.
//  - I34/SP23 parent digest (pssai_parent_digest, C22): a revocable read-only link; the week is
//    frozen on Sundays at 19:00 IST. No amounts, phone numbers or messages.
//  - O10 one owner, every branch (pssai_owner_overview).
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, daysBetween, istDayEnd, istDayStart, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { examFamily, familiesMatch, familyLabel } from "../../_shared/exams.ts";
import { buddyPairs, certificateText, examCoach, focusProfile, hmacHex, minutesPerDay, WINDOWS, wrapped } from "../../_shared/study.ts";
import { sameKey } from "../../_shared/checkin.ts";
import { CODE_ALPHABET, fetchAllRows, isISODate, randomCode } from "../lib.ts";
import { currentMembership } from "../portal-lib.ts";
import { PORTAL_URL } from "./portal.ts";

const me = (ctx: Ctx) => ctx.student!;
const firstName = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0] || "Your buddy";
const CERT_MAX_DAYS = 366;
const CERTS_PER_30_DAYS = 5;
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Completed sessions with their real length and break minutes. */
async function sessionsBetween(db: Ctx["db"], studentId: string, from: string, to: string) {
  const rows = await fetchAllRows<any>(() => db.from("bookings").select("id, start_time, end_time, total_pause_minutes, desks!desk_id(label)")
    .eq("student_id", studentId).eq("status", "completed").gte("start_time", istDayStart(from)).lte("start_time", istDayEnd(to)).order("start_time").order("id"));
  return rows.map((b) => ({ id: b.id, start: Date.parse(b.start_time), end: Date.parse(b.end_time ?? b.start_time), pauseMinutes: Number(b.total_pause_minutes ?? 0), desk: b.desks?.label ?? null }));
}

async function hallName(db: Ctx["db"], branchId: string | null) {
  const [{ data: legal }, { data: b }] = await Promise.all([
    db.from("app_settings").select("value").eq("key", "business_legal_name").maybeSingle(),
    branchId ? db.from("branches").select("name").eq("id", branchId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return [legal?.value || "Perfect Study Space", b?.name].filter(Boolean).join(" — ");
}

const certView = (c: any) => ({ id: c.id, hall: c.hall_name, name: c.student_name, from: c.date_from, to: c.date_to, hours: Number(c.hours), days: c.days, issuedAt: c.issued_at, revoked: !!c.revoked_at, verifyUrl: `${PORTAL_URL()}/verify/${c.id}` });

/** The week (Monday–Sunday, IST) a parent sees. */
export async function weekSummary(db: Ctx["db"], studentId: string, weekStart: string) {
  const weekEnd = addDays(weekStart, 6);
  const [sessions, { data: s }, mem, { data: ratings }] = await Promise.all([
    sessionsBetween(db, studentId, weekStart, weekEnd),
    db.from("students").select("name, branch_id").eq("id", studentId).maybeSingle(),
    currentMembership(db, studentId),
    db.from("focus_ratings").select("rating, created_at").eq("student_id", studentId).gte("created_at", istDayStart(weekStart)).lte("created_at", istDayEnd(weekEnd)),
  ]);
  const perDay = minutesPerDay(sessions);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => ({ date: d, minutes: perDay.get(d) ?? 0 }));
  const r: number[] = (ratings ?? []).map((x: any) => Number(x.rating));
  return {
    name: firstName(s?.name), hall: await hallName(db, s?.branch_id ?? null), weekStart, weekEnd, days,
    minutes: days.reduce((a, d) => a + d.minutes, 0), daysAttended: days.filter((d) => d.minutes > 0).length,
    focus: r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null, planEnds: mem?.end_date ?? null,
  };
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── SP18, SP19, SP20 ───
    me_focus_profile: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal_r4"))) return json({ on: false });
      const since = istDayStart(addDays(todayISO(), -180));
      const { data } = await db.from("focus_ratings").select("rating, created_at, bookings(start_time)").eq("student_id", me(ctx).id).gte("created_at", since).limit(1000);
      const ratings = (data ?? []).map((r: any) => ({ start: Date.parse(r.bookings?.start_time ?? r.created_at), rating: Number(r.rating) }));
      return json({ on: true, enough: ratings.length >= 5, ...focusProfile(ratings) });
    },

    me_exam_coach: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal_r4"))) return json({ on: false });
      const s = me(ctx);
      const today = todayISO();
      const [{ data: st }, mem, sessions] = await Promise.all([
        db.from("students").select("course").eq("id", s.id).maybeSingle(),
        currentMembership(db, s.id),
        sessionsBetween(db, s.id, addDays(today, -14), addDays(today, -1)),
      ]);
      const family = examFamily(st?.course);
      let exam: any = null;
      if (family) {
        const { data } = await db.from("exam_notices").select("exam_name, exam_family, exam_date").eq("status", "confirmed").gte("exam_date", today).order("exam_date").limit(50);
        exam = (data ?? []).find((e: any) => familiesMatch(e.exam_family, family)) ?? null;
      }
      const perDay = minutesPerDay(sessions);
      const minutes = Array.from({ length: 14 }, (_, i) => perDay.get(addDays(today, -14 + i)) ?? 0);
      return json({ on: true, course: st?.course ?? null, ...examCoach({ today, examDate: exam?.exam_date ?? null, examLabel: exam ? (familyLabel(exam.exam_family) || exam.exam_name) : (family ? familyLabel(family) : null), minutesLast14: minutes, planHours: Number(mem?.hours_per_day ?? 0) }) });
    },

    me_wrapped: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal_r4"))) return json({ on: false });
      const s = me(ctx);
      const thisMonth = todayISO().slice(0, 7);
      const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
      const month = typeof payload.month === "string" && /^\d{4}-\d{2}$/.test(payload.month) && payload.month <= thisMonth ? payload.month : lastMonth;
      const from = `${month}-01`;
      const to = month === thisMonth ? todayISO() : addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
      const sessions = await sessionsBetween(db, s.id, from, to);
      const { data: ratings } = await db.from("focus_ratings").select("rating").eq("student_id", s.id).gte("created_at", istDayStart(from)).lte("created_at", istDayEnd(to));
      // The branch's members' totals for the same month: counts only, for the percentile.
      let others: number[] = [];
      if (s.branch_id) {
        const rows = await fetchAllRows<any>(() => db.from("bookings").select("id, student_id, start_time, end_time, total_pause_minutes").eq("branch_id", s.branch_id)
          .eq("status", "completed").in("booking_type", ["temporary", "permanent"]).gte("start_time", istDayStart(from)).lte("start_time", istDayEnd(to)).order("id"));
        const by = new Map<string, number>();
        for (const b of rows) by.set(b.student_id, (by.get(b.student_id) ?? 0) + Math.max(0, Math.round((Date.parse(b.end_time ?? b.start_time) - Date.parse(b.start_time)) / 60000) - Number(b.total_pause_minutes ?? 0)));
        others = [...by.entries()].filter(([id]) => id !== s.id).map(([, m]) => m);
      }
      return json({ on: true, month, from, to, ...wrapped(sessions, (ratings ?? []).map((r: any) => Number(r.rating)), others) });
    },

    // ─── SP21 study buddy ───
    me_buddy: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "study_buddy"))) return json({ on: false });
      const s = me(ctx);
      const [{ data: profile }, { data: matches }] = await Promise.all([
        db.from("study_buddies").select("study_window, exam_family, active").eq("student_id", s.id).maybeSingle(),
        db.from("study_buddy_matches").select("id, student_a, student_b, a_answer, b_answer, status, created_at").or(`student_a.eq.${s.id},student_b.eq.${s.id}`).in("status", ["proposed", "connected"]).order("created_at", { ascending: false }).limit(1),
      ]);
      const m = matches?.[0] ?? null;
      let match = null;
      if (m) {
        const mine = m.student_a === s.id ? "a" : "b";
        const otherId = mine === "a" ? m.student_b : m.student_a;
        const [{ data: other }, { data: otherProfile }] = await Promise.all([
          m.status === "connected" ? db.from("students").select("name").eq("id", otherId).maybeSingle() : Promise.resolve({ data: null }),
          db.from("study_buddies").select("study_window, exam_family").eq("student_id", otherId).maybeSingle(),
        ]);
        match = {
          id: m.id, status: m.status, myAnswer: mine === "a" ? m.a_answer : m.b_answer,
          window: otherProfile?.study_window ?? null, exam: familyLabel(otherProfile?.exam_family ?? null) || null,
          ...(m.status === "connected" ? { firstName: firstName(other?.name) } : {}),
        };
      }
      return json({ on: true, windows: WINDOWS, profile: profile?.active ? { window: profile.study_window, exam: familyLabel(profile.exam_family) || null } : null, match });
    },

    me_buddy_join: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "study_buddy"))) return err("Study buddies are not open yet", 403);
      const s = me(ctx);
      if (!(WINDOWS as readonly string[]).includes(payload.window)) return err("Choose when you usually study");
      const mem = await currentMembership(db, s.id);
      if (!mem || !s.branch_id) return err("Study buddies are for members");
      const { data: st } = await db.from("students").select("course").eq("id", s.id).maybeSingle();
      const family = examFamily(st?.course);
      if (!family) return err("Tell the desk which exam you are preparing for first — buddies are matched by exam");
      const { error } = await db.from("study_buddies").upsert({ student_id: s.id, branch_id: s.branch_id, exam_family: family, study_window: payload.window, active: true }, { onConflict: "student_id" });
      if (error) return err(error.message, 500);
      return json({ ok: true });
    },

    me_buddy_leave: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      await db.from("study_buddies").update({ active: false }).eq("student_id", s.id);
      for (const col of ["student_a", "student_b"]) await db.from("study_buddy_matches").update({ status: "ended" }).eq(col, s.id).in("status", ["proposed", "connected"]);
      return json({ ok: true });
    },

    me_buddy_respond: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "study_buddy"))) return err("Study buddies are not open yet", 403);
      const s = me(ctx);
      const { data: m } = await db.from("study_buddy_matches").select("*").eq("id", payload.matchId).maybeSingle();
      if (!m || (m.student_a !== s.id && m.student_b !== s.id)) return err("Not found", 404);
      if (m.status !== "proposed") return err("This match is already decided", 409);
      const side = m.student_a === s.id ? "a_answer" : "b_answer";
      const answer = payload.accept === true ? "yes" : "no";
      const other = side === "a_answer" ? m.b_answer : m.a_answer;
      const status = answer === "no" || other === "no" ? "declined" : other === "yes" ? "connected" : "proposed";
      const { data } = await db.from("study_buddy_matches").update({ [side]: answer, status }).eq("id", m.id).eq("status", "proposed").is(side, null).select("id");
      if (!data?.length) return err("You already answered", 409);
      if (status === "connected") {
        for (const id of [m.student_a, m.student_b]) await notifyStudent(db, id, { kind: "buddy", title: "You have a study buddy", body: "You both said yes — see who in the portal, and say hi at the hall.", actionUrl: "/me/buddy", dedupeKey: `buddy:${m.id}:${id}` });
      }
      return json({ ok: true, matchStatus: status });
    },

    cron_buddy_matches: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "study_buddy"))) return json({ skipped: "pssai_study_buddy is off" });
      const profiles = await fetchAllRows<any>(() => db.from("study_buddies").select("student_id, branch_id, exam_family, study_window").eq("active", true).order("student_id"));
      const matches = await fetchAllRows<any>(() => db.from("study_buddy_matches").select("id, student_a, student_b, status").order("id"));
      const busy = new Set<string>();
      for (const m of matches) if (m.status === "proposed" || m.status === "connected") { busy.add(m.student_a); busy.add(m.student_b); }
      const seen = new Set(matches.map((m) => `${m.student_a}:${m.student_b}`));
      let made = 0;
      for (const [a, b] of buddyPairs(profiles, busy, seen)) {
        const { data, error } = await db.from("study_buddy_matches").insert({ student_a: a, student_b: b }).select("id").single();
        if (error || !data) continue;
        made++;
        for (const id of [a, b]) await notifyStudent(db, id, { kind: "buddy", title: "We found a study buddy for you", body: "Someone preparing for the same exam at the same time of day. Say yes or no in the portal — names are shown only if you both say yes.", actionUrl: "/me/buddy", dedupeKey: `buddy-offer:${data.id}:${id}` });
      }
      return json({ ok: true, made });
    },

    // ─── I33 certificates ───
    me_issue_certificate: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "certificates"))) return err("Certificates are not open yet", 403);
      const secret = Deno.env.get("CERTIFICATE_SECRET") ?? "";
      if (secret.length < 16) return err("Certificates are not set up yet — please ask the desk", 503);
      const s = me(ctx);
      const { dateFrom, dateTo } = payload;
      if (!isISODate(dateFrom) || !isISODate(dateTo) || dateFrom > dateTo) return err("Choose a start and an end date");
      if (dateTo > todayISO()) return err("The end date can't be in the future");
      if (daysBetween(dateFrom, dateTo) + 1 > CERT_MAX_DAYS) return err("A certificate covers at most 12 months");
      const { count } = await db.from("study_certificates").select("*", { count: "exact", head: true }).eq("student_id", s.id).gte("issued_at", new Date(Date.now() - 30 * 86400e3).toISOString());
      if ((count ?? 0) >= CERTS_PER_30_DAYS) return err(`At most ${CERTS_PER_30_DAYS} certificates a month`, 429);
      const sessions = await sessionsBetween(db, s.id, dateFrom, dateTo);
      const perDay = minutesPerDay(sessions);
      const minutes = [...perDay.values()].reduce((a, b) => a + b, 0);
      if (minutes <= 0) return err("There are no study hours in those dates");
      const { data: st } = await db.from("students").select("name, branch_id").eq("id", s.id).maybeSingle();
      const row: any = {
        id: randomCode(10, CODE_ALPHABET), student_id: s.id, branch_id: st?.branch_id ?? null, hall_name: await hallName(db, st?.branch_id ?? null),
        student_name: String(st?.name ?? s.name).trim(), date_from: dateFrom, date_to: dateTo, hours: Math.round((minutes / 60) * 100) / 100, days: perDay.size,
      };
      row.signature = await hmacHex(secret, certificateText(row));
      const { data, error } = await db.from("study_certificates").insert(row).select("*").single();
      if (error || !data) return err(error?.message ?? "Could not make the certificate", 500);
      return json({ ok: true, certificate: certView(data) });
    },

    me_certificates: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "certificates"))) return json({ on: false });
      const { data } = await db.from("study_certificates").select("*").eq("student_id", me(ctx).id).order("issued_at", { ascending: false }).limit(50);
      return json({ on: true, certificates: (data ?? []).map(certView) });
    },

    me_revoke_certificate: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("study_certificates").update({ revoked_at: new Date().toISOString() }).eq("id", payload.id).eq("student_id", me(ctx).id).is("revoked_at", null).select("id");
      if (!data?.length) return err("Not found, or already withdrawn", 404);
      return json({ ok: true });
    },

    public_verify_certificate: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "certificates"))) return err("Not found", 404);
      if (typeof payload.id !== "string" || !/^[0-9a-z]{10}$/.test(payload.id)) return json({ found: false });
      const { data: c } = await db.from("study_certificates").select("*").eq("id", payload.id).maybeSingle();
      if (!c) return json({ found: false });
      const secret = Deno.env.get("CERTIFICATE_SECRET") ?? "";
      const valid = secret.length >= 16 && sameKey(await hmacHex(secret, certificateText(c)), c.signature);
      return json({ found: true, valid: valid && !c.revoked_at, revoked: !!c.revoked_at, hall: c.hall_name, name: c.student_name, from: c.date_from, to: c.date_to, hours: Number(c.hours), days: c.days, issuedAt: c.issued_at });
    },

    // ─── I34 parent digest ───
    me_parent_info: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "parent_digest"))) return json({ on: false });
      const { data } = await db.from("parent_links").select("created_at, last_viewed_at").eq("student_id", me(ctx).id).is("revoked_at", null).maybeSingle();
      return json({ on: true, link: data ? { createdAt: data.created_at, lastViewedAt: data.last_viewed_at } : null });
    },

    me_parent_link: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "parent_digest"))) return err("The family summary is not open yet", 403);
      const s = me(ctx);
      // A new link replaces the old one, which stops working at once.
      await db.from("parent_links").update({ revoked_at: new Date().toISOString() }).eq("student_id", s.id).is("revoked_at", null);
      const token = randomCode(32, CODE_ALPHABET);
      const { error } = await db.from("parent_links").insert({ student_id: s.id, token_hash: await sha256(token) });
      if (error) return err(error.message, 500);
      return json({ ok: true, url: `${PORTAL_URL()}/p/${token}` });
    },

    me_revoke_parent_link: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("parent_links").update({ revoked_at: new Date().toISOString() }).eq("student_id", me(ctx).id).is("revoked_at", null).select("id");
      if (!data?.length) return err("There is no link to stop", 404);
      return json({ ok: true });
    },

    // Sundays 19:00 IST (C22): freeze the week that ends today for every student with a live link.
    cron_parent_digest: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "parent_digest"))) return json({ skipped: "pssai_parent_digest is off" });
      const today = todayISO();
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();          // 0 = Sunday
      const weekStart = addDays(today, -((weekday + 6) % 7));               // that week's Monday
      const links = await fetchAllRows<any>(() => db.from("parent_links").select("id, student_id").is("revoked_at", null).order("id"));
      let made = 0;
      for (const l of links) {
        const summary = await weekSummary(db, l.student_id, weekStart);
        const { error } = await db.from("parent_digests").upsert({ student_id: l.student_id, week_start: weekStart, summary }, { onConflict: "student_id,week_start" });
        if (error) continue;
        made++;
        await notifyStudent(db, l.student_id, { kind: "parent_digest", title: "This week's summary for your family is ready", body: `${Math.round(summary.minutes / 60)} hours over ${summary.daysAttended} days.`, dedupeKey: `parent-digest:${weekStart}` });
      }
      return json({ ok: true, weekStart, made });
    },

    public_parent_digest: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "parent_digest"))) return err("Not found", 404);
      if (typeof payload.token !== "string" || !/^[0-9a-z]{32}$/.test(payload.token)) return err("This link does not work", 404);
      const { data: link } = await db.from("parent_links").select("id, student_id, revoked_at").eq("token_hash", await sha256(payload.token)).maybeSingle();
      if (!link || link.revoked_at) return err("This link was stopped by the student", 404);
      await db.from("parent_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", link.id);
      const { data } = await db.from("parent_digests").select("week_start, summary").eq("student_id", link.student_id).order("week_start", { ascending: false }).limit(4);
      return json({ weeks: (data ?? []).map((d: any) => d.summary) });
    },

    // ─── O10 ───
    get_owner_overview: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      if (!(await featureOn(db, "owner_overview"))) return json({ on: false });
      const today = todayISO();
      const monthStart = `${today.slice(0, 7)}-01`;
      const { data: branches } = await db.from("branches").select("id, name").eq("is_active", true).order("name");
      const ids = (branches ?? []).map((b: any) => b.id);
      const [desks, open, tx, mems, approvals, tickets, orders] = await Promise.all([
        fetchAllRows<any>(() => db.from("desks").select("id, branch_id, seat_type").in("branch_id", ids).order("id")),
        fetchAllRows<any>(() => db.from("bookings").select("id, branch_id, desks!desk_id(seat_type)").eq("status", "active").in("branch_id", ids).order("id")),
        fetchAllRows<any>(() => db.from("transactions").select("id, branch_id, amount, created_at").in("branch_id", ids).gte("created_at", istDayStart(monthStart)).order("id")),
        fetchAllRows<any>(() => db.from("memberships").select("id, branch_id, fee_due, end_date").eq("is_active", true).in("branch_id", ids).order("id")),
        fetchAllRows<any>(() => db.from("approvals").select("id, branch_id").eq("status", "pending").order("id")),
        fetchAllRows<any>(() => db.from("tickets").select("id, branch_id").in("status", ["open", "in_progress"]).order("id")),
        fetchAllRows<any>(() => db.from("food_orders").select("id, branch_id").in("status", ["placed", "accepted", "ready"]).order("id")),
      ]);
      const todayStart = Date.parse(istDayStart(today));
      const rows = (branches ?? []).map((b: any) => {
        const mine = <T extends { branch_id: string | null }>(xs: T[]) => xs.filter((x) => x.branch_id === b.id);
        const seats = mine(desks).filter((d) => d.seat_type !== "fixed").length;
        const inNow = mine(open);
        const t = mine(tx);
        const m = mine(mems);
        return {
          id: b.id, name: b.name, checkedIn: inNow.length, freeSeats: Math.max(0, seats - inNow.filter((o) => o.desks?.seat_type !== "fixed").length), seats,
          collectedToday: Math.round(t.filter((x) => Date.parse(x.created_at) >= todayStart).reduce((a, x) => a + Number(x.amount), 0) * 100) / 100,
          collectedMonth: Math.round(t.reduce((a, x) => a + Number(x.amount), 0) * 100) / 100,
          dues: Math.round(m.reduce((a, x) => a + Number(x.fee_due || 0), 0) * 100) / 100,
          endingThisWeek: m.filter((x) => x.end_date >= today && x.end_date <= addDays(today, 7)).length,
          approvals: mine(approvals).length, tickets: mine(tickets).length, foodOrders: mine(orders).length,
        };
      });
      const sum = (k: string) => Math.round(rows.reduce((a: number, r: any) => a + Number(r[k]), 0) * 100) / 100;
      return json({
        on: true, today, branches: rows,
        totals: { checkedIn: sum("checkedIn"), freeSeats: sum("freeSeats"), collectedToday: sum("collectedToday"), collectedMonth: sum("collectedMonth"), dues: sum("dues"), endingThisWeek: sum("endingThisWeek"), approvals: approvals.length, tickets: sum("tickets"), foodOrders: sum("foodOrders") },
      });
    },
  };
}
