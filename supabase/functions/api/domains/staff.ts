// Staff, attendance, overrides, tasks, messages and alerts. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addDays, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isAdmin, isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { getOwnerStaffIds, isTaskDueOn } from "../lib.ts";
import { featureOn } from "../../_shared/flags.ts";
import { needsPhotoByDefault } from "../../_shared/tickets.ts";
import { photosFor } from "./tickets.ts";
import { STAFF_DUTIES, staffOpsRetired } from "../../_shared/retire.ts";

// PSS-AI S1 / C18: once the desk-staff modules retire, the only staff accounts kept are owner,
// admin and kitchen / housekeeping duties. Returns an error message, or null when the account may exist.
async function dutyProblem(db: Ctx["db"], role: string, duty: unknown): Promise<string | null> {
  if (duty !== undefined && !STAFF_DUTIES.includes(duty as any)) return "Duty is desk, kitchen or housekeeping";
  if (role === "owner" || role === "admin" || !(await staffOpsRetired(db))) return null;
  if (duty !== "kitchen" && duty !== "housekeeping") return "The desk-staff modules are retired — a staff account now needs a kitchen or housekeeping duty";
  return null;
}

// PSS-AI C17: with pssai_photo_tasks on, the tasks a day's list returns say whether that day's
// photo is in (photoTaken), for tasks that need one.
async function withPhotos(db: Ctx["db"], tasks: any[], date: string) {
  const need = tasks.filter((t) => t.needs_photo).map((t) => t.id);
  if (!need.length || !(await featureOn(db, "photo_tasks"))) return tasks;
  const have = await photosFor(db, need, date);
  return tasks.map((t) => (t.needs_photo ? { ...t, photoTaken: have.has(t.id) } : t));
}

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── STAFF MANAGEMENT ───
    list_staff: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      // Disambiguated FK hint (!branch_id) is required — staff now has two FKs to branches
      // (branch_id and override_branch_id from the branch-reassignment feature), so the
      // plain `branches(name)` embed is ambiguous to PostgREST and errors out silently.
      // PSS-AI S1: with each account's duty (migration 070); before 070 the plain list.
      const withDuty = await db.from("staff")
        .select("id, username, role, display_name, branch_id, is_active, duty, branches!branch_id(name)")
        .neq("role", "admin").order("username");
      if (!withDuty.error) return json({ staff: withDuty.data ?? [] });
      const { data } = await db.from("staff")
        .select("id, username, role, display_name, branch_id, is_active, branches!branch_id(name)")
        .neq("role", "admin").order("username");
      return json({ staff: data ?? [] });
    },
    // Kanban board data: every active staff member grouped under their EFFECTIVE branch for
    // today (override branch if one's set for today, otherwise their home branch) — so a
    // substitute shows up under the branch they're covering, not their home branch.
    get_staff_grid: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { data: branches } = await db.from("branches").select("id, name").eq("is_active", true).order("name");
      const { data: allStaff } = await db.from("staff")
        .select("id, username, display_name, role, branch_id, override_branch_id, override_date")
        .eq("is_active", true).neq("role", "owner").neq("role", "admin").order("display_name");

      const today = todayISO();
      const staffRows = (allStaff ?? []).map((s: { id: string; username: string; display_name: string | null; role: string; branch_id: string | null; override_branch_id: string | null; override_date: string | null }) => {
        const isOverrideToday = !!s.override_branch_id && s.override_date === today;
        return {
          id: s.id, username: s.username, displayName: s.display_name || s.username,
          homeBranchId: s.branch_id, effectiveBranchId: isOverrideToday ? s.override_branch_id : s.branch_id,
          isOverrideToday,
        };
      });

      return json({ date: today, branches: branches ?? [], staff: staffRows });
    },
    // Owner drags a staff card onto a different branch column — assigns them there for
    // today only. Dropping back onto their own home branch column clears the override.
    assign_staff_override: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { staffId, branchId } = payload;
      const { data: target } = await db.from("staff").select("id, role, branch_id").eq("id", staffId).single();
      if (!target) return err("Staff not found");
      if (target.role === "owner") return err("Can't reassign an owner account");
      const { data: branch } = await db.from("branches").select("id").eq("id", branchId).single();
      if (!branch) return err("Branch not found");

      const today = todayISO();
      if (branchId === target.branch_id) {
        await db.from("staff").update({ override_branch_id: null, override_date: null }).eq("id", staffId);
      } else {
        await db.from("staff").update({ override_branch_id: branchId, override_date: today }).eq("id", staffId);
      }
      return json({ ok: true });
    },
    // Manually revert a staff member to their home branch before the day is over.
    clear_staff_override: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { staffId } = payload;
      await db.from("staff").update({ override_branch_id: null, override_date: null }).eq("id", staffId);
      return json({ ok: true });
    },
    // ─── TASKS (two-way assignment) ───
    list_branch_staff: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      let q = db.from("staff").select("id, username, display_name, role, branch_id")
        .eq("is_active", true).neq("role", "admin").order("display_name");
      if (isOwnerOrAdmin(staff)) {
        // Include the owner themself (branch_id is null for owner accounts) so they can
        // self-assign a task regardless of which branch they're currently viewing.
        if (branchId) q = q.or(`branch_id.eq.${branchId},role.eq.owner`);
      } else {
        // Staff can also assign tasks to the owner, so include owner accounts (branch_id is
        // null for them) alongside this staff member's own branch.
        q = q.or(`branch_id.eq.${staff.branch_id!},role.eq.owner`);
      }
      const { data } = await q;
      const results = data ?? [];
      // Owner may not be tied to any single branch — always let them self-assign
      if (isOwnerOrAdmin(staff) && !results.some(s => s.id === staff.id)) {
        const { data: ownerRow } = await db.from("staff").select("id, username, display_name, role, branch_id").eq("id", staff.id).single();
        if (ownerRow) results.push(ownerRow);
      }
      return json({ staff: results });
    },
    create_task: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, assignedToStaffId, assignedToStaffIds, title, description, dueDate, repeatInterval } = payload;
      // Accepts either the older single assignedToStaffId, or a list to assign the same
      // task to several staff members at once — each gets their own independent task row
      // (own completion status), just created together in one go.
      const staffIds: string[] = assignedToStaffIds?.length ? assignedToStaffIds : (assignedToStaffId ? [assignedToStaffId] : []);
      if (!title) return err("Title is required");
      if (!staffIds.length) return err("Please select at least one person to assign this task to");
      if (repeatInterval && !["none", "daily", "weekly", "monthly"].includes(repeatInterval)) return err("Invalid repeat interval");
      const targetBranchId = branchId ?? staff.branch_id;
      if (!isOwnerOrAdmin(staff)) {
        if (!targetBranchId || targetBranchId !== staff.branch_id) return err("Branch access denied", 403);
        if (dueDate && dueDate < todayISO()) return err("Cannot assign a task on a past date");
        const { data: assignees } = await db.from("staff").select("id, branch_id, role").in("id", staffIds);
        const allValid = assignees?.length === staffIds.length
          && assignees.every(a => a.role === "owner" || a.branch_id === staff.branch_id);
        if (!allValid) return err("Can only assign tasks to staff in your branch, or the owner");
      }
      // PSS-AI C17: a daily cleaning task needs a photo unless the owner says otherwise.
      const photoOn = await featureOn(db, "photo_tasks");
      const needsPhoto = photoOn && (typeof payload.needsPhoto === "boolean" ? payload.needsPhoto : needsPhotoByDefault({ title, repeatInterval }));
      const rows = staffIds.map(sid => ({
        branch_id: targetBranchId, assigned_by_staff_id: staff.id, assigned_to_staff_id: sid,
        title, description: description ?? null, due_date: dueDate ?? null,
        repeat_interval: repeatInterval ?? "none",
        ...(needsPhoto ? { needs_photo: true } : {}),
      }));
      const { data: tasks, error: tErr } = await db.from("tasks").insert(rows).select("*");
      if (tErr) return err(tErr.message);
      return json({ ok: true, tasks });
    },
    list_tasks: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches, date } = payload;
      const targetDate = date || todayISO();
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username, is_active), assigned_by:assigned_by_staff_id(display_name, username), branches(name)")
        .order("created_at", { ascending: false });
      if (isOwnerOrAdmin(staff)) {
        if (!allBranches && branchId) q = q.eq("branch_id", branchId);
      } else {
        const bid = staff.branch_id;
        if (!bid) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid).or(`assigned_to_staff_id.eq.${staff.id},assigned_by_staff_id.eq.${staff.id}`);
        const ownerIds = await getOwnerStaffIds(db);
        if (ownerIds.length) q = q.not("assigned_to_staff_id", "in", `(${ownerIds.join(",")})`);
      }
      const { data, error: lErr } = await q;
      if (lErr) return err(lErr.message);

      const recurringIds = (data ?? []).filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", targetDate).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));

      const tasks = (data ?? []).map(t => ({
        ...t,
        dueToday: isTaskDueOn(t, targetDate) && (t.assigned_to?.is_active !== false || targetDate < todayISO()),
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));

      return json({ tasks: await withPhotos(db, tasks, targetDate) });
    },
    update_task_status: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { taskId, done, date } = payload;
      const targetDate = date || todayISO();
      const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
      if (!task) return err("Task not found");
      // Only the assignee can mark their own task complete — except the owner, who can
      // manually set completion status on any staff member's task (e.g. clearing missed
      // items in the Incomplete Tasks list).
      if (task.assigned_to_staff_id !== staff.id && !isOwnerOrAdmin(staff)) {
        return err("Only the person a task is assigned to can complete it", 403);
      }
      // PSS-AI C17: a task that needs a photo is ticked only once that day's photo is in.
      if (done && task.needs_photo && (await featureOn(db, "photo_tasks"))) {
        const have = await photosFor(db, [task.id], targetDate);
        if (!have.has(task.id)) return err("Add a photo of the finished task first");
      }
      if (task.repeat_interval === "none") {
        await db.from("tasks").update({
          status: done ? "done" : "pending", completed_at: done ? new Date().toISOString() : null,
        }).eq("id", taskId);
      } else if (done) {
        await db.from("task_completions").upsert(
          { task_id: taskId, completion_date: targetDate },
          { onConflict: "task_id,completion_date", ignoreDuplicates: true },
        );
      } else {
        await db.from("task_completions").delete().eq("task_id", taskId).eq("completion_date", targetDate);
      }
      return json({ ok: true });
    },
    get_my_tasks_today: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { data } = await db.from("tasks").select("*, branches(name)").eq("assigned_to_staff_id", staff.id);
      const today = todayISO();
      const dueTasks = (data ?? []).filter(t => isTaskDueOn(t, today));
      const recurringIds = dueTasks.filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", today).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));
      const tasks = dueTasks.map(t => ({
        ...t,
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));
      return json({ tasks: await withPhotos(db, tasks, today) });
    },
    get_task_completion_report: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches, date } = payload;
      const targetDate = date || todayISO();
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username, is_active), branches(name)");
      if (isOwnerOrAdmin(staff)) {
        if (!allBranches && branchId) q = q.eq("branch_id", branchId);
      } else {
        const bid = staff.branch_id;
        if (!bid) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid);
        const ownerIds = await getOwnerStaffIds(db);
        if (ownerIds.length) q = q.not("assigned_to_staff_id", "in", `(${ownerIds.join(",")})`);
      }
      const { data, error: rErr } = await q;
      if (rErr) return err(rErr.message);

      const dueTasks = (data ?? []).filter(t => isTaskDueOn(t, targetDate) && (t.assigned_to?.is_active !== false || targetDate < todayISO()));
      const recurringIds = dueTasks.filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", targetDate).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));

      const tasks = dueTasks.map(t => ({
        ...t,
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));

      return json({ date: targetDate, tasks: await withPhotos(db, tasks, targetDate) });
    },
    list_incomplete_tasks: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username), assigned_by:assigned_by_staff_id(display_name, username), branches(name)");
      if (isOwnerOrAdmin(staff)) {
        if (!allBranches && branchId) q = q.eq("branch_id", branchId);
      } else {
        const bid = staff.branch_id;
        if (!bid) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid).or(`assigned_to_staff_id.eq.${staff.id},assigned_by_staff_id.eq.${staff.id}`);
        const ownerIds = await getOwnerStaffIds(db);
        if (ownerIds.length) q = q.not("assigned_to_staff_id", "in", `(${ownerIds.join(",")})`);
      }
      const { data, error: tErr } = await q;
      if (tErr) return err(tErr.message);

      const today = todayISO();
      const LOOKBACK_DAYS = 7;
      const windowStart = addDays(today, -LOOKBACK_DAYS);

      const recurringIds = (data ?? []).filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id, completion_date").in("task_id", recurringIds).gte("completion_date", windowStart)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => `${c.task_id}:${c.completion_date}`));

      const missed: Array<Record<string, unknown>> = [];
      for (const t of data ?? []) {
        if (t.repeat_interval === "none") {
          if (t.due_date && t.due_date < today && t.due_date >= windowStart && t.status !== "done") {
            missed.push({
              id: `${t.id}:${t.due_date}`, taskId: t.id, title: t.title, description: t.description,
              repeatInterval: t.repeat_interval, missedDate: t.due_date, branchName: t.branches?.name ?? null,
              assignedTo: t.assigned_to, assignedBy: t.assigned_by, assignedToStaffId: t.assigned_to_staff_id,
            });
          }
          continue;
        }
        const anchor = t.due_date ?? toISTDateStr(t.created_at);
        let cursor = anchor > windowStart ? anchor : windowStart;
        while (cursor < today) {
          if (isTaskDueOn(t, cursor) && !completedSet.has(`${t.id}:${cursor}`)) {
            missed.push({
              id: `${t.id}:${cursor}`, taskId: t.id, title: t.title, description: t.description,
              repeatInterval: t.repeat_interval, missedDate: cursor, branchName: t.branches?.name ?? null,
              assignedTo: t.assigned_to, assignedBy: t.assigned_by, assignedToStaffId: t.assigned_to_staff_id,
            });
          }
          cursor = addDays(cursor, 1);
        }
      }

      missed.sort((a, b) => (b.missedDate as string).localeCompare(a.missedDate as string));
      return json({ tasks: missed });
    },
    list_staff_attendance: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const targetDate = payload?.date || todayISO();

      // Disambiguated FK hint — see the comment in list_staff for why this is required now.
      const { data: allStaff } = await db.from("staff").select("id, username, display_name, branch_id, is_active, branches!branch_id(name)")
        .eq("is_active", true).neq("role", "owner").neq("role", "admin").order("display_name");
      const { data: present } = await db.from("staff_attendance").select("staff_id, first_login_at, last_logout_at")
        .eq("attendance_date", targetDate);
      const presentMap = new Map((present ?? []).map((p: { staff_id: string; first_login_at: string; last_logout_at: string | null }) => [p.staff_id, p]));

      const rows = (allStaff ?? []).map(s => {
        const rec = presentMap.get(s.id);
        return {
          staffId: s.id, displayName: s.display_name || s.username,
          branchId: s.branch_id ?? null, branchName: s.branches?.name ?? null,
          present: !!rec, firstLoginAt: rec?.first_login_at ?? null, lastLogoutAt: rec?.last_logout_at ?? null,
        };
      });

      return json({ date: targetDate, rows });
    },
    // Self-service: any staff (including owner) can mark when they end their session for
    // the day. No-op if they never logged in today (nothing to end).
    end_staff_session: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { password } = payload;
      if (!password) return err("Password required");
      // Confirms it's really this staff member ending their own day, not someone else
      // grabbing an unlocked, unattended computer — re-verifies their password the same
      // way login does, without issuing a new token.
      const { data: check } = await db.rpc("verify_staff_login", { p_username: staff.username, p_password: password });
      if (!check?.length || check[0].id !== staff.id) return err("Incorrect password", 401);

      const today = todayISO();
      await db.from("staff_attendance").update({ last_logout_at: new Date().toISOString() })
        .eq("staff_id", staff.id).eq("attendance_date", today);
      return json({ ok: true });
    },
    create_staff: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { username, password, displayName, role, branchId, duty } = payload;
      const problem = await dutyProblem(db, role ?? "staff", duty);
      if (problem) return err(problem);
      const { data: hash } = await db.rpc("hash_staff_password", { plain_password: password });
      const { error } = await db.from("staff").insert({
        username, password_hash: hash, role: role ?? "staff",
        display_name: displayName, branch_id: branchId,
        ...(duty !== undefined ? { duty } : {}),
      });
      if (error) return err(error.code === "23505" ? "That username is already taken (usernames aren't case-sensitive)" : error.message);
      return json({ ok: true });
    },
    // Edit an existing staff account's credentials/branch, or toggle is_active.
    // verify_staff_login already requires is_active = true, so deactivating here
    // immediately blocks that account from signing in — and authStaff() re-checks
    // is_active on every request, so an already-issued token stops working too.
    update_staff: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { staffId, username, newPassword, displayName, branchId, isActive, duty } = payload;
      if (!staffId) return err("Staff ID required");
      const { data: target } = await db.from("staff").select("id, role, is_active").eq("id", staffId).single();
      if (!target) return err("Staff not found");
      // The owner can edit/deactivate their own account, and admin (who outranks owner) can
      // edit/deactivate the owner's account too — but nobody else gets to touch an owner
      // account, and nobody but the owner gets to bypass the general self-edit block below.
      const isSelf = staffId === staff.id;
      if (target.role === "owner" && !isSelf && !isAdmin(staff)) return err("Owner accounts can't be edited here");
      if (isSelf && staff.role !== "owner") return err("You can't edit your own account from here");
      // Deactivation is permanent — once a staff account is turned off it can never be
      // switched back on, so this deliberately does not accept isActive: true on an
      // already-inactive account.
      if (!target.is_active) return err("This staff account has been permanently removed and cannot be reactivated");
      if (duty !== undefined) {
        const problem = await dutyProblem(db, target.role, duty);
        if (problem) return err(problem);
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (username !== undefined && username !== "") updates.username = username;
      if (displayName !== undefined) updates.display_name = displayName;
      if (branchId !== undefined && branchId !== "") updates.branch_id = branchId;
      if (isActive === false) updates.is_active = false;
      if (duty !== undefined) updates.duty = duty;
      if (newPassword) {
        const { data: hash } = await db.rpc("hash_staff_password", { plain_password: newPassword });
        updates.password_hash = hash;
      }

      const { error } = await db.from("staff").update(updates).eq("id", staffId);
      if (error) return err(error.code === "23505" ? "That username is already taken (usernames aren't case-sensitive)" : error.message);

      // Deactivation removes the account permanently, so its tasks (recurring and
      // one-time alike) are removed too rather than left dangling — new occurrences
      // were already blocked by the is_active gate in list_tasks/get_task_completion_report,
      // this clears out what already existed.
      if (isActive === false) {
        const { data: ownTasks } = await db.from("tasks").select("id").eq("assigned_to_staff_id", staffId);
        const taskIds = (ownTasks ?? []).map(t => t.id);
        if (taskIds.length) await db.from("task_completions").delete().in("task_id", taskIds);
        await db.from("tasks").delete().eq("assigned_to_staff_id", staffId);
      }

      return json({ ok: true });
    },
    // ─── MESSAGES ───
    list_messages: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, channel, allBranches } = payload;
      let q = db.from("messages")
        .select("*, staff:sender_staff_id(display_name, username), students:recipient_student_id(name, phone)")
        .order("sent_at", { ascending: false });
      if (channel === "all") {
        q = q.is("branch_id", null).limit(50);
      } else if (allBranches) {
        // Owner/admin oversee every branch, so a system notice (a new website enquiry, a
        // cross-branch check-in) has to reach them no matter which single branch they
        // currently have open in the UI — see useMessageAlerts on the frontend, which
        // filters this down to just the tagged system notices rather than every branch's
        // ordinary team chat. Higher limit than the single-branch case since this spans
        // every branch's channel at once.
        if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
        q = q.not("branch_id", "is", null).limit(150);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId).limit(50);
      }
      const { data } = await q;
      return json({ messages: data ?? [] });
    },
    send_message: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, channel, recipientType, recipientStudentId, recipientStaffId, content } = payload;
      const isAllStaffChannel = channel === "all";
      if (!isAllStaffChannel && !requireBranch(staff, branchId)) return err("Branch access denied", 403);
      await db.from("messages").insert({
        branch_id: isAllStaffChannel ? null : branchId, sender_staff_id: staff.id,
        recipient_type: recipientType, recipient_student_id: recipientStudentId,
        recipient_staff_id: recipientStaffId, content,
      });
      return json({ ok: true });
    },
    // ─── ALERTS ───
    list_alerts: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("alerts").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("status", "pending").order("due_date");
      return json({ alerts: data ?? [] });
    },
    resolve_alert: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { alertId } = payload;
      const { data: alert } = await db.from("alerts").select("branch_id").eq("id", alertId).single();
      if (!alert) return err("Alert not found", 404);
      if (!requireBranch(staff, alert.branch_id)) return err("Branch access denied", 403);
      await db.from("alerts").update({ status: "resolved" }).eq("id", alertId);
      return json({ ok: true });
    },
  };
  return h;
}
