import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, jwtVerify } from "https://esm.sh/jose@5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

const JWT_SECRET = Deno.env.get("STAFF_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? "dev-secret-change-in-production";

async function signToken(payload: Record<string, unknown>) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

async function verifyToken(token: string) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as { sub: string; role: string; username: string };
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

type StaffRow = { id: string; username: string; role: string; display_name: string | null; branch_id: string | null; is_active: boolean };

async function authStaff(req: Request): Promise<StaffRow | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = await verifyToken(auth.slice(7));
    const db = adminClient();
    const { data } = await db.from("staff").select("id, username, role, display_name, branch_id, is_active").eq("id", payload.sub).single();
    if (!data?.is_active) return null;
    return data;
  } catch { return null; }
}

function isOwner(staff: StaffRow) { return staff.role === "owner"; }

function requireBranch(staff: StaffRow, branchId: string) {
  if (isOwner(staff)) return true;
  return staff.branch_id === branchId;
}

async function getOwnerStaffIds(db: ReturnType<typeof adminClient>): Promise<string[]> {
  const { data } = await db.from("staff").select("id").eq("role", "owner");
  return (data ?? []).map(r => r.id);
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// A recurring task's "anchor" is its due_date (or, failing that, the day it was created).
// daily tasks are due every day from the anchor onward; weekly/monthly repeat on the
// anchor's weekday / day-of-month.
function isTaskDueOn(task: { repeat_interval: string; due_date: string | null; created_at: string; status?: string }, dateStr: string): boolean {
  const anchor = task.due_date ?? task.created_at.slice(0, 10);
  if (task.repeat_interval === "none") return anchor === dateStr && task.status !== "done";
  if (anchor > dateStr) return false;
  if (task.repeat_interval === "daily") return true;
  const anchorDate = new Date(anchor + "T12:00:00");
  const target = new Date(dateStr + "T12:00:00");
  if (task.repeat_interval === "weekly") return anchorDate.getDay() === target.getDay();
  if (task.repeat_interval === "monthly") return anchorDate.getDate() === target.getDate();
  return false;
}

function multiMonthDiscount(months: number): number {
  if (months >= 6) return 15;
  if (months >= 3) return 10;
  if (months >= 2) return 5;
  return 0;
}

function dateRange(period: string, dateFrom?: string, dateTo?: string) {
  const today = todayISO();
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (period === "month") {
    const d = new Date();
    return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: today };
  }
  return { from: dateFrom ?? today, to: dateTo ?? today };
}

async function getWalkinFee(db: ReturnType<typeof adminClient>, hours: number): Promise<number> {
  const { data } = await db.from("fee_config").select("*").eq("config_type", "walkin").order("max_hours");
  if (!data?.length) {
    if (hours <= 3) return 35;
    if (hours <= 6) return 60;
    if (hours <= 8) return 80;
    return 100;
  }
  for (const tier of data) {
    if (hours <= tier.max_hours) return Number(tier.fee);
  }
  return Number(data[data.length - 1].fee);
}

async function getMembershipPackage(db: ReturnType<typeof adminClient>, hoursPerDay: number, category: string) {
  const { data } = await db.from("fee_config").select("*")
    .eq("config_type", "membership").eq("cabin_type", category).eq("hours_per_day", hoursPerDay).maybeSingle();
  if (data) return Number(data.fee);
  const defaults: Record<string, Record<number, number>> = {
    temporary: { 2: 500, 3: 650, 4: 800, 5: 1000, 6: 1250, 8: 1500 },
    permanent: { 12: 2100, 13: 2200, 14: 2300, 15: 2400, 24: 2500 },
  };
  return defaults[category]?.[hoursPerDay] ?? 0;
}

