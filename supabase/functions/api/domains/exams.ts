// PSS-AI Phase 3 — the exam calendar (I25), next-exam plans (O9, SP12), pay-later advice (O3,
// closes G16) and the exception desk's notes on approvals (A7). The AI reads exam pages and drafts
// approval notes in the agent function; it writes only through the agent-only save_* actions
// here. Matching exams to students, prices and risk are code.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, daysBetween, todayISO } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { EXAM_SOURCES, examFamily, familiesMatch, familyLabel, nextExam, parseLadder } from "../../_shared/exams.ts";
import { paylaterAdvice, paylaterRisk } from "../../_shared/paylater.ts";
import { fetchAllRows, isISODate } from "../lib.ts";
import { currentMembership, quoteRenewal, renewalBlock } from "../portal-lib.ts";
import { PORTAL_URL } from "./portal.ts";

const NEXT_EXAM_MONTHS = 3;
const ENDING_DAYS = 10;
const JUST_PASSED_DAYS = 14;
const SIGN_OFF = "— Team Perfect Study Space"; // C6
const me = (ctx: Ctx) => ctx.student!;
const okDate = (v: unknown) => (isISODate(v) ? v : null);

async function ladder(db: Ctx["db"]) {
  const { data } = await db.from("app_settings").select("value").eq("key", "exam_ladder").maybeSingle();
  return parseLadder(data?.value);
}

/** The next confirmed exam of a family from today, if any. */
async function nextConfirmed(db: Ctx["db"], family: string, from = todayISO()) {
  const { data } = await db.from("exam_notices").select("exam_name, exam_family, exam_date, apply_by").eq("status", "confirmed").gte("exam_date", from).order("exam_date").limit(50);
  return (data ?? []).find((e: any) => familiesMatch(e.exam_family, family)) ?? null;
}

