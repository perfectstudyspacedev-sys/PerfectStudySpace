// PSS-AI Phase 4 — I22/SP17 complaints to tickets (pssai_tickets) and C17 photo-proof housekeeping
// tasks (pssai_photo_tasks).
//  - A student reports a problem in a C16 category; the priority comes from fixed word lists
//    (_shared/tickets.ts), never from AI, and the text is logged as its length only. Staff work the
//    queue; the student is told when it is resolved.
//  - A task that needs a photo (all daily cleaning tasks by default) can be ticked only after that
//    day's photo is uploaded to the private task-photos bucket. The owner opens photos through
//    short-lived links; cron_purge_images removes them after task_photo_keep_days.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, istDayStart, todayISO } from "../../_shared/dates.ts";
import { alertDesk, notifyStudent } from "../../_shared/notify.ts";
import { OPEN_TICKETS_MAX, TICKET_CATEGORIES, TICKETS_PER_DAY, ticketPriority } from "../../_shared/tickets.ts";
import { decodeImage } from "../payments-lib.ts";
import { isISODate } from "../lib.ts";

const me = (ctx: Ctx) => ctx.student!;
export const TASK_PHOTO_BUCKET = "task-photos";
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PHOTO_DAYS_BACK = 7;

const ticketView = (t: any) => ({
  id: t.id, category: t.category, priority: t.priority, details: t.details, deskLabel: t.desk_label, status: t.status,
  resolution: t.resolution, at: t.created_at, updatedAt: t.updated_at, resolvedAt: t.resolved_at,
});

