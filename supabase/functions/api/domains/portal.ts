// PSS-AI P2.1 — the student portal (SP1–SP8): PIN login, the student's own membership, receipts,
// study report, inbox and privacy page, plus the desk's "Portal setup code". Every me_* action
// works only on the student in the token (ctx.student); no payload field can point it elsewhere.
// The api router refuses me_* actions while pssai_portal is off; login and PIN setup check it here.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, daysBetween, istDayEnd, istDayStart, todayISO } from "../../_shared/dates.ts";
import {
  hashSecret, newSetupCode, openSession, pinProblem, PIN_LOCK_MINUTES, PIN_MAX_TRIES, revokeSessions,
  SETUP_CODE_HOURS, SETUP_CODE_MAX_TRIES, verifySecret,
} from "../../_shared/student.ts";
import { fetchAllRows, isISODate } from "../lib.ts";
import { currentMembership, membershipView, quoteRenewal, RENEWAL_MONTHS, renewalBlock } from "../portal-lib.ts";

const PORTAL_OFF = "The student portal is not open yet — please ask at the desk.";
const LOGIN_FAILED = `Phone number or PIN is wrong. After ${PIN_MAX_TRIES} wrong tries, login stops for ${PIN_LOCK_MINUTES} minutes.`;
const SETUP_FAILED = "That code is wrong or has expired — ask the desk for a new one";
const REPORT_MAX_DAYS = 60;
export const PORTAL_URL = () => (Deno.env.get("PORTAL_URL")?.trim() || "https://join.perfectstudyspace.in").replace(/\/+$/, "");
const PRIVACY_KEYS = ["business_legal_name", "grievance_contact_name", "grievance_contact_phone", "grievance_contact_email"];

const me = (ctx: Ctx) => ctx.student!;
const phoneOf = (p: any) => String(p?.phone ?? "").replace(/\D/g, "");

async function settings(db: Ctx["db"], keys: string[]) {
  const { data } = await db.from("app_settings").select("key, value").in("key", keys);
  return new Map<string, string>((data ?? []).map((r: any) => [r.key, r.value]));
}

