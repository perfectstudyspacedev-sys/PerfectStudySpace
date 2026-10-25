// PSS-AI P2.1 SP6/SP8 and P2.3 — what a student asks for in the portal, and the owner's approval
// queue. Within policy a student's hold runs at once (C1, D5: a temporary membership, 1–7 days,
// once a calendar month); anything else — longer holds, permanent members (a hold frees their
// cabin), plan changes, refunds, privacy requests, waitlist acceptances — waits for the owner.
// A T3 action asked for by an agent or a student is queued by run.ts and decided here too.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { addDays, istDayStart, todayISO } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { portalScope } from "../../_shared/student.ts";
import { actionDef } from "../registry-ref.ts";
import { runNested } from "../run.ts";
import { createAlert } from "../lib.ts";
import { currentMembership } from "../portal-lib.ts";

export const SELF_HOLD_MAX_DAYS = 7;    // C1
const HOLD_MAX_DAYS = 31;
const MAX_OPEN_REQUESTS = 5;
const REQUEST_KINDS = ["plan_change", "refund", "privacy_download", "privacy_delete"];
const KIND_LABEL: Record<string, string> = {
  hold: "hold", plan_change: "plan change", refund: "refund", privacy_download: "copy of your data",
  privacy_delete: "deletion of your data", waitlist_accept: "permanent seat",
  // Queued by the referral job (requested_by_type 'system'), not asked for by the student.
  grant_cashback: "referral reward",
};

const me = (ctx: Ctx) => ctx.student!;

async function selfHoldUsedThisMonth(db: Ctx["db"], studentId: string) {
  const { count } = await db.from("membership_holds").select("*", { count: "exact", head: true })
    .eq("student_id", studentId).eq("requested_by_student", true).gte("paused_at", istDayStart(`${todayISO().slice(0, 7)}-01`));
  return (count ?? 0) > 0;
}

/** Stores a student request and its approvals row; the owner decides it. */
async function queueRequest(ctx: Ctx, kind: string, details: Record<string, unknown>) {
  const { db } = ctx;
  const s = me(ctx);
  const { count } = await db.from("student_requests").select("*", { count: "exact", head: true }).eq("student_id", s.id).eq("status", "pending");
  if ((count ?? 0) >= MAX_OPEN_REQUESTS) return err("You already have several requests waiting — please wait for the owner to answer them");
  const { data: appr, error } = await db.from("approvals").insert({
    kind: "student_request", action: kind, payload: details, requested_by_type: "student", requested_by_id: s.id,
    student_id: s.id, branch_id: s.branch_id,
  }).select("id").single();
  if (error || !appr) return err(error?.message ?? "Could not send the request", 500);
  const { data: reqRow, error: e2 } = await db.from("student_requests").insert({ student_id: s.id, branch_id: s.branch_id, kind, details, approval_id: appr.id }).select("id").single();
  if (e2) return err(e2.message, 500);
  return json({ pending_approval: appr.id, requestId: reqRow?.id, message: `Your ${KIND_LABEL[kind]} request was sent to the owner. You will see the answer here.` }, 202);
}

