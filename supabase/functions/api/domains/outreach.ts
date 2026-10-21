// PSS-AI P2.4 A4 — the owner's Send list: who the collections job ranked today, why, and the
// message to send. The owner sends each one through WhatsApp (openWhatsApp) and marks it; nothing
// is sent automatically. save_send_list is the job's only write (agent only).
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { todayISO } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { isISODate } from "../lib.ts";

const MAX_ROWS = 400;

export function handlers(): Record<string, Handler> {
  return {
    save_send_list: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      if (!isISODate(payload.listDate) || !Array.isArray(payload.rows) || payload.rows.length > MAX_ROWS) return err("Invalid list");
      let saved = 0;
      for (const r of payload.rows) {
        if (typeof r.studentId !== "string" || typeof r.branchId !== "string" || typeof r.message !== "string" || !r.message.trim()) continue;
        const { data } = await db.from("send_list").upsert({
          list_date: payload.listDate, branch_id: r.branchId, student_id: r.studentId, reason: String(r.reason ?? "").slice(0, 200),
          amount: Number(r.amount) > 0 ? Number(r.amount) : null, message: r.message.slice(0, 1000), run_id: ctx.runId ?? null,
        }, { onConflict: "list_date,student_id", ignoreDuplicates: true }).select("id");
        if (!data?.length) continue;
        saved++;
        const days = Number(r.daysToEnd);
        await notifyStudent(db, r.studentId, {
          kind: "renewal_reminder",
          title: days < 0 ? "Your plan has ended" : days <= 7 ? "Your plan ends soon" : "Payment due",
          body: `${r.reason}. Renew or pay at the desk, or in the Pay page.`,
          actionUrl: "/me/pay", dedupeKey: `collections:${payload.listDate}`,
        });
      }
      return json({ ok: true, saved });
    },

    list_send_list: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const date = payload.date ?? todayISO();
      if (!isISODate(date)) return err("Invalid date");
      const { data, error } = await ctx.db.from("send_list").select("id, list_date, branch_id, student_id, reason, amount, message, status, handled_at, students(name, phone), branches(name)")
        .eq("list_date", date).order("status").order("created_at").limit(MAX_ROWS);
      if (error) return err(error.message, 500);
      return json({ date, rows: (data ?? []).map((r: any) => ({ ...r, name: r.students?.name ?? null, phone: r.students?.phone ?? null, branch: r.branches?.name ?? null, students: undefined, branches: undefined })) });
    },

    update_send_list_item: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      if (!["pending", "sent", "skipped"].includes(payload.status)) return err("Invalid status");
      const update: Record<string, unknown> = { status: payload.status, handled_by_staff_id: payload.status === "pending" ? null : staff.id, handled_at: payload.status === "pending" ? null : new Date().toISOString() };
      if (typeof payload.message === "string" && payload.message.trim()) update.message = payload.message.trim().slice(0, 1000);
      const { data } = typeof payload.id === "string" ? await ctx.db.from("send_list").update(update).eq("id", payload.id).select("id") : { data: null };
      if (!data?.length) return err("Not found", 404);
      return json({ ok: true });
    },
  };
}