/** Whether a task's photo for a day is in. */
export async function photosFor(db: Ctx["db"], taskIds: string[], date: string): Promise<Set<string>> {
  if (!taskIds.length) return new Set();
  const { data } = await db.from("task_photos").select("task_id").in("task_id", taskIds).eq("completion_date", date);
  return new Set((data ?? []).map((p: any) => p.task_id));
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student: SP17 ───
    me_report_problem: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "tickets"))) return err("Reporting here is not open yet — please tell the desk", 403);
      if (!(TICKET_CATEGORIES as readonly string[]).includes(payload.category)) return err("Choose what the problem is about");
      const details = typeof payload.details === "string" ? payload.details.trim() : "";
      if (details.length < 3) return err("Tell us a little about the problem");
      if (details.length > 600) return err("Please keep it under 600 characters");
      const [{ count: today }, { count: open }, { data: session }] = await Promise.all([
        db.from("tickets").select("*", { count: "exact", head: true }).eq("student_id", s.id).gte("created_at", istDayStart(todayISO())),
        db.from("tickets").select("*", { count: "exact", head: true }).eq("student_id", s.id).in("status", ["open", "in_progress"]),
        db.from("bookings").select("branch_id, desks!desk_id(label)").eq("student_id", s.id).eq("status", "active").order("start_time", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if ((today ?? 0) >= TICKETS_PER_DAY) return err(`You can report ${TICKETS_PER_DAY} problems a day here — for more, please tell the desk`, 429);
      if ((open ?? 0) >= OPEN_TICKETS_MAX) return err("You already have several open reports — we're on them", 429);
      const branchId = session?.branch_id ?? s.branch_id;
      if (!branchId) return err("Your branch is not set — please tell the desk");
      const typedDesk = typeof payload.deskLabel === "string" ? payload.deskLabel.trim().slice(0, 20) : "";
      const priority = ticketPriority(payload.category, details);
      const { data: t, error } = await db.from("tickets").insert({
        branch_id: branchId, student_id: s.id, category: payload.category, priority, details,
        desk_label: typedDesk || (session?.desks as any)?.label || null,
      }).select("*").single();
      if (error || !t) return err(error?.message ?? "Could not save your report", 500);
      // Urgent reports reach a person at once: the desk's message alerts show it (review fix).
      if (priority === "urgent") await alertDesk(db, branchId, `Urgent problem reported${t.desk_label ? ` at desk ${t.desk_label}` : ""}: ${details.slice(0, 200)}`);
      return json({ ok: true, ticket: ticketView(t) });
    },

    me_tickets: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "tickets"))) return json({ on: false });
      const { data } = await db.from("tickets").select("*").eq("student_id", me(ctx).id).order("created_at", { ascending: false }).limit(20);
      return json({ on: true, categories: TICKET_CATEGORIES, tickets: (data ?? []).map(ticketView) });
    },

    // ─── Staff ───
    list_tickets: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      let q = db.from("tickets").select("*, students(name), branches(name)").order("created_at", { ascending: false }).limit(300);
      if (payload.allBranches && isOwnerOrAdmin(staff)) {
        // every branch
      } else {
        if (!requireBranch(staff, payload.branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", payload.branchId);
      }
      q = payload.view === "all" ? q.gte("created_at", istDayStart(addDays(todayISO(), -30))) : q.in("status", ["open", "in_progress"]);
      const { data, error } = await q;
      if (error) return err(error.message, 500);
      const rows = (data ?? []).map((t: any) => ({ ...ticketView(t), student: t.students?.name ?? null, branch: t.branches?.name ?? null }));
      rows.sort((a: any, b: any) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (b.at < a.at ? -1 : 1));
      return json({ on: await featureOn(db, "tickets"), tickets: rows });
    },

    update_ticket: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { data: t } = await db.from("tickets").select("id, branch_id, student_id, status, category").eq("id", payload.ticketId).maybeSingle();
      if (!t) return err("Ticket not found", 404);
      if (!requireBranch(staff, t.branch_id)) return err("Branch access denied", 403);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), handled_by_staff_id: staff.id ?? null };
      if (payload.status !== undefined) {
        if (!STATUSES.includes(payload.status)) return err("Unknown status");
        updates.status = payload.status;
        updates.resolved_at = payload.status === "resolved" || payload.status === "closed" ? new Date().toISOString() : null;
      }
      if (payload.priority !== undefined) {
        if (!(payload.priority in PRIORITY_ORDER)) return err("Unknown priority");
        updates.priority = payload.priority;
      }
      const resolution = typeof payload.resolution === "string" ? payload.resolution.trim().slice(0, 300) : null;
      if (resolution) updates.resolution = resolution;
      await db.from("tickets").update(updates).eq("id", t.id);
      if (payload.status === "resolved" && t.status !== "resolved" && t.student_id) {
        await notifyStudent(db, t.student_id, {
          kind: "ticket", title: "The problem you reported is fixed",
          body: resolution ?? "Thank you for telling us. If it happens again, report it once more.", dedupeKey: `ticket-resolved:${t.id}`,
        });
      }
      return json({ ok: true });
    },

    // ─── C17 photo-proof tasks ───
    upload_task_photo: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!(await featureOn(db, "photo_tasks"))) return err("Task photos are not switched on", 403);
      const { data: task } = await db.from("tasks").select("id, branch_id, assigned_to_staff_id").eq("id", payload.taskId).maybeSingle();
      if (!task) return err("Task not found", 404);
      if (task.assigned_to_staff_id !== staff.id && !isOwnerOrAdmin(staff)) return err("Only the person a task is assigned to can add its photo", 403);
      const date = payload.date ?? todayISO();
      if (!isISODate(date) || date > todayISO() || date < addDays(todayISO(), -PHOTO_DAYS_BACK)) return err(`Choose today or a day in the last ${PHOTO_DAYS_BACK} days`);
      const image = decodeImage(payload.image);
      if ("error" in image) return err(image.error.replace(/screenshot/g, "photo"));
      const ext = image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg";
      const path = `${task.branch_id ?? "all"}/${task.id}/${date}.${ext}`;
      const { error: upErr } = await db.storage.from(TASK_PHOTO_BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: true });
      if (upErr) return err(`Could not save the photo: ${upErr.message}`, 500);
      const { error } = await db.from("task_photos").upsert(
        { task_id: task.id, completion_date: date, photo_path: path, uploaded_by_staff_id: staff.id ?? null, created_at: new Date().toISOString() },
        { onConflict: "task_id,completion_date" },
      );
      if (error) return err(error.message, 500);
      return json({ ok: true, date });
    },

    get_task_photo: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { data: task } = await db.from("tasks").select("id, branch_id, assigned_to_staff_id").eq("id", payload.taskId).maybeSingle();
      if (!task) return err("Task not found", 404);
      if (!isOwnerOrAdmin(staff) && task.assigned_to_staff_id !== staff.id) return err("Owner only", 403);
      const { data: p } = await db.from("task_photos").select("photo_path").eq("task_id", task.id).eq("completion_date", payload.date ?? todayISO()).maybeSingle();
      if (!p) return err("No photo for that day", 404);
      const { data, error } = await db.storage.from(TASK_PHOTO_BUCKET).createSignedUrl(p.photo_path, 300);
      if (error || !data?.signedUrl) return err(error?.message ?? "Could not open the photo", 500);
      return json({ url: data.signedUrl });
    },
  };
}
