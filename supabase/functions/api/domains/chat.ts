// PSS-AI P2.4 A1 — the portal chat. The student writes (me_chat_send, from the agent function),
// the concierge saves its reply (save_chat_reply, agent only), and staff review it: in shadow mode
// (Appendix F rule 7) every reply is a draft that a person sends, edits or discards. Staff can
// also answer any message themselves. The student only ever sees sent messages.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { featureOn } from "../../_shared/flags.ts";
import { istDayStart, todayISO } from "../../_shared/dates.ts";

export const MAX_MESSAGE = 1000;
export const DAILY_LIMIT = 30;          // a student's chat messages per day (the desk's time, and the AI budget)
const THREAD_ROWS = 1000;

/** The student's messages today (IST). */
export async function studentMessagesToday(db: Ctx["db"], studentId: string) {
  const { count } = await db.from("portal_chat_messages").select("*", { count: "exact", head: true })
    .eq("student_id", studentId).eq("role", "student").gte("created_at", istDayStart(todayISO()));
  return count ?? 0;
}
const me = (ctx: Ctx) => ctx.student!;
// Oldest first. Within the same instant a student's message comes before the reply to it.
export const byTime = (a: any, b: any) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.role === "student" ? 0 : 1) - (b.role === "student" ? 0 : 1));
const cleanBody = (v: unknown, max = MAX_MESSAGE) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student ───
    me_chat_history: async (ctx: Ctx): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("portal_chat_messages").select("id, role, body, created_at, sent_at, status")
        .eq("student_id", me(ctx).id).in("status", ["sent"]).order("created_at", { ascending: false }).limit(60);
      const list = (data ?? []).sort(byTime);
      const last = list.at(-1);
      return json({
        messages: list.map((m: any) => ({ id: m.id, role: m.role, body: m.body, at: m.sent_at ?? m.created_at })),
        waiting: !!last && last.role === "student",
        assistant: await featureOn(ctx.db, "concierge"),
      });
    },

    // The student's message, stored before the concierge runs (the agent function calls this).
    me_chat_send: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const body = cleanBody(payload.body);
      if (!body) return err("Write a message");
      if ((await studentMessagesToday(ctx.db, me(ctx).id)) >= DAILY_LIMIT) return err(`That's ${DAILY_LIMIT} messages today — please ask at the desk, or write again tomorrow`, 429);
      const { data, error } = await ctx.db.from("portal_chat_messages")
        .insert({ student_id: me(ctx).id, role: "student", body, status: "sent", sent_at: new Date().toISOString() }).select("id").single();
      if (error || !data) return err(error?.message ?? "Could not save the message", 500);
      return json({ id: data.id });
    },

    // ─── Agent ───
    save_chat_reply: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      const body = cleanBody(payload.body, 4000);
      if (!body || typeof payload.studentId !== "string") return err("Nothing to save");
      const status = payload.draft === false ? "sent" : "draft";
      const now = new Date().toISOString();
      const { data, error } = await ctx.db.from("portal_chat_messages").insert({
        student_id: payload.studentId, role: "assistant", body, status, reply_to: typeof payload.replyTo === "string" ? payload.replyTo : null,
        run_id: ctx.runId ?? null, ...(status === "sent" ? { sent_at: now } : {}),
      }).select("id").single();
      if (error || !data) return err(error?.message ?? "Could not save the reply", 500);
      return json({ id: data.id, status });
    },

    // ─── Staff: the chat review page ───
    list_chat_threads: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const branchId = typeof payload.branchId === "string" ? payload.branchId : null;
      if (branchId && !requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!branchId && !isOwnerOrAdmin(staff)) return err("Pick a branch", 403);
      const since = new Date(Date.now() - 14 * 86400e3).toISOString();
      // Newest first, so a busy fortnight drops the oldest rows, never the newest questions; the
      // branch is filtered in the database (through the inner join), before the limit.
      let q = db.from("portal_chat_messages").select("id, student_id, role, body, status, created_at, sent_at, reply_to, students!inner(name, phone, branch_id)")
        .neq("status", "discarded").gte("created_at", since);
      if (branchId) q = q.eq("students.branch_id", branchId);
      const { data } = await q.order("created_at", { ascending: false }).limit(THREAD_ROWS);
      const threads = new Map<string, any>();
      for (const m of (data ?? []).sort(byTime)) {
        const s = (m as any).students;
        const t = threads.get(m.student_id) ?? { studentId: m.student_id, name: s?.name, phone: s?.phone, branchId: s?.branch_id, messages: [] as any[] };
        t.messages.push({ id: m.id, role: m.role, body: m.body, status: m.status, at: m.sent_at ?? m.created_at, replyTo: m.reply_to });
        threads.set(m.student_id, t);
      }
      const open = [...threads.values()].map((t) => {
        const sent = t.messages.filter((m: any) => m.status === "sent");
        const last = sent.at(-1);
        const drafts = t.messages.filter((m: any) => m.status === "draft");
        return { ...t, messages: t.messages.slice(-12), drafts, unanswered: !!last && last.role === "student" };
      }).filter((t) => t.unanswered || t.drafts.length > 0);
      return json({ threads: open });
    },

    send_chat_reply: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const body = cleanBody(payload.body, 4000);
      if (!body) return err("Write the reply");
      const { data: student } = typeof payload.studentId === "string" ? await db.from("students").select("id, branch_id").eq("id", payload.studentId).maybeSingle() : { data: null };
      if (!student) return err("Student not found", 404);
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);
      const now = new Date().toISOString();
      if (typeof payload.draftId === "string") {
        // Send the concierge's draft, as is or edited; claimed so it is sent once.
        const { data } = await db.from("portal_chat_messages").update({ status: "sent", body, sent_by_staff_id: staff.id, sent_at: now })
          .eq("id", payload.draftId).eq("student_id", student.id).eq("status", "draft").select("id");
        if (!data?.length) return err("This draft was already sent or discarded", 409);
      } else {
        await db.from("portal_chat_messages").insert({ student_id: student.id, role: "staff", body, status: "sent", sent_by_staff_id: staff.id, sent_at: now });
      }
      // The reply answers the thread: older drafts (answers to earlier questions) are dropped, so
      // the page never offers a stale one next.
      await db.from("portal_chat_messages").update({ status: "discarded" }).eq("student_id", student.id).eq("status", "draft").lt("created_at", now);
      await notifyStudent(db, student.id, { kind: "chat_reply", title: "New reply in your chat", body: body.slice(0, 140), actionUrl: "/me/chat" });
      return json({ ok: true });
    },

    discard_chat_draft: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data: draft } = typeof payload.draftId === "string"
        ? await db.from("portal_chat_messages").select("id, student_id, status, students(branch_id)").eq("id", payload.draftId).maybeSingle() : { data: null };
      if (!draft || draft.status !== "draft") return err("Draft not found", 404);
      if (!requireBranch(ctx.staff!, (draft as any).students?.branch_id)) return err("Branch access denied", 403);
      await db.from("portal_chat_messages").update({ status: "discarded" }).eq("id", draft.id).eq("status", "draft");
      return json({ ok: true });
    },
  };
}