/** O9 for one student: their exam, the next one up the ladder and a ready plan (code prices). */
export async function nextExamOffer(db: Ctx["db"], studentId: string) {
  const { data: s } = await db.from("students").select("id, name, course").eq("id", studentId).maybeSingle();
  const family = examFamily(s?.course);
  const next = nextExam(family, await ladder(db));
  if (!s || !family || !next) return null;
  const mem = await currentMembership(db, studentId);
  const quote = mem && !renewalBlock(mem) ? await quoteRenewal(db, mem, NEXT_EXAM_MONTHS) : null;
  const exam = await nextConfirmed(db, next);
  return {
    name: s.name, current: family, currentLabel: familyLabel(family), next, nextLabel: familyLabel(next),
    examDate: exam?.exam_date ?? null, applyBy: exam?.apply_by ?? null, membership: mem,
    plan: quote && !("error" in quote) ? { months: NEXT_EXAM_MONTHS, amount: quote.amount } : null,
  };
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── I25: the exam calendar ───
    list_exam_notices: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const status = ["suggested", "confirmed", "dismissed"].includes(payload.status) ? payload.status : null;
      let q = db.from("exam_notices").select("id, source, exam_name, exam_family, notified_on, apply_by, exam_date, url, status, created_at, reviewed_at")
        .gte("created_at", new Date(Date.now() - 400 * 86400e3).toISOString());
      if (status) q = q.eq("status", status);
      const { data } = await q.order("exam_date", { ascending: true }).limit(300);
      // How many current or recent students each exam concerns (their "preparing for" text).
      const students = await fetchAllRows<any>(() => db.from("students").select("id, course").not("course", "is", null).order("id"));
      const families = students.map((s) => examFamily(s.course)).filter(Boolean) as string[];
      return json({
        on: await featureOn(db, "exam_radar"),
        notices: (data ?? []).map((n: any) => ({ ...n, label: familyLabel(n.exam_family) || n.exam_name, students: n.exam_family ? families.filter((f) => familiesMatch(f, n.exam_family)).length : 0 })),
        ladder: (await ladder(db)).map((rung) => rung.map((f) => familyLabel(f) || f)),
      });
    },

    add_exam_notice: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const name = String(payload.examName ?? "").trim().slice(0, 160);
      if (name.length < 2) return err("Write the exam's name");
      const examDate = okDate(payload.examDate), applyBy = okDate(payload.applyBy);
      if (!examDate && !applyBy) return err("Give the exam date or the last day to apply");
      const source = EXAM_SOURCES.includes(payload.source) ? payload.source : "manual";
      const { data, error } = await db.from("exam_notices").insert({
        source, exam_name: name, exam_family: examFamily(name, source), exam_date: examDate, apply_by: applyBy, notified_on: okDate(payload.notifiedOn),
        url: typeof payload.url === "string" && /^https:\/\//.test(payload.url) ? payload.url.slice(0, 500) : null,
        status: "confirmed", created_by_staff_id: ctx.staff!.id, reviewed_by_staff_id: ctx.staff!.id, reviewed_at: new Date().toISOString(),
      }).select("id").single();
      if (error?.code === "23505") return err("That exam is already in the calendar", 409);
      if (error || !data) return err(error?.message ?? "Could not save", 500);
      return json({ id: data.id });
    },

    review_exam_notice: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      if (!["confirm", "dismiss"].includes(payload.decision)) return err("Confirm or dismiss");
      const update: Record<string, unknown> = { status: payload.decision === "confirm" ? "confirmed" : "dismissed", reviewed_by_staff_id: ctx.staff!.id, reviewed_at: new Date().toISOString() };
      if (payload.examDate !== undefined) update.exam_date = okDate(payload.examDate);
      if (payload.applyBy !== undefined) update.apply_by = okDate(payload.applyBy);
      if (typeof payload.examName === "string" && payload.examName.trim().length >= 2) { update.exam_name = payload.examName.trim().slice(0, 160); update.exam_family = examFamily(update.exam_name); }
      const { data } = typeof payload.id === "string" ? await db.from("exam_notices").update(update).eq("id", payload.id).select("id") : { data: null };
      if (!data?.length) return err("Not found", 404);
      return json({ ok: true });
    },

    save_exam_notices: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      if (!Array.isArray(payload.rows) || payload.rows.length > 100) return err("Invalid list");
      let saved = 0;
      for (const r of payload.rows) {
        if (!EXAM_SOURCES.includes(r.source) || typeof r.examName !== "string" || r.examName.trim().length < 2) continue;
        const name = r.examName.trim().slice(0, 160);
        // The unique index refuses a re-read of the same exam; checked here too, so the answer is clear.
        let dup = ctx.db.from("exam_notices").select("id").eq("source", r.source).ilike("exam_name", name.replace(/[%_\\]/g, (c: string) => `\\${c}`));
        dup = okDate(r.examDate) ? dup.eq("exam_date", okDate(r.examDate)) : dup.is("exam_date", null);
        if ((await dup.limit(1)).data?.length) continue;
        const { error } = await ctx.db.from("exam_notices").insert({
          source: r.source, exam_name: name, exam_family: examFamily(name, r.source), exam_date: okDate(r.examDate), apply_by: okDate(r.applyBy), notified_on: okDate(r.notifiedOn),
          url: typeof r.url === "string" && /^https:\/\//.test(r.url) ? r.url.slice(0, 500) : null, status: "suggested", run_id: ctx.runId ?? null,
        });
        if (!error) saved++;   // a re-read of the same exam is refused by the unique index (23505)
      }
      return json({ ok: true, saved });
    },

    // ─── O9 / SP12: next-exam plans ───
    me_next_exam: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "next_exam"))) return json({ on: false });
      const offer = await nextExamOffer(db, me(ctx).id);
      if (!offer) return json({ on: true, offer: null });
      const { membership: _m, name: _n, ...rest } = offer;
      return json({ on: true, offer: rest });
    },

    cron_next_exam: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "next_exam"))) return json({ skipped: "pssai_next_exam is off" });
      const today = todayISO();
      const mems = await fetchAllRows<any>(() => db.from("memberships").select("id, student_id, branch_id, end_date, students(course)")
        .eq("is_active", true).eq("is_paused", false).gte("end_date", today).order("id"));
      const { data: passed } = await db.from("exam_notices").select("exam_family").eq("status", "confirmed").lt("exam_date", today).gte("exam_date", addDays(today, -JUST_PASSED_DAYS));
      const passedFamilies = (passed ?? []).map((p: any) => p.exam_family).filter(Boolean);
      let noticed = 0;
      const rows: any[] = [];
      for (const m of mems) {
        const family = examFamily(m.students?.course);
        if (!family) continue;
        const ending = daysBetween(today, m.end_date) <= ENDING_DAYS;
        const justPassed = passedFamilies.some((f: string) => familiesMatch(f, family));
        if (!ending && !justPassed) continue;
        const offer = await nextExamOffer(db, m.student_id);
        if (!offer?.plan) continue;
        const when = offer.examDate ? ` (exam on ${offer.examDate})` : "";
        const sent = await notifyStudent(db, m.student_id, {
          kind: "next_exam", title: `Next: ${offer.nextLabel}${when}`,
          body: `Keep your seat for ${offer.nextLabel}: ${offer.plan.months} months for ₹${offer.plan.amount.toLocaleString("en-IN")}.`,
          actionUrl: "/me/next", dedupeKey: `next-exam:${m.id}:${offer.next}`,
        });
        if (!sent) continue;
        noticed++;
        const first = String(offer.name).split(" ")[0];
        rows.push({
          list_date: today, branch_id: m.branch_id, student_id: m.student_id, kind: "next_exam", reason: `${offer.currentLabel} → ${offer.nextLabel}`.slice(0, 200), amount: offer.plan.amount,
          message: `Hi ${first}, all the best for ${offer.currentLabel}! Many students go on to ${offer.nextLabel}${when}. You can keep your seat for ${offer.plan.months} months for ₹${offer.plan.amount.toLocaleString("en-IN")} — renew in the portal: ${PORTAL_URL()}/me/next\n${SIGN_OFF}`,
        });
      }
      for (const r of rows) await db.from("send_list").upsert(r, { onConflict: "list_date,student_id", ignoreDuplicates: true });
      return json({ ok: true, noticed });
    },

    // ─── O3: pay-later advice ───
    cron_paylater_scores: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "paylater_advice"))) return json({ skipped: "pssai_paylater_advice is off" });
      const active = await fetchAllRows<any>(() => db.from("memberships").select("student_id").eq("is_active", true).order("id"));
      const ids = [...new Set(active.map((m) => m.student_id))];
      let scored = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const [{ data: mems }, { data: churn }] = await Promise.all([
          db.from("memberships").select("student_id, is_active, fee_due, renewed_from_membership_id").in("student_id", part),
          db.from("student_scores").select("student_id, score").eq("model", "churn").in("student_id", part),
        ]);
        const churnOf = new Map<string, number>((churn ?? []).map((c: any) => [c.student_id, Number(c.score)]));
        const rows = part.map((sid) => {
          const list = (mems ?? []).filter((m: any) => m.student_id === sid);
          const past = list.filter((m: any) => !m.is_active);
          const r = paylaterRisk({
            pastPlans: past.length, pastUnpaid: past.filter((m: any) => Number(m.fee_due) > 0).length,
            duesNow: list.filter((m: any) => m.is_active).reduce((t: number, m: any) => t + Number(m.fee_due || 0), 0),
            churn: churnOf.has(sid) ? churnOf.get(sid)! : null, renewals: list.filter((m: any) => m.renewed_from_membership_id).length,
          });
          return { student_id: sid, model: "paylater", version: "rules-1", score: r.risk, reason: `${r.band}: ${r.reasons.join("; ")}`.slice(0, 500), computed_at: new Date().toISOString() };
        });
        const { error } = await db.from("student_scores").upsert(rows, { onConflict: "student_id,model" });
        if (!error) scored += rows.length;
      }
      return json({ ok: true, scored });
    },

    get_paylater_advice: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "paylater_advice"))) return json({ on: false });
      const { data: s } = typeof payload.studentId === "string" ? await db.from("students").select("id, branch_id").eq("id", payload.studentId).maybeSingle() : { data: null };
      if (!s) return err("Student not found", 404);
      if (!requireBranch(ctx.staff!, s.branch_id)) return err("Branch access denied", 403);
      const { data: row } = await db.from("student_scores").select("score, reason, computed_at").eq("student_id", s.id).eq("model", "paylater").maybeSingle();
      if (!row) return json({ on: true, advice: null });
      const band = String(row.reason ?? "").split(":")[0] as "low" | "medium" | "high";
      return json({ on: true, advice: { band, risk: Number(row.score), reasons: String(row.reason ?? "").replace(/^[a-z]+: /, ""), computedAt: row.computed_at, ...paylaterAdvice(["low", "medium", "high"].includes(band) ? band : "high") } });
    },

    // ─── A7: the exception desk's note on an approval ───
    save_approval_note: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      const n = payload.note ?? {};
      if (typeof payload.approvalId !== "string" || !["approve", "deny", "ask"].includes(n.recommendation)) return err("Invalid note");
      const note = {
        recommendation: n.recommendation, confidence: ["high", "medium", "low"].includes(n.confidence) ? n.confidence : "low",
        reasons: (Array.isArray(n.reasons) ? n.reasons : []).slice(0, 4).map((r: unknown) => String(r).slice(0, 200)),
        questions: (Array.isArray(n.questions) ? n.questions : []).slice(0, 3).map((r: unknown) => String(r).slice(0, 200)),
        run_id: ctx.runId ?? null,
      };
      const { data } = await ctx.db.from("approvals").update({ ai_note: note, ai_note_at: new Date().toISOString() }).eq("id", payload.approvalId).eq("status", "pending").select("id");
      if (!data?.length) return err("This approval is no longer pending", 409);
      return json({ ok: true });
    },
  };
}