async function upsertStudent(db: ReturnType<typeof adminClient>, name: string, phone: string, branchId: string, extra: Record<string, unknown> = {}) {
  const { data: existing } = await db.from("students").select("id").eq("phone", phone).maybeSingle();
  if (existing) {
    await db.from("students").update({ name, branch_id: branchId, ...extra, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return existing.id;
  }
  const { count } = await db.from("students").select("*", { count: "exact", head: true });
  const { data: s, error } = await db.from("students").insert({
    name, phone, branch_id: branchId, s_no: (count ?? 0) + 1, status: "pending", ...extra,
  }).select("id").single();
  if (error) {
    // Unique-violation on `phone` means a concurrent request just created this student — attach to it instead of failing.
    if (error.code === "23505") {
      const { data: raced } = await db.from("students").select("id").eq("phone", phone).single();
      if (raced) {
        await db.from("students").update({ name, branch_id: branchId, ...extra, updated_at: new Date().toISOString() }).eq("id", raced.id);
        return raced.id;
      }
    }
    throw new Error(error.message);
  }
  return s!.id;
}


async function refreshStudentStatus(db: ReturnType<typeof adminClient>, studentId: string) {
  const today = todayISO();
  const { data: mem } = await db.from("memberships").select("*")
    .eq("student_id", studentId).eq("is_active", true).order("end_date", { ascending: false }).limit(1).maybeSingle();
  let status = "inactive";
  if (mem) {
    if (mem.fee_due > 0 || mem.due_date < today) status = "pending";
    else if (mem.end_date >= today) status = "active";
    else status = "inactive";
  }
  await db.from("students").update({ status, updated_at: new Date().toISOString() }).eq("id", studentId);
}

async function createAlert(db: ReturnType<typeof adminClient>, studentId: string, branchId: string, type: string, dueDate: string, message: string) {
  const { data: existing } = await db.from("alerts").select("id")
    .eq("student_id", studentId).eq("alert_type", type).eq("status", "pending").maybeSingle();
  if (existing) {
    await db.from("alerts").update({ due_date: dueDate, message }).eq("id", existing.id);
  } else {
    await db.from("alerts").insert({ student_id: studentId, branch_id: branchId, alert_type: type, due_date: dueDate, message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, ...payload } = body;
    const db = adminClient();

    // ─── PUBLIC ───
    if (action === "login") {
      const { username, password } = payload;
      if (!username || !password) return err("Username and password required");
      const { data, error } = await db.rpc("verify_staff_login", { p_username: username, p_password: password });
      if (error || !data?.length) return err("Invalid login credentials", 401);
      const row = data[0];
      const token = await signToken({ sub: row.id, role: row.role, username: row.username });

      // Auto-mark attendance on first login of the day (no-op if already marked) — owner is exempt
      if (row.role !== "owner") {
        await db.from("staff_attendance").upsert(
          { staff_id: row.id, branch_id: row.branch_id, attendance_date: todayISO() },
          { onConflict: "staff_id,attendance_date", ignoreDuplicates: true },
        );
      }

      return json({
        token,
        staff: {
          id: row.id, username: row.username, role: row.role,
          displayName: row.display_name, branchId: row.branch_id, branchName: row.branch_name,
        },
      });
    }

    const staff = await authStaff(req);
    if (!staff) return err("Unauthorized", 401);

    // ─── BRANCHES ───
    if (action === "list_branches") {
      let q = db.from("branches").select("id, name, desk_count, shift_config").eq("is_active", true).order("name");
      if (!isOwner(staff)) q = q.eq("id", staff.branch_id!);
      const { data } = await q;
      return json({ branches: data ?? [] });
    }

    if (action === "update_branch") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { branchId, deskCount, shiftConfig } = payload;
      await db.from("branches").update({
        desk_count: deskCount, shift_config: shiftConfig,
      }).eq("id", branchId);
      return json({ ok: true });
    }

    if (action === "add_desk") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { branchId, label } = payload;
      const { data: maxSort } = await db.from("desks").select("sort_order").eq("branch_id", branchId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
      await db.from("desks").insert({ branch_id: branchId, label, sort_order: (maxSort?.sort_order ?? 0) + 1 });
      await db.from("branches").update({ desk_count: (await db.from("desks").select("*", { count: "exact", head: true }).eq("branch_id", branchId)).count }).eq("id", branchId);
      return json({ ok: true });
    }

    if (action === "remove_desk") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { deskId } = payload;
      const { data: desk } = await db.from("desks").select("*").eq("id", deskId).single();
      if (desk?.status !== "free") return err("Cannot remove occupied desk");
      await db.from("desks").delete().eq("id", deskId);
      return json({ ok: true });
    }

    // ─── DASHBOARD ───
    if (action === "get_dashboard") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: desks } = await db.from("desks").select("status").eq("branch_id", branchId);
      const free = desks?.filter(d => d.status === "free").length ?? 0;
      const occupied = desks?.filter(d => d.status === "occupied").length ?? 0;
      const reserved = desks?.filter(d => d.status === "reserved").length ?? 0;

      const today = todayISO();
      // Count from memberships — avoids walk-in students inflating the "active" count
      const { count: active } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).gte("end_date", today);
      const { count: pending } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).gt("fee_due", 0);
      const { count: temporaryCount } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).eq("category", "temporary").gte("end_date", today);
      const { count: permanentCount } = await db.from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("is_active", true).eq("category", "permanent").gte("end_date", today);

      // Students currently in an active session right now (scoped to today, same as list_today_bookings)
      const { count: currentlyStudying } = await db.from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "active").eq("is_paused", false)
        .gte("created_at", today + "T00:00:00Z").lte("created_at", today + "T23:59:59Z");

      const { data: alerts } = await db.from("alerts").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("status", "pending").order("due_date").limit(10);

      const { data: recentBookings } = await db.from("bookings").select("*, students(name, phone)")
        .eq("branch_id", branchId).order("created_at", { ascending: false }).limit(5);

      // Not just "due/expired exactly today" — any membership that's overdue and hasn't
      // been settled/renewed yet should keep showing up until it's dealt with.
      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lte("due_date", today).gt("fee_due", 0);

      const { data: expiredToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("end_date", today);

      const { count: checkedInToday } = await db.from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .gte("created_at", today + "T00:00:00Z").lte("created_at", today + "T23:59:59Z");

      return json({
        seats: { free, occupied, reserved, total: desks?.length ?? 0 },
        students: {
          active: active ?? 0,
          pending: pending ?? 0,
          temporary: temporaryCount ?? 0,
          permanent: permanentCount ?? 0,
          currentlyStudying: currentlyStudying ?? 0,
          checkedInToday: checkedInToday ?? 0,
        },
        alerts: alerts ?? [],
        recentActivity: (recentBookings ?? []).map(b => ({
          id: b.id, type: b.booking_type, studentName: b.students?.name,
          time: b.created_at, status: b.status,
        })),
        actionable: {
          dueToday: dueToday ?? [],
          expiredToday: expiredToday ?? [],
        },
      });
    }

    // ─── SEAT MAP ───
    if (action === "get_seat_map") {
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
    }

    // ─── COMBINED HALL (owner, all branches) ───
    if (action === "get_combined_hall") {
      if (!isOwner(staff)) return err("Owner only", 403);
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
          .gte("created_at", today + "T00:00:00Z").lte("created_at", today + "T23:59:59Z");
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
    }

    if (action === "get_combined_seatmap") {
      if (!isOwner(staff)) return err("Owner only", 403);
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
    }

    if (action === "get_combined_pending") {
      if (!isOwner(staff)) return err("Owner only", 403);
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
    }

    // ─── STUDENT LOOKUP ───
    if (action === "lookup_student") {
      const { phone } = payload;
      const { data, error: lookupErr } = await db.from("students").select("id, name, phone, course, status")
        .eq("phone", phone).maybeSingle();
      if (lookupErr) return err(lookupErr.message);
      if (!data) return json({ student: null });
      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", data.id).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      return json({ student: { ...data, active_membership: membership ?? null, is_member: !!membership } });
    }

    if (action === "search_students_by_name") {
      const { branchId, query } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const q = (query ?? "").trim();
      if (q.length < 2) return json({ students: [] });
      // Recognize a student by full name or phone number in the same search box.
      const { data } = await db.from("students").select("id, name, phone")
        .eq("branch_id", branchId).or(`name.ilike.%${q}%,phone.ilike.%${q}%`).order("name").limit(8);
      return json({ students: data ?? [] });
    }

    // ─── WALK-IN ───
    if (action === "create_walkin") {
      const { branchId, name, phone, hours, paymentMode, startTime: startTimeStr, deskId: manualDeskId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name || !phone || !hours) return err("Name, phone, and hours required");

      const studentId = await upsertStudent(db, name, phone, branchId);

      // Desk is optional for walk-ins — staff no longer assigns a desk
      let desk = null;
      if (manualDeskId) {
        const { data: d } = await db.from("desks").select("*").eq("id", manualDeskId).eq("branch_id", branchId).single();
        if (!d || d.status !== "free") return err("Selected desk is not available");
        desk = d;
      }

      const amount = await getWalkinFee(db, Number(hours));
      // startTimeStr is a full UTC ISO string sent by the frontend after local→UTC conversion
      const startTime = startTimeStr ? new Date(startTimeStr).toISOString() : new Date().toISOString();
      const endTime = new Date(new Date(startTime).getTime() + Number(hours) * 3600000).toISOString();

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: desk?.id ?? null,
        booking_type: "walkin", start_time: startTime, end_time: endTime,
        hours: Number(hours), amount, status: "active", payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      if (desk) {
        await db.from("desks").update({ status: "occupied", current_booking_id: booking!.id }).eq("id", desk.id);
      }
      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, booking_id: booking!.id,
        category: "desk", amount, payment_mode: paymentMode ?? "cash", created_by_staff_id: staff.id,
      });
      const { data: st } = await db.from("students").select("total_visits, total_hours_studied").eq("id", studentId).single();
      await db.from("students").update({
        total_visits: (st?.total_visits ?? 0) + 1,
        total_hours_studied: Number(st?.total_hours_studied ?? 0) + Number(hours),
        status: "active",
      }).eq("id", studentId);

      return json({ booking: { ...booking, deskLabel: desk?.label ?? null, amount, studentName: name } });
    }

    // ─── MEMBERSHIP ───
    if (action === "create_membership") {
      const {
        branchId, name, phone, category, hoursPerDay, timings, monthsPaid,
        paymentMode, course, lockerNo, withLocker,
        advanceAmount, emergencyContact, referralSource,
      } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!emergencyContact) return err("Emergency contact is required");
      const validReferrals = ["google_search", "instagram", "word_of_mouth", "flex", "ai_platform"];
      if (!validReferrals.includes(referralSource)) return err("Please select how the student heard about us");

      const studentId = await upsertStudent(db, name, phone, branchId, {
        course, status: "active",
        emergency_contact: emergencyContact, referral_source: referralSource,
      });

      const monthlyFee = await getMembershipPackage(db, Number(hoursPerDay), category);
      if (!monthlyFee) return err("Invalid membership package");

      const months = Number(monthsPaid) || 1;
      const discount = multiMonthDiscount(months);
      const gross = monthlyFee * months;
      const totalPaid = gross * (1 - discount / 100);
      const startDate = todayISO();
      const endDate = addMonths(startDate, months);
      const dueDate = addMonths(startDate, 1);
      const seatType = category === "permanent" ? "fixed" : "floating";
      let deskId = null;
      let cabinNo = null;

      if (category === "permanent") {
        const { data: freeDesk } = await db.from("desks").select("*")
          .eq("branch_id", branchId).eq("status", "free").order("sort_order").limit(1).maybeSingle();
        if (!freeDesk) return err("No cabin available for permanent membership — add them to the Waitlist tab instead");
        deskId = freeDesk.id;
        cabinNo = freeDesk.label;
        await db.from("desks").update({
          status: "reserved", seat_type: "fixed", assigned_student_id: studentId,
        }).eq("id", deskId);
      }

      const monthLabel = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

      const { data: mem, error: mErr } = await db.from("memberships").insert({
        student_id: studentId, branch_id: branchId, category, seat_type: seatType,
        desk_id: deskId, cabin_no: cabinNo, month: monthLabel,
        hours_per_day: hoursPerDay, timings: timings ?? '', start_date: startDate, end_date: endDate,
        due_date: dueDate, months_paid: months, discount_percent: discount,
        monthly_fee: monthlyFee,
        total_paid: advanceAmount != null ? Number(advanceAmount) : totalPaid,
        fee_due: advanceAmount != null ? Math.max(totalPaid - Number(advanceAmount), 0) : 0,
        payment_mode: paymentMode ?? "cash", created_by_staff_id: staff.id,
      }).select("id").single();
      if (mErr) return err(mErr.message);

      const actualPaid = advanceAmount != null ? Number(advanceAmount) : totalPaid;
      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, membership_id: mem!.id,
        category: "membership", amount: actualPaid, payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      });

      if (withLocker && lockerNo) {
        const { data: branchRow } = await db.from("branches").select("locker_capacity").eq("id", branchId).single();
        const { count: usedLockers } = await db.from("lockers")
          .select("*", { count: "exact", head: true }).eq("branch_id", branchId).eq("is_active", true);
        if ((usedLockers ?? 0) >= (branchRow?.locker_capacity ?? 0)) return err("No lockers available at this branch");

        const lockerDue = addMonths(startDate, 1);
        await db.from("lockers").insert({
          branch_id: branchId, student_id: studentId, locker_no: lockerNo,
          locker_due_date: lockerDue, deposit_amount: 100, monthly_fee: 100,
        });
        await db.from("transactions").insert({
          student_id: studentId, branch_id: branchId, category: "locker",
          amount: 200, payment_mode: paymentMode ?? "cash", notes: "Locker rent + deposit",
          created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, studentId);
      return json({ membership: mem, totalPaid, cabinNo });
    }

    // ─── PERMANENT MEMBERSHIP WAITLIST ───
    // "Full" means zero free desks at the branch — any free desk can become a permanent
    // cabin, so this is the same condition create_membership itself checks.
    if (action === "get_permanent_waitlist") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { count: freeDesks } = await db.from("desks").select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "free");
      const { data: waitlist } = await db.from("permanent_waitlist").select("*")
        .eq("branch_id", branchId).eq("status", "waiting").order("created_at", { ascending: true });
      return json({ isFull: (freeDesks ?? 0) === 0, freeDesks: freeDesks ?? 0, waitlist: waitlist ?? [] });
    }

    if (action === "join_permanent_waitlist") {
      const { branchId, name, phone, hoursPerDay, notes } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name || !phone) return err("Name and phone are required");
      const { count: freeDesks } = await db.from("desks").select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "free");
      if ((freeDesks ?? 0) > 0) return err("Permanent seats are still available — register directly instead of waitlisting");

      const { error } = await db.from("permanent_waitlist").insert({
        branch_id: branchId, name, phone, hours_per_day: hoursPerDay || null, notes: notes || null,
        created_by_staff_id: staff.id,
      });
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "remove_from_waitlist") {
      const { waitlistId, status } = payload;
      const { data: entry } = await db.from("permanent_waitlist").select("branch_id").eq("id", waitlistId).single();
      if (!entry) return err("Waitlist entry not found");
      if (!requireBranch(staff, entry.branch_id)) return err("Branch access denied", 403);
      await db.from("permanent_waitlist").update({
        status: status === "fulfilled" ? "fulfilled" : "cancelled",
        fulfilled_at: status === "fulfilled" ? new Date().toISOString() : null,
      }).eq("id", waitlistId);
      return json({ ok: true });
    }

    // ─── LOCKERS (add / remove after registration) ───
    if (action === "get_locker_status") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: branchRow } = await db.from("branches").select("locker_capacity").eq("id", branchId).single();
      const capacity = branchRow?.locker_capacity ?? 0;
      const { data: activeLockers } = await db.from("lockers").select("locker_no").eq("branch_id", branchId).eq("is_active", true);
      const used = activeLockers?.map(l => l.locker_no) ?? [];
      const usedSet = new Set(used);
      const availableNumbers: string[] = [];
      for (let i = 1; i <= capacity; i++) {
        const label = String(i);
        if (!usedSet.has(label)) availableNumbers.push(label);
      }
      return json({ capacity, used: used.length, available: capacity - used.length, availableNumbers });
    }

    if (action === "add_locker") {
      const { studentId, branchId, lockerNo, paymentMode, payLater } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: existing } = await db.from("lockers").select("id").eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (existing) return err("Student already has an active locker");

      const { data: branchRow } = await db.from("branches").select("locker_capacity").eq("id", branchId).single();
      const { count: usedLockers } = await db.from("lockers")
        .select("*", { count: "exact", head: true }).eq("branch_id", branchId).eq("is_active", true);
      if ((usedLockers ?? 0) >= (branchRow?.locker_capacity ?? 0)) return err("No lockers available at this branch");

      const { data: membership } = await db.from("memberships").select("end_date")
        .eq("student_id", studentId).eq("is_active", true).order("end_date", { ascending: false }).limit(1).maybeSingle();
      const today = todayISO();
      const endDate = membership?.end_date && membership.end_date > today ? membership.end_date : addMonths(today, 1);
      const daysRemaining = Math.max(1, Math.ceil((new Date(endDate + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86_400_000));
      const proratedFee = Math.round((100 / 30) * daysRemaining);
      const deposit = 100;

      // The ₹100 caution deposit is mandatory and collected upfront, always — a locker is
      // never assigned without it. Only the prorated monthly rent can be deferred.
      const amountPaid = deposit + (payLater ? 0 : proratedFee);
      const feeDue = payLater ? proratedFee : 0;

      const { data: locker, error: lErr } = await db.from("lockers").insert({
        branch_id: branchId, student_id: studentId, locker_no: lockerNo,
        locker_due_date: endDate, deposit_amount: deposit, monthly_fee: 100,
        amount_paid: amountPaid, fee_due: feeDue,
      }).select("*").single();
      if (lErr) return err(lErr.message);

      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, category: "locker",
        amount: amountPaid, payment_mode: paymentMode ?? "cash",
        notes: payLater
          ? `Locker deposit (₹${deposit}) — rent (₹${proratedFee} for ${daysRemaining}d) deferred`
          : `Locker — prorated ${daysRemaining}d rent (₹${proratedFee}) + deposit (₹${deposit})`,
        created_by_staff_id: staff.id,
      });

      return json({ ok: true, locker, amountCharged: amountPaid, proratedFee, deposit, daysRemaining, payLater: !!payLater });
    }

    if (action === "remove_locker") {
      const { lockerId } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      await db.from("lockers").update({ is_active: false, deposit_returned: true }).eq("id", lockerId);
      return json({ ok: true });
    }

    // ─── MEMBER CHECK-IN (attendance) ───
    if (action === "check_in_member") {
      const { branchId, studentId, deskId: passedDeskId, startTime: startTimeStr } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");

      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", studentId).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      if (!membership) return err("No active membership found");
      if (membership.is_paused) return err("Membership is currently on hold");

      const today = todayISO();
      const isExpiredMembership = membership.end_date < today;
      if (isExpiredMembership) {
        const daysSinceExpiry = Math.floor((new Date(today + "T12:00:00").getTime() - new Date(membership.end_date + "T12:00:00").getTime()) / 86_400_000);
        const GRACE_DAYS = 10;
        if (daysSinceExpiry > GRACE_DAYS) {
          const dueAmount = Number(membership.fee_due);
          if (dueAmount > 0) {
            return err(`Dues not cleared (₹${dueAmount} pending) even ${daysSinceExpiry} days after membership expiration — the ${GRACE_DAYS}-day grace period is over. Please clear dues and renew before checking in.`);
          }
          return err(`Membership expired ${daysSinceExpiry} days ago — the ${GRACE_DAYS}-day grace period is over. Please renew before checking in.`);
        }
      }

      // One check-in per day
      const { data: alreadyIn } = await db.from("bookings").select("id")
        .eq("student_id", studentId)
        .in("booking_type", ["temporary", "permanent"])
        .gte("created_at", today + "T00:00:00Z")
        .lte("created_at", today + "T23:59:59Z")
        .maybeSingle();
      if (alreadyIn) return err("Student is already checked in today");

      // A member visiting a branch other than their registered home branch can't use their
      // home cabin (it physically doesn't exist here) — treat them as floating for the day.
      const isCrossBranchVisit = student.branch_id != null && student.branch_id !== branchId;
      const deskId = membership.category === "permanent" && !isCrossBranchVisit ? membership.desk_id : (passedDeskId ?? null);

      let desk = null;
      if (deskId) {
        const { data: d } = await db.from("desks").select("*").eq("id", deskId).eq("branch_id", branchId).single();
        if (!d) return err("Desk not found");
        if (membership.category !== "permanent" && d.status !== "free") return err("Selected desk is not available");
        desk = d;
      }

      // startTimeStr is a full UTC ISO string sent by the frontend after local→UTC conversion
      const checkInTime = startTimeStr ? new Date(startTimeStr).toISOString() : new Date().toISOString();
      const endTime = new Date(new Date(checkInTime).getTime() + membership.hours_per_day * 3_600_000).toISOString();
      const bookingType = membership.category === "permanent" ? "permanent" : "temporary";

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: desk?.id ?? null,
        membership_id: membership.id, booking_type: bookingType,
        start_time: checkInTime, end_time: endTime,
        hours: membership.hours_per_day, amount: 0, status: "active",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      // Update desk status if a desk was assigned
      if (desk) {
        if (membership.category === "permanent") {
          // Permanent cabin stays 'reserved' — just link the booking
          await db.from("desks").update({ current_booking_id: booking!.id }).eq("id", desk.id);
        } else {
          await db.from("desks").update({ status: "occupied", current_booking_id: booking!.id }).eq("id", desk.id);
        }
      }
      await db.from("students").update({
        total_visits: (student.total_visits ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", studentId);

      // Intimate the student's home branch that they attended a different branch today.
      if (isCrossBranchVisit) {
        const { data: currentBranch } = await db.from("branches").select("name").eq("id", branchId).single();
        await db.from("messages").insert({
          branch_id: student.branch_id, sender_staff_id: staff.id, recipient_type: "staff",
          content: `${student.name} (home branch) checked in at ${currentBranch?.name ?? "another branch"} today.`,
        });
      }

      return json({ ok: true, bookingId: booking!.id, deskLabel: desk?.label ?? null, endTime, expiredMembership: isExpiredMembership, crossBranchVisit: isCrossBranchVisit });
    }

    // Edit a student's attendance record (check-in time / hours / status) — corrects
    // mistakes like a wrong check-in time or hours punched in by staff. Available to
    // both staff (their own branch) and owner (any branch).
    if (action === "update_attendance") {
      const { bookingId, startTime, hours, status } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Attendance record not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      const newStartTime = startTime ? new Date(startTime).toISOString() : booking.start_time;
      const newHours = hours !== undefined && hours !== null && hours !== "" ? Number(hours) : Number(booking.hours ?? 0);
      const newEndTime = new Date(new Date(newStartTime).getTime() + newHours * 3_600_000).toISOString();
      const newStatus = status || booking.status;

      await db.from("bookings").update({
        start_time: newStartTime, end_time: newEndTime, hours: newHours, status: newStatus,
      }).eq("id", bookingId);

      const hoursDelta = newHours - Number(booking.hours ?? 0);
      if (hoursDelta !== 0) {
        const { data: st } = await db.from("students").select("total_hours_studied").eq("id", booking.student_id).single();
        await db.from("students").update({
          total_hours_studied: Math.max(0, Number(st?.total_hours_studied ?? 0) + hoursDelta),
        }).eq("id", booking.student_id);
      }

      return json({ ok: true });
    }

    // ─── PAUSE / RESUME MEMBERSHIP ───
    if (action === "pause_membership") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (mem.is_paused) return err("Membership is already on hold");
      const pausedAtNow = new Date().toISOString();
      await db.from("memberships").update({
        is_paused: true, paused_at: pausedAtNow,
      }).eq("id", membershipId);
      await db.from("membership_holds").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        paused_at: pausedAtNow,
      });
      return json({ ok: true });
    }

    if (action === "resume_membership") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_paused) return err("Membership is not on hold");

      const pausedAt = new Date(mem.paused_at);
      const daysPaused = Math.max(1, Math.ceil((Date.now() - pausedAt.getTime()) / 86_400_000));
      const newEnd = new Date(mem.end_date + "T12:00:00");
      newEnd.setDate(newEnd.getDate() + daysPaused);
      const newEndDate = newEnd.toISOString().slice(0, 10);

      await db.from("memberships").update({
        is_paused: false, paused_at: null,
        hold_days: (mem.hold_days ?? 0) + daysPaused,
        end_date: newEndDate,
      }).eq("id", membershipId);
      await db.from("membership_holds")
        .update({ resumed_at: new Date().toISOString(), days_paused: daysPaused })
        .eq("membership_id", membershipId).is("resumed_at", null);
      return json({ ok: true, daysPaused, newEndDate });
    }

    // ─── CHECKOUT ───
    if (action === "checkout_booking") {
      const { bookingId, overtimeMinutes, overtimePaymentMode, settleFoodNow } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Booking not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      const isMember = booking.booking_type !== "walkin";
      const FOOD_CARRY_DAYS = 3;

      // A Food Pass holder never pays cash for food at checkout — any bill still marked
      // unpaid (e.g. from before the pass existed) is deducted from the pass automatically.
      const { data: foodPass } = isMember
        ? await db.from("food_passes").select("*").eq("student_id", booking.student_id).maybeSingle()
        : { data: null };

      // Membership students without a pass can carry an unpaid food bill for up to 3 days
      // across sessions — check by student, not just this booking, since each day is a new booking.
      const { data: memberUnpaidBills } = isMember && !foodPass
        ? await db.from("food_bills").select("id, total, created_at").eq("student_id", booking.student_id).eq("paid", false)
        : { data: null };
      if (memberUnpaidBills?.length) {
        const cutoff = Date.now() - FOOD_CARRY_DAYS * 86_400_000;
        const overdue = memberUnpaidBills.filter(b => new Date(b.created_at).getTime() < cutoff);
        if (overdue.length) {
          const overdueTotal = overdue.reduce((s, b) => s + Number(b.total), 0);
          return err(`Food bill of ₹${overdueTotal} is more than ${FOOD_CARRY_DAYS} days old — settle it before checking out.`);
        }
      }

      // end_time was only ever the *scheduled* end time set at check-in — record the real
      // checkout time here so attendance history (and anything reading end_time) is accurate,
      // especially when the student stayed into overtime.
      await db.from("bookings").update({
        status: "completed", end_time: new Date().toISOString(),
        is_paused: false, paused_at: null, total_pause_minutes: 0,
      }).eq("id", bookingId);

      if (booking.desk_id) {
        const { data: desk } = await db.from("desks").select("seat_type").eq("id", booking.desk_id).single();
        if (desk?.seat_type === "floating") {
          await db.from("desks").update({ status: "free", current_booking_id: null }).eq("id", booking.desk_id);
        } else {
          await db.from("desks").update({ current_booking_id: null }).eq("id", booking.desk_id);
        }
      }

      if (foodPass) {
        // Deduct straight from the pass — no cash prompt, no 3-day rule (that's only for
        // students without a pass).
        const { data: passUnpaidBills } = await db.from("food_bills").select("id, total")
          .eq("student_id", booking.student_id).eq("paid", false);
        if (passUnpaidBills?.length) {
          const passTotal = passUnpaidBills.reduce((s: number, b: { total: number }) => s + Number(b.total), 0);
          await db.from("food_passes").update({
            balance: Number(foodPass.balance) - passTotal, updated_at: new Date().toISOString(),
          }).eq("id", foodPass.id);
          for (const bill of passUnpaidBills) {
            await db.from("food_bills").update({ paid: true, payment_mode: "other" }).eq("id", bill.id);
          }
        }
      } else {
        // Walk-ins always settle unpaid food at checkout (no carry-forward concept — the
        // session ends here). Members only settle now if staff explicitly chose to collect it
        // (settleFoodNow); otherwise it carries forward within the 3-day window checked above.
        const unpaidBillsQuery = isMember
          ? db.from("food_bills").select("id, total").eq("student_id", booking.student_id).eq("paid", false)
          : db.from("food_bills").select("id, total").eq("booking_id", bookingId).eq("paid", false);
        const shouldSettleNow = !isMember || settleFoodNow;
        const { data: unpaidBills } = shouldSettleNow ? await unpaidBillsQuery : { data: null };
        if (unpaidBills?.length) {
          const settleMode = overtimePaymentMode ?? booking.payment_mode ?? "cash";
          for (const bill of unpaidBills) {
            await db.from("food_bills").update({ paid: true, payment_mode: settleMode }).eq("id", bill.id);
            await db.from("transactions").insert({
              student_id: booking.student_id, branch_id: booking.branch_id,
              food_bill_id: bill.id, category: "food", amount: bill.total,
              payment_mode: settleMode, created_by_staff_id: staff.id,
            });
          }
        }
      }

      const otMinutes = Number(overtimeMinutes) || 0;

      if (otMinutes > 0) {
        if (booking.booking_type === "walkin") {
          // First 15 minutes are grace — charge only beyond that
          const billableMinutes = Math.max(0, otMinutes - 15);
          const hours = Number(booking.hours) || 1;
          const hourlyRate = Number(booking.amount) / hours;
          const overtimeCharge = Math.round(billableMinutes * hourlyRate / 60);
          if (overtimeCharge > 0) {
            await db.from("transactions").insert({
              student_id: booking.student_id, branch_id: booking.branch_id,
              booking_id: bookingId, category: "overtime",
              amount: overtimeCharge,
              payment_mode: overtimePaymentMode ?? booking.payment_mode ?? "cash",
              notes: `${otMinutes}m overtime (${billableMinutes}m billed, 15m grace)`,
              created_by_staff_id: staff.id,
            });
          }
        } else {
          // Member — 15 min grace, same as walk-ins; only the billable remainder is logged.
          // Not charged now — it accumulates and gets added to the bill when the
          // membership is finally settled (renewed or closed).
          const billableMinutes = Math.max(0, otMinutes - 15);
          if (billableMinutes > 0) {
            await db.from("overtime_sessions").insert({
              booking_id: bookingId,
              student_id: booking.student_id,
              membership_id: booking.membership_id ?? null,
              branch_id: booking.branch_id,
              overtime_minutes: billableMinutes,
              session_date: todayISO(),
            });
          }
        }
      }

      return json({ ok: true });
    }

    // ─── STUDENTS LIST (spreadsheet view) ───
    if (action === "list_students") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: students } = await db.from("students").select("*").eq("branch_id", branchId).order("s_no");
      const { data: memberships } = await db.from("memberships").select("*").eq("branch_id", branchId).eq("is_active", true);
      const { data: lockers } = await db.from("lockers").select("*").eq("branch_id", branchId).eq("is_active", true);

      const memByStudent = new Map(memberships?.map(m => [m.student_id, m]) ?? []);
      const lockerByStudent = new Map(lockers?.map(l => [l.student_id, l]) ?? []);

      const rows = (students ?? []).map((s, i) => {
        const mem = memByStudent.get(s.id);
        const locker = lockerByStudent.get(s.id);
        return {
          sNo: s.s_no ?? i + 1,
          id: s.id,
          name: s.name,
          cabin: mem?.cabin_no ?? "-",
          dueDate: mem?.due_date ?? "-",
          month: mem?.month ?? "-",
          hours: mem?.hours_per_day ?? "-",
          timings: mem?.timings ?? "-",
          locker: locker?.locker_no ?? "-",
          lockerDue: locker?.locker_due_date ?? "-",
          course: s.course ?? "-",
          contact: s.phone,
          status: s.status,
          isOverdue: mem ? mem.due_date < todayISO() && mem.fee_due > 0 : false,
          lockerOverdue: locker ? locker.locker_due_date && locker.locker_due_date < todayISO() : false,
          totalVisits: s.total_visits,
          totalHours: s.total_hours_studied,
        };
      });

      return json({ students: rows });
    }

    if (action === "get_student_profile") {
      const { studentId } = payload;
      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);

      const { data: memberships } = await db.from("memberships").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
      const { data: bookings } = await db.from("bookings").select("*, desks!desk_id(label)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: transactions } = await db.from("transactions").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: locker } = await db.from("lockers").select("*").eq("student_id", studentId).eq("is_active", true).maybeSingle();
      const { data: overtimeSessions } = await db.from("overtime_sessions").select("*").eq("student_id", studentId).order("session_date", { ascending: false }).limit(50);
      const { data: holds } = await db.from("membership_holds").select("*").eq("student_id", studentId).order("paused_at", { ascending: false }).limit(50);
      const { data: discounts } = await db.from("membership_discounts").select("*, staff(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: cashbacks } = await db.from("cashbacks").select("*, staff:granted_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);

      return json({ student, memberships, bookings, transactions, locker, overtimeSessions: overtimeSessions ?? [], holds: holds ?? [], discounts: discounts ?? [], cashbacks: cashbacks ?? [] });
    }

    if (action === "get_top_students") {
      const { branchId, sortBy, period } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      if (period === "month") {
        const d = new Date();
        const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const { data: bookings } = await db.from("bookings")
          .select("student_id, hours, students(id, name, phone, course)")
          .eq("branch_id", branchId).gte("created_at", monthStart + "T00:00:00Z");
        const byStudent = new Map<string, { id: string; name: string; phone: string; course: string | null; visits: number; hours: number }>();
        for (const b of bookings ?? []) {
          const s = b.students as unknown as { id: string; name: string; phone: string; course: string | null } | null;
          if (!s) continue;
          const row = byStudent.get(s.id) ?? { id: s.id, name: s.name, phone: s.phone, course: s.course, visits: 0, hours: 0 };
          row.visits += 1;
          row.hours += Number(b.hours ?? 0);
          byStudent.set(s.id, row);
        }
        const col = sortBy === "hours" ? "hours" : "visits";
        const rows = [...byStudent.values()].sort((a, b) => b[col] - a[col]).slice(0, 20)
          .map(r => ({ id: r.id, name: r.name, phone: r.phone, course: r.course, total_visits: r.visits, total_hours_studied: r.hours }));
        const { data: activeMemStudents } = rows.length
          ? await db.from("memberships").select("student_id").in("student_id", rows.map(r => r.id)).eq("is_active", true)
          : { data: [] as { student_id: string }[] };
        const memberIds = new Set((activeMemStudents ?? []).map((m: { student_id: string }) => m.student_id));
        return json({ students: rows.map(r => ({ ...r, is_member: memberIds.has(r.id) })) });
      }

      const col = sortBy === "hours" ? "total_hours_studied" : "total_visits";
      const { data } = await db.from("students").select("id, name, phone, total_visits, total_hours_studied, loyalty_tag, course")
        .eq("branch_id", branchId).order(col, { ascending: false }).limit(20);
      const { data: activeMemStudents } = data?.length
        ? await db.from("memberships").select("student_id").in("student_id", data.map((r: { id: string }) => r.id)).eq("is_active", true)
        : { data: [] as { student_id: string }[] };
      const memberIds = new Set((activeMemStudents ?? []).map((m: { student_id: string }) => m.student_id));
      return json({ students: (data ?? []).map((r: { id: string }) => ({ ...r, is_member: memberIds.has(r.id) })) });
    }

    if (action === "record_payment") {
      const { membershipId, amount, paymentMode } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const newDue = Math.max(Number(mem.fee_due) - Number(amount), 0);
      // Only push the due date forward once the balance is fully cleared — otherwise a
      // partial payment would make a still-overdue membership vanish from overdue views.
      const newDueDate = newDue === 0 ? addMonths(mem.due_date, 1) : mem.due_date;
      await db.from("memberships").update({
        fee_due: newDue, due_date: newDueDate, total_paid: Number(mem.total_paid) + Number(amount),
      }).eq("id", membershipId);

      await db.from("transactions").insert({
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
        category: "membership", amount: Number(amount), payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      });

      if (newDue === 0) {
        await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      }
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true });
    }

    // Owner-only: reward a loyal/high-hours student by knocking a % or fixed ₹ amount
    // off their currently pending membership fee. No money changes hands — this only
    // reduces fee_due — so it's tracked in its own audited table, not `transactions`.
    if (action === "apply_loyalty_discount") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { membershipId, discountType, discountValue, remarks } = payload;
      if (!["percent", "fixed"].includes(discountType)) return err("Invalid discount type");
      const value = Number(discountValue);
      if (!(value > 0)) return err("Discount value must be greater than 0");

      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      // Available even with nothing pending — a discount on a fully-paid membership (or one
      // larger than what's left owing) banks the leftover as a cashback instead of being wasted.
      const feeDue = Number(mem.fee_due);
      const discountBase = feeDue > 0 ? feeDue : Number(mem.monthly_fee) * Number(mem.months_paid);
      const rawAmount = discountType === "percent" ? discountBase * (value / 100) : value;
      const appliedToFee = Math.min(rawAmount, feeDue);
      const bankedAsCashback = Math.max(rawAmount - feeDue, 0);
      const newDue = feeDue - appliedToFee;

      await db.from("memberships").update({ fee_due: newDue }).eq("id", membershipId);
      await db.from("membership_discounts").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        discount_type: discountType, discount_value: value, discount_amount: appliedToFee,
        remarks: remarks || null, applied_by_staff_id: staff.id,
      });

      let cashbackBankedNote = null;
      if (bankedAsCashback > 0) {
        const { data: existingCashback } = await db.from("cashbacks").select("*")
          .eq("student_id", mem.student_id).eq("status", "pending").maybeSingle();
        if (!existingCashback) {
          await db.from("cashbacks").insert({
            student_id: mem.student_id, branch_id: mem.branch_id,
            month_label: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
            cashback_type: "fixed", cashback_value: bankedAsCashback,
            notes: `Banked from a discount that exceeded the pending fee${remarks ? ` — ${remarks}` : ""}`,
            granted_by_staff_id: staff.id,
          });
        } else if (existingCashback.cashback_type === "fixed") {
          await db.from("cashbacks").update({
            cashback_value: Number(existingCashback.cashback_value) + bankedAsCashback,
          }).eq("id", existingCashback.id);
        } else {
          cashbackBankedNote = "Could not bank the excess — this student already has a percent-based cashback pending.";
        }
      }

      if (newDue === 0) {
        await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      }
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, discountAmount: appliedToFee, newFeeDue: newDue, bankedAsCashback, cashbackBankedNote });
    }

    // Cashback for a top-hours student this month — staff or owner grants it after checking
    // the leaderboard. Sits pending until consumed at the student's next renewal (discount)
    // or, if they close out instead of renewing, paid out in cash at closure.
    if (action === "grant_cashback") {
      const { studentId, branchId, cashbackType, cashbackValue, monthLabel, notes } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!["percent", "fixed"].includes(cashbackType)) return err("Invalid cashback type");
      const value = Number(cashbackValue);
      if (!(value > 0)) return err("Cashback value must be greater than 0");
      if (cashbackType === "percent" && value > 100) return err("Percentage cashback cannot exceed 100");

      // Redemption only makes sense against a renewal or closure, both of which require
      // an active membership — walk-in-only students have neither.
      const { data: activeMem } = await db.from("memberships").select("id")
        .eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (!activeMem) return err("This student doesn't have an active membership — cashback can only be granted to membership students");

      const { data: existing } = await db.from("cashbacks").select("id")
        .eq("student_id", studentId).eq("status", "pending").maybeSingle();
      if (existing) return err("This student already has a pending cashback awaiting redemption");

      await db.from("cashbacks").insert({
        student_id: studentId, branch_id: branchId, month_label: monthLabel || new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
        cashback_type: cashbackType, cashback_value: value, notes: notes || null, granted_by_staff_id: staff.id,
      });
      return json({ ok: true });
    }

    // All cashback grants for a branch, newest first — lets staff/owner see who still has
    // a cashback pending (yet to avail) vs. already redeemed or settled at closure.
    if (action === "list_cashbacks") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: cashbacks } = await db.from("cashbacks")
        .select("*, students(name, phone)")
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });

      // Percent-type cashbacks that are still pending have no fixed rupee value yet — the
      // amount depends on the membership fee it's applied against at renewal/closure. Estimate
      // it off each student's current active membership (monthly_fee * months_paid), the same
      // base renew_membership/close_membership use, so staff can see roughly what it's worth.
      const pendingStudentIds = [...new Set(
        (cashbacks ?? []).filter((c) => c.status === "pending" && c.cashback_type === "percent").map((c) => c.student_id),
      )];
      const { data: activeMems } = pendingStudentIds.length
        ? await db.from("memberships").select("student_id, monthly_fee, months_paid").in("student_id", pendingStudentIds).eq("is_active", true)
        : { data: [] };
      const memByStudent = new Map((activeMems ?? []).map((m: { student_id: string; monthly_fee: number; months_paid: number }) => [m.student_id, m]));

      const rows = (cashbacks ?? []).map((c: Record<string, unknown>) => {
        let estimatedAmount = null;
        if (c.cashback_type === "fixed") {
          estimatedAmount = Number(c.cashback_value);
        } else if (c.status === "pending") {
          const mem = memByStudent.get(c.student_id as string);
          if (mem) estimatedAmount = Number(mem.monthly_fee) * Number(mem.months_paid) * (Number(c.cashback_value) / 100);
        } else {
          estimatedAmount = c.redeemed_amount != null ? Number(c.redeemed_amount) : null;
        }
        return {
          id: c.id,
          studentId: c.student_id,
          studentName: (c.students as { name?: string } | null)?.name ?? "-",
          studentPhone: (c.students as { phone?: string } | null)?.phone ?? "-",
          monthLabel: c.month_label,
          cashbackType: c.cashback_type,
          cashbackValue: c.cashback_value,
          estimatedAmount,
          status: c.status,
          redeemedAmount: c.redeemed_amount,
          redeemedAt: c.redeemed_at,
          notes: c.notes,
          createdAt: c.created_at,
        };
      });

      return json({ cashbacks: rows });
    }

    if (action === "record_locker_payment") {
      const { lockerId, amount, paymentMode } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      const newDue = Math.max(Number(locker.fee_due) - Number(amount), 0);
      await db.from("lockers").update({
        fee_due: newDue, amount_paid: Number(locker.amount_paid) + Number(amount),
      }).eq("id", lockerId);

      await db.from("transactions").insert({
        student_id: locker.student_id, branch_id: locker.branch_id,
        category: "locker", amount: Number(amount), payment_mode: paymentMode ?? "cash",
        notes: "Locker pending payment", created_by_staff_id: staff.id,
      });

      return json({ ok: true });
    }

    // ─── FOOD PASS (prepaid wallet) ───
    if (action === "get_food_pass") {
      const { studentId } = payload;
      const { data: student } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);
      const { data: pass } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
      return json({ pass: pass ?? null });
    }

    if (action === "topup_food_pass") {
      const { studentId, branchId, amount, paymentMode } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const amt = Number(amount);
      if (!(amt > 0)) return err("Top-up amount must be greater than 0");

      // Same eligibility rule as cashback — a currently active membership, not just having
      // held one at some point (so a walk-in, or a student whose membership has since ended,
      // can't top up a Food Pass).
      const { count: activeMembershipCount } = await db.from("memberships")
        .select("*", { count: "exact", head: true }).eq("student_id", studentId).eq("is_active", true);
      if (!activeMembershipCount) return err("Food Pass is only available to students with an active membership");

      const { data: existing } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
      let newBalance;
      if (existing) {
        newBalance = Number(existing.balance) + amt;
        await db.from("food_passes").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        newBalance = amt;
        await db.from("food_passes").insert({ student_id: studentId, branch_id: branchId, balance: newBalance });
      }
      // Real revenue collected now — record it (topups are the only Food Pass event that's actual new money).
      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, category: "food",
        amount: amt, payment_mode: paymentMode ?? "cash", notes: "Food Pass top-up",
        created_by_staff_id: staff.id,
      });
      return json({ ok: true, balance: newBalance });
    }

    // ─── FOOD ───
    if (action === "list_food_items") {
      const { branchId } = payload;
      let q = db.from("food_items").select("*").eq("is_active", true).order("name");
      if (branchId) {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ items: data ?? [] });
    }

    if (action === "create_food_bill") {
      const { branchId, studentId, studentName, studentPhone, bookingId, items, paymentMode, discountType, discountValue, discountAmount } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      let subtotal = 0;
      const lineItems = [];
      for (const item of items) {
        const { data: fi } = await db.from("food_items").select("*").eq("id", item.foodItemId).single();
        if (!fi) continue;
        const qty = item.quantity || 1;
        if (fi.quantity != null && qty > fi.quantity) return err(`Only ${fi.quantity} of ${fi.name} available`);
        subtotal += Number(fi.price) * qty;
        lineItems.push({ food_item_id: fi.id, name: fi.name, price: fi.price, quantity: qty });
        if (fi.quantity != null) await db.from("food_items").update({ quantity: fi.quantity - qty }).eq("id", fi.id);
      }

      const disc = Number(discountAmount) || 0;
      const total = Math.max(subtotal - disc, 0);

      // A student with a Food Pass pays through it exclusively — not a choice, a rule.
      // Balance can go negative (settled separately); the money for it was already
      // collected at top-up time, so no new transaction gets recorded here.
      let payFromPass = false;
      let newPassBalance = null;
      let pass = null;
      if (studentId) {
        const { data: p } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
        pass = p;
      }
      if (pass) {
        payFromPass = true;
        newPassBalance = Number(pass.balance) - total;
        await db.from("food_passes").update({
          balance: newPassBalance, updated_at: new Date().toISOString(),
        }).eq("id", pass.id);
      }

      // Otherwise: no payment mode ⇒ bill is recorded unpaid, carried on the student's tab
      // (membership students get up to 3 days before it must be settled at checkout).
      const isPaid = payFromPass || paymentMode != null;

      const { data: bill, error } = await db.from("food_bills").insert({
        branch_id: branchId, student_id: studentId, booking_id: bookingId,
        student_name: studentName, student_phone: studentPhone,
        subtotal, discount_type: discountType, discount_value: discountValue ?? 0,
        discount_amount: disc, total, payment_mode: payFromPass ? "other" : (isPaid ? paymentMode : null), paid: isPaid,
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (error) return err(error.message);

      for (const li of lineItems) {
        await db.from("food_bill_items").insert({ food_bill_id: bill!.id, ...li });
      }

      if (isPaid && !payFromPass) {
        await db.from("transactions").insert({
          student_id: studentId, branch_id: branchId, food_bill_id: bill!.id,
          category: "food", amount: total, payment_mode: paymentMode,
          created_by_staff_id: staff.id,
        });
      }

      return json({
        bill: { id: bill!.id, total, subtotal, discountAmount: disc, items: lineItems, paid: isPaid, paidFromPass: payFromPass },
        foodPassBalance: newPassBalance,
      });
    }

    if (action === "create_food_item") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { branchId, name, price } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name?.trim() || !price) return err("Name and price are required");
      const { data, error } = await db.from("food_items").insert({
        branch_id: branchId, name: name.trim(), price: Number(price), is_active: true,
      }).select("id").single();
      if (error) return err(error.message);
      return json({ ok: true, item: data });
    }

    if (action === "update_food_item") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { itemId, isActive, price } = payload;
      const updates: Record<string, unknown> = {};
      if (isActive !== undefined) updates.is_active = isActive;
      if (price !== undefined) updates.price = Number(price);
      await db.from("food_items").update(updates).eq("id", itemId);
      return json({ ok: true });
    }

    if (action === "list_food_bills") {
      const { branchId, dateFrom, dateTo } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("food_bills").select("*, food_bill_items(*)").eq("branch_id", branchId)
        .gte("created_at", dateFrom + "T00:00:00Z").lte("created_at", dateTo + "T23:59:59Z")
        .order("created_at", { ascending: false });
      return json({ bills: data ?? [] });
    }

    // ─── REVENUE (owner + staff see own branch only) ───
    if (action === "get_revenue") {
      const { branchId, period, dateFrom, dateTo, allBranches } = payload;
      const range = dateRange(period ?? "today", dateFrom, dateTo);

      let branchFilter: string[] = [];
      if (allBranches && isOwner(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }

      const { data: txns } = await db.from("transactions").select("*")
        .in("branch_id", branchFilter)
        .gte("created_at", range.from + "T00:00:00Z")
        .lte("created_at", range.to + "T23:59:59Z");

      const cats = { desk: 0, membership: 0, food: 0, locker: 0, fine: 0 };
      const modes = { cash: 0, upi: 0, other: 0 };
      for (const t of txns ?? []) {
        cats[t.category as keyof typeof cats] = (cats[t.category as keyof typeof cats] ?? 0) + Number(t.amount);
        modes[t.payment_mode as keyof typeof modes] = (modes[t.payment_mode as keyof typeof modes] ?? 0) + Number(t.amount);
      }
      const total = Object.values(cats).reduce((a, b) => a + b, 0);

      // Daily trend
      const byDay: Record<string, number> = {};
      for (const t of txns ?? []) {
        const day = t.created_at.slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + Number(t.amount);
      }
      const trend = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));

      // Branch breakdown (useful when allBranches = true)
      const byBranchMap: Record<string, number> = {};
      for (const t of txns ?? []) {
        byBranchMap[t.branch_id] = (byBranchMap[t.branch_id] ?? 0) + Number(t.amount);
      }
      let branchRevenue: { name: string; amount: number }[] = [];
      if (Object.keys(byBranchMap).length > 1) {
        const { data: branchRows } = await db.from("branches").select("id, name").in("id", Object.keys(byBranchMap));
        const nameMap = new Map(branchRows?.map(b => [b.id, b.name]) ?? []);
        branchRevenue = Object.entries(byBranchMap)
          .map(([id, amount]) => ({ name: nameMap.get(id) ?? id, amount }))
          .sort((a, b) => b.amount - a.amount);
      }

      // Cashback payouts, locker deposit refunds, and unused Food Pass balances handed back
      // to students aren't revenue transactions — net them out to show the real final figure.
      const { data: payouts } = await db.from("payouts").select("payout_type, amount")
        .in("branch_id", branchFilter)
        .gte("created_at", range.from + "T00:00:00Z")
        .lte("created_at", range.to + "T23:59:59Z");
      const payoutTotals = { cashback: 0, locker_deposit: 0, food_pass_refund: 0 };
      for (const p of payouts ?? []) {
        payoutTotals[p.payout_type as keyof typeof payoutTotals] = (payoutTotals[p.payout_type as keyof typeof payoutTotals] ?? 0) + Number(p.amount);
      }
      const totalPayouts = Object.values(payoutTotals).reduce((a, b) => a + b, 0);
      const netRevenue = total - totalPayouts;

      return json({
        total, byCategory: cats, byPaymentMode: modes, trend, byBranch: branchRevenue,
        dateFrom: range.from, dateTo: range.to,
        payouts: payoutTotals, totalPayouts, netRevenue,
      });
    }

    if (action === "get_referral_stats") {
      const { branchId, allBranches } = payload;
      let branchFilter: string[] = [];
      if (allBranches && isOwner(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }

      const { data: students } = await db.from("students").select("referral_source")
        .in("branch_id", branchFilter).not("referral_source", "is", null);
      const counts: Record<string, number> = {};
      for (const s of students ?? []) {
        const key = s.referral_source || "unknown";
        counts[key] = (counts[key] ?? 0) + 1;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const rows = Object.entries(counts)
        .map(([source, count]) => ({ source, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 }))
        .sort((a, b) => b.count - a.count);

      return json({ rows, total });
    }

    if (action === "list_transactions") {
      const { branchId, period, dateFrom, dateTo, category, search } = payload;
      const range = dateRange(period ?? "month", dateFrom, dateTo);
      const bid = branchId ?? staff.branch_id;
      if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);

      let q = db.from("transactions").select("*, students(name, phone), branches(name)")
        .eq("branch_id", bid)
        .gte("created_at", range.from + "T00:00:00Z")
        .lte("created_at", range.to + "T23:59:59Z")
        .order("created_at", { ascending: false });
      if (category) q = q.eq("category", category);

      const { data } = await q;
      let rows = data ?? [];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(r => r.students?.name?.toLowerCase().includes(s) || r.students?.phone?.includes(s));
      }
      return json({ transactions: rows });
    }

    if (action === "get_daily_report") {
      const { branchId, date } = payload;
      const reportDate = date ?? todayISO();
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      const { data: txns } = await db.from("transactions").select("*")
        .eq("branch_id", branchId)
        .gte("created_at", reportDate + "T00:00:00Z")
        .lte("created_at", reportDate + "T23:59:59Z");

      const { data: walkins } = await db.from("bookings").select("*, students(name)")
        .eq("branch_id", branchId).eq("booking_type", "walkin")
        .gte("created_at", reportDate + "T00:00:00Z").lte("created_at", reportDate + "T23:59:59Z");

      const { data: newMembers } = await db.from("memberships").select("*, students(name)")
        .eq("branch_id", branchId)
        .gte("created_at", reportDate + "T00:00:00Z").lte("created_at", reportDate + "T23:59:59Z");

      const total = (txns ?? []).reduce((s, t) => s + Number(t.amount), 0);
      const canSeeCollections = isOwner(staff);
      return json({
        date: reportDate,
        totalCollections: canSeeCollections ? total : null,
        transactions: canSeeCollections ? txns : null,
        walkins, newMembers,
      });
    }

    // ─── FEE CONFIG ───
    if (action === "list_fee_config") {
      const { data } = await db.from("fee_config").select("*").order("config_type").order("sort_order");
      return json({ config: data ?? [] });
    }

    if (action === "update_fee_config") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { id, fee } = payload;
      await db.from("fee_config").update({ fee }).eq("id", id);
      return json({ ok: true });
    }

    // ─── STAFF MANAGEMENT ───
    if (action === "list_staff") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { data } = await db.from("staff").select("id, username, role, display_name, branch_id, is_active, branches(name)").order("username");
      return json({ staff: data ?? [] });
    }

    // ─── TASKS (two-way assignment) ───
    if (action === "list_branch_staff") {
      const { branchId } = payload;
      let q = db.from("staff").select("id, username, display_name, role, branch_id").eq("is_active", true).order("display_name");
      if (isOwner(staff)) {
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
      if (isOwner(staff) && !results.some(s => s.id === staff.id)) {
        const { data: ownerRow } = await db.from("staff").select("id, username, display_name, role, branch_id").eq("id", staff.id).single();
        if (ownerRow) results.push(ownerRow);
      }
      return json({ staff: results });
    }

    if (action === "create_task") {
      const { branchId, assignedToStaffId, title, description, dueDate, repeatInterval } = payload;
      if (!title) return err("Title is required");
      if (!assignedToStaffId) return err("Please select who to assign this task to");
      if (repeatInterval && !["none", "daily", "weekly", "monthly"].includes(repeatInterval)) return err("Invalid repeat interval");
      const targetBranchId = branchId ?? staff.branch_id;
      if (!isOwner(staff)) {
        if (!targetBranchId || targetBranchId !== staff.branch_id) return err("Branch access denied", 403);
        const { data: assignee } = await db.from("staff").select("branch_id, role").eq("id", assignedToStaffId).single();
        if (!assignee || (assignee.role !== "owner" && assignee.branch_id !== staff.branch_id)) {
          return err("Can only assign tasks to staff in your branch, or the owner");
        }
      }
      const { data: task, error: tErr } = await db.from("tasks").insert({
        branch_id: targetBranchId, assigned_by_staff_id: staff.id, assigned_to_staff_id: assignedToStaffId,
        title, description: description ?? null, due_date: dueDate ?? null,
        repeat_interval: repeatInterval ?? "none",
      }).select("*").single();
      if (tErr) return err(tErr.message);
      return json({ ok: true, task });
    }

    if (action === "list_tasks") {
      const { branchId, allBranches, date } = payload;
      const targetDate = date || todayISO();
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username), assigned_by:assigned_by_staff_id(display_name, username), branches(name)")
        .order("created_at", { ascending: false });
      if (isOwner(staff)) {
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
        dueToday: isTaskDueOn(t, targetDate),
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));

      return json({ tasks });
    }

    if (action === "update_task_status") {
      const { taskId, done, date } = payload;
      const targetDate = date || todayISO();
      const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
      if (!task) return err("Task not found");
      // Only the assignee can mark their own task complete — being the assigner (even as owner) isn't enough
      if (task.assigned_to_staff_id !== staff.id) {
        return err("Only the person a task is assigned to can complete it", 403);
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
    }

    if (action === "get_my_tasks_today") {
      const { data } = await db.from("tasks").select("*").eq("assigned_to_staff_id", staff.id);
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
      return json({ tasks });
    }

    if (action === "get_task_completion_report") {
      const { branchId, allBranches, date } = payload;
      const targetDate = date || todayISO();
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username), branches(name)");
      if (isOwner(staff)) {
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

      const dueTasks = (data ?? []).filter(t => isTaskDueOn(t, targetDate));
      const recurringIds = dueTasks.filter(t => t.repeat_interval !== "none").map(t => t.id);
      const { data: completions } = recurringIds.length
        ? await db.from("task_completions").select("task_id").eq("completion_date", targetDate).in("task_id", recurringIds)
        : { data: [] };
      const completedSet = new Set((completions ?? []).map(c => c.task_id));

      const tasks = dueTasks.map(t => ({
        ...t,
        completedToday: t.repeat_interval === "none" ? t.status === "done" : completedSet.has(t.id),
      }));

      return json({ date: targetDate, tasks });
    }

    if (action === "list_incomplete_tasks") {
      const { branchId, allBranches } = payload;
      let q = db.from("tasks").select("*, assigned_to:assigned_to_staff_id(display_name, username), assigned_by:assigned_by_staff_id(display_name, username), branches(name)");
      if (isOwner(staff)) {
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
        const anchor = t.due_date ?? t.created_at.slice(0, 10);
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
    }

    if (action === "list_staff_attendance") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const targetDate = payload?.date || todayISO();

      const { data: allStaff } = await db.from("staff").select("id, username, display_name, branch_id, is_active, branches(name)")
        .eq("is_active", true).neq("role", "owner").order("display_name");
      const { data: present } = await db.from("staff_attendance").select("staff_id, first_login_at")
        .eq("attendance_date", targetDate);
      const presentMap = new Map((present ?? []).map(p => [p.staff_id, p.first_login_at]));

      const rows = (allStaff ?? []).map(s => ({
        staffId: s.id, displayName: s.display_name || s.username,
        branchId: s.branch_id ?? null, branchName: s.branches?.name ?? null,
        present: presentMap.has(s.id), firstLoginAt: presentMap.get(s.id) ?? null,
      }));

      return json({ date: targetDate, rows });
    }

    if (action === "create_staff") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { username, password, displayName, role, branchId } = payload;
      const { data: hash } = await db.rpc("hash_staff_password", { plain_password: password });
      const { error } = await db.from("staff").insert({
        username, password_hash: hash, role: role ?? "staff",
        display_name: displayName, branch_id: branchId,
      });
      if (error) return err(error.message);
      return json({ ok: true });
    }

    // Edit an existing staff account's credentials/branch, or toggle is_active.
    // verify_staff_login already requires is_active = true, so deactivating here
    // immediately blocks that account from signing in — and authStaff() re-checks
    // is_active on every request, so an already-issued token stops working too.
    if (action === "update_staff") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const { staffId, username, newPassword, displayName, branchId, isActive } = payload;
      if (!staffId) return err("Staff ID required");
      const { data: target } = await db.from("staff").select("id, role, is_active").eq("id", staffId).single();
      if (!target) return err("Staff not found");
      if (target.role === "owner") return err("Owner accounts can't be edited here");
      if (staffId === staff.id) return err("You can't edit your own account from here");
      // Deactivation is permanent — once a staff account is turned off it can never be
      // switched back on, so this deliberately does not accept isActive: true on an
      // already-inactive account.
      if (!target.is_active) return err("This staff account has been permanently removed and cannot be reactivated");

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (username !== undefined && username !== "") updates.username = username;
      if (displayName !== undefined) updates.display_name = displayName;
      if (branchId !== undefined && branchId !== "") updates.branch_id = branchId;
      if (isActive === false) updates.is_active = false;
      if (newPassword) {
        const { data: hash } = await db.rpc("hash_staff_password", { plain_password: newPassword });
        updates.password_hash = hash;
      }

      const { error } = await db.from("staff").update(updates).eq("id", staffId);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    // ─── MESSAGES ───
    if (action === "list_messages") {
      const { branchId, channel } = payload;
      let q = db.from("messages")
        .select("*, staff:sender_staff_id(display_name, username), students:recipient_student_id(name, phone)")
        .order("sent_at", { ascending: false }).limit(50);
      if (channel === "all") {
        q = q.is("branch_id", null);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ messages: data ?? [] });
    }

    if (action === "send_message") {
      const { branchId, channel, recipientType, recipientStudentId, recipientStaffId, content } = payload;
      const isAllStaffChannel = channel === "all";
      if (!isAllStaffChannel && !requireBranch(staff, branchId)) return err("Branch access denied", 403);
      await db.from("messages").insert({
        branch_id: isAllStaffChannel ? null : branchId, sender_staff_id: staff.id,
        recipient_type: recipientType, recipient_student_id: recipientStudentId,
        recipient_staff_id: recipientStaffId, content,
      });
      return json({ ok: true });
    }

    // ─── ALERTS ───
    if (action === "list_alerts") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("alerts").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("status", "pending").order("due_date");
      return json({ alerts: data ?? [] });
    }

    if (action === "resolve_alert") {
      const { alertId } = payload;
      const { data: alert } = await db.from("alerts").select("branch_id").eq("id", alertId).single();
      if (!alert) return err("Alert not found", 404);
      if (!requireBranch(staff, alert.branch_id)) return err("Branch access denied", 403);
      await db.from("alerts").update({ status: "resolved" }).eq("id", alertId);
      return json({ ok: true });
    }

    // ─── ACTIONABLE ITEMS ───
    if (action === "get_actionable_items") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const today = todayISO();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

      // Any outstanding balance is actionable, regardless of due_date — due_date is always
      // set a month out even on a same-day partial payment, so gating on it would hide a
      // real balance for a full month.
      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone, course)")
        .eq("branch_id", branchId).eq("is_active", true).gt("fee_due", 0);

      const { data: expiringSoon } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true)
        .gte("end_date", today).lte("end_date", addDays(today, 7));

      const { data: expiredMemberships } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("end_date", today);

      const { data: overdueLockers } = await db.from("lockers").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("locker_due_date", today);

      return json({
        dueToday: dueToday ?? [], expiringSoon: expiringSoon ?? [],
        expiredMemberships: expiredMemberships ?? [], overdueLockers: overdueLockers ?? [],
      });
    }

    // ─── TODAY'S BOOKINGS ───
    if (action === "list_today_bookings") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const today = todayISO();
      const { data, error: bErr } = await db.from("bookings")
        .select("*, students(name, phone, course), desks!desk_id(label, seat_type), memberships:membership_id(total_paid, fee_due, monthly_fee, category, end_date)")
        .eq("branch_id", branchId)
        .eq("status", "active")
        .gte("created_at", today + "T00:00:00Z")
        .lte("created_at", today + "T23:59:59Z")
        .order("created_at", { ascending: false });
      if (bErr) return err(bErr.message);

      const bookingIds = (data ?? []).map(b => b.id);
      const { data: foodBills } = bookingIds.length
        ? await db.from("food_bills").select("booking_id, total, paid").in("booking_id", bookingIds)
        : { data: [] };
      const foodTotals = new Map<string, number>();
      const unpaidFoodTotalsByBooking = new Map<string, number>();
      for (const fb of foodBills ?? []) {
        foodTotals.set(fb.booking_id, (foodTotals.get(fb.booking_id) ?? 0) + Number(fb.total));
        if (!fb.paid) unpaidFoodTotalsByBooking.set(fb.booking_id, (unpaidFoodTotalsByBooking.get(fb.booking_id) ?? 0) + Number(fb.total));
      }

      // A student can renew mid-session — pull each member's *current* active membership
      // rather than trusting the (possibly now-superseded) membership_id stored on the booking.
      const memberStudentIds = [...new Set((data ?? []).filter((b: any) => b.booking_type !== "walkin").map((b: any) => b.student_id))];
      const { data: activeMems } = memberStudentIds.length
        ? await db.from("memberships").select("student_id, total_paid, fee_due, monthly_fee, category, end_date")
            .in("student_id", memberStudentIds).eq("is_active", true)
        : { data: [] };
      const activeMemByStudent = new Map((activeMems ?? []).map((m: any) => [m.student_id, m]));

      // Members can carry an unpaid food bill across days (different booking_id each day),
      // so their unpaid total must be summed by student, not by today's booking alone.
      const { data: memberUnpaidBills } = memberStudentIds.length
        ? await db.from("food_bills").select("student_id, total").in("student_id", memberStudentIds).eq("paid", false)
        : { data: [] };
      const unpaidFoodTotalsByStudent = new Map<string, number>();
      for (const fb of memberUnpaidBills ?? []) {
        unpaidFoodTotalsByStudent.set(fb.student_id, (unpaidFoodTotalsByStudent.get(fb.student_id) ?? 0) + Number(fb.total));
      }

      // Food Pass holders never see a "pending, pay cash" food bill — it's auto-settled from
      // the pass at checkout — so the frontend needs to know who has one.
      const { data: foodPasses } = memberStudentIds.length
        ? await db.from("food_passes").select("student_id").in("student_id", memberStudentIds)
        : { data: [] };
      const foodPassStudentIds = new Set((foodPasses ?? []).map((p: { student_id: string }) => p.student_id));

      const bookings = (data ?? []).map(b => ({
        ...b,
        memberships: activeMemByStudent.get(b.student_id) ?? b.memberships,
        foodTotal: foodTotals.get(b.id) ?? 0,
        unpaidFoodTotal: b.booking_type === "walkin" ? (unpaidFoodTotalsByBooking.get(b.id) ?? 0) : (unpaidFoodTotalsByStudent.get(b.student_id) ?? 0),
        hasFoodPass: foodPassStudentIds.has(b.student_id),
      }));
      return json({ bookings });
    }

    // ─── PAUSE / RESUME SESSION ───
    if (action === "pause_session") {
      const { bookingId } = payload;
      const { data: bk } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!bk) return err("Booking not found");
      if (!requireBranch(staff, bk.branch_id)) return err("Branch access denied", 403);
      if (bk.is_paused) return err("Session is already on break");
      await db.from("bookings").update({
        is_paused: true, paused_at: new Date().toISOString(),
      }).eq("id", bookingId);
      return json({ ok: true });
    }

    if (action === "resume_session") {
      const { bookingId } = payload;
      const { data: bk } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!bk) return err("Booking not found");
      if (!requireBranch(staff, bk.branch_id)) return err("Branch access denied", 403);
      if (!bk.is_paused) return err("Session is not on break");

      const pausedAt = new Date(bk.paused_at);
      const minutesPaused = Math.ceil((Date.now() - pausedAt.getTime()) / 60_000);
      const totalPause = (bk.total_pause_minutes ?? 0) + minutesPaused;
      const newEnd = new Date(new Date(bk.end_time).getTime() + minutesPaused * 60_000).toISOString();

      await db.from("bookings").update({
        is_paused: false, paused_at: null,
        total_pause_minutes: totalPause, end_time: newEnd,
      }).eq("id", bookingId);
      return json({ ok: true, minutesPaused, newEndTime: newEnd });
    }

    // ─── ACTIVE MEMBERSHIPS ───
    if (action === "list_active_memberships") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("memberships")
        .select("id, category, hours_per_day, start_date, end_date, cabin_no, is_paused, hold_days, fee_due, total_paid, students(id, name, phone)")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("end_date");
      type MemRow = { id: string; category: string; hours_per_day: number; start_date: string; end_date: string; cabin_no: string | null; is_paused: boolean; hold_days: number; fee_due: number; total_paid: number; students: { id: string; name: string; phone: string } | null };
      const studentIds = (data as MemRow[] ?? []).map(m => m.students?.id).filter((id): id is string => !!id);
      const { data: pendingCashbacks } = studentIds.length
        ? await db.from("cashbacks").select("student_id, cashback_type, cashback_value").in("student_id", studentIds).eq("status", "pending")
        : { data: [] };
      const cashbackByStudent = new Map((pendingCashbacks ?? []).map((c: { student_id: string; cashback_type: string; cashback_value: number }) => [c.student_id, c]));

      const members = (data as MemRow[] ?? []).map(m => ({
        membership_id: m.id,
        student_id: m.students?.id,
        student_name: m.students?.name,
        student_phone: m.students?.phone,
        category: m.category,
        hours_per_day: m.hours_per_day,
        cabin_no: m.cabin_no,
        start_date: m.start_date,
        end_date: m.end_date,
        is_paused: m.is_paused,
        hold_days: m.hold_days,
        fee_due: m.fee_due,
        total_paid: m.total_paid,
        pending_cashback: m.students?.id ? (cashbackByStudent.get(m.students.id) ?? null) : null,
      }));

      // Remind staff to collect renewal during the student's final week of validity —
      // kept alive (re-upserted) every time this list loads, resolved on renew/close.
      const today = todayISO();
      const weekOut = addDays(today, 7);
      for (const m of members) {
        if (!m.student_id) continue;
        if (m.end_date >= today && m.end_date <= weekOut) {
          await createAlert(db, m.student_id, branchId, "expiry", m.end_date,
            `${m.student_name}'s membership expires on ${m.end_date} — remind them to renew.`);
        }
      }

      return json({ members });
    }

    // ─── RENEW MEMBERSHIP ───
    if (action === "renew_membership") {
      const { membershipId, monthsPaid, paymentMode, advanceAmount, category, hoursPerDay } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (Number(mem.fee_due ?? 0) > 0) {
        return err(`This membership still has ₹${Number(mem.fee_due)} pending — clear it before renewing.`);
      }

      const newCategory = category ?? mem.category;
      const newHoursPerDay = Number(hoursPerDay ?? mem.hours_per_day);

      const months = Number(monthsPaid) || 1;
      const monthlyFee = await getMembershipPackage(db, newHoursPerDay, newCategory);
      if (!monthlyFee) return err("Invalid membership package");

      const discount = multiMonthDiscount(months);
      const gross = monthlyFee * months;
      const totalBeforeCashback = gross * (1 - discount / 100);

      const { data: pendingCashback } = await db.from("cashbacks").select("*")
        .eq("student_id", mem.student_id).eq("status", "pending").maybeSingle();
      const cashbackAmount = pendingCashback
        ? Math.min(pendingCashback.cashback_type === "percent" ? totalBeforeCashback * (Number(pendingCashback.cashback_value) / 100) : Number(pendingCashback.cashback_value), totalBeforeCashback)
        : 0;

      // Any overtime run up since the last settlement gets folded into this renewal's bill.
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes")
        .eq("student_id", mem.student_id).is("billed_at", null);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeHourlyRate = Number(mem.monthly_fee) / (Number(mem.hours_per_day) * 30);
      const overtimeDue = Math.round(overtimeMinutes * overtimeHourlyRate / 60);

      const totalFee = totalBeforeCashback - cashbackAmount + overtimeDue;

      const feePaid = advanceAmount != null ? Number(advanceAmount) : totalFee;
      const feeDue = Math.max(totalFee - feePaid, 0);

      const today = todayISO();
      const startDate = mem.end_date < today ? today : mem.end_date;
      const endDate = addMonths(startDate, months);
      const dueDate = addMonths(startDate, 1);
      const monthLabel = new Date(startDate).toLocaleString("en-US", { month: "long", year: "numeric" });

      // Plan can change on renewal — reassign the cabin/seat if the category changed
      let seatType = mem.seat_type;
      let deskId = mem.desk_id;
      let cabinNo = mem.cabin_no;
      if (newCategory !== mem.category) {
        if (mem.desk_id) {
          await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
          deskId = null;
          cabinNo = null;
        }
        seatType = newCategory === "permanent" ? "fixed" : "floating";
        if (newCategory === "permanent") {
          const { data: freeDesk } = await db.from("desks").select("*")
            .eq("branch_id", mem.branch_id).eq("status", "free").order("sort_order").limit(1).maybeSingle();
          if (!freeDesk) return err("No cabin available for permanent membership");
          deskId = freeDesk.id;
          cabinNo = freeDesk.label;
          await db.from("desks").update({ status: "reserved", seat_type: "fixed", assigned_student_id: mem.student_id }).eq("id", deskId);
        }
      }

      const { data: newMem, error: mErr } = await db.from("memberships").insert({
        student_id: mem.student_id, branch_id: mem.branch_id,
        category: newCategory, seat_type: seatType,
        desk_id: deskId, cabin_no: cabinNo,
        month: monthLabel, hours_per_day: newHoursPerDay,
        timings: mem.timings ?? '', start_date: startDate, end_date: endDate,
        due_date: dueDate, months_paid: months, discount_percent: discount,
        monthly_fee: monthlyFee, total_paid: feePaid, fee_due: feeDue,
        payment_mode: paymentMode ?? "cash", created_by_staff_id: staff.id,
      }).select("id").single();
      if (mErr) return err(mErr.message);

      await db.from("transactions").insert({
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: newMem!.id,
        category: "membership", amount: feePaid, payment_mode: paymentMode ?? "cash",
        notes: "Renewal", created_by_staff_id: staff.id,
      });

      // Deactivate old membership
      await db.from("memberships").update({ is_active: false }).eq("id", membershipId);
      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      if (pendingCashback && cashbackAmount > 0) {
        await db.from("cashbacks").update({
          status: "redeemed", redeemed_membership_id: newMem!.id,
          redeemed_amount: cashbackAmount, redeemed_at: new Date().toISOString(),
        }).eq("id", pendingCashback.id);
      }

      if (unbilledOvertime?.length) {
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString(), billed_amount: overtimeDue })
          .in("id", unbilledOvertime.map((o: { id: string }) => o.id));
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, membershipId: newMem!.id,
        cashbackApplied: cashbackAmount > 0 ? cashbackAmount : null,
        overtimeCharged: overtimeDue > 0 ? overtimeDue : null,
      });
    }

    // ─── CLOSE MEMBERSHIP ───
    if (action === "get_membership_closure_summary") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: pendingCashback } = await db.from("cashbacks").select("*")
        .eq("student_id", mem.student_id).eq("status", "pending").maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("overtime_minutes")
        .eq("student_id", mem.student_id).is("billed_at", null);

      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      // The caution deposit is owed back to the student once the locker is given up —
      // it's a credit against whatever else they owe, not revenue.
      const lockerDepositRefund = locker && !locker.deposit_returned ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const cashbackAmount = pendingCashback
        ? (pendingCashback.cashback_type === "percent" ? cashbackBase * (Number(pendingCashback.cashback_value) / 100) : Number(pendingCashback.cashback_value))
        : 0;
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeHourlyRate = Number(mem.monthly_fee) / (Number(mem.hours_per_day) * 30);
      const overtimeDue = Math.round(overtimeMinutes * overtimeHourlyRate / 60);

      const totalOwed = membershipDue + lockerDue + foodPassOwed + overtimeDue;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount;
      const netAmount = totalOwed - totalCredit;

      return json({
        membershipDue, lockerDue, lockerDepositRefund,
        foodPassBalance, foodPassRefund, foodPassOwed,
        cashbackAmount, overtimeMinutes, overtimeDue,
        totalOwed, totalCredit, netAmount,
        canClose: true,
        locker: locker ?? null,
      });
    }

    if (action === "close_membership") {
      const { membershipId, paymentMode } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: pendingCashback } = await db.from("cashbacks").select("*")
        .eq("student_id", mem.student_id).eq("status", "pending").maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes")
        .eq("student_id", mem.student_id).is("billed_at", null);

      // Final settlement: what's owed to the business nets against what's owed back to
      // the student (locker deposit, unredeemed Food Pass balance, unredeemed cashback).
      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      const lockerDepositRefund = locker && !locker.deposit_returned ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const cashbackAmount = pendingCashback
        ? (pendingCashback.cashback_type === "percent" ? cashbackBase * (Number(pendingCashback.cashback_value) / 100) : Number(pendingCashback.cashback_value))
        : 0;
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeHourlyRate = Number(mem.monthly_fee) / (Number(mem.hours_per_day) * 30);
      const overtimeDue = Math.round(overtimeMinutes * overtimeHourlyRate / 60);

      const totalOwed = membershipDue + lockerDue + foodPassOwed + overtimeDue;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount;
      const netAmount = totalOwed - totalCredit;

      if (netAmount > 0 && !paymentMode) {
        return err(`₹${netAmount.toFixed(2)} still needs to be collected before closing — choose a payment mode.`);
      }

      await db.from("memberships").update({ is_active: false, fee_due: 0 }).eq("id", membershipId);

      if (unbilledOvertime?.length) {
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString(), billed_amount: overtimeDue })
          .in("id", unbilledOvertime.map((o: { id: string }) => o.id));
      }

      if (locker) {
        await db.from("lockers").update({
          is_active: false, fee_due: 0, deposit_returned: true,
        }).eq("id", locker.id);
        if (lockerDepositRefund > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "locker_deposit",
            amount: lockerDepositRefund, notes: "Locker caution deposit returned at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }
      if (foodPass) {
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", foodPass.id);
        if (foodPassRefund > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "food_pass_refund",
            amount: foodPassRefund, notes: "Unused Food Pass balance returned at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }
      if (pendingCashback) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: cashbackAmount, redeemed_at: new Date().toISOString(),
        }).eq("id", pendingCashback.id);
        if (cashbackAmount > 0) {
          await db.from("payouts").insert({
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "cashback",
            amount: cashbackAmount, notes: "Cashback settled at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }

      // Release reserved desk if permanent
      if (mem.desk_id) {
        await db.from("desks").update({
          status: "free", seat_type: "floating", assigned_student_id: null,
        }).eq("id", mem.desk_id);
      }

      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      // Only a positive net is real revenue collected — a refund going the other way
      // isn't logged as a transaction, same as the cashback-payout convention.
      if (netAmount > 0) {
        await db.from("transactions").insert({
          student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
          category: "membership", amount: netAmount, payment_mode: paymentMode,
          notes: "Final settlement at membership closure", created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, netAmount,
        collectedAmount: Math.max(netAmount, 0), refundAmount: Math.max(-netAmount, 0),
        cashbackAmount, lockerDepositRefund, foodPassRefund, overtimeDue,
      });
    }

    // ─── ENQUIRIES (leads pipeline) ───
    if (action === "list_enquiries") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiries").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
      return json({ enquiries: data ?? [] });
    }

    if (action === "create_enquiry") {
      const { branchId, name, phone, email, source, message } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name?.trim()) return err("Name is required");
      const { data, error } = await db.from("enquiries").insert({
        branch_id: branchId, name: name.trim(), phone: phone || null, email: email || null,
        source: source || "walk_in", message: message || null, created_by_staff_id: staff.id,
      }).select("*").single();
      if (error) return err(error.message);
      return json({ enquiry: data });
    }

    if (action === "update_enquiry") {
      const { id, fields } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", id).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiries").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "delete_enquiries") {
      const ids: string[] = payload.ids ?? (payload.id ? [payload.id] : []);
      if (!ids.length) return err("No enquiry ids provided");
      const { data: rows } = await db.from("enquiries").select("id, branch_id").in("id", ids);
      if (!rows?.length) return err("Enquiry not found");
      if (!rows.every(r => requireBranch(staff, r.branch_id))) return err("Branch access denied", 403);
      const { error } = await db.from("enquiries").delete().in("id", ids);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "add_enquiry_activity") {
      const { enquiryId, type, note } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiry_activities").insert({ enquiry_id: enquiryId, type, note: note || null });
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "list_enquiry_activities") {
      const { enquiryId } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_activities").select("*").eq("enquiry_id", enquiryId).order("created_at", { ascending: true });
      return json({ activities: data ?? [] });
    }

    if (action === "add_enquiry_followup") {
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
    }

    if (action === "list_enquiry_followups") {
      const { enquiryId } = payload;
      const { data: enq } = await db.from("enquiries").select("branch_id").eq("id", enquiryId).single();
      if (!enq) return err("Enquiry not found");
      if (!requireBranch(staff, enq.branch_id)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_followups").select("*").eq("enquiry_id", enquiryId).order("due_at", { ascending: true });
      return json({ followups: data ?? [] });
    }

    if (action === "update_enquiry_followup") {
      const { id, fields } = payload;
      const { data: fu } = await db.from("enquiry_followups").select("branch_id").eq("id", id).single();
      if (!fu) return err("Follow-up not found");
      if (!requireBranch(staff, fu.branch_id)) return err("Branch access denied", 403);
      const { error } = await db.from("enquiry_followups").update(fields).eq("id", id);
      if (error) return err(error.message);
      return json({ ok: true });
    }

    if (action === "list_open_enquiry_followups") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_followups").select("*").eq("branch_id", branchId).eq("done", false).order("due_at", { ascending: true });
      return json({ followups: data ?? [] });
    }

    return err(`Unknown action: ${action}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
});
