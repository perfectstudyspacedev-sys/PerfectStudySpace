// Dashboard and reports. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addDays, istDayEnd, istDayStart, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { buildDateBuckets, dateRange, fetchAllRows, formatISTSession } from "../lib.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── DASHBOARD ───
    get_dashboard: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
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
        .gte("created_at", istDayStart(today)).lte("created_at", istDayEnd(today));

      const { data: alerts } = await db.from("alerts").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("status", "pending").order("due_date").limit(10);

      // Not just "due/expired exactly today" — any membership that's overdue and hasn't
      // been settled/renewed yet should keep showing up until it's dealt with.
      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lte("due_date", today).gt("fee_due", 0);

      const { data: expiredToday } = await db.from("memberships").select("*, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true).lt("end_date", today);

      // By when the session started, not when the row was written — past attendance added
      // from a student's profile today would otherwise count as someone who came in today.
      const { count: checkedInToday } = await db.from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .gte("start_time", istDayStart(today)).lte("start_time", istDayEnd(today));

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
        actionable: {
          dueToday: dueToday ?? [],
          expiredToday: expiredToday ?? [],
        },
      });
    },
    // Full activity feed branch-wide, newest first — every new booking/check-in, every new
    // membership, and every payment-related transaction (walk-in fee, membership payment,
    // food, locker, overtime), merged into one timeline. Moved off the Dashboard onto the
    // Reports page as its own lightweight action so Reports doesn't need the full
    // get_dashboard payload just to show this feed.
    get_recent_activity: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, date, period, dateFrom, dateTo } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      // Same range logic as get_daily_report — staff only ever see a single day; the
      // owner's Day/Week/Month/Custom picker at the top of Reports scopes this too.
      const range = period && isOwnerOrAdmin(staff) ? dateRange(period, dateFrom, dateTo) : { from: date ?? todayISO(), to: date ?? todayISO() };
      const fromTs = istDayStart(range.from);
      const toTs = istDayEnd(range.to);
      // Instant bounds for the in-JS re-check below (fromTs/toTs carry +05:30 while DB
      // timestamps come back as Z, so they must be compared as parsed instants, not strings).
      const fromMs = new Date(fromTs).getTime();
      const toMs = new Date(toTs).getTime();

      const [{ data: recentBookings }, { data: recentMemberships }, { data: recentTxns }, { data: recentCashbacks }, { data: recentPayouts }] = await Promise.all([
        db.from("bookings").select("id, booking_type, status, created_at, start_time, end_time, students(name, phone)")
          .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs),
        db.from("memberships").select("id, category, total_paid, created_at, students(name, phone)")
          .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs),
        db.from("transactions").select("id, category, amount, payment_mode, created_at, students(name, phone)")
          .eq("branch_id", branchId).gte("created_at", fromTs).lte("created_at", toTs),
        // Granted and redeemed/settled can each fall in range independently of one
        // another, so fetch anything touched (created OR redeemed) within the window.
        db.from("cashbacks").select("id, cashback_type, cashback_value, status, redeemed_amount, created_at, redeemed_at, students(name, phone)")
          .eq("branch_id", branchId)
          .or(`and(created_at.gte.${fromTs},created_at.lte.${toTs}),and(redeemed_at.gte.${fromTs},redeemed_at.lte.${toTs})`),
        db.from("payouts").select("id, payout_type, amount, created_at, students(name, phone)")
          .eq("branch_id", branchId).eq("payout_type", "membership_refund")
          .gte("created_at", fromTs).lte("created_at", toTs),
      ]);

      const cashbackFeed: Record<string, unknown>[] = [];
      for (const c of recentCashbacks ?? []) {
        const valueLabel = c.cashback_type === "percent" ? `${c.cashback_value}%` : `₹${Number(c.cashback_value)}`;
        if (new Date(c.created_at).getTime() >= fromMs && new Date(c.created_at).getTime() <= toMs) {
          cashbackFeed.push({
            id: `cashback-grant-${c.id}`, kind: "cashback", label: `Cashback granted (${valueLabel})`,
            studentName: c.students?.name, studentPhone: c.students?.phone,
            time: c.created_at, status: "pending", amount: c.cashback_type === "fixed" ? Number(c.cashback_value) : null,
          });
        }
        if (c.redeemed_at && c.status !== "pending" && new Date(c.redeemed_at).getTime() >= fromMs && new Date(c.redeemed_at).getTime() <= toMs) {
          cashbackFeed.push({
            id: `cashback-${c.status}-${c.id}`, kind: "cashback", label: `Cashback ${c.status}`,
            studentName: c.students?.name, studentPhone: c.students?.phone,
            time: c.redeemed_at, status: c.status, amount: c.redeemed_amount != null ? Number(c.redeemed_amount) : null,
          });
        }
      }

      const feed = [
        ...(recentBookings ?? []).map(b => ({
          id: `booking-${b.id}`, kind: "booking", label: b.booking_type,
          studentName: b.students?.name, studentPhone: b.students?.phone,
          time: b.created_at, status: b.status, amount: null,
          // A row written after its own session had already ended was typed in from the
          // student's profile (Add Attendance), not a live check-in — a live one is created
          // at check-in and only gets its end_time at checkout, later. Without this, ten past
          // days entered back to back read as ten check-ins minutes apart.
          manual: b.status === "completed" && !!b.end_time && new Date(b.created_at).getTime() > new Date(b.end_time).getTime(),
          sessionLabel: formatISTSession(b.start_time, b.end_time ?? undefined),
        })),
        ...(recentMemberships ?? []).map(m => ({
          id: `membership-${m.id}`, kind: "membership", label: `New ${m.category} membership`,
          studentName: m.students?.name, studentPhone: m.students?.phone,
          time: m.created_at, status: null, amount: Number(m.total_paid),
        })),
        ...(recentTxns ?? []).map(t => ({
          id: `transaction-${t.id}`, kind: "transaction", label: t.category,
          studentName: t.students?.name, studentPhone: t.students?.phone,
          time: t.created_at, status: t.payment_mode, amount: Number(t.amount),
        })),
        ...cashbackFeed,
        ...(recentPayouts ?? []).map(p => ({
          id: `payout-${p.id}`, kind: "membership_refund", label: "Membership deleted — refund",
          studentName: p.students?.name, studentPhone: p.students?.phone,
          time: p.created_at, status: "refunded", amount: -Number(p.amount),
        })),
      ].sort((a: { time: string }, b: { time: string }) => b.time.localeCompare(a.time));

      return json({ recentActivity: feed });
    },
    get_top_students: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, sortBy, period } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);

      if (period === "month") {
        // First of the current IST month (todayISO() is already IST), not the server's UTC month.
        const monthStart = `${todayISO().slice(0, 7)}-01`;
        // Sessions that happened this month (start_time) — not rows typed in this month, which
        // would credit a backfilled last-month session to this month's leaderboard.
        const { data: bookings } = await db.from("bookings")
          .select("student_id, hours, students(id, name, phone, course)")
          .eq("branch_id", branchId).gte("start_time", istDayStart(monthStart));
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
    },
    get_referral_stats: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let branchFilter: string[] = [];
      if (allBranches && isOwnerOrAdmin(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }

      // All-time (not tied to the Revenue page's period picker) — paged, since a plain select
      // stopped counting at the 1000-row response cap once the student base grew past it.
      const [students, { count: notRecorded, error: notRecordedErr }] = await Promise.all([
        fetchAllRows<{ referral_source: string }>(() => db.from("students").select("referral_source")
          .in("branch_id", branchFilter).not("referral_source", "is", null).order("id")),
        db.from("students").select("id", { count: "exact", head: true })
          .in("branch_id", branchFilter).is("referral_source", null),
      ]);
      if (notRecordedErr) return err(notRecordedErr.message, 500);
      const counts: Record<string, number> = {};
      for (const s of students) {
        const key = s.referral_source || "unknown";
        counts[key] = (counts[key] ?? 0) + 1;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const rows = Object.entries(counts)
        .map(([source, count]) => ({ source, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 }))
        .sort((a, b) => b.count - a.count);

      return json({ rows, total, notRecorded: notRecorded ?? 0 });
    },
    get_daily_report: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, date, period, dateFrom, dateTo, allBranches } = payload;

      let branchFilter: string[] = [];
      if (allBranches && isOwnerOrAdmin(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        branchFilter = [branchId];
      }

      // Staff only ever see a single day; the owner can additionally pick week/month/custom
      // (period-based) to see the same stats aggregated over a range.
      const range = period && isOwnerOrAdmin(staff) ? dateRange(period, dateFrom, dateTo) : { from: date ?? todayISO(), to: date ?? todayISO() };
      const fromTs = istDayStart(range.from);
      const toTs = istDayEnd(range.to);

      const { data: walkins } = await db.from("bookings").select("*, students(name)")
        .in("branch_id", branchFilter).eq("booking_type", "walkin")
        .gte("created_at", fromTs).lte("created_at", toTs);

      const { data: newMembers } = await db.from("memberships").select("*, students(name)")
        .in("branch_id", branchFilter).gte("created_at", fromTs).lte("created_at", toTs);

      // Attendance breakdown over the range — how many sessions were temporary vs permanent
      // members vs plain walk-ins, counted by distinct student (not by session, so a member
      // who split their day into two sessions only counts once). With allBranches this
      // dedupes org-wide too — a student who visited two branches the same day (a "cross-
      // branch visit") is one person, counted once in the combined total. Ranged on
      // start_time (when they attended), not created_at (when the row was written) — past
      // attendance added from a profile would otherwise land on the day it was typed in.
      const { data: rangeBookingsRaw } = await db.from("bookings").select("student_id, booking_type, start_time, branch_id, branches(name)")
        .in("branch_id", branchFilter).gte("start_time", fromTs).lte("start_time", toTs);
      const rangeBookings = (rangeBookingsRaw ?? []) as { student_id: string; booking_type: string; start_time: string; branch_id: string; branches: { name: string } | null }[];
      const attendanceBreakdown = {
        temporary: new Set(rangeBookings.filter(b => b.booking_type === "temporary").map(b => b.student_id)).size,
        permanent: new Set(rangeBookings.filter(b => b.booking_type === "permanent").map(b => b.student_id)).size,
        walkin: new Set(rangeBookings.filter(b => b.booking_type === "walkin").map(b => b.student_id)).size,
        total: new Set(rangeBookings.map(b => b.student_id)).size,
      };

      // Active memberships right now (not "new in range" — currently valid, any branch in
      // scope) — the "how many memberships are in use" number the owner actually wants
      // alongside the attendance breakdown above.
      const { data: activeMembershipRows } = await db.from("memberships")
        .select("branch_id").in("branch_id", branchFilter).eq("is_active", true).gte("end_date", todayISO());
      const activeMemberships = (activeMembershipRows ?? []).length;

      // Per-branch breakdown — only meaningful (and only computed) once more than one branch
      // is in view, same convention as get_revenue's byBranch.
      let byBranch: { name: string; total: number; activeMemberships: number }[] = [];
      if (branchFilter.length > 1) {
        const byBranchIdMap: Record<string, { name: string; students: Set<string> }> = {};
        for (const b of rangeBookings) {
          const key = b.branch_id;
          if (!byBranchIdMap[key]) byBranchIdMap[key] = { name: b.branches?.name ?? "Unknown", students: new Set() };
          byBranchIdMap[key].students.add(b.student_id);
        }
        const activeMembershipCounts: Record<string, number> = {};
        for (const m of activeMembershipRows ?? []) activeMembershipCounts[m.branch_id] = (activeMembershipCounts[m.branch_id] ?? 0) + 1;
        const allBranchIds = new Set([...Object.keys(byBranchIdMap), ...Object.keys(activeMembershipCounts)]);
        const { data: branchNameRows } = await db.from("branches").select("id, name").in("id", [...allBranchIds]);
        const nameById = new Map(branchNameRows?.map(b => [b.id, b.name]) ?? []);
        byBranch = [...allBranchIds]
          .map(id => ({
            name: byBranchIdMap[id]?.name ?? nameById.get(id) ?? "Unknown",
            total: byBranchIdMap[id]?.students.size ?? 0,
            activeMemberships: activeMembershipCounts[id] ?? 0,
          }))
          .sort((a, b) => b.total - a.total);
      }

      // New registrations — brand-new students created at this branch (or every branch, with
      // allBranches) in the range (membership or walk-in, whichever brought them in first).
      const { count: newRegistrations } = await db.from("students")
        .select("*", { count: "exact", head: true }).in("branch_id", branchFilter)
        .gte("created_at", fromTs).lte("created_at", toTs);

      // Trend charts (owner, non-single-day views only) — attendance and new-membership
      // registrations bucketed day-by-day, every date shown separately (never combined into
      // week-range buckets), so the owner can see day-on-day movement at a glance.
      let attendanceTrend = null;
      let registrationsTrend = null;
      if (isOwnerOrAdmin(staff) && period && period !== "day") {
        const buckets = buildDateBuckets(range.from, range.to, "day");
        attendanceTrend = buckets.map(b => ({
          label: b.label,
          count: new Set(
            rangeBookings.filter(r => { const d = toISTDateStr(r.start_time); return d >= b.start && d <= b.end; }).map(r => r.student_id),
          ).size,
        }));
        registrationsTrend = buckets.map(b => ({
          label: b.label,
          count: (newMembers ?? []).filter((m: { created_at: string }) => { const d = toISTDateStr(m.created_at); return d >= b.start && d <= b.end; }).length,
        }));
      }

      return json({
        date: range.to, dateFrom: range.from, dateTo: range.to,
        walkins, newMembers, attendanceTrend, registrationsTrend,
        attendanceBreakdown, newRegistrations: newRegistrations ?? 0,
        activeMemberships, byBranch,
      });
    },
    // ─── ACTIONABLE ITEMS ───
    get_actionable_items: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let branchFilter: string[] = [];
      if (allBranches && isOwnerOrAdmin(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        branchFilter = [branchId];
      }
      const today = todayISO();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

      // Any outstanding balance is actionable, regardless of due_date — due_date is always
      // set a month out even on a same-day partial payment, so gating on it would hide a
      // real balance for a full month.
      const { data: dueToday } = await db.from("memberships").select("*, students(name, phone, course), branches(name)")
        .in("branch_id", branchFilter).eq("is_active", true).gt("fee_due", 0);

      const { data: expiringSoon } = await db.from("memberships").select("*, students(name, phone), branches(name)")
        .in("branch_id", branchFilter).eq("is_active", true)
        .gte("end_date", today).lte("end_date", addDays(today, 7));

      const { data: expiredMemberships } = await db.from("memberships").select("*, students(name, phone), branches(name)")
        .in("branch_id", branchFilter).eq("is_active", true).lt("end_date", today);

      const { data: overdueLockers } = await db.from("lockers").select("*, students(name, phone), branches(name)")
        .in("branch_id", branchFilter).eq("is_active", true).lt("locker_due_date", today);

      return json({
        dueToday: dueToday ?? [], expiringSoon: expiringSoon ?? [],
        expiredMemberships: expiredMemberships ?? [], overdueLockers: overdueLockers ?? [],
      });
    },
  };
  return h;
}
