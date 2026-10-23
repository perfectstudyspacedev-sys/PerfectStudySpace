// Check-in, walk-ins, attendance, checkout and study reports. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { IST_OFFSET_MS, daysBetween, istDayEnd, istDayStart, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { MEMBERSHIP_GRACE_DAYS } from "../../_shared/membership.ts";
import { OVERTIME_GRACE_MINUTES, computeOvertimeCharge } from "../../_shared/overtime.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { claimRelease, memberArrives, recordResale, unclaimRelease } from "./seats.ts";
import { walkinPrice } from "./pricing.ts";
import { STUDY_REPORT_MAX_DAYS, fetchAllRows, findOverlappingSession, formatISTSession, insertPaymentTransactions, isISODate, recordTransaction, splitPaymentError, storedPaymentMode, upsertStudent } from "../lib.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── WALK-IN ───
    create_walkin: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, name, phone, hours, paymentMode, cashAmount, upiAmount, startTime: startTimeStr, deskId: manualDeskId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name || !phone || !hours) return err("Name, phone, and hours required");

      // A walk-in by someone who already holds a membership must leave that member's record
      // alone. upsertStudent re-homes a student to whichever branch the call came from and
      // renames them to whatever was typed — so a member dropping into another branch for a
      // day got moved there: their own cabin then read as a cross-branch visit (no cabin at
      // check-in) and their home branch lost access to their profile. Walk-in-only students
      // still follow the branch they visit, as before.
      // Fee first (a read), so a split that doesn't add up is refused before anything is written.
      // PSS-AI I3: with pssai_yield_pricing on, today's price change for this branch applies (always
      // within ±20% of fee_config, C8); off, this is the fee_config price exactly as before. The
      // modal sends the price it showed; a price that changed in between is refused, not charged.
      const { amount } = await walkinPrice(db, branchId, Number(hours));
      if (payload.expectedAmount != null && Math.abs(Number(payload.expectedAmount) - amount) > 0.001) {
        return err(`The walk-in price is now ₹${amount} — check it and try again`, 409);
      }
      const splitErr = splitPaymentError(paymentMode, amount, cashAmount, upiAmount);
      if (splitErr) return err(splitErr);

      // PSS-AI O1/SP10: hours of a member's cabin sold to this walk-in. Claimed before anything is
      // written, so two desks can never sell the same hours.
      const startTime = startTimeStr ? new Date(startTimeStr).toISOString() : new Date().toISOString();
      const endTime = new Date(new Date(startTime).getTime() + Number(hours) * 3600000).toISOString();
      let release: any = null;
      if (payload.releaseId) {
        if (manualDeskId) return err("Choose either a desk or released hours, not both");
        const claim = await claimRelease(ctx, payload.releaseId, branchId, startTime, endTime);
        if ("error" in claim) return err(claim.error as string, 409);
        release = claim.release;
      }

      const { data: phoneOwner } = await db.from("students").select("id").eq("phone", phone).maybeSingle();
      const { count: ownerActiveMemberships } = phoneOwner
        ? await db.from("memberships").select("*", { count: "exact", head: true }).eq("student_id", phoneOwner.id).eq("is_active", true)
        : { count: 0 };
      const isExistingMember = !!phoneOwner && (ownerActiveMemberships ?? 0) > 0;
      const { id: studentId, isNew: isNewStudent } = isExistingMember
        ? { id: phoneOwner!.id, isNew: false }
        : await upsertStudent(db, name, phone, branchId);

      // Desk is optional for walk-ins — staff no longer assigns a desk
      let desk = null;
      if (manualDeskId) {
        const { data: d } = await db.from("desks").select("*").eq("id", manualDeskId).eq("branch_id", branchId).single();
        if (!d || d.status !== "free") return err("Selected desk is not available");
        desk = d;
      }

      // startTimeStr is a full UTC ISO string sent by the frontend after local→UTC conversion
      // (startTime and endTime are worked out above, before the release claim).
      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: desk?.id ?? release?.desk_id ?? null,
        booking_type: "walkin", start_time: startTime, end_time: endTime,
        hours: Number(hours), scheduled_hours: Number(hours), amount, status: "active",
        payment_mode: storedPaymentMode(paymentMode), created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) {
        if (release) await unclaimRelease(db, release.id);
        return err(bErr.message);
      }

      if (desk) {
        await db.from("desks").update({ status: "occupied", current_booking_id: booking!.id }).eq("id", desk.id);
      }
      if (release) await recordResale(ctx, release, { id: booking!.id, start: startTime, end: endTime }, amount);
      await insertPaymentTransactions(db, {
        student_id: studentId, branch_id: branchId, booking_id: booking!.id,
        category: "desk", created_by_staff_id: staff.id,
      }, paymentMode, amount, cashAmount, upiAmount);
      const { data: st } = await db.from("students").select("total_visits, total_hours_studied").eq("id", studentId).single();
      await db.from("students").update({
        total_visits: (st?.total_visits ?? 0) + 1,
        total_hours_studied: Number(st?.total_hours_studied ?? 0) + Number(hours),
        // A member's status comes from their membership (dues, expiry) — a paid walk-in
        // doesn't make a member with pending dues "active".
        ...(isExistingMember ? {} : { status: "active" }),
      }).eq("id", studentId);

      return json({ booking: { ...booking, deskLabel: desk?.label ?? release?.desks?.label ?? null, amount, studentName: name }, isNewStudent });
    },
    // ─── MEMBERSHIP ───
    // Study-report WhatsApp message (Active Members 💬): every session in the chosen dates. A
    // dedicated action because get_student_profile only returns a student's latest 100 bookings,
    // which would silently drop days from an older or longer range.
    get_student_study_report: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, dateFrom, dateTo } = payload;
      if (!isISODate(dateFrom) || !isISODate(dateTo)) return err("Pick a start date and an end date");
      if (dateFrom > dateTo) return err("The start date must be on or before the end date");
      if (dateTo > todayISO()) return err("The end date can't be in the future");
      if (daysBetween(dateFrom, dateTo) + 1 > STUDY_REPORT_MAX_DAYS) {
        return err(`Pick a period of at most ${STUDY_REPORT_MAX_DAYS} days`);
      }
      const { data: student } = await db.from("students").select("id, name, branch_id").eq("id", studentId).maybeSingle();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);

      const fromTs = istDayStart(dateFrom);
      const toTs = istDayEnd(dateTo);
      const rows = await fetchAllRows<{ id: string; start_time: string; end_time: string | null; status: string }>(() =>
        db.from("bookings").select("id, start_time, end_time, status")
          .eq("student_id", studentId).neq("status", "cancelled")
          .gte("start_time", fromTs).lte("start_time", toTs)
          .order("start_time").order("id"));
      return json({
        studentName: student.name, dateFrom, dateTo,
        bookings: rows.map((b) => ({ start_time: b.start_time, end_time: b.end_time, status: b.status })),
      });
    },
    // ─── MEMBER CHECK-IN (attendance) ───
    check_in_member: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
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
        const daysSinceExpiry = daysBetween(membership.end_date, today);
        if (daysSinceExpiry > MEMBERSHIP_GRACE_DAYS) {
          const dueAmount = Number(membership.fee_due);
          if (dueAmount > 0) {
            return err(`Dues not cleared (₹${dueAmount} pending) even ${daysSinceExpiry} days after membership expiration — the ${MEMBERSHIP_GRACE_DAYS}-day grace period is over. Please clear dues and renew before checking in.`);
          }
          return err(`Membership expired ${daysSinceExpiry} days ago — the ${MEMBERSHIP_GRACE_DAYS}-day grace period is over. Please renew before checking in.`);
        }
      }

      // Can't check in twice at once — but a member CAN split their daily hour quota across
      // multiple sessions the same day (e.g. 3h morning + 3h evening on a 6h/day plan), as
      // long as they've checked out of the previous one first.
      const { data: activeToday } = await db.from("bookings").select("id")
        .eq("student_id", studentId)
        .in("booking_type", ["temporary", "permanent"])
        .eq("status", "active")
        .maybeSingle();
      if (activeToday) return err("Student is already checked in — check them out first");

      // Sum actual time already used today (completed sessions' real duration, since end_time
      // is stamped with the true checkout time) to figure out how much of the daily quota
      // remains for a possible additional split session. Keyed on start_time, not created_at:
      // a past day's attendance added from the profile today is created today, and counting
      // it here used to block the student's real check-in with "quota already used".
      const { data: todaysSessions } = await db.from("bookings").select("start_time, end_time")
        .eq("student_id", studentId)
        .in("booking_type", ["temporary", "permanent"])
        .eq("status", "completed")
        .gte("start_time", istDayStart(today))
        .lte("start_time", istDayEnd(today));
      const usedMinutesToday = (todaysSessions ?? []).reduce((sum: number, b: { start_time: string; end_time: string }) => {
        return sum + Math.max(0, (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60_000);
      }, 0);
      // A custom-plan membership (hours_per_day_weekend set) gets a different daily quota
      // on Sat/Sun than on weekdays — everyone else's hours_per_day applies every day.
      const istDayOfWeek = new Date(Date.now() + IST_OFFSET_MS).getUTCDay();
      const isWeekendToday = istDayOfWeek === 0 || istDayOfWeek === 6;
      const effectiveHoursPerDay = isWeekendToday && membership.hours_per_day_weekend != null
        ? Number(membership.hours_per_day_weekend)
        : Number(membership.hours_per_day);

      const remainingMinutes = effectiveHoursPerDay * 60 - usedMinutesToday;
      if (remainingMinutes <= 0) {
        return err(`Daily quota of ${effectiveHoursPerDay}h has already been used today (split across earlier sessions).`);
      }

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
      // PSS-AI O1/SP10: a permanent member arriving while hours of their cabin are on sale or sold.
      let collision: { kind: string; credit: number; message: string } | null = null;
      let fallbackDesk = false;
      if (desk && membership.category === "permanent" && !isCrossBranchVisit) {
        const arrival = await memberArrives(ctx, membership, desk);
        if (arrival?.collision) { collision = arrival.collision; desk = arrival.desk; fallbackDesk = !!arrival.desk; }
      }

      // startTimeStr is a full UTC ISO string sent by the frontend after local→UTC conversion
      const checkInTime = startTimeStr ? new Date(startTimeStr).toISOString() : new Date().toISOString();
      const sessionHours = remainingMinutes / 60;
      const endTime = new Date(new Date(checkInTime).getTime() + remainingMinutes * 60_000).toISOString();
      const bookingType = membership.category === "permanent" ? "permanent" : "temporary";

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: desk?.id ?? null,
        membership_id: membership.id, booking_type: bookingType,
        start_time: checkInTime, end_time: endTime,
        hours: sessionHours, scheduled_hours: sessionHours, amount: 0, status: "active",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      // Update desk status if a desk was assigned
      if (desk) {
        if (membership.category === "permanent" && !fallbackDesk) {
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
      // The [cross_branch] tag lets the frontend's notification hook (useMessageAlerts)
      // recognize this as a distinct alert type — its own icon/title — instead of showing
      // up as an indistinguishable generic chat message.
      if (isCrossBranchVisit) {
        const { data: currentBranch } = await db.from("branches").select("name").eq("id", branchId).single();
        await db.from("messages").insert({
          branch_id: student.branch_id, sender_staff_id: staff.id, recipient_type: "staff",
          content: `[cross_branch] ${student.name} (home branch) checked in at ${currentBranch?.name ?? "another branch"} today.`,
        });
      }

      return json({
        ok: true, bookingId: booking!.id, deskLabel: desk?.label ?? null, endTime,
        expiredMembership: isExpiredMembership, crossBranchVisit: isCrossBranchVisit, ...(collision ? { collision } : {}),
        sessionHours: Math.round(sessionHours * 100) / 100,
        isSplitSession: usedMinutesToday > 0,
      });
    },
    // Edit a student's attendance record (check-in time / check-out time / hours / status) —
    // corrects mistakes like a wrong check-in or checkout time punched in by staff. Available
    // to both staff (their own branch) and owner (any branch). If an explicit endTime is given
    // it wins (and hours is derived from the gap); otherwise hours (or the existing hours) is
    // used to derive the end time, same as before.
    update_attendance: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { bookingId, startTime, endTime, hours, status, scheduledHours } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Attendance record not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      // The originally booked/allotted session length — a stable baseline for recomputing
      // overtime that survives repeated edits. Deliberately read from scheduled_hours, NOT
      // the mutable `hours` column: `hours` gets overwritten below with the actual total
      // duration, so on a *second* edit it would no longer reflect the true original session
      // length, silently corrupting the overtime baseline. scheduled_hours is set once at
      // booking creation and never touched again — except here: an explicit scheduledHours
      // in the payload is a deliberate staff correction (e.g. a row whose scheduled_hours
      // was itself corrupted before this baseline existed), the one legitimate way to change it.
      const originalBookedHours = scheduledHours !== undefined && scheduledHours !== null && scheduledHours !== ""
        ? Number(scheduledHours)
        : Number(booking.scheduled_hours ?? booking.hours ?? 0);

      const newStartTime = startTime ? new Date(startTime).toISOString() : booking.start_time;
      let newEndTime: string;
      let newHours: number;
      if (endTime) {
        newEndTime = new Date(endTime).toISOString();
        if (new Date(newEndTime).getTime() <= new Date(newStartTime).getTime()) {
          return err("Check-out time must be after check-in time");
        }
        newHours = Math.round(((new Date(newEndTime).getTime() - new Date(newStartTime).getTime()) / 3_600_000) * 100) / 100;
      } else {
        newHours = hours !== undefined && hours !== null && hours !== "" ? Number(hours) : Number(booking.hours ?? 0);
        // end_time carries every finished break (resume_session extends it), so rebuilding it
        // from start + hours alone would silently hand those break minutes back as study time.
        newEndTime = new Date(
          new Date(newStartTime).getTime() + newHours * 3_600_000 + Number(booking.total_pause_minutes ?? 0) * 60_000,
        ).toISOString();
      }
      const newStatus = status || booking.status;

      // Only a completed session has a real end to compare — an active one's end_time is
      // just the scheduled end, and its own overlap is already prevented by the one-active-
      // session rule at check-in.
      if (newStatus === "completed") {
        const clash = await findOverlappingSession(db, booking.student_id, newStartTime, newEndTime, bookingId);
        if (clash) {
          return err(clash.status === "active"
            ? `These times overlap the session they're checked into right now (since ${formatISTSession(clash.start_time)}).`
            : `These times overlap another attendance record (${formatISTSession(clash.start_time, clash.end_time)}) — adjust them so the two don't overlap.`);
        }
      }

      await db.from("bookings").update({
        start_time: newStartTime, end_time: newEndTime, hours: newHours, status: newStatus,
        scheduled_hours: originalBookedHours,
      }).eq("id", bookingId);

      // Log the correction to the same Edit History a cabin/end-date edit shows up in — a
      // member session's start/end time only, since membership_edits.membership_id is
      // NOT NULL and a walk-in booking has none.
      if (booking.membership_id && (newStartTime !== booking.start_time || newEndTime !== booking.end_time)) {
        await db.from("membership_edits").insert({
          membership_id: booking.membership_id, student_id: booking.student_id, branch_id: booking.branch_id,
          edit_type: "attendance",
          old_value: JSON.stringify({ start: booking.start_time, end: booking.end_time }),
          new_value: JSON.stringify({ start: newStartTime, end: newEndTime }),
          changed_by_staff_id: staff.id,
        });
      }

      const hoursDelta = newHours - Number(booking.hours ?? 0);
      if (hoursDelta !== 0) {
        const { data: st } = await db.from("students").select("total_hours_studied").eq("id", booking.student_id).single();
        await db.from("students").update({
          total_hours_studied: Math.max(0, Number(st?.total_hours_studied ?? 0) + hoursDelta),
        }).eq("id", booking.student_id);
      }

      // Recompute overtime against the corrected times — scheduled end is derived from the
      // *original* booked length (not the just-recomputed total-duration newHours), same
      // basis checkout_booking used when it first logged this booking's overtime.
      let overtimeAlreadyBilled = false;
      if (booking.status === "completed" || newStatus === "completed") {
        const scheduledEndMs = new Date(newStartTime).getTime() + originalBookedHours * 3_600_000;
        const otMinutes = Math.max(0, Math.round((new Date(newEndTime).getTime() - scheduledEndMs) / 60_000));
        const isWalkinBooking = booking.booking_type === "walkin";

        // The 10-hour/₹100 cap is walk-in-only (total visit hours vs. total visit cost) — for
        // a member, bookedHoursForCap=0 makes the cap trigger purely on overtimeHours itself.
        const bookedHoursForCap = isWalkinBooking ? originalBookedHours : 0;
        const baseFee = isWalkinBooking ? Number(booking.amount) : 0;
        const isWalkinThreeHour = isWalkinBooking && originalBookedHours === 3;
        const { overtimeCharge } = computeOvertimeCharge(otMinutes, bookedHoursForCap, baseFee, isWalkinThreeHour);

        // .maybeSingle() would silently return nothing (not an error) if more than one row
        // ever matched — risking a duplicate insert on top of stale rows instead of updating
        // in place. Fetching as a list and taking the first is robust either way.
        if (isWalkinBooking) {
          // Every step here is checked: a failed lookup used to read as "no overtime row yet"
          // and insert a second charge, and a failed update/delete left the old amount in
          // Revenue while the attendance edit reported success.
          const { data: existingTxns, error: otLookupErr } = await db.from("transactions").select("id, amount")
            .eq("booking_id", bookingId).eq("category", "overtime").order("created_at", { ascending: true });
          if (otLookupErr) return err(`Attendance saved, but the overtime charge couldn't be checked: ${otLookupErr.message}`, 500);
          const existingTxn = existingTxns?.[0];
          if (existingTxn) {
            const { error: otWriteErr } = overtimeCharge > 0
              ? await db.from("transactions").update({ amount: overtimeCharge }).eq("id", existingTxn.id)
              : await db.from("transactions").delete().eq("id", existingTxn.id);
            if (otWriteErr) return err(`Attendance saved, but the overtime charge couldn't be updated: ${otWriteErr.message}`, 500);
          } else if (overtimeCharge > 0) {
            await recordTransaction(db, {
              student_id: booking.student_id, branch_id: booking.branch_id,
              booking_id: bookingId, category: "overtime", amount: overtimeCharge,
              payment_mode: booking.payment_mode ?? "cash",
              notes: "Overtime recomputed after editing attendance", created_by_staff_id: staff.id,
            });
          }

          // Keep the history row (added at checkout, see checkout_booking) in sync with the
          // same recomputed numbers — a walk-in's overtime money is always adjusted directly
          // above (no billed-money-already-changed-hands guard needed, unlike members), so
          // this just mirrors that same update/insert/delete.
          const { data: existingOtRows } = await db.from("overtime_sessions").select("id")
            .eq("booking_id", bookingId).order("created_at", { ascending: true });
          const existingOtRow = existingOtRows?.[0];
          if (existingOtRow) {
            if (otMinutes > OVERTIME_GRACE_MINUTES) {
              await db.from("overtime_sessions").update({
                overtime_minutes: otMinutes, billed_amount: overtimeCharge,
              }).eq("id", existingOtRow.id);
            } else {
              await db.from("overtime_sessions").delete().eq("id", existingOtRow.id);
            }
          } else if (otMinutes > OVERTIME_GRACE_MINUTES) {
            await db.from("overtime_sessions").insert({
              booking_id: bookingId, student_id: booking.student_id, membership_id: null,
              branch_id: booking.branch_id, overtime_minutes: otMinutes,
              session_date: todayISO(), billed_amount: overtimeCharge,
              billed_at: new Date().toISOString(),
            });
          }
        } else {
          const { data: existingRows } = await db.from("overtime_sessions").select("id, billed_at")
            .eq("booking_id", bookingId).order("created_at", { ascending: true });
          const existingRow = existingRows?.[0];
          if (existingRow) {
            if (existingRow.billed_at) {
              // Already collected/settled — leave the historical record alone rather than
              // rewrite money that's already changed hands; just flag it in the response.
              overtimeAlreadyBilled = true;
            } else if (otMinutes > OVERTIME_GRACE_MINUTES) {
              await db.from("overtime_sessions").update({
                overtime_minutes: otMinutes, billed_amount: overtimeCharge,
              }).eq("id", existingRow.id);
            } else {
              await db.from("overtime_sessions").delete().eq("id", existingRow.id);
            }
          } else if (otMinutes > OVERTIME_GRACE_MINUTES) {
            await db.from("overtime_sessions").insert({
              booking_id: bookingId, student_id: booking.student_id,
              membership_id: booking.membership_id ?? null, branch_id: booking.branch_id,
              overtime_minutes: otMinutes,
              session_date: todayISO(), billed_amount: overtimeCharge, billed_at: null,
            });
          }
        }
      }

      return json({ ok: true, overtimeAlreadyBilled });
    },
    // Record a past attendance the staff forgot to punch in at the time (e.g. "she came in
    // yesterday evening but nobody checked her in"). Bypasses the daily-quota/one-active-
    // session checks that live check-in enforces, since this is a deliberate manual
    // correction of the historical record, not a new live session.
    add_attendance: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, studentId, startTime, endTime } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!startTime || !endTime) return err("Check-in and check-out time are required");
      const newStartTime = new Date(startTime).toISOString();
      const newEndTime = new Date(endTime).toISOString();
      if (new Date(newEndTime).getTime() <= new Date(newStartTime).getTime()) {
        return err("Check-out time must be after check-in time");
      }

      const clash = await findOverlappingSession(db, studentId, newStartTime, newEndTime);
      if (clash) {
        return err(clash.status === "active"
          ? `This overlaps the session they're checked into right now (since ${formatISTSession(clash.start_time)}) — check them out first, or pick a different time.`
          : `Attendance for ${formatISTSession(clash.start_time, clash.end_time)} is already recorded and overlaps this one — edit that record instead of adding it again.`);
      }

      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");

      const { data: membership } = await db.from("memberships").select("*")
        .eq("student_id", studentId).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      if (!membership) return err("No active membership found");

      const hours = Math.round(((new Date(newEndTime).getTime() - new Date(newStartTime).getTime()) / 3_600_000) * 100) / 100;
      const bookingType = membership.category === "permanent" ? "permanent" : "temporary";
      const isCrossBranchVisit = student.branch_id != null && student.branch_id !== branchId;
      const deskId = membership.category === "permanent" && !isCrossBranchVisit ? membership.desk_id : null;

      // Overtime must always be measured against the student's actual plan allotment for
      // the day this session falls on, never the duration the staff member happened to type
      // in — otherwise a manually-added session's "scheduled hours" always equals its actual
      // hours and overtime silently never triggers.
      const attendanceDayOfWeek = new Date(new Date(newStartTime).getTime() + IST_OFFSET_MS).getUTCDay();
      const isWeekendAttendance = attendanceDayOfWeek === 0 || attendanceDayOfWeek === 6;
      const scheduledHours = isWeekendAttendance && membership.hours_per_day_weekend != null
        ? Number(membership.hours_per_day_weekend)
        : Number(membership.hours_per_day);

      const { data: booking, error: bErr } = await db.from("bookings").insert({
        student_id: studentId, branch_id: branchId, desk_id: deskId,
        membership_id: membership.id, booking_type: bookingType,
        start_time: newStartTime, end_time: newEndTime,
        hours, scheduled_hours: scheduledHours, amount: 0, status: "completed",
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (bErr) return err(bErr.message);

      await db.from("students").update({
        total_visits: (student.total_visits ?? 0) + 1,
        total_hours_studied: Number(student.total_hours_studied ?? 0) + hours,
        updated_at: new Date().toISOString(),
      }).eq("id", studentId);

      // Log overtime immediately (unbilled — Pay Later — since there's no live checkout
      // moment for a backfilled session to ask Pay Now/Later), same basis as a normal
      // checkout: scheduled end = check-in + the plan's actual allotment for that day.
      const scheduledEndMs = new Date(newStartTime).getTime() + scheduledHours * 3_600_000;
      const otMinutes = Math.max(0, Math.round((new Date(newEndTime).getTime() - scheduledEndMs) / 60_000));
      if (otMinutes > OVERTIME_GRACE_MINUTES) {
        const { overtimeCharge } = computeOvertimeCharge(otMinutes, 0, 0, false);
        await db.from("overtime_sessions").insert({
          booking_id: booking!.id, student_id: studentId,
          membership_id: membership.id, branch_id: branchId,
          overtime_minutes: otMinutes,
          session_date: toISTDateStr(newStartTime), billed_amount: overtimeCharge, billed_at: null,
        });
      }

      return json({ ok: true, bookingId: booking!.id });
    },
    // ─── CHECKOUT ───
    checkout_booking: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { bookingId, overtimeMinutes, overtimePaymentMode, overtimePayNow, settleFoodNow, foodPassPaymentMode, actualEndTime } = payload;
      const { data: booking } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!booking) return err("Booking not found");
      if (!requireBranch(staff, booking.branch_id)) return err("Branch access denied", 403);

      // Staff can correct the recorded checkout moment (e.g. they forgot to check someone
      // out promptly and the resulting overtime is really just their own delay, not the
      // student's) — see the "Correct checkout time" control in the checkout modal, which
      // recomputes overtimeMinutes client-side against this same value before submitting.
      // Falls back to "now" exactly as before when omitted. Can't be before the session
      // started; a future timestamp is allowed since staff correcting toward "later than I
      // clicked" is a legitimate case too (e.g. filling this in a few minutes after the fact).
      let stampedEndTime = new Date().toISOString();
      if (actualEndTime) {
        const parsed = new Date(actualEndTime);
        if (isNaN(parsed.getTime())) return err("Invalid checkout time");
        if (parsed.getTime() < new Date(booking.start_time).getTime()) {
          return err("Checkout time can't be before the session started");
        }
        stampedEndTime = parsed.toISOString();
      }
      // Checkout moves real money (overtime billing, Food Pass deduction, shortfall
      // collection) and stamps end_time, none of it idempotent — so a repeat submission
      // (double-click, retry on a slow network, two staff on two devices) would charge
      // everything twice and rewrite the recorded session length. Only an open session
      // can be checked out; every comparable action guards its state the same way.
      if (booking.status !== "active") {
        return err("This session has already been checked out.");
      }

      const isMember = booking.booking_type !== "walkin";
      const FOOD_CARRY_DAYS = 3;

      // A Food Pass holder never pays cash for food at checkout — any bill still marked
      // unpaid (e.g. from before the pass existed) is deducted from the pass automatically.
      const { data: foodPass } = isMember
        ? await db.from("food_passes").select("*").eq("student_id", booking.student_id).maybeSingle()
        : { data: null };

      // A Food Pass balance is never allowed to end a session negative — ordering food
      // against an insufficient balance gets one grace window (skippable at order time),
      // but by checkout the shortfall must be collected, no skip option this time. Checked
      // before any mutation below so a "needs collection" response leaves nothing half-done.
      let passUnpaidBillIds: string[] = [];
      let foodPassNewBalance = 0;
      let foodPassShortfall = 0;
      if (foodPass) {
        const { data: passUnpaidBills } = await db.from("food_bills").select("id, total")
          .eq("student_id", booking.student_id).eq("paid", false);
        passUnpaidBillIds = (passUnpaidBills ?? []).map((b: { id: string }) => b.id);
        const passTotal = (passUnpaidBills ?? []).reduce((s: number, b: { total: number }) => s + Number(b.total), 0);
        const resultingBalance = Number(foodPass.balance) - passTotal;
        if (resultingBalance < 0) {
          foodPassShortfall = -resultingBalance;
          if (!foodPassPaymentMode) {
            return json({ needsFoodPassCollection: true, shortfall: foodPassShortfall });
          }
          // The shortfall is collected as cash/UPI below, so the pass itself settles at 0
          // rather than carrying a negative balance forward.
          foodPassNewBalance = 0;
        } else {
          foodPassNewBalance = resultingBalance;
        }
      }

      // Membership students without a pass can carry an unpaid food bill for up to 3 days
      // across sessions — check by student, not just this booking, since each day is a new booking.
      // Skipped entirely when staff opted to settle the food bill now (settleFoodNow): that
      // path pays it off below regardless of age, so the age check would otherwise block a
      // checkout that's about to resolve the exact debt it's complaining about.
      const { data: memberUnpaidBills } = isMember && !foodPass && !settleFoodNow
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
      // This conditional update is the real double-checkout guard: the status check above
      // is a separate read, so two submissions landing together could both pass it and both
      // bill food/overtime. Only one request can flip active → completed; the other gets no
      // row back and stops here, before any money moves.
      const { data: closedRows, error: closeErr } = await db.from("bookings").update({
        status: "completed", end_time: stampedEndTime,
        is_paused: false, paused_at: null, total_pause_minutes: 0,
      }).eq("id", bookingId).eq("status", "active").select("id");
      if (closeErr) return err(closeErr.message);
      if (!closedRows?.length) return err("This session has already been checked out.");

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
        // students without a pass). Any shortfall was already gated above: if it would've
        // gone negative, foodPassPaymentMode is guaranteed to be set here, so the balance
        // is topped up by exactly that much in the same breath — it can never end negative.
        if (passUnpaidBillIds.length) {
          await db.from("food_passes").update({
            balance: foodPassNewBalance, updated_at: new Date().toISOString(),
          }).eq("id", foodPass.id);
          for (const billId of passUnpaidBillIds) {
            await db.from("food_bills").update({ paid: true, payment_mode: "other" }).eq("id", billId);
          }
        }
        if (foodPassShortfall > 0) {
          await recordTransaction(db, {
            student_id: booking.student_id, branch_id: booking.branch_id,
            category: "food", amount: foodPassShortfall, payment_mode: foodPassPaymentMode,
            notes: "Food Pass shortfall collected at checkout", created_by_staff_id: staff.id,
          });
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
            await recordTransaction(db, {
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
          const bookedHours = Number(booking.scheduled_hours ?? booking.hours) || 1;
          const baseFee = Number(booking.amount);
          const isWalkinThreeHour = bookedHours === 3;
          const { overtimeHours, overtimeCharge } = computeOvertimeCharge(otMinutes, bookedHours, baseFee, isWalkinThreeHour);
          if (overtimeHours > 0) {
            // A walk-in has no "Pay Later" concept — the charge is collected immediately
            // as part of checkout below, so this row is recorded already-billed. It exists
            // purely so the student's profile shows the same Overtime History table a
            // member gets; it was never used for walk-in billing itself (that's the
            // transactions insert), so adding it doesn't change how/when money moves.
            await db.from("overtime_sessions").insert({
              booking_id: bookingId, student_id: booking.student_id, membership_id: null,
              branch_id: booking.branch_id, overtime_minutes: otMinutes,
              session_date: todayISO(), billed_amount: overtimeCharge,
              billed_at: new Date().toISOString(),
            });
          }
          if (overtimeCharge > 0) {
            await recordTransaction(db, {
              student_id: booking.student_id, branch_id: booking.branch_id,
              booking_id: bookingId, category: "overtime",
              amount: overtimeCharge,
              payment_mode: overtimePaymentMode ?? booking.payment_mode ?? "cash",
              notes: `${otMinutes}m overtime, flat-rate billed`,
              created_by_staff_id: staff.id,
            });
          }
        } else {
          // Member overtime is always logged (hours + computed amount) regardless of the
          // Pay Now / Pay Later choice, so the record exists either way. Pay Now settles it
          // immediately (billed_at set, transaction recorded today); Pay Later leaves it
          // unbilled — exactly as before this feature — to be picked up at the membership's
          // next renewal/closure settlement instead of today's bill.
          // The 10-hour/₹100 cap is walk-in-only (total visit hours vs. total visit cost) —
          // for a member there's no per-visit "total cost" to cap, so bookedHours=0 here makes
          // the cap trigger purely on overtimeHours itself reaching 10.
          const { overtimeHours, overtimeCharge } = computeOvertimeCharge(otMinutes, 0, 0, false);
          if (overtimeHours > 0) {
            const payNow = !!overtimePayNow;
            await db.from("overtime_sessions").insert({
              booking_id: bookingId,
              student_id: booking.student_id,
              membership_id: booking.membership_id ?? null,
              branch_id: booking.branch_id,
              overtime_minutes: otMinutes,
              session_date: todayISO(),
              billed_amount: overtimeCharge,
              billed_at: payNow ? new Date().toISOString() : null,
            });
            if (payNow && overtimeCharge > 0) {
              await recordTransaction(db, {
                student_id: booking.student_id, branch_id: booking.branch_id,
                booking_id: bookingId, category: "overtime",
                amount: overtimeCharge, payment_mode: overtimePaymentMode ?? "cash",
                notes: `${otMinutes}m overtime, flat-rate billed`, created_by_staff_id: staff.id,
              });
            }
          }
        }
      }

      return json({ ok: true });
    },
    // ─── TODAY'S BOOKINGS ───
    list_today_bookings: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let branchIds: string[];
      if (allBranches) {
        if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
        const { data: branchesList } = await db.from("branches").select("id").eq("is_active", true);
        branchIds = (branchesList ?? []).map(b => b.id);
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        branchIds = [branchId];
      }
      // status = "active" already means "not yet checked out" — that's true regardless of
      // which day the session started, so no date filter here. A leftover date range meant a
      // session staff forgot to check out would silently vanish from this tab the next day
      // even though it was still genuinely open; sessions now only ever leave this list when
      // checkout_booking explicitly closes them.
      const { data, error: bErr } = await db.from("bookings")
        .select("*, students(name, phone, course), desks!desk_id(label, seat_type), memberships:membership_id(total_paid, fee_due, monthly_fee, category, end_date), branches(name)")
        .in("branch_id", branchIds)
        .eq("status", "active")
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

      // Walk-ins holding a locker with no membership behind it: nothing releases that locker
      // automatically (a member's is settled at membership closure), so the checkout screen
      // reminds staff about it. A walk-in who is also a member is skipped — their locker is
      // handled when the membership closes.
      const walkinStudentIds = [...new Set((data ?? []).filter((b: any) => b.booking_type === "walkin" && b.student_id).map((b: any) => b.student_id))];
      const [{ data: walkinLockers }, { data: walkinMems }] = walkinStudentIds.length
        ? await Promise.all([
            db.from("lockers").select("id, student_id, locker_no, locker_due_date, fee_due, deposit_amount, deposit_returned")
              .in("student_id", walkinStudentIds).eq("is_active", true),
            db.from("memberships").select("student_id").in("student_id", walkinStudentIds).eq("is_active", true),
          ])
        : [{ data: [] }, { data: [] }];
      const walkinMemberIds = new Set((walkinMems ?? []).map((m: { student_id: string }) => m.student_id));
      const walkinLockerByStudent = new Map(
        (walkinLockers ?? []).filter((l: { student_id: string }) => !walkinMemberIds.has(l.student_id))
          .map((l: { student_id: string }) => [l.student_id, l]),
      );

      const bookings = (data ?? []).map(b => ({
        ...b,
        memberships: activeMemByStudent.get(b.student_id) ?? b.memberships,
        foodTotal: foodTotals.get(b.id) ?? 0,
        unpaidFoodTotal: b.booking_type === "walkin" ? (unpaidFoodTotalsByBooking.get(b.id) ?? 0) : (unpaidFoodTotalsByStudent.get(b.student_id) ?? 0),
        hasFoodPass: foodPassStudentIds.has(b.student_id),
        walkinLocker: b.booking_type === "walkin" ? (walkinLockerByStudent.get(b.student_id) ?? null) : null,
      }));
      return json({ bookings });
    },
    // ─── PAUSE / RESUME SESSION ───
    pause_session: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { bookingId } = payload;
      const { data: bk } = await db.from("bookings").select("*").eq("id", bookingId).single();
      if (!bk) return err("Booking not found");
      if (!requireBranch(staff, bk.branch_id)) return err("Branch access denied", 403);
      if (bk.is_paused) return err("Session is already on break");
      await db.from("bookings").update({
        is_paused: true, paused_at: new Date().toISOString(),
      }).eq("id", bookingId);
      return json({ ok: true });
    },
    resume_session: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
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
    },
  };
  return h;
}
