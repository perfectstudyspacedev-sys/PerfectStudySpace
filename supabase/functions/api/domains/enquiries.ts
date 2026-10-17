// Enquiries, activities and follow-ups. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── ENQUIRIES (leads pipeline) ───
    list_enquiries: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let q = db.from("enquiries").select("*, branches(name)").order("created_at", { ascending: false });
      if (allBranches && isOwnerOrAdmin(staff)) {
        // no branch filter — every branch's enquiries, for the Combined Hall read-only view
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ enquiries: data ?? [] });
    },
    create_enquiry: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, name, phone, email, source, message } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name?.trim()) return err("Name is required");
      const { data, error } = await db.from("enquiries").insert({
        branch_id: branchId, name: name.trim(), phone: phone || null, email: email || null,
        source: source || "walk_in", message: message || null, created_by_staff_id: staff.id,
      }).select("*").single();
      if (error) return err(error.message);
      return json({ enquiry: data });
    },
    update_enquiry: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { id, fields } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", id).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiries").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return err(error.message);
      return json({ ok: true });
    },
    delete_enquiries: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const ids: string[] = payload.ids ?? (payload.id ? [payload.id] : []);
      if (!ids.length) return err("No enquiry ids provided");
      const { data: rows } = await db.from("enquiries").select("id, branch_id").in("id", ids);
      if (!rows?.length) return err("Enquiry not found");
      if (!rows.every(r => requireBranch(staff, r.branch_id))) return err("Branch access denied", 403);
      const { error } = await db.from("enquiries").delete().in("id", ids);
      if (error) return err(error.message);
      return json({ ok: true });
    },
    add_enquiry_activity: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { enquiryId, type, note } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiry_activities").insert({ enquiry_id: enquiryId, type, note: note || null });
      if (error) return err(error.message);
      return json({ ok: true });
    },
    list_enquiry_activities: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { enquiryId } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_activities").select("*").eq("enquiry_id", enquiryId).order("created_at", { ascending: true });
      return json({ activities: data ?? [] });
    },
    add_enquiry_followup: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { enquiryId, note, dueAt } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      if (!dueAt) return err("Due date/time is required");
      const { error } = await db.from("enquiry_followups").insert({
        enquiry_id: enquiryId, branch_id: enq.branch_id, note: note || "Follow up", due_at: dueAt,
      });
      if (error) return err(error.message);
      return json({ ok: true });
    },
    list_enquiry_followups: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { enquiryId } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_followups").select("*").eq("enquiry_id", enquiryId).order("due_at", { ascending: true });
      return json({ followups: data ?? [] });
    },
    update_enquiry_followup: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { id, fields } = payload;
      const { data: fu } = await db.from("enquiry_followups").select("branch_id").eq("id", id).single();
      if (!fu) return err("Follow-up not found");
      if (!requireBranch(staff, fu.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiry_followups").update(fields).eq("id", id);
      if (error) return err(error.message);
      return json({ ok: true });
    },
    list_open_enquiry_followups: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_followups").select("*").eq("branch_id", branchId).eq("done", false).order("due_at", { ascending: true });
      return json({ followups: data ?? [] });
    },
  };
  return h;
}
