// Branches, desks, fees and the welcome template. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { istDayEnd, istDayStart, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { DEFAULT_WELCOME_TEMPLATE } from "../lib.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── BRANCHES ───
    list_branches: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      let q = db.from("branches").select("id, name, desk_count, shift_config, locker_capacity").eq("is_active", true).order("name");
      if (!isOwnerOrAdmin(staff)) q = q.eq("id", staff.branch_id!);
      const { data } = await q;
      return json({ branches: data ?? [] });
    },
    // Destination options for Transfer Branch. list_branches deliberately narrows staff to
    // their own branch (it drives branch pickers everywhere else), so transferring needed a
    // dedicated read: every branch is returned, but only id/name — no desk counts, capacity
    // or config that staff have no business seeing for a branch they don't work at.
    list_transfer_branches: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data } = await db.from("branches").select("id, name")
        .eq("is_active", true).order("name");
      return json({ branches: data ?? [] });
    },
    // Free cabins at a transfer destination. get_seat_map is branch-gated (correctly — it
    // exposes who is sitting where, including student names), so this returns the bare
    // minimum a transfer needs: the id and label of unoccupied desks, nothing about people.
    list_transfer_desks: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { branchId } = payload;
      if (!branchId) return err("Branch is required");
      const { data } = await db.from("desks").select("id, label")
        .eq("branch_id", branchId).eq("status", "free").order("sort_order");
      return json({ desks: data ?? [] });
    },
    update_branch: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { branchId, deskCount, shiftConfig, lockerCapacity } = payload;
      const updates: Record<string, unknown> = {};
      if (deskCount !== undefined) updates.desk_count = deskCount;
      if (shiftConfig !== undefined) updates.shift_config = shiftConfig;
      if (lockerCapacity !== undefined) {
        const cap = Number(lockerCapacity);
        if (!Number.isFinite(cap) || cap < 0) return err("Locker capacity must be a non-negative number");
        updates.locker_capacity = cap;
      }
      await db.from("branches").update(updates).eq("id", branchId);
      return json({ ok: true });
    },
    add_desk: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { branchId, label } = payload;
      const { data: maxSort } = await db.from("desks").select("sort_order").eq("branch_id", branchId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
      await db.from("desks").insert({ branch_id: branchId, label, sort_order: (maxSort?.sort_order ?? 0) + 1 });
      await db.from("branches").update({ desk_count: (await db.from("desks").select("*", { count: "exact", head: true }).eq("branch_id", branchId)).count }).eq("id", branchId);
      return json({ ok: true });
    },
    remove_desk: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { deskId } = payload;
      const { data: desk } = await db.from("desks").select("*").eq("id", deskId).single();
      if (desk?.status !== "free") return err("Cannot remove occupied desk");
      await db.from("desks").delete().eq("id", deskId);
      return json({ ok: true });
    },
    // ─── SEAT MAP ───
    get_seat_map: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, shift } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: desks } = await db.from("desks").select(`
        id, label, status, seat_type, assigned_student_id,
        students:assigned_student_id(name),
        bookings:current_booking_id(id, start_time, end_time, hours, booking_type, students(name, phone))
      `).eq("branch_id", branchId).order("sort_order");

      // Seat map only shows two colors — yellow (free or occupied floating desks) and grey (permanent/reserved)
      const permanent = desks?.filter(d => d.status === "reserved").length ?? 0;
      const free = (desks?.length ?? 0) - permanent;
      const occupied = desks?.filter(d => d.status === "occupied").length ?? 0;

      return json({ desks: desks ?? [], summary: { free, occupied, permanent, total: desks?.length ?? 0 }, shift });
    },
    // ─── COMBINED HALL (owner, all branches) ───
    get_combined_hall: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { data: branchesList } = await db.from("branches").select("id, name").eq("is_active", true).order("name");
      const today = todayISO();

      const rows = [];
      for (const b of branchesList ?? []) {
        const { data: desks } = await db.from("desks").select("status").eq("branch_id", b.id);
        const permanentDesks = desks?.filter(d => d.status === "reserved").length ?? 0;
        const freeDesks = (desks?.length ?? 0) - permanentDesks;

        const { count: currentlyStudying } = await db.from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("branch_id", b.id).eq("status", "active").eq("is_paused", false)
          .gte("created_at", istDayStart(today)).lte("created_at", istDayEnd(today));
        const { count: activeMemberships } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).gte("end_date", today);
        const { count: temporary } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).eq("category", "temporary").gte("end_date", today);
        const { count: permanent } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).eq("category", "permanent").gte("end_date", today);
        // "Pending" = any outstanding balance, regardless of due_date — due_date is always
        // set a month out on creation/renewal even for a partial payment made today, so
        // gating on it would hide a real balance for a full month.
        const { count: pending } = await db.from("memberships")
          .select("*", { count: "exact", head: true }).eq("branch_id", b.id).eq("is_active", true).gt("fee_due", 0);

        rows.push({
          id: b.id, name: b.name,
          freeDesks, permanentDesks, totalDesks: desks?.length ?? 0,
          currentlyStudying: currentlyStudying ?? 0, activeMemberships: activeMemberships ?? 0,
          temporary: temporary ?? 0, permanent: permanent ?? 0, pending: pending ?? 0,
        });
      }

      const totals = rows.reduce((acc, r) => ({
        freeDesks: acc.freeDesks + r.freeDesks, permanentDesks: acc.permanentDesks + r.permanentDesks,
        totalDesks: acc.totalDesks + r.totalDesks, currentlyStudying: acc.currentlyStudying + r.currentlyStudying,
        activeMemberships: acc.activeMemberships + r.activeMemberships, temporary: acc.temporary + r.temporary,
        permanent: acc.permanent + r.permanent, pending: acc.pending + r.pending,
      }), { freeDesks: 0, permanentDesks: 0, totalDesks: 0, currentlyStudying: 0, activeMemberships: 0, temporary: 0, permanent: 0, pending: 0 });

      return json({ branches: rows, totals });
    },
    get_combined_seatmap: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { data: branchesList } = await db.from("branches").select("id, name").eq("is_active", true).order("name");

      const branchesOut = [];
      for (const b of branchesList ?? []) {
        const { data: desks } = await db.from("desks").select(`
          id, label, status, seat_type, assigned_student_id,
          students:assigned_student_id(name),
          bookings:current_booking_id(id, start_time, end_time, hours, booking_type, students(name, phone))
        `).eq("branch_id", b.id).order("sort_order");
        const permanent = desks?.filter(d => d.status === "reserved").length ?? 0;
        const free = (desks?.length ?? 0) - permanent;
        branchesOut.push({ id: b.id, name: b.name, desks: desks ?? [], summary: { free, permanent, total: desks?.length ?? 0 } });
      }

      return json({ branches: branchesOut });
    },
    get_combined_pending: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { date } = payload;
      const targetDate = date || todayISO();

      // Any outstanding balance counts as pending, regardless of due_date — due_date is
      // always set a month out even on a same-day partial payment, so gating on it would
      // hide a real balance for a full month. Still sorted by due_date so overdue-longest
      // shows first.
      const { data: duePayments } = await db.from("memberships")
        .select("*, students(name, phone, course), branches(name)")
        .eq("is_active", true).gt("fee_due", 0)
        .order("due_date");
      const { data: expiredMemberships } = await db.from("memberships")
        .select("*, students(name, phone, course), branches(name)")
        .eq("is_active", true).eq("end_date", targetDate)
        .order("end_date");

      return json({ date: targetDate, duePayments: duePayments ?? [], expiredMemberships: expiredMemberships ?? [] });
    },
    // ─── FEE CONFIG ───
    list_fee_config: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data } = await db.from("fee_config").select("*").order("config_type").order("sort_order");
      return json({ config: data ?? [] });
    },
    update_fee_config: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { id, fee } = payload;
      await db.from("fee_config").update({ fee }).eq("id", id);
      return json({ ok: true });
    },
    // Shared WhatsApp welcome-message template (app_settings row keyed 'welcome_template') —
    // every staff member's device reads the same value, and only owner/admin can change it.
    get_welcome_template: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data } = await db.from("app_settings").select("value").eq("key", "welcome_template").maybeSingle();
      return json({ value: data?.value ?? DEFAULT_WELCOME_TEMPLATE });
    },
    update_welcome_template: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { value } = payload;
      if (!value || !String(value).trim()) return err("Template cannot be empty");
      await db.from("app_settings").upsert({
        key: "welcome_template", value: String(value), updated_by_staff_id: staff.id, updated_at: new Date().toISOString(),
      });
      return json({ ok: true });
    },
  };
  return h;
}