/** Marks the newest open hold of a membership with its planned end. */
async function planResume(db: Ctx["db"], membershipId: string, days: number, byStudent: boolean) {
  const { data: hold } = await db.from("membership_holds").select("id").eq("membership_id", membershipId).is("resumed_at", null)
    .order("paused_at", { ascending: false }).limit(1).maybeSingle();
  if (hold) await db.from("membership_holds").update({ planned_resume_date: addDays(todayISO(), days), requested_by_student: byStudent }).eq("id", hold.id);
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student ───
    me_request_hold: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      const days = Number(payload.days);
      if (!Number.isInteger(days) || days < 1 || days > HOLD_MAX_DAYS) return err(`Choose 1 to ${HOLD_MAX_DAYS} days — for longer, please talk to the desk`);
      const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 300) : "";
      const mem = await currentMembership(db, s.id);
      if (!mem) return err("You have no active membership to put on hold");
      if (mem.is_paused) return err("Your membership is already on hold");
      if (mem.start_date > todayISO()) return err("Your new period has not started yet");
      if (mem.end_date < todayISO()) return err("Your membership has ended — renew it first");
      const why = mem.category !== "temporary" ? "permanent seat (a hold frees the cabin)"
        : days > SELF_HOLD_MAX_DAYS ? `longer than ${SELF_HOLD_MAX_DAYS} days`
        : (await selfHoldUsedThisMonth(db, s.id)) ? "second hold this month" : null;
      if (why) return await queueRequest(ctx, "hold", { membershipId: mem.id, days, reason, why });
      const ran = await runNested(actionDef("pause_membership"), ctx, { staff: portalScope(mem.branch_id) }, { membershipId: mem.id, reason: reason || "Portal self-hold" });
      if (!ran.ok) return err(ran.body?.error ?? "Could not start the hold", ran.status);
      await planResume(db, mem.id, days, true);
      const until = addDays(todayISO(), days);
      await notifyStudent(db, s.id, { kind: "hold", title: "Your membership is on hold", body: `It resumes by itself on ${until}; the days you miss are added to your end date.` });
      return json({ ok: true, resumesOn: until });
    },

    me_resume: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const mem = await currentMembership(db, me(ctx).id);
      if (!mem?.is_paused) return err("Your membership is not on hold");
      if (mem.category !== "temporary") return err("A cabin has to be picked again — please ask the desk to resume your membership");
      const ran = await runNested(actionDef("resume_membership"), ctx, { staff: portalScope(mem.branch_id) }, { membershipId: mem.id });
      if (!ran.ok) return err(ran.body?.error ?? "Could not resume", ran.status);
      return json({ ok: true, newEndDate: ran.body?.newEndDate ?? null });
    },

    me_request: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!REQUEST_KINDS.includes(payload.kind)) return err("Choose what you are asking for");
      const text = typeof payload.details === "string" ? payload.details.trim() : "";
      if (payload.kind !== "privacy_download" && text.length < 3) return err("Tell the owner a little more");
      return await queueRequest(ctx, payload.kind, { text: text.slice(0, 500) });
    },

    me_respond_offer: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      const { data: offer } = typeof payload.offerId === "string"
        ? await db.from("permanent_waitlist").select("*").eq("id", payload.offerId).eq("student_id", s.id).maybeSingle()
        : { data: null };
      if (!offer || offer.offer_status !== "offered") return err("This offer is no longer open", 404);
      if (new Date(offer.offer_expires_at).getTime() < Date.now()) return err("This offer has expired");
      if (payload.accept !== true) {
        await db.from("permanent_waitlist").update({ offer_status: "declined", status: "cancelled" }).eq("id", offer.id);
        return json({ ok: true, declined: true });
      }
      // Queued first: if the request can't be queued, the offer stays open for the student to retry.
      const queued = await queueRequest(ctx, "waitlist_accept", { waitlistId: offer.id, hoursPerDay: offer.hours_per_day });
      if (queued.status === 202) await db.from("permanent_waitlist").update({ offer_status: "accepted" }).eq("id", offer.id).eq("offer_status", "offered");
      return queued;
    },

    // ─── Owner ───
    list_approvals: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const status = payload.status ?? "pending";
      if (!["pending", "approved", "denied"].includes(status)) return err("Invalid status");
      const { data, error } = await ctx.db.from("approvals")
        .select("id, kind, action, payload, requested_by_type, requested_by_id, run_id, student_id, status, reason, result, decided_at, created_at, ai_note, ai_note_at, students(name, phone), branches(name)")
        .eq("status", status).order("created_at", { ascending: status === "pending" }).limit(200);
      if (error) return err(error.message, 500);
      return json({ approvals: (data ?? []).map((a: any) => ({ ...a, name: a.students?.name ?? null, phone: a.students?.phone ?? null, branch: a.branches?.name ?? null, students: undefined, branches: undefined })) });
    },

    decide_approval: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Only the owner decides approvals", 403);
      const decision = payload.decision;
      if (decision !== "approve" && decision !== "deny") return err("Approve or deny");
      const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 500) : "";
      if (decision === "deny" && reason.length < 3) return err("Write a reason — the student will see it");
      if (typeof payload.approvalId !== "string") return err("Approval not found", 404);
      // Claim it, so two clicks can't run it twice.
      const { data: claimed } = await db.from("approvals")
        .update({ status: decision === "approve" ? "approved" : "denied", decided_by_staff_id: staff.id, decided_at: new Date().toISOString(), reason: reason || null })
        .eq("id", payload.approvalId).eq("status", "pending").select("*");
      const a = claimed?.[0];
      if (!a) return err("This was already decided, or does not exist", 409);
      const reopen = () => db.from("approvals").update({ status: "pending", decided_by_staff_id: null, decided_at: null, reason: null }).eq("id", a.id);
      const setRequest = (status: string) => db.from("student_requests").update({ status, decided_at: new Date().toISOString() }).eq("approval_id", a.id);
      const label = KIND_LABEL[a.action] ?? a.action;

      if (decision === "deny") {
        await setRequest("denied");
        if (a.action === "waitlist_accept" && a.payload?.waitlistId) await db.from("permanent_waitlist").update({ offer_status: "declined" }).eq("id", a.payload.waitlistId);
        // Something the system queued (a referral reward) was never the student's request: no notice.
        if (a.student_id && a.requested_by_type !== "system") await notifyStudent(db, a.student_id, { kind: "request_denied", title: `Your ${label} request was not approved`, body: reason, dedupeKey: `approval:${a.id}` });
        return json({ ok: true, decision: "denied" });
      }

      let result: any = null;
      if (a.kind === "t3_action") {
        const ran = await runNested(actionDef(a.action), ctx, {}, { ...a.payload, reason: `Approved request ${a.id} (asked by ${a.requested_by_type})${reason ? `: ${reason}` : ""}` });
        if (!ran.ok) { await reopen(); return err(`Not approved — ${a.action} said: ${ran.body?.error ?? `HTTP ${ran.status}`}`, 409); }
        result = ran.body;
      } else if (a.action === "hold") {
        // The plan may have changed since the request (renewed, ended, already on hold): the hold
        // applies only to the same membership, still active, not paused and not ended.
        const mem = a.student_id ? await currentMembership(db, a.student_id) : null;
        if (!mem || mem.id !== a.payload.membershipId || !mem.is_active || mem.is_paused || mem.end_date < todayISO()) {
          await reopen();
          return err("The student's membership has changed since this request (renewed, ended or already on hold) — deny it with a note.", 409);
        }
        const ran = await runNested(actionDef("pause_membership"), ctx, {}, { membershipId: a.payload.membershipId, reason: `Approved hold request ${a.id}` });
        if (!ran.ok) { await reopen(); return err(`Not approved — pause_membership said: ${ran.body?.error ?? `HTTP ${ran.status}`}`, 409); }
        await planResume(db, a.payload.membershipId, Number(a.payload.days), false);
        result = { ...ran.body, resumesOn: addDays(todayISO(), Number(a.payload.days)) };
      }
      // Plan changes, refunds, privacy requests and waitlist seats are finished by the owner or
      // the desk in the staff app (they need staff choices: amounts, cabins); approving tells the
      // student it is being done.
      await db.from("approvals").update({ result }).eq("id", a.id);
      await setRequest("approved");
      if (a.student_id && a.requested_by_type === "system" && a.action === "grant_cashback") {
        const amount = Number(a.payload?.cashbackValue) || 0;
        await notifyStudent(db, a.student_id, { kind: "cashback", title: "Thank you for bringing a friend", body: `₹${amount} comes off your next renewal.`, actionUrl: "/me/refer", dedupeKey: `approval:${a.id}` });
      } else if (a.student_id) {
        const body = a.action === "hold" ? `Your hold has started and ends on ${result.resumesOn}.`
          : a.kind === "t3_action" ? "It has been done." : "The desk will complete it and let you know.";
        await notifyStudent(db, a.student_id, { kind: "request_approved", title: `Your ${label} request was approved`, body: reason ? `${body} ${reason}` : body, dedupeKey: `approval:${a.id}` });
      }
      return json({ ok: true, decision: "approved", result });
    },

    // ─── System: holds end by themselves on their planned day ───
    cron_resume_holds: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const today = todayISO();
      const { data: holds } = await db.from("membership_holds").select("id, membership_id, student_id, branch_id, planned_resume_date")
        .is("resumed_at", null).lte("planned_resume_date", today).limit(500);
      let resumed = 0, toDesk = 0, failed = 0;
      for (const h of holds ?? []) {
        const { data: mem } = await db.from("memberships").select("id, category, is_paused, is_active").eq("id", h.membership_id).maybeSingle();
        if (!mem?.is_paused || !mem.is_active) continue;
        if (mem.category !== "temporary") {
          await createAlert(db, h.student_id, h.branch_id, "hold", today, "Planned hold ends today — pick a cabin and resume the membership");
          await notifyStudent(db, h.student_id, { kind: "hold_end", title: "Your hold ends today", body: "Please come to the desk so a cabin can be picked for you.", dedupeKey: `hold-end:${h.id}` });
          toDesk++;
          continue;
        }
        const ran = await runNested(actionDef("resume_membership"), ctx, { staff: portalScope(h.branch_id) }, { membershipId: mem.id });
        if (!ran.ok) { failed++; continue; }
        resumed++;
        await notifyStudent(db, h.student_id, { kind: "hold_end", title: "Welcome back — your hold has ended", body: `Your membership now ends on ${ran.body?.newEndDate}.`, dedupeKey: `hold-end:${h.id}` });
      }
      return json({ ok: true, resumed, toDesk, failed });
    },
  };
}
