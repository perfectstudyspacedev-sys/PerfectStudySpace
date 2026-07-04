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

function todayISO() { return new Date().toISOString().slice(0, 10); }

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// A recurring task's "anchor" is its due_date (or, failing that, the day it was created).
// daily tasks are due every day from the anchor onward; weekly/monthly repeat on the
// anchor's weekday / day-of-month.
function isTaskDueOn(task: { repeat_interval: string; due_date: string | null; created_at: string; status?: string }, dateStr: string): boolean {
  if (task.repeat_interval === "none") return task.status !== "done";
  const anchor = task.due_date ?? task.created_at.slice(0, 10);
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
  if (error) throw new Error(error.message);
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

      // Auto-mark attendance on first login of the day (no-op if already marked)
      await db.from("staff_attendance").upsert(
        { staff_id: row.id, branch_id: row.branch_id, attendance_date: todayISO() },
        { onConflict: "staff_id,attendance_date", ignoreDuplicates: true },
      );

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

      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).eq("due_date", today);

      const { data: expiredToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("end_date", today);

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

      const { data: duePayments } = await db.from("memberships")
        .select("*, students(name, phone, course), branches(name)")
        .eq("is_active", true).lte("due_date", targetDate).gt("fee_due", 0)
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
      const { data } = await db.from("students").select("id, name, phone, course, aadhaar_photo_url, photo_url, status")
        .eq("phone", phone).maybeSingle();
      if (!data) return json({ student: null });
      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", data.id).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      return json({ student: { ...data, active_membership: membership ?? null, is_member: !!membership } });
    }

    if (action === "search_students_by_name") {
      const { branchId, query } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!query || query.trim().length < 2) return json({ students: [] });
      const { data } = await db.from("students").select("id, name, phone")
        .eq("branch_id", branchId).ilike("name", `%${query.trim()}%`).order("name").limit(8);
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
        const { data: d } = await db.from("desks").select("*").eq("id", manualDeskId).single();
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
        paymentMode, aadhaarPhotoUrl, photoUrl, course, lockerNo, withLocker,
        advanceAmount, emergencyContact, referralSource,
      } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!aadhaarPhotoUrl) return err("Aadhaar photo is required");
      if (!emergencyContact) return err("Emergency contact is required");
      const validReferrals = ["google_search", "instagram", "word_of_mouth", "flex"];
      if (!validReferrals.includes(referralSource)) return err("Please select how the student heard about us");

      const studentId = await upsertStudent(db, name, phone, branchId, {
        aadhaar_photo_url: aadhaarPhotoUrl, photo_url: photoUrl, course, status: "active",
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
        if (!freeDesk) return err("No cabin available for permanent membership");
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
      const amount = proratedFee + deposit;

      const { data: locker, error: lErr } = await db.from("lockers").insert({
        branch_id: branchId, student_id: studentId, locker_no: lockerNo,
        locker_due_date: endDate, deposit_amount: deposit, monthly_fee: 100,
        amount_paid: payLater ? 0 : amount, fee_due: payLater ? amount : 0,
      }).select("*").single();
      if (lErr) return err(lErr.message);

      if (!payLater) {
        await db.from("transactions").insert({
          student_id: studentId, branch_id: branchId, category: "locker",
          amount, payment_mode: paymentMode ?? "cash",
          notes: `Locker added later — prorated ${daysRemaining}d rent (₹${proratedFee}) + deposit (₹${deposit})`,
          created_by_staff_id: staff.id,
        });
      }

      return json({ ok: true, locker, amountCharged: amount, proratedFee, daysRemaining, payLater: !!payLater });
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
        const GRACE_DAYS = 7;
        if (daysSinceExpiry > GRACE_DAYS) {
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

      // Permanent members use their pre-assigned cabin; temporary/others have no fixed desk
      const deskId = membership.category === "permanent" ? membership.desk_id : (passedDeskId ?? null);

      let desk = null;
      if (deskId) {
        const { data: d } = await db.from("desks").select("*").eq("id", deskId).single();
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

      return json({ ok: true, bookingId: booking!.id, deskLabel: desk?.label ?? null, endTime, expiredMembership: isExpiredMembership });
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
      const { bookingId, overtimeMinutes, overtimePaymentMode } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Booking not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      await db.from("bookings").update({ status: "completed", is_paused: false, paused_at: null, total_pause_minutes: 0 }).eq("id", bookingId);

      if (booking.desk_id) {
        const { data: desk } = await db.from("desks").select("seat_type").eq("id", booking.desk_id).single();
        if (desk?.seat_type === "floating") {
          await db.from("desks").update({ status: "free", current_booking_id: null }).eq("id", booking.desk_id);
        } else {
          await db.from("desks").update({ current_booking_id: null }).eq("id", booking.desk_id);
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
          // Member — log overtime to history table, no charge at checkout
          await db.from("overtime_sessions").insert({
            booking_id: bookingId,
            student_id: booking.student_id,
            membership_id: booking.membership_id ?? null,
            branch_id: booking.branch_id,
            overtime_minutes: otMinutes,
            session_date: todayISO(),
          });
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
      const { data: bookings } = await db.from("bookings").select("*, desks(label)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: transactions } = await db.from("transactions").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: locker } = await db.from("lockers").select("*").eq("student_id", studentId).eq("is_active", true).maybeSingle();
      const { data: overtimeSessions } = await db.from("overtime_sessions").select("*").eq("student_id", studentId).order("session_date", { ascending: false }).limit(50);
      const { data: holds } = await db.from("membership_holds").select("*").eq("student_id", studentId).order("paused_at", { ascending: false }).limit(50);

      return json({ student, memberships, bookings, transactions, locker, overtimeSessions: overtimeSessions ?? [], holds: holds ?? [] });
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
        return json({ students: rows });
      }

      const col = sortBy === "hours" ? "total_hours_studied" : "total_visits";
      const { data } = await db.from("students").select("id, name, phone, total_visits, total_hours_studied, loyalty_tag, course")
        .eq("branch_id", branchId).order(col, { ascending: false }).limit(20);
      return json({ students: data ?? [] });
    }

    if (action === "record_payment") {
      const { membershipId, amount, paymentMode } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const newDue = Math.max(Number(mem.fee_due) - Number(amount), 0);
      const newDueDate = addMonths(mem.due_date, 1);
      await db.from("memberships").update({
        fee_due: newDue, due_date: newDueDate, total_paid: Number(mem.total_paid) + Number(amount),
      }).eq("id", membershipId);

      await db.from("transactions").insert({
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
        category: "membership", amount: Number(amount), payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      });

      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true });
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

    // ─── FOOD ───
    if (action === "list_food_items") {
      const { branchId } = payload;
      let q = db.from("food_items").select("*").eq("is_active", true).order("name");
      if (branchId) q = q.eq("branch_id", branchId);
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

      const { data: bill, error } = await db.from("food_bills").insert({
        branch_id: branchId, student_id: studentId, booking_id: bookingId,
        student_name: studentName, student_phone: studentPhone,
        subtotal, discount_type: discountType, discount_value: discountValue ?? 0,
        discount_amount: disc, total, payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (error) return err(error.message);

      for (const li of lineItems) {
        await db.from("food_bill_items").insert({ food_bill_id: bill!.id, ...li });
      }

      await db.from("transactions").insert({
        student_id: studentId, branch_id: branchId, food_bill_id: bill!.id,
        category: "food", amount: total, payment_mode: paymentMode ?? "cash",
        created_by_staff_id: staff.id,
      });

      return json({ bill: { id: bill!.id, total, subtotal, discountAmount: disc, items: lineItems } });
    }

    if (action === "create_food_item") {
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

      return json({ total, byCategory: cats, byPaymentMode: modes, trend, byBranch: branchRevenue, dateFrom: range.from, dateTo: range.to });
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
        if (branchId) q = q.eq("branch_id", branchId);
      } else {
        q = q.eq("branch_id", staff.branch_id!);
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
        const { data: assignee } = await db.from("staff").select("branch_id").eq("id", assignedToStaffId).single();
        if (!assignee || assignee.branch_id !== staff.branch_id) return err("Can only assign tasks to staff in your branch");
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

    if (action === "list_staff_attendance") {
      if (!isOwner(staff)) return err("Owner only", 403);
      const targetDate = payload?.date || todayISO();

      const { data: allStaff } = await db.from("staff").select("id, username, display_name, branch_id, is_active, branches(name)")
        .eq("is_active", true).order("display_name");
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
      await db.from("alerts").update({ status: "resolved" }).eq("id", alertId);
      return json({ ok: true });
    }

    // ─── ACTIONABLE ITEMS ───
    if (action === "get_actionable_items") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const today = todayISO();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone, course)")
        .eq("branch_id", branchId).eq("is_active", true).lte("due_date", today).gt("fee_due", 0);

      const { data: expiringSoon } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true)
        .gte("end_date", today).lte("end_date", addMonths(today, 0));

      const { data: overdueLockers } = await db.from("lockers").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("locker_due_date", today);

      return json({ dueToday: dueToday ?? [], expiringSoon: expiringSoon ?? [], overdueLockers: overdueLockers ?? [] });
    }

    // ─── TODAY'S BOOKINGS ───
    if (action === "list_today_bookings") {
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const today = todayISO();
      const { data, error: bErr } = await db.from("bookings")
        .select("*, students(name, phone, course), desks!desk_id(label, seat_type), memberships:membership_id(total_paid, fee_due, monthly_fee, category)")
        .eq("branch_id", branchId)
        .eq("status", "active")
        .gte("created_at", today + "T00:00:00Z")
        .lte("created_at", today + "T23:59:59Z")
        .order("created_at", { ascending: false });
      if (bErr) return err(bErr.message);

      const bookingIds = (data ?? []).map(b => b.id);
      const { data: foodBills } = bookingIds.length
        ? await db.from("food_bills").select("booking_id, total").in("booking_id", bookingIds)
        : { data: [] };
      const foodTotals = new Map<string, number>();
      for (const fb of foodBills ?? []) {
        foodTotals.set(fb.booking_id, (foodTotals.get(fb.booking_id) ?? 0) + Number(fb.total));
      }

      const bookings = (data ?? []).map(b => ({ ...b, foodTotal: foodTotals.get(b.id) ?? 0 }));
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
      }));
      return json({ members });
    }

    // ─── RENEW MEMBERSHIP ───
    if (action === "renew_membership") {
      const { membershipId, monthsPaid, paymentMode, advanceAmount } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const months = Number(monthsPaid) || 1;
      const monthlyFee = await getMembershipPackage(db, Number(mem.hours_per_day), mem.category);
      if (!monthlyFee) return err("Invalid membership package");

      const discount = multiMonthDiscount(months);
      const gross = monthlyFee * months;
      const totalFee = gross * (1 - discount / 100);
      const feePaid = advanceAmount != null ? Number(advanceAmount) : totalFee;
      const feeDue = Math.max(totalFee - feePaid, 0);

      const today = todayISO();
      const startDate = mem.end_date < today ? today : mem.end_date;
      const endDate = addMonths(startDate, months);
      const dueDate = addMonths(startDate, 1);
      const monthLabel = new Date(startDate).toLocaleString("en-US", { month: "long", year: "numeric" });

      const { data: newMem, error: mErr } = await db.from("memberships").insert({
        student_id: mem.student_id, branch_id: mem.branch_id,
        category: mem.category, seat_type: mem.seat_type,
        desk_id: mem.desk_id, cabin_no: mem.cabin_no,
        month: monthLabel, hours_per_day: mem.hours_per_day,
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
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, membershipId: newMem!.id });
    }

    // ─── CLOSE MEMBERSHIP ───
    if (action === "get_membership_closure_summary") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();

      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);

      return json({
        membershipDue, lockerDue, totalDue: membershipDue + lockerDue,
        canClose: membershipDue <= 0 && lockerDue <= 0,
        locker: locker ?? null,
      });
    }

    if (action === "close_membership") {
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      if (Number(mem.fee_due ?? 0) > 0) {
        return err(`This membership still has ₹${Number(mem.fee_due)} pending — clear it before closing.`);
      }
      const { data: locker } = await db.from("lockers").select("fee_due")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      if (locker && Number(locker.fee_due ?? 0) > 0) {
        return err(`This student's locker still has ₹${Number(locker.fee_due)} pending — clear it before closing.`);
      }

      await db.from("memberships").update({ is_active: false }).eq("id", membershipId);

      // Release reserved desk if permanent
      if (mem.desk_id) {
        await db.from("desks").update({
          status: "free", seat_type: "floating", assigned_student_id: null,
        }).eq("id", mem.desk_id);
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true });
    }

    return err(`Unknown action: ${action}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
});