/** Holds a student may still start alone this month (C1: one self-hold per calendar month). */
async function selfHoldUsedThisMonth(db: Ctx["db"], studentId: string) {
  const monthStart = istDayStart(`${todayISO().slice(0, 7)}-01`);
  const { count } = await db.from("membership_holds").select("*", { count: "exact", head: true })
    .eq("student_id", studentId).eq("requested_by_student", true).gte("paused_at", monthStart);
  return (count ?? 0) > 0;
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Login (public) ───
    me_login: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal"))) return err(PORTAL_OFF, 403);
      const phone = phoneOf(payload);
      const pin = String(payload.pin ?? "");
      const { data: student } = /^\d{10}$/.test(phone)
        ? await db.from("students").select("id, name, branch_id").eq("phone", phone).maybeSingle()
        : { data: null };
      const { data: cred } = student
        ? await db.from("student_credentials").select("pin_hash, failed_attempts, locked_until").eq("student_id", student.id).maybeSingle()
        : { data: null };
      // Each try is counted before the PIN is checked, with one conditional update (the count must
      // still be what was read and the PIN not locked), so a burst of parallel guesses gets one
      // check each for the 5 tries, not one each per request (D6). A try that loses the race, a
      // locked PIN, an unknown phone and a wrong PIN all get the same answer and the same hashing.
      let counted = false;
      if (student && cred && !(cred.locked_until && Date.parse(cred.locked_until) > Date.now())) {
        const tries = Number(cred.failed_attempts ?? 0) + 1;
        // The row must still hold exactly what was read (count and lock). Plain filters only: on
        // PostgREST 12.2 an .or() on an update also filters the returned row, so an update that
        // sets the lock would look like a lost race (found by the Postgres suite).
        let q = db.from("student_credentials").update(tries >= PIN_MAX_TRIES
          ? { failed_attempts: 0, locked_until: new Date(Date.now() + PIN_LOCK_MINUTES * 60e3).toISOString() }
          : { failed_attempts: tries, locked_until: null })
          .eq("student_id", student.id).eq("failed_attempts", Number(cred.failed_attempts ?? 0));
        q = cred.locked_until ? q.eq("locked_until", cred.locked_until) : q.is("locked_until", null);
        const { data } = await q.select("student_id");
        counted = !!data?.length;
      }
      const ok = await verifySecret(pin, counted ? cred!.pin_hash : null);
      if (!student || !ok) return err(LOGIN_FAILED, 401);
      await db.from("student_credentials").update({ failed_attempts: 0, locked_until: null }).eq("student_id", student.id);
      const token = await openSession(db, student.id);
      return json({ token, student: { name: student.name } });
    },

    // A setup code from the desk + a new PIN. Also how a forgotten PIN is reset (D6).
    me_set_pin: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal"))) return err(PORTAL_OFF, 403);
      const pinErr = pinProblem(payload.pin);
      if (pinErr) return err(pinErr);
      if (payload.acceptPrivacy !== true) return err("Please read and accept the privacy notice first");
      const phone = phoneOf(payload);
      const code = String(payload.code ?? "");
      const { data: student } = /^\d{10}$/.test(phone)
        ? await db.from("students").select("id, name").eq("phone", phone).maybeSingle()
        : { data: null };
      const { data: setup } = student
        ? await db.from("student_setup_codes").select("code_hash, expires_at, attempts").eq("student_id", student.id).maybeSingle()
        : { data: null };
      // As with the PIN: the try is counted (conditionally) before the code is checked, so parallel
      // guesses can't share one count, and a code dies after 5 tries.
      let counted = false;
      if (student && setup && new Date(setup.expires_at).getTime() > Date.now() && Number(setup.attempts) < SETUP_CODE_MAX_TRIES) {
        const { data } = await db.from("student_setup_codes").update({ attempts: Number(setup.attempts) + 1 })
          .eq("student_id", student.id).eq("attempts", Number(setup.attempts)).select("student_id");
        counted = !!data?.length;
      }
      const ok = await verifySecret(code, counted ? setup!.code_hash : null);
      if (!student || !ok) return err(SETUP_FAILED, 401);
      const now = new Date().toISOString();
      const { error } = await db.from("student_credentials").upsert({
        student_id: student.id, pin_hash: await hashSecret(payload.pin), failed_attempts: 0, locked_until: null,
        pin_set_at: now, privacy_accepted_at: now,
      }, { onConflict: "student_id" });
      if (error) return err(error.message, 500);
      await db.from("student_setup_codes").delete().eq("student_id", student.id);
      await revokeSessions(db, student.id);
      const token = await openSession(db, student.id);
      return json({ token, student: { name: student.name } });
    },

    me_logout: async (ctx: Ctx): Promise<Response | undefined> => {
      await ctx.db.from("student_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", me(ctx).sessionId);
      return json({ ok: true });
    },

    // ─── The desk: a one-time code for a student to set (or reset) their PIN ───
    create_portal_setup_code: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!(await featureOn(db, "portal"))) return err("The student portal is switched off (pssai_portal)", 403);
      const { data: student } = typeof payload.studentId === "string"
        ? await db.from("students").select("id, name, phone, branch_id").eq("id", payload.studentId).maybeSingle()
        : { data: null };
      if (!student) return err("Student not found", 404);
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);
      const code = newSetupCode();
      const expiresAt = new Date(Date.now() + SETUP_CODE_HOURS * 3600e3).toISOString();
      const { error } = await db.from("student_setup_codes").upsert({
        student_id: student.id, code_hash: await hashSecret(code), expires_at: expiresAt, attempts: 0,
        created_by_staff_id: staff.id, created_at: new Date().toISOString(),
      }, { onConflict: "student_id" });
      if (error) return err(error.message, 500);
      const first = String(student.name).split(" ")[0];
      const message = `Hi ${first}, your Perfect Study Space portal code is ${code}. It works for 24 hours.\n` +
        `Open ${PORTAL_URL()}/me/setup, enter your phone number, this code and a new 6-digit PIN.\n` +
        `Never share your PIN with anyone.\n— Team Perfect Study Space`;
      return json({ code, expiresAt, phone: student.phone, message });
    },

    // ─── The student's own data ───
    me_profile: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data: s } = await ctx.db.from("students").select("name, phone, course, emergency_contact, status, branches(name)").eq("id", me(ctx).id).maybeSingle();
      if (!s) return err("Student not found", 404);
      // Phase 3: which portal pages are switched on (release hours, waitlist and referral, next exam).
      const [hourRelease, portalR2, nextExam, referral] = await Promise.all(["hour_release", "portal_r2", "next_exam", "referral_links"].map((f) => featureOn(ctx.db, f)));
      return json({
        profile: { name: s.name, phone: s.phone, course: s.course, emergencyContact: s.emergency_contact, status: s.status, branch: (s.branches as any)?.name ?? null },
        features: { hourRelease, waitlist: portalR2, cashbacks: portalR2, referral: portalR2 && referral, nextExam },
      });
    },

    // Contact fields only — never name, phone (the login), branch or plan.
    me_update_contact: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const ec = String(payload.emergencyContact ?? "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(ec)) return err("Emergency contact must be a 10 digit phone number");
      if (ec === me(ctx).phone) return err("Emergency contact must be a different number from your own");
      await ctx.db.from("students").update({ emergency_contact: ec, updated_at: new Date().toISOString() }).eq("id", me(ctx).id);
      return json({ ok: true, emergencyContact: ec });
    },

    me_membership: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const sid = me(ctx).id;
      const mem = await currentMembership(db, sid);
      const [{ data: desk }, { data: locker }, { data: pass }, { data: open }, { data: offer }, flags] = await Promise.all([
        mem?.desk_id ? db.from("desks").select("label").eq("id", mem.desk_id).maybeSingle() : Promise.resolve({ data: null }),
        db.from("lockers").select("id, locker_no, locker_due_date, monthly_fee, fee_due").eq("student_id", sid).eq("is_active", true).limit(1).maybeSingle(),
        db.from("food_passes").select("balance").eq("student_id", sid).maybeSingle(),
        db.from("payment_proofs").select("reference, purpose, amount_expected, status, created_at, reject_reason, decided_at")
          .eq("student_id", sid).in("status", ["requested", "submitted"]).order("created_at", { ascending: false }).limit(10),
        db.from("permanent_waitlist").select("id, offer_expires_at").eq("student_id", sid).eq("offer_status", "offered").limit(1).maybeSingle(),
        Promise.all(["upi_pay"].map((f) => featureOn(db, f))),
      ]);
      const quotes: { months: number; amount: number }[] = [];
      if (mem && flags[0] && !renewalBlock(mem)) {
        for (const m of RENEWAL_MONTHS) {
          const q = await quoteRenewal(db, mem, m);
          if ("amount" in q) quotes.push({ months: m, amount: q.amount });
        }
      }
      const holdUsed = await selfHoldUsedThisMonth(db, sid);
      return json({
        membership: membershipView(mem, desk?.label ?? null),
        renewalBlockedBy: mem ? renewalBlock(mem) : null,
        renewalQuotes: quotes,
        locker: locker ? { id: locker.id, lockerNo: locker.locker_no, dueDate: locker.locker_due_date, monthlyFee: Number(locker.monthly_fee), feeDue: Number(locker.fee_due ?? 0) } : null,
        foodPass: pass ? { balance: Number(pass.balance) } : null,
        openPayments: (open ?? []).map((p: any) => ({ reference: p.reference, purpose: p.purpose, amount: Number(p.amount_expected), status: p.status, createdAt: p.created_at })),
        selfHold: { usedThisMonth: holdUsed, canSelfHold: !!mem && mem.category === "temporary" && !mem.is_paused && !holdUsed, maxDays: 7 },
        waitlistOffer: offer && offer.offer_expires_at > new Date().toISOString() ? { id: offer.id, expiresAt: offer.offer_expires_at } : null,
        upiPay: flags[0],
      });
    },

    me_receipts: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const sid = me(ctx).id;
      const [{ data: tx }, { data: payouts }, { data: proofs }] = await Promise.all([
        db.from("transactions").select("id, created_at, amount, category, payment_mode, notes, branches(name)").eq("student_id", sid).order("created_at", { ascending: false }).limit(100),
        db.from("payouts").select("id, created_at, amount, payout_type, notes").eq("student_id", sid).order("created_at", { ascending: false }).limit(50),
        db.from("payment_proofs").select("reference, purpose, amount_expected, status, reject_reason, created_at, decided_at")
          .eq("student_id", sid).in("status", ["confirmed", "rejected"]).order("created_at", { ascending: false }).limit(50),
      ]);
      return json({
        receipts: (tx ?? []).map((t: any) => ({ id: t.id, date: t.created_at, amount: Number(t.amount), category: t.category, mode: t.payment_mode, notes: t.notes, branch: t.branches?.name ?? null })),
        payouts: (payouts ?? []).map((p: any) => ({ id: p.id, date: p.created_at, amount: Number(p.amount), type: p.payout_type, notes: p.notes })),
        upiPayments: (proofs ?? []).map((p: any) => ({ reference: p.reference, purpose: p.purpose, amount: Number(p.amount_expected), status: p.status, rejectReason: p.reject_reason, date: p.decided_at ?? p.created_at })),
      });
    },

    me_study_report: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const today = todayISO();
      const dateTo = payload.dateTo ?? today;
      const dateFrom = payload.dateFrom ?? addDays(dateTo, -6);
      if (!isISODate(dateFrom) || !isISODate(dateTo) || dateFrom > dateTo) return err("Pick a valid date range");
      if (dateTo > today) return err("The end date can't be in the future");
      if (daysBetween(dateFrom, dateTo) + 1 > REPORT_MAX_DAYS) return err(`Pick a period of at most ${REPORT_MAX_DAYS} days`);
      const sid = me(ctx).id;
      const rows = await fetchAllRows<any>(() => db.from("bookings").select("id, start_time, end_time, status, total_pause_minutes")
        .eq("student_id", sid).neq("status", "cancelled").gte("start_time", istDayStart(dateFrom)).lte("start_time", istDayEnd(dateTo))
        .order("start_time").order("id"));
      const { data: ratings } = await db.from("focus_ratings").select("booking_id, rating").eq("student_id", sid)
        .gte("created_at", istDayStart(dateFrom)).lte("created_at", istDayEnd(addDays(dateTo, 2)));
      const byBooking = new Map((ratings ?? []).map((r: any) => [r.booking_id, r.rating]));
      return json({
        dateFrom, dateTo,
        bookings: rows.map((b) => ({ start_time: b.start_time, end_time: b.end_time, status: b.status, pauseMinutes: Number(b.total_pause_minutes ?? 0), focus: byBooking.get(b.id) ?? null })),
      });
    },

    me_notifications: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("portal_notifications").select("id, kind, title, body, action_url, read_at, created_at")
        .eq("student_id", me(ctx).id).order("created_at", { ascending: false }).limit(50);
      const list = data ?? [];
      return json({ notifications: list, unread: list.filter((n: any) => !n.read_at).length });
    },

    me_mark_read: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      let q = ctx.db.from("portal_notifications").update({ read_at: new Date().toISOString() }).eq("student_id", me(ctx).id).is("read_at", null);
      if (payload.notificationId !== undefined) {
        if (typeof payload.notificationId !== "string") return err("Invalid notice");
        q = q.eq("id", payload.notificationId);
      }
      await q;
      return json({ ok: true });
    },

    // Plans and prices, for choosing (and for the concierge's plan advice, I27).
    me_plans: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("fee_config").select("cabin_type, hours_per_day, fee, sort_order").eq("config_type", "membership").order("sort_order");
      return json({
        plans: (data ?? []).map((r: any) => ({ category: r.cabin_type, hoursPerDay: Number(r.hours_per_day), monthlyFee: Number(r.fee) })),
        multiMonthDiscount: [{ months: 2, percent: 5 }, { months: 3, percent: 10 }, { months: 6, percent: 15 }],
      });
    },

    // SP8: who runs the hall, how to complain, what the student agreed to, open privacy requests.
    me_privacy: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const sid = me(ctx).id;
      const [values, { data: cred }, { data: requests }] = await Promise.all([
        settings(db, PRIVACY_KEYS),
        db.from("student_credentials").select("privacy_accepted_at, pin_set_at").eq("student_id", sid).maybeSingle(),
        db.from("student_requests").select("id, kind, status, created_at").eq("student_id", sid).in("kind", ["privacy_download", "privacy_delete"]).order("created_at", { ascending: false }).limit(10),
      ]);
      return json({
        businessName: values.get("business_legal_name") ?? "Perfect Study Space",
        grievance: { name: values.get("grievance_contact_name") ?? null, phone: values.get("grievance_contact_phone") ?? null, email: values.get("grievance_contact_email") ?? null },
        privacyAcceptedAt: cred?.privacy_accepted_at ?? null, pinSetAt: cred?.pin_set_at ?? null,
        requests: requests ?? [],
      });
    },
  };
}
