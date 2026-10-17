// Students, memberships, renewals, settlements, lockers and the waitlist. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addDays, addMonths, daysBetween, endDateForMonths, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { computeStudentStatus, multiMonthDiscount, notStartedYetMessage, renewalKind, unusedDaysRefund } from "../../_shared/membership.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { DEV_MODE, claimDesk, claimSignup, computeOverstay, fetchAllRows, getMembershipPackage, hasOpenSession, insertPaymentTransactions, isISODate, lockerNumberSequence, recordPayout, recordSettlementIncome, recordTransaction, recordWaiver, refreshStudentStatus, remindExpiringMembers, settlePendingCashbacks, signupBusyMessage, storedPaymentMode, unpaidFoodBillsFor, upsertStudent } from "../lib.ts";
import { featureOn } from "../../_shared/flags.ts";

// Used to be declared inside the request handler, reading its db and staff. This factory gives it
// the same two values; the function text is unchanged.
function makeComputeDeleteSettlement(db: Ctx["db"], staff: NonNullable<Ctx["staff"]>) {
    // Shared by get_membership_delete_summary and delete_membership so the preview and
    // the actual execution can never disagree — computes every owed/credit line close_membership
    // does (locker, food pass, cashback, overtime), plus the prorated refund for unused days
    // that's unique to a deletion. "Membership amount paid" for the prorated formula is the
    // pre-multi-month-discount gross (monthly_fee * months_paid), per how it was specified;
    // the raw result is capped at total_paid + fee_due (what the student will have been
    // charged in total once this same settlement collects the outstanding balance below) —
    // NOT total_paid alone, since that would short the refund by exactly the still-unpaid
    // balance whenever the membership was only partially paid off.
    async function computeDeleteSettlement(
      mem: Record<string, any>, waiveOverstayCharge = false, withholdLockerDeposit = false, waiveProratedRefund = false,
    ) {
      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
      const { data: planChanges } = await db.from("membership_plan_changes").select("*")
        .eq("membership_id", mem.id).order("created_at", { ascending: true });
      const { bills: unpaidFoodBills, total: unpaidFoodTotal } = await unpaidFoodBillsFor(db, mem.student_id);

      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      const lockerDepositRefund = locker && !locker.deposit_returned && !withholdLockerDeposit ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount, contribs: cashbackContribs } = await settlePendingCashbacks(db, mem.student_id, cashbackBase);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      const today = todayISO();
      // A membership is either still running (unused days to refund) or already over (possible
      // overstay) — never both. waiveProratedRefund lets staff omit the refund entirely (e.g. a
      // no-refund policy for leaving early by choice).
      const { proratedRefund, remainingDays, totalDays, planAmount, refundDailyRate } = unusedDaysRefund(mem as any, today, !!waiveProratedRefund);
      // Same overstay rule as Quit (RSP O1–O3); the full amount is kept for the waiver log.
      const overstay = await computeOverstay(db, mem as any);
      const overstayDays = overstay.overstayDays;
      const overstayChargeBeforeWaive = overstay.overstayCharge;
      const overstayCharge = waiveOverstayCharge ? 0 : overstayChargeBeforeWaive;

      const totalOwed = membershipDue + lockerDue + foodPassOwed + unpaidFoodTotal + overtimeDue + overstayCharge;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount + proratedRefund;
      const netAmount = totalOwed - totalCredit;

      return {
        membershipDue, lockerDue, lockerDepositRefund,
        foodPassBalance, foodPassRefund, foodPassOwed, unpaidFoodTotal, unpaidFoodBills,
        cashbackAmount, cashbackContribs, overtimeMinutes, overtimeDue,
        proratedRefund, remainingDays, totalDays, planAmount, refundDailyRate,
        overstayDays, overstayCharge, overstayChargeBeforeWaive, lastVisitDate: overstay.lastVisitDate, overstayDailyRate: overstay.overstayDailyRate,
        totalOwed, totalCredit, netAmount,
        locker: locker ?? null, foodPass: foodPass ?? null, unbilledOvertime: unbilledOvertime ?? [],
        planChanges: planChanges ?? [],
      };
    }
  return computeDeleteSettlement;
}

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── STUDENT LOOKUP ───
    lookup_student: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { phone } = payload;
      const { data, error: lookupErr } = await db.from("students").select("id, name, phone, course, status")
        .eq("phone", phone).maybeSingle();
      if (lookupErr) return err(lookupErr.message);
      if (!data) return json({ student: null });
      const { data: membership } = await db.from("memberships").select("*, branches(name)")
        .eq("student_id", data.id).eq("is_active", true)
        .order("end_date", { ascending: false }).limit(1).maybeSingle();
      // A student whose memberships are all inactive is a *returning* student — re-registering
      // them is the supported flow, and must reuse this same student record (keeping their
      // history) rather than creating a second person on the same phone number.
      const { data: pastMems } = await db.from("memberships").select("end_date, category")
        .eq("student_id", data.id).eq("is_active", false)
        .order("end_date", { ascending: false }).limit(1);
      const lastPast = pastMems?.[0] ?? null;
      return json({
        student: {
          ...data,
          active_membership: membership ?? null,
          is_member: !!membership,
          active_branch_name: (membership?.branches as { name: string } | null)?.name ?? null,
          is_returning: !membership && !!lastPast,
          last_membership_end: lastPast?.end_date ?? null,
          last_membership_category: lastPast?.category ?? null,
        },
      });
    },
    search_students_by_name: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, query } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const q = (query ?? "").trim();
      if (q.length < 2) return json({ students: [] });
      // Recognize a student by full name or phone number in the same search box.
      const { data } = await db.from("students").select("id, name, phone")
        .eq("branch_id", branchId).or(`name.ilike.%${q}%,phone.ilike.%${q}%`).order("name").limit(8);
      return json({ students: data ?? [] });
    },
    create_membership: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const {
        branchId, name, phone, category, hoursPerDay, timings, monthsPaid,
        paymentMode, cashAmount, upiAmount, course, lockerNo, withLocker,
        advanceAmount, emergencyContact, referralSource, startDate: customStartDate,
        isCustomPlan, customAmount, weekendHours,
        isCustomDays, customDays, customDaysAmount, deskId: selectedDeskId, signupId,
      } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!emergencyContact) return err("Emergency contact is required");
      if (phone === emergencyContact) return err("Emergency contact cannot be the same as the primary phone number");
      const validReferrals = ["google_search", "instagram", "word_of_mouth", "flex", "ai_platform"];
      if (!validReferrals.includes(referralSource)) return err("Please select how the student heard about us");

      // SSP: registering from a self sign-up. This staff member must hold its lock (Approve
      // took it), so only one Register or Deny can ever succeed for one sign-up (C3). Checked
      // before anything is written; the sign-up is deleted only once the membership exists.
      if (signupId) {
        const { data: su } = await db.from("signup_requests").select("id, branch_id").eq("id", signupId).maybeSingle();
        if (!su) return err("This sign-up was already handled by someone else (or has expired). Clear the form and check before registering.", 409);
        if (su.branch_id !== branchId) return err("This sign-up was sent to another branch — switch to that branch to register it.");
        if (!(await claimSignup(db, signupId, staff.id))) return err(await signupBusyMessage(db, signupId), 409);
      }

      // Duplicate-registration guard. A phone that already holds an ACTIVE membership —
      // at ANY branch, of any category — cannot be registered again: stacking a second
      // membership on top of a live one is exactly what produced the double-active records
      // this database had to be audited for (two cabins reserved for one person, inflated
      // active counts, ambiguous renewals). Checked before upsertStudent so a rejection
      // leaves no partial writes behind. An all-inactive history is deliberately allowed —
      // that's a returning student, and re-registering them is the supported path.
      const { data: dupStudent } = await db.from("students").select("id, name").eq("phone", phone).maybeSingle();
      if (dupStudent) {
        const { data: liveMems } = await db.from("memberships")
          .select("category, end_date, branches(name)")
          .eq("student_id", dupStudent.id).eq("is_active", true)
          .order("end_date", { ascending: false });
        const live = liveMems?.[0];
        if (live) {
          const liveBranch = (live.branches as unknown as { name: string } | null)?.name ?? "another branch";
          return err(
            `${dupStudent.name} (${phone}) already has an active ${live.category} membership at ${liveBranch}, valid until ${live.end_date}. ` +
            `Use Renew on their profile to extend it, Transfer Branch to move them, or close/delete that membership first — registering again would create a duplicate.`,
          );
        }
      }

      // Locker checks run here, before anything is written. They used to run after the
      // membership, payment and cabin were already saved, so "No lockers available" left a
      // half-registered student behind (and a retry was then blocked as a duplicate).
      if (withLocker) {
        if (!lockerNo) return err("Pick a locker number, or choose Avail Later for the locker");
        const { data: lockerBranch } = await db.from("branches").select("locker_capacity").eq("id", branchId).single();
        const { count: lockersInUse } = await db.from("lockers")
          .select("*", { count: "exact", head: true }).eq("branch_id", branchId).eq("is_active", true);
        if ((lockersInUse ?? 0) >= (lockerBranch?.locker_capacity ?? 0)) {
          return err("No lockers available at this branch — choose Avail Later for the locker");
        }
        const { data: lockerTaken } = await db.from("lockers").select("id")
          .eq("branch_id", branchId).eq("locker_no", lockerNo).eq("is_active", true).maybeSingle();
        if (lockerTaken) return err(`Locker ${lockerNo} is already assigned to another student — pick another one`);
      }

      // Reaching here with an existing record means a returning student (the guard above
      // already rejected anyone holding a live membership). Their visit/hours totals belong
      // to the membership they were earned under, so a fresh membership starts the counters
      // at zero rather than carrying the old figures forward. Their underlying per-session
      // rows (bookings/transactions) are deliberately left intact as historical record.
      const isReturningStudent = !!dupStudent;

      const { id: studentId } = await upsertStudent(db, name, phone, branchId, {
        course, status: "active",
        emergency_contact: emergencyContact, referral_source: referralSource,
        ...(isReturningStudent ? { total_visits: 0, total_hours_studied: 0 } : {}),
      });

      // A Custom plan skips the fixed fee_config tiers entirely — staff enter a negotiated
      // monthly amount directly, plus separate weekday/weekend hour allotments (enforced at
      // check-in). hours_per_day_weekend being set is what marks a membership as custom
      // everywhere else (renewal, check-in) — a normal package never sets it.
      let monthlyFee: number;
      let weekdayHoursValue: number;
      let weekendHoursValue: number | null = null;
      if (isCustomPlan) {
        monthlyFee = Number(customAmount);
        if (!(monthlyFee > 0)) return err("Enter a valid custom amount");
        weekdayHoursValue = Number(hoursPerDay);
        if (!(weekdayHoursValue > 0)) return err("Enter valid weekday hours");
        weekendHoursValue = Number(weekendHours) || weekdayHoursValue;
      } else {
        const pkgFee = await getMembershipPackage(db, Number(hoursPerDay), category);
        if (!pkgFee) return err("Invalid membership package");
        monthlyFee = pkgFee;
        weekdayHoursValue = Number(hoursPerDay);
      }

      // A custom day count bypasses the whole-month billing model entirely — end date is
      // exactly startDate + days (inclusive), fee is auto-prorated from the plan's monthly
      // rate but staff can override it, and no multi-month discount applies since it isn't a
      // whole-month plan. months_paid still needs an integer for the column (and is reused
      // elsewhere as a rough multiplier, e.g. cashback base) — a rounded month-equivalent is
      // stored there; the actual money and end date come from the exact day count, not this.
      const isCustomDaysPlan = !!isCustomDays;
      let months: number;
      let discount: number;
      let gross: number;
      let customDaysCount: number | null = null;
      if (isCustomDaysPlan) {
        customDaysCount = Number(customDays);
        if (!(customDaysCount > 0)) return err("Enter a valid number of days");
        months = Math.max(1, Math.round(customDaysCount / 30));
        discount = 0;
        gross = customDaysAmount != null && customDaysAmount !== ""
          ? Number(customDaysAmount)
          : Math.round((monthlyFee / 30) * customDaysCount);
        if (!(gross > 0)) return err("Enter a valid amount collected");
      } else {
        months = Number(monthsPaid) || 1;
        discount = multiMonthDiscount(months);
        gross = monthlyFee * months;
      }
      const totalPaid = gross * (1 - discount / 100);
      const startDate = customStartDate ? customStartDate : todayISO();
      if (startDate > todayISO()) return err("Start date cannot be in the future");

      // What's collected right now, split between the membership and the locker's ₹200
      // (₹100 deposit + ₹100 first month). The form totals membership + locker together, and
      // Full/Partial/Pay Later apply to that grand total — so an advance pays the membership
      // first and only what's left over goes to the locker; whatever the locker is still owed
      // becomes the locker's own fee_due, same as add_locker's Pay Later. Previously an
      // advance was credited entirely to the membership and the locker's ₹200 was always
      // recorded as collected, so a Pay Later registration with a locker put ₹200 into
      // Revenue that nobody paid, and the student's dues came out ₹200 short.
      const LOCKER_SIGNUP_TOTAL = 200;
      const grandTotal = totalPaid + (withLocker ? LOCKER_SIGNUP_TOTAL : 0);
      let paidNow = grandTotal;
      if (advanceAmount != null) {
        paidNow = Number(advanceAmount);
        if (!(paidNow >= 0)) return err("Enter a valid advance amount");
        if (Math.round(paidNow * 100) > Math.round(grandTotal * 100)) {
          return err(`The advance (₹${paidNow}) is more than the total of ₹${grandTotal} — choose Full payment instead.`);
        }
      }
      const membershipPaidNow = Math.min(paidNow, totalPaid);
      const lockerPaidNow = withLocker ? Math.round((paidNow - membershipPaidNow) * 100) / 100 : 0;
      let lockerCash = 0;
      let lockerUpi = 0;
      let membershipCash: number | string | undefined = cashAmount;
      let membershipUpi: number | string | undefined = upiAmount;
      if (paymentMode === "split" && paidNow > 0) {
        const cash = Math.round((Number(cashAmount) || 0) * 100) / 100;
        const upi = Math.round((Number(upiAmount) || 0) * 100) / 100;
        if (Math.round((cash + upi) * 100) !== Math.round(paidNow * 100)) {
          return err("Cash + UPI amounts must add up to the total");
        }
        lockerCash = Math.min(lockerPaidNow, cash);
        lockerUpi = Math.round((lockerPaidNow - lockerCash) * 100) / 100;
        membershipCash = Math.round((cash - lockerCash) * 100) / 100;
        membershipUpi = Math.round((upi - lockerUpi) * 100) / 100;
      }
      const endDate = isCustomDaysPlan ? addDays(startDate, customDaysCount! - 1) : endDateForMonths(startDate, months);
      // Derived the same clamp-aware way as endDate (not a raw addMonths) so a start date
      // on the 29th/30th/31st can't make dueDate collide with a 1-month endDate instead of
      // landing the day after it.
      const dueDate = isCustomDaysPlan ? addDays(endDate, 1) : addDays(endDateForMonths(startDate, 1), 1);
      const seatType = category === "permanent" ? "fixed" : "floating";
      let deskId = null;
      let cabinNo = null;

      if (category === "permanent") {
        // The cabin is chosen explicitly at registration rather than auto-assigned to the
        // lowest free sort_order — staff seat people deliberately (near a window, away from
        // the door, next to a friend), and silently picking for them meant a reassignment
        // straight after almost every permanent signup. Same claim-then-verify race guard as
        // every other cabin assignment path.
        if (!selectedDeskId) return err("Select a cabin for this permanent membership");
        const { data: chosenDesk } = await db.from("desks").select("id, label, status")
          .eq("id", selectedDeskId).eq("branch_id", branchId).maybeSingle();
        if (!chosenDesk) return err("Cabin not found at this branch");
        if (chosenDesk.status !== "free") return err("Selected cabin is no longer available — pick another one");
        if (!(await claimDesk(db, chosenDesk.id, studentId))) {
          return err("That cabin was just taken by another registration — pick another one.");
        }
        deskId = chosenDesk.id;
        cabinNo = chosenDesk.label;
      }

      const monthLabel = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

      const { data: mem, error: mErr } = await db.from("memberships").insert({
        student_id: studentId, branch_id: branchId, category, seat_type: seatType,
        desk_id: deskId, cabin_no: cabinNo, month: monthLabel,
        hours_per_day: weekdayHoursValue, hours_per_day_weekend: weekendHoursValue,
        timings: timings ?? '', start_date: startDate, end_date: endDate,
        due_date: dueDate, months_paid: months, discount_percent: discount,
        monthly_fee: monthlyFee,
        total_paid: membershipPaidNow,
        fee_due: Math.max(Math.round((totalPaid - membershipPaidNow) * 100) / 100, 0),
        payment_mode: storedPaymentMode(paymentMode), created_by_staff_id: staff.id,
        // RSP: the plan's own price (after the multi-month discount) and length, for an exact
        // per-day rate if the membership is deleted early.
        plan_amount: Math.round(totalPaid * 100) / 100,
        plan_days: isCustomDaysPlan ? customDaysCount : daysBetween(startDate, endDate) + 1,
      }).select("id").single();
      if (mErr) return err(mErr.message);

      await insertPaymentTransactions(db, {
        student_id: studentId, branch_id: branchId, membership_id: mem!.id,
        category: "membership", created_by_staff_id: staff.id,
      }, paymentMode, membershipPaidNow, membershipCash, membershipUpi);

      // Availability was checked before anything was written; this only fails if another
      // registration took the same number in the moments since. The membership and its
      // payment are real and stay — the locker just isn't assigned, and nothing is recorded
      // for it, instead of charging for a locker that was never created.
      let lockerWarning: string | null = null;
      if (withLocker) {
        const lockerDue = addMonths(startDate, 1);
        const { error: lockerErr } = await db.from("lockers").insert({
          branch_id: branchId, student_id: studentId, locker_no: lockerNo,
          locker_due_date: lockerDue, deposit_amount: 100, monthly_fee: 100,
          amount_paid: lockerPaidNow,
          fee_due: Math.round((LOCKER_SIGNUP_TOTAL - lockerPaidNow) * 100) / 100,
        });
        const lockerTxnBase = {
          student_id: studentId, branch_id: branchId, category: "locker",
          notes: "Locker rent + deposit", created_by_staff_id: staff.id,
        };
        if (lockerErr) {
          lockerWarning = lockerPaidNow > 0
            ? `Locker ${lockerNo} was taken by another registration a moment ago — no locker was assigned. Hand back the ₹${lockerPaidNow} collected for it, then add a locker from the student's profile.`
            : `Locker ${lockerNo} was taken by another registration a moment ago — no locker was assigned and nothing was charged for it. Add one from the student's profile.`;
        } else if (paymentMode === "split") {
          if (lockerCash > 0) await recordTransaction(db, { ...lockerTxnBase, amount: lockerCash, payment_mode: "cash" });
          if (lockerUpi > 0) await recordTransaction(db, { ...lockerTxnBase, amount: lockerUpi, payment_mode: "upi" });
        } else if (lockerPaidNow > 0) {
          await recordTransaction(db, {
            ...lockerTxnBase, amount: lockerPaidNow, payment_mode: paymentMode ?? "cash",
          });
        }
      }

      await refreshStudentStatus(db, studentId);
      if (signupId) await db.from("signup_requests").delete().eq("id", signupId);
      return json({ membership: mem, totalPaid, cabinNo, lockerWarning });
    },
    // ─── PERMANENT MEMBERSHIP WAITLIST ───
    // "Full" means zero free desks at the branch — any free desk can become a permanent
    // cabin, so this is the same condition create_membership itself checks.
    get_permanent_waitlist: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { count: freeDesks } = await db.from("desks").select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "free");
      const { data: waitlist } = await db.from("permanent_waitlist").select("*")
        .eq("branch_id", branchId).eq("status", "waiting").order("created_at", { ascending: true });
      return json({ isFull: (freeDesks ?? 0) === 0, freeDesks: freeDesks ?? 0, waitlist: waitlist ?? [] });
    },
    join_permanent_waitlist: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, name, phone, hoursPerDay, notes } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name || !phone) return err("Name and phone are required");
      const { count: freeDesks } = await db.from("desks").select("*", { count: "exact", head: true })
        .eq("branch_id", branchId).eq("status", "free");
      if ((freeDesks ?? 0) > 0 && !DEV_MODE) return err("Permanent seats are still available — register directly instead of waitlisting");

      const { error } = await db.from("permanent_waitlist").insert({
        branch_id: branchId, name, phone, hours_per_day: hoursPerDay || null, notes: notes || null,
        created_by_staff_id: staff.id,
      });
      if (error) return err(error.message);
      return json({ ok: true });
    },
    remove_from_waitlist: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { waitlistId, status } = payload;
      const { data: entry } = await db.from("permanent_waitlist").select("branch_id").eq("id", waitlistId).single();
      if (!entry) return err("Waitlist entry not found");
      if (!requireBranch(staff, entry.branch_id)) return err("Branch access denied", 403);
      await db.from("permanent_waitlist").update({
        status: status === "fulfilled" ? "fulfilled" : "cancelled",
        fulfilled_at: status === "fulfilled" ? new Date().toISOString() : null,
      }).eq("id", waitlistId);
      return json({ ok: true });
    },
    // ─── LOCKERS (add / remove after registration) ───
    get_locker_status: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: branchRow } = await db.from("branches").select("name, locker_capacity").eq("id", branchId).single();
      const capacity = branchRow?.locker_capacity ?? 0;
      const { data: activeLockers } = await db.from("lockers").select("locker_no").eq("branch_id", branchId).eq("is_active", true);
      const used = activeLockers?.map(l => l.locker_no) ?? [];
      const usedSet = new Set(used);
      const allNumbers = lockerNumberSequence(branchRow?.name, capacity);
      const availableNumbers = allNumbers.filter(label => !usedSet.has(label));
      return json({ capacity, used: used.length, available: capacity - used.length, availableNumbers });
    },
    // Full list of currently-assigned lockers at a branch, for the Membership page's Locker tab.
    list_lockers: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("lockers")
        .select("id, student_id, locker_no, created_at, locker_due_date, fee_due, students(name, phone)")
        .eq("branch_id", branchId).eq("is_active", true);
      return json({ lockers: data ?? [] });
    },
    add_locker: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, branchId, lockerNo, paymentMode, cashAmount, upiAmount, payLater } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: lockerStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!lockerStudent || lockerStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);

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
      const totalDue = deposit + proratedFee;

      // Pay Later defers the whole thing — deposit included — into fee_due; nothing is
      // collected or recorded as a transaction at assignment time in that case.
      const amountPaid = payLater ? 0 : totalDue;
      const feeDue = payLater ? totalDue : 0;

      const { data: locker, error: lErr } = await db.from("lockers").insert({
        branch_id: branchId, student_id: studentId, locker_no: lockerNo,
        locker_due_date: endDate, deposit_amount: deposit, monthly_fee: 100,
        amount_paid: amountPaid, fee_due: feeDue,
      }).select("*").single();
      if (lErr) return err(lErr.message);

      if (amountPaid > 0) {
        await insertPaymentTransactions(db, {
          student_id: studentId, branch_id: branchId, category: "locker",
          notes: `Locker — prorated ${daysRemaining}d rent (₹${proratedFee}) + deposit (₹${deposit})`,
          created_by_staff_id: staff.id,
        }, paymentMode, amountPaid, cashAmount, upiAmount);
      }

      await refreshStudentStatus(db, studentId);
      return json({ ok: true, locker, amountCharged: amountPaid, proratedFee, deposit, totalDue, daysRemaining, payLater: !!payLater });
    },
    // Preview for the Remove Locker confirmation — locker-only money, deliberately excludes
    // membership fee_due or any other pending balance the student might have.
    get_locker_removal_summary: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { lockerId } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      const rentDue = Number(locker.fee_due ?? 0);
      const depositRefund = locker.deposit_returned ? 0 : Number(locker.deposit_amount ?? 0);
      // Positive = still owed to the branch (rent exceeds the deposit that would offset it).
      // Negative = owed back to the student (deposit exceeds any pending rent).
      const netAmount = rentDue - depositRefund;
      return json({ lockerNo: locker.locker_no, rentDue, depositRefund, netAmount });
    },
    remove_locker: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { lockerId, paymentMode, cashAmount, upiAmount, withholdDeposit } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      // withholdDeposit forfeits the caution deposit instead of refunding it (e.g. the
      // locker was damaged) — the locker is still freed either way, just not paid back.
      const rentDue = Number(locker.fee_due ?? 0);
      const depositRefund = locker.deposit_returned || withholdDeposit ? 0 : Number(locker.deposit_amount ?? 0);
      const netAmount = rentDue - depositRefund;
      if (netAmount > 0 && !paymentMode) {
        return err(`₹${netAmount} still needs to be collected before returning the locker — choose a payment mode.`);
      }

      // Claim the locker first, conditional on it still being active: two Remove clicks
      // landing together both read deposit_returned=false above, and without this guard both
      // would pay the deposit out (same pattern as close/delete membership).
      const { data: releasedRows, error: relErr } = await db.from("lockers")
        .update({ is_active: false, fee_due: 0, deposit_returned: true })
        .eq("id", lockerId).eq("is_active", true).select("id");
      if (relErr) return err(relErr.message);
      if (!releasedRows?.length) return err("This locker has already been returned — refresh to see its current state.");

      if (netAmount > 0) {
        // Owed rent exceeds the deposit that would offset it — collect just the difference.
        await insertPaymentTransactions(db, {
          student_id: locker.student_id, branch_id: locker.branch_id, category: "locker",
          notes: `Locker removed — outstanding rent (₹${rentDue}) net of deposit (₹${depositRefund})`,
          created_by_staff_id: staff.id,
        }, paymentMode, netAmount, cashAmount, upiAmount);
      } else if (netAmount < 0) {
        // Deposit refund exceeds any owed rent — the branch owes the student the difference.
        await recordPayout(db, {
          student_id: locker.student_id, branch_id: locker.branch_id, payout_type: "locker_deposit",
          amount: -netAmount, notes: "Locker caution deposit returned — locker removed",
          created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, locker.student_id);
      return json({ ok: true, rentDue, depositRefund, netAmount });
    },
    update_locker_due_date: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { lockerId, dueDate } = payload;
      if (!dueDate) return err("Due date is required");
      const { data: locker } = await db.from("lockers").select("branch_id, student_id").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      await db.from("lockers").update({ locker_due_date: dueDate }).eq("id", lockerId);
      if (locker.student_id) await refreshStudentStatus(db, locker.student_id);
      return json({ ok: true });
    },
    // Reassigns which physical locker number is on record for this student (e.g. staff
    // typo'd the number when adding it, or the student is moved to a different locker) —
    // doesn't touch fee/due-date/deposit, purely a label swap onto a still-free number.
    update_locker_number: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { lockerId, lockerNo } = payload;
      if (!lockerNo) return err("Locker number is required");
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);
      if (lockerNo === locker.locker_no) return err("That's already this locker's number");

      const { data: existing } = await db.from("lockers").select("id")
        .eq("branch_id", locker.branch_id).eq("locker_no", lockerNo).eq("is_active", true).maybeSingle();
      if (existing) return err(`Locker ${lockerNo} is already assigned to another student`);

      await db.from("lockers").update({ locker_no: lockerNo }).eq("id", lockerId);
      return json({ ok: true });
    },
    // ─── PAUSE / RESUME MEMBERSHIP ───
    pause_membership: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (mem.is_paused) return err("Membership is already on hold");
      if (await hasOpenSession(db, mem.student_id)) {
        return err("This student is currently checked in — check them out before putting the membership on hold.");
      }
      const pausedAtNow = new Date().toISOString();

      // A permanent member's cabin sits idle while they're on hold — free it up so it can
      // be assigned to someone else in the meantime, rather than reserving a seat nobody's
      // using. Resuming will require picking a cabin again (possibly a different one).
      const releasingDesk = mem.category === "permanent" && !!mem.desk_id;
      if (releasingDesk) {
        const { error: deskErr } = await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
        if (deskErr) return err(deskErr.message);
      }

      await db.from("memberships").update({
        is_paused: true, paused_at: pausedAtNow,
        ...(releasingDesk ? { desk_id: null, cabin_no: null } : {}),
      }).eq("id", membershipId);
      await db.from("membership_holds").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        paused_at: pausedAtNow,
      });
      return json({ ok: true, deskReleased: releasingDesk });
    },
    resume_membership: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, deskId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_paused) return err("Membership is not on hold");

      // Their old cabin was freed for reuse when they paused, so a permanent membership
      // needs a (possibly new) cabin picked before it can resume, to avoid two students
      // colliding on the same seat.
      let newDeskId = mem.desk_id;
      let newCabinNo = mem.cabin_no;
      if (mem.category === "permanent" && !mem.desk_id) {
        if (!deskId) return err("Select a cabin to resume this permanent membership");
        const { data: desk } = await db.from("desks").select("*").eq("id", deskId).eq("branch_id", mem.branch_id).single();
        if (!desk) return err("Cabin not found");
        if (desk.status !== "free") return err("Selected cabin is not available");
        if (!(await claimDesk(db, deskId, mem.student_id))) {
          return err("That cabin was just taken — pick another one.");
        }
        newDeskId = deskId;
        newCabinNo = desk.label;
      }

      // Calendar-day difference (IST), not raw elapsed hours — pausing and resuming on the
      // same IST calendar day is 0 days paused, not a floored-up 1. Using millisecond
      // elapsed time here previously rounded any same-day hold up to a full day, extending
      // the membership by a day it never actually lost.
      const pausedDateStr = toISTDateStr(mem.paused_at);
      const daysPaused = Math.max(0, Math.round(
        (new Date(todayISO() + "T00:00:00Z").getTime() - new Date(pausedDateStr + "T00:00:00Z").getTime()) / 86_400_000,
      ));
      const newEndDate = addDays(mem.end_date, daysPaused);

      await db.from("memberships").update({
        is_paused: false, paused_at: null,
        hold_days: (mem.hold_days ?? 0) + daysPaused,
        end_date: newEndDate, desk_id: newDeskId, cabin_no: newCabinNo,
      }).eq("id", membershipId);
      await db.from("membership_holds")
        .update({ resumed_at: new Date().toISOString(), days_paused: daysPaused })
        .eq("membership_id", membershipId).is("resumed_at", null);
      return json({ ok: true, daysPaused, newEndDate, cabinNo: newCabinNo });
    },
    // ─── STUDENTS LIST (spreadsheet view) ───
    list_students: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
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

      const { data: students } = await db.from("students").select("*, branches(name)").in("branch_id", branchIds).order("s_no");
      const { data: memberships } = await db.from("memberships").select("*").in("branch_id", branchIds).eq("is_active", true);
      const { data: lockers } = await db.from("lockers").select("*").in("branch_id", branchIds).eq("is_active", true);

      const memByStudent = new Map(memberships?.map(m => [m.student_id, m]) ?? []);
      const lockerByStudent = new Map(lockers?.map(l => [l.student_id, l]) ?? []);

      const listToday = todayISO();
      const rows = (students ?? []).map((s, i) => {
        const mem = memByStudent.get(s.id);
        const locker = lockerByStudent.get(s.id);
        // Derived live rather than read from s.status — see computeStudentStatus().
        const liveStatus = computeStudentStatus(mem, locker, listToday);
        return {
          sNo: s.s_no ?? i + 1,
          id: s.id,
          name: s.name,
          branches: s.branches,
          cabin: mem?.cabin_no ?? "-",
          // Start of the current (latest-renewed) membership and the real last paid day —
          // unlike dueDate, endDate reflects every month paid (same date the status uses).
          startDate: mem?.start_date ?? "-",
          endDate: mem?.end_date ?? "-",
          dueDate: mem?.due_date ?? "-",
          month: mem?.month ?? "-",
          hours: mem?.hours_per_day ?? "-",
          timings: mem?.timings ?? "-",
          locker: locker?.locker_no ?? "-",
          lockerDue: locker?.locker_due_date ?? "-",
          course: s.course ?? "-",
          contact: s.phone,
          status: liveStatus,
          isOverdue: mem ? mem.due_date < listToday && mem.fee_due > 0 : false,
          lockerOverdue: locker ? locker.locker_due_date && locker.locker_due_date < listToday : false,
          totalVisits: s.total_visits,
          totalHours: s.total_hours_studied,
        };
      });

      return json({ students: rows });
    },
    get_student_profile: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId } = payload;
      const { data: student } = await db.from("students").select("*").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);

      const { data: memberships } = await db.from("memberships").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
      // 100, not 50: the WhatsApp study report reads its 21-day window from this list, and a
      // student with a few sessions a day would otherwise push the oldest days off the end.
      const { data: bookings } = await db.from("bookings").select("*, desks!desk_id(label)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(100);
      const { data: transactions } = await db.from("transactions").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: locker } = await db.from("lockers").select("*").eq("student_id", studentId).eq("is_active", true).maybeSingle();
      const { data: overtimeSessions } = await db.from("overtime_sessions").select("*").eq("student_id", studentId).order("session_date", { ascending: false }).limit(50);
      const { data: holds } = await db.from("membership_holds").select("*").eq("student_id", studentId).order("paused_at", { ascending: false }).limit(50);
      const { data: discounts } = await db.from("membership_discounts").select("*, staff(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: cashbacksRaw } = await db.from("cashbacks").select("*, staff:granted_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: planChanges } = await db.from("membership_plan_changes").select("*, staff:changed_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
      const { data: edits } = await db.from("membership_edits").select("*, staff:changed_by_staff_id(display_name, username)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);

      // Percent-type cashbacks that are still pending have no fixed rupee value yet — same
      // estimate as the Students page Cashback tab, off this student's current active
      // membership (monthly_fee * months_paid), so the Value column can show it alongside
      // the raw percentage instead of just "5%" with no sense of what that's actually worth.
      const activeMemForCashback = (memberships ?? []).find((m: { is_active: boolean }) => m.is_active);
      const cashbacks = (cashbacksRaw ?? []).map((c: Record<string, unknown>) => {
        let estimatedAmount = null;
        if (c.cashback_type === "fixed") {
          estimatedAmount = Number(c.cashback_value);
        } else if (c.status === "pending") {
          if (activeMemForCashback) {
            estimatedAmount = Number(activeMemForCashback.monthly_fee) * Number(activeMemForCashback.months_paid) * (Number(c.cashback_value) / 100);
          }
        } else {
          estimatedAmount = c.redeemed_amount != null ? Number(c.redeemed_amount) : null;
        }
        return { ...c, estimatedAmount };
      });

      // Same live status the Students list shows (computeStudentStatus), not the stored
      // column — which only refreshes on some events and so drifts (e.g. a locker added to
      // a walk-in, or a membership lapsing overnight).
      const liveStatus = computeStudentStatus(activeMemForCashback, locker, todayISO());

      // What renew_membership will add/apply, uncapped — the history lists above stop at 50
      // rows, so a renewal total built from them could miss an older unbilled overtime row
      // or pending cashback and then disagree with the amount actually charged.
      const [unbilledOvertime, pendingCashbacks] = await Promise.all([
        fetchAllRows<{ billed_amount: number | null }>(() => db.from("overtime_sessions").select("billed_amount")
          .eq("student_id", studentId).is("billed_at", null).eq("excluded", false).order("id")),
        fetchAllRows<{ cashback_type: string; cashback_value: number }>(() => db.from("cashbacks").select("cashback_type, cashback_value")
          .eq("student_id", studentId).eq("status", "pending").order("id")),
      ]);
      const unbilledOvertimeDue = unbilledOvertime.reduce((sum, o) => sum + Number(o.billed_amount ?? 0), 0);

      return json({
        student: { ...student, status: liveStatus }, memberships, bookings, transactions, locker,
        overtimeSessions: overtimeSessions ?? [], holds: holds ?? [], discounts: discounts ?? [],
        cashbacks, planChanges: planChanges ?? [], edits: edits ?? [],
        unbilledOvertimeDue, pendingCashbacks,
      });
    },
    // Edit a student's personal details from their profile — any staff role, limited to
    // their own branch (owner/admin: any branch). Only identity/contact fields: status,
    // branch (Transfer Branch), counters and membership data all have their own flows.
    update_student_details: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, name, phone, emergencyContact, course, referralSource } = payload;
      const { data: student } = await db.from("students").select("id, branch_id").eq("id", studentId).maybeSingle();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);

      const cleanName = String(name ?? "").trim();
      const cleanPhone = String(phone ?? "").trim();
      const cleanEmergency = String(emergencyContact ?? "").trim();
      const cleanCourse = String(course ?? "").trim();
      if (!cleanName) return err("Name is required");
      if (!/^\d{10}$/.test(cleanPhone)) return err("Phone must be a 10 digit number");
      // Optional so walk-ins (who never gave one) can still be edited, but if present it
      // follows the registration rules.
      if (cleanEmergency && !/^\d{10}$/.test(cleanEmergency)) return err("Emergency contact must be a 10 digit phone number");
      if (cleanEmergency && cleanEmergency === cleanPhone) return err("Emergency contact cannot be the same as the primary phone number");
      const validReferrals = ["google_search", "instagram", "word_of_mouth", "flex", "ai_platform"];
      if (referralSource && !validReferrals.includes(referralSource)) return err("Invalid referral source");

      // Phone is the unique key used to recognise returning students and walk-ins, so it
      // can't collide with anyone else's (friendly message instead of the DB unique error).
      const { data: phoneOwner } = await db.from("students").select("id, name").eq("phone", cleanPhone).neq("id", studentId).maybeSingle();
      if (phoneOwner) return err(`Phone ${cleanPhone} already belongs to another student (${phoneOwner.name})`);

      const { data: updated, error: upErr } = await db.from("students").update({
        name: cleanName, phone: cleanPhone,
        emergency_contact: cleanEmergency || null,
        course: cleanCourse || null,
        referral_source: referralSource || null,
        updated_at: new Date().toISOString(),
      }).eq("id", studentId).select("*").single();
      if (upErr) {
        if (upErr.code === "23505") return err(`Phone ${cleanPhone} already belongs to another student`);
        return err(upErr.message);
      }
      return json({ ok: true, student: updated });
    },
    // Owner-only: permanently move a student (and their active membership) to a
    // different branch. A permanent-cabin desk is physically tied to its old branch, so
    // it's released there rather than dragged along — a permanent member must be handed
    // a specific free desk at the destination branch instead, and the transfer is refused
    // outright if none are available, rather than silently leaving them without a seat.
    transfer_student_branch: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, newBranchId, deskId } = payload;
      if (!studentId || !newBranchId) return err("Student and destination branch are required");

      const { data: student } = await db.from("students").select("id, branch_id").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (student.branch_id === newBranchId) return err("Student is already at this branch");
      // Staff can transfer, but only students who are currently at their own branch — they
      // can't reach into another branch and move someone out of it. Owners are unrestricted.
      if (!requireBranch(staff, student.branch_id!)) return err("Branch access denied", 403);

      const { data: newBranch } = await db.from("branches").select("id").eq("id", newBranchId).eq("is_active", true).maybeSingle();
      if (!newBranch) return err("Destination branch not found");

      if (await hasOpenSession(db, studentId)) {
        return err("This student is currently checked in — check them out before transferring them to another branch.");
      }

      const { data: activeMem } = await db.from("memberships").select("id, desk_id, category").eq("student_id", studentId).eq("is_active", true).maybeSingle();

      let newDesk: { id: string; label: string } | null = null;
      if (activeMem?.category === "permanent") {
        if (!deskId) return err("Select a cabin at the destination branch");
        const { data: desk } = await db.from("desks").select("id, label, status").eq("id", deskId).eq("branch_id", newBranchId).maybeSingle();
        if (!desk) return err("Cabin not found at the destination branch");
        if (desk.status !== "free") return err("Selected cabin is no longer available — pick another one");
        newDesk = desk;
      }

      // Claim the destination cabin BEFORE releasing the current one: if the claim loses a
      // race, the student keeps the seat they already had instead of ending up with none.
      if (newDesk && !(await claimDesk(db, newDesk.id, studentId))) {
        return err("That cabin was just taken at the destination branch — pick another one.");
      }
      if (activeMem?.desk_id) {
        const { error: releaseErr } = await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", activeMem.desk_id);
        if (releaseErr) return err(releaseErr.message);
      }
      if (activeMem) {
        const { error: memErr } = await db.from("memberships").update({
          branch_id: newBranchId,
          desk_id: newDesk?.id ?? null, cabin_no: newDesk?.label ?? null,
          seat_type: newDesk ? "fixed" : activeMem.category === "permanent" ? "floating" : undefined,
        }).eq("id", activeMem.id);
        if (memErr) return err(memErr.message);
      }

      // A locker is physically tied to its branch, so it's surrendered on transfer. That's a
      // real settlement, not a silent flag flip: any unpaid rent is carried onto the
      // membership's fee_due (so it's still collected rather than vanishing), and the caution
      // deposit is genuinely refunded via a payouts row — previously this line just marked
      // deposit_returned = true with no money moving and wrote off pending rent entirely.
      const { data: transferLocker } = await db.from("lockers").select("*")
        .eq("student_id", studentId).eq("is_active", true).maybeSingle();
      let lockerRentCarried = 0;
      let lockerDepositRefunded = 0;
      if (transferLocker) {
        lockerRentCarried = Number(transferLocker.fee_due ?? 0);
        lockerDepositRefunded = transferLocker.deposit_returned ? 0 : Number(transferLocker.deposit_amount ?? 0);

        await db.from("lockers").update({ is_active: false, fee_due: 0, deposit_returned: true })
          .eq("id", transferLocker.id);

        if (lockerDepositRefunded > 0) {
          await recordPayout(db, {
            student_id: studentId, branch_id: transferLocker.branch_id, payout_type: "locker_deposit",
            amount: lockerDepositRefunded, notes: "Locker caution deposit returned — student transferred branch",
            created_by_staff_id: staff.id,
          });
        }
        if (lockerRentCarried > 0 && activeMem) {
          const { data: memRow } = await db.from("memberships").select("fee_due").eq("id", activeMem.id).single();
          await db.from("memberships")
            .update({ fee_due: Number(memRow?.fee_due ?? 0) + lockerRentCarried })
            .eq("id", activeMem.id);
        }
      }

      const { error } = await db.from("students").update({ branch_id: newBranchId }).eq("id", studentId);
      if (error) return err(error.message);

      return json({ ok: true, lockerRentCarried, lockerDepositRefunded });
    },
    // One-off owner-triggered repair for rows written before the addMonths/addDays
    // timezone fix and the switch to an inclusive-end billing convention — recomputes
    // end_date/due_date purely from each membership's own start_date, months_paid and
    // accumulated hold_days (the source-of-truth fields, which were never wrong), so
    // it's safe to run more than once and only touches rows that actually drifted.
    fix_membership_dates: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { data: memberships } = await db.from("memberships")
        .select("id, start_date, months_paid, hold_days, end_date, due_date");
      let fixed = 0;
      for (const m of memberships ?? []) {
        const correctEndDate = addDays(endDateForMonths(m.start_date, m.months_paid), m.hold_days ?? 0);
        const correctDueDate = addDays(endDateForMonths(m.start_date, 1), 1);
        if (correctEndDate !== m.end_date || correctDueDate !== m.due_date) {
          await db.from("memberships").update({ end_date: correctEndDate, due_date: correctDueDate }).eq("id", m.id);
          fixed++;
        }
      }
      return json({ ok: true, checked: (memberships ?? []).length, fixed });
    },
    // ─── ACTIVE MEMBERSHIPS ───
    list_active_memberships: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
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
      const { data } = await db.from("memberships")
        .select("id, branch_id, category, hours_per_day, hours_per_day_weekend, monthly_fee, start_date, end_date, cabin_no, is_paused, hold_days, fee_due, total_paid, students(id, name, phone), branches(name)")
        .in("branch_id", branchIds)
        .eq("is_active", true)
        .order("end_date");
      type MemRow = { id: string; branch_id: string; category: string; hours_per_day: number; hours_per_day_weekend: number | null; monthly_fee: number; start_date: string; end_date: string; cabin_no: string | null; is_paused: boolean; hold_days: number; fee_due: number; total_paid: number; students: { id: string; name: string; phone: string } | null; branches: { name: string } | null };
      const studentIds = (data as MemRow[] ?? []).map(m => m.students?.id).filter((id): id is string => !!id);
      const { data: pendingCashbacks } = studentIds.length
        ? await db.from("cashbacks").select("student_id, cashback_type, cashback_value").in("student_id", studentIds).eq("status", "pending")
        : { data: [] };
      const cashbackByStudent = new Map((pendingCashbacks ?? []).map((c: { student_id: string; cashback_type: string; cashback_value: number }) => [c.student_id, c]));
      // The renewal dialog has to show the same total renew_membership will charge, which
      // applies EVERY pending cashback (not just one) and adds any unbilled Pay Later overtime.
      const allCashbacksByStudent = new Map<string, { cashback_type: string; cashback_value: number }[]>();
      for (const c of (pendingCashbacks ?? []) as { student_id: string; cashback_type: string; cashback_value: number }[]) {
        allCashbacksByStudent.set(c.student_id, [...(allCashbacksByStudent.get(c.student_id) ?? []), { cashback_type: c.cashback_type, cashback_value: c.cashback_value }]);
      }
      const unbilledOvertimeRows = studentIds.length
        ? await fetchAllRows<{ student_id: string; billed_amount: number | null }>(() => db.from("overtime_sessions").select("student_id, billed_amount")
          .in("student_id", studentIds).is("billed_at", null).eq("excluded", false).order("id"))
        : [];
      const overtimeDueByStudent = new Map<string, number>();
      for (const o of unbilledOvertimeRows) {
        overtimeDueByStudent.set(o.student_id, (overtimeDueByStudent.get(o.student_id) ?? 0) + Number(o.billed_amount ?? 0));
      }

      const members = (data as MemRow[] ?? []).map(m => ({
        membership_id: m.id,
        branch_id: m.branch_id,
        branches: m.branches,
        student_id: m.students?.id,
        student_name: m.students?.name,
        student_phone: m.students?.phone,
        category: m.category,
        hours_per_day: m.hours_per_day,
        hours_per_day_weekend: m.hours_per_day_weekend,
        monthly_fee: m.monthly_fee,
        cabin_no: m.cabin_no,
        start_date: m.start_date,
        end_date: m.end_date,
        is_paused: m.is_paused,
        hold_days: m.hold_days,
        fee_due: m.fee_due,
        total_paid: m.total_paid,
        pending_cashback: m.students?.id ? (cashbackByStudent.get(m.students.id) ?? null) : null,
        pending_cashbacks: m.students?.id ? (allCashbacksByStudent.get(m.students.id) ?? []) : [],
        unbilled_overtime_due: m.students?.id ? (overtimeDueByStudent.get(m.students.id) ?? 0) : 0,
      }));

      // Renewal reminders for the final week. Once the 06:00 cron job is switched on
      // (pssai_cron), it creates them instead and opening this list has no side effect.
      if (!(await featureOn(db, "cron"))) await remindExpiringMembers(db, members);

      return json({ members });
    },
    // Mid-cycle plan change (temp <-> permanent, or an hours/day change) on the CURRENT
    // active membership — doesn't touch the expiry date or months_paid, just prorates the
    // difference between old and new daily rate over the days remaining in the cycle.
    // Logged to membership_plan_changes so the closure summary can show every plan a
    // student was on during this membership period.
    change_membership_plan: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, newCategory, newHoursPerDay, newEndDate } = payload;
      if (!["temporary", "permanent"].includes(newCategory)) return err("Invalid category");
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      { const gap = notStartedYetMessage(mem, "change the plan from the membership that is running now"); if (gap) return err(gap); }
      if (!mem.is_active) return err("Membership is not active");

      const newHours = Number(newHoursPerDay);
      const newMonthlyFee = await getMembershipPackage(db, newHours, newCategory);
      if (!newMonthlyFee) return err("Invalid membership package for that category/hours combination");
      const planUnchanged = newCategory === mem.category && newHours === Number(mem.hours_per_day);
      const wantsEndDateChange = newEndDate && newEndDate !== mem.end_date;
      if (planUnchanged && !wantsEndDateChange) {
        return err("That's already the current plan");
      }
      // A membership can't end before it starts — this is the same hand-edited end_date
      // that once collapsed to 1 day after start_date and blew up the per-day rate used by
      // Quit/Delete Membership (see membershipTotalDays). That's now floored so it can't
      // overcharge, but there's no legitimate reason to allow the date itself to be invalid.
      if (wantsEndDateChange && newEndDate < mem.start_date) {
        return err("End date can't be before the membership's start date");
      }

      // An expired membership can still have its due/end date corrected — staff routinely fix
      // a date that was mistyped at signup, or extend one that lapsed over a holiday, and
      // forcing a renewal to do that would fabricate a payment that never happened. The plan
      // itself stays locked though: proration is computed over days remaining, and on an
      // expired membership that count is zero or negative, so a category/hours change here
      // would bill a nonsense amount.
      const alreadyExpired = mem.end_date < todayISO();
      if (alreadyExpired && !planUnchanged) {
        return err("Membership has expired — renew it before changing the plan. You can still correct the expiry date on its own.");
      }

      const today = todayISO();
      const remainingDays = Math.max(1, Math.ceil((new Date(mem.end_date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86_400_000));
      const oldDailyRate = Number(mem.monthly_fee) / 30;
      const newDailyRate = newMonthlyFee / 30;
      const proratedAmount = Math.round((newDailyRate - oldDailyRate) * remainingDays);

      // Reassign the cabin/seat if the category is changing, same as at renewal.
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
          if (!(await claimDesk(db, freeDesk.id, mem.student_id))) {
            return err("That cabin was just taken — please try again.");
          }
          deskId = freeDesk.id;
          cabinNo = freeDesk.label;
        }
      }

      // A cheaper plan credits the difference against fee_due (and banks any leftover as
      // cashback, same pattern as a discount); a pricier plan adds to fee_due to be collected.
      let newFeeDue = Number(mem.fee_due);
      let bankedAsCashback = 0;
      if (proratedAmount > 0) {
        newFeeDue += proratedAmount;
      } else if (proratedAmount < 0) {
        const credit = -proratedAmount;
        const appliedToFee = Math.min(credit, newFeeDue);
        newFeeDue -= appliedToFee;
        bankedAsCashback = credit - appliedToFee;
        if (bankedAsCashback > 0) {
          await db.from("cashbacks").insert({
            student_id: mem.student_id, branch_id: mem.branch_id,
            month_label: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
            cashback_type: "fixed", cashback_value: bankedAsCashback,
            notes: "Banked from a plan downgrade credit that exceeded the pending fee",
            granted_by_staff_id: staff.id,
          });
        }
      }

      // due_date is always the day right after end_date (the inclusive-end billing
      // convention — see endDateForMonths) — a manual end-date edit must shift it in step
      // so the two never drift apart.
      await db.from("memberships").update({
        category: newCategory, hours_per_day: newHours, monthly_fee: newMonthlyFee,
        seat_type: seatType, desk_id: deskId, cabin_no: cabinNo, fee_due: newFeeDue,
        ...(wantsEndDateChange ? { end_date: newEndDate, due_date: addDays(newEndDate, 1) } : {}),
      }).eq("id", membershipId);

      if (!planUnchanged) {
        await db.from("membership_plan_changes").insert({
          membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
          old_category: mem.category, old_hours_per_day: mem.hours_per_day, old_monthly_fee: mem.monthly_fee,
          new_category: newCategory, new_hours_per_day: newHours, new_monthly_fee: newMonthlyFee,
          prorated_amount: proratedAmount, changed_by_staff_id: staff.id,
        });
      }
      if (wantsEndDateChange) {
        await db.from("membership_edits").insert({
          membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
          edit_type: "end_date", old_value: mem.end_date, new_value: newEndDate,
          changed_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, proratedAmount, newFeeDue, bankedAsCashback, remainingDays });
    },
    // Reassign a permanent member to a different cabin/desk — e.g. they asked to move, or
    // the current desk needs to be freed up for maintenance.
    change_membership_cabin: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, deskId: newDeskId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_active) return err("Membership is not active");
      if (mem.end_date < todayISO()) return err("Membership has expired — renew it before changing the cabin");
      if (mem.category !== "permanent") return err("Only permanent memberships have an assigned cabin");

      const { data: newDesk } = await db.from("desks").select("*").eq("id", newDeskId).eq("branch_id", mem.branch_id).single();
      if (!newDesk) return err("Desk not found");
      if (newDesk.status !== "free") return err("Selected cabin is not available");

      // Claim the new cabin before releasing the old one — losing the race must leave them
      // on their existing seat rather than with none at all.
      if (!(await claimDesk(db, newDesk.id, mem.student_id))) {
        return err("That cabin was just taken — pick another one.");
      }
      if (mem.desk_id) {
        await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
      }
      await db.from("memberships").update({ desk_id: newDesk.id, cabin_no: newDesk.label }).eq("id", membershipId);
      await db.from("membership_edits").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        edit_type: "cabin", old_value: mem.cabin_no, new_value: newDesk.label,
        changed_by_staff_id: staff.id,
      });

      // If they're currently mid-session in the old cabin, move the active booking's desk too.
      const { data: activeBooking } = await db.from("bookings").select("id, desk_id")
        .eq("membership_id", membershipId).eq("status", "active").maybeSingle();
      if (activeBooking) {
        await db.from("bookings").update({ desk_id: newDesk.id }).eq("id", activeBooking.id);
        await db.from("desks").update({ current_booking_id: activeBooking.id }).eq("id", newDesk.id);
      }

      return json({ ok: true, cabinNo: newDesk.label });
    },
    // ─── RENEW MEMBERSHIP ───
    renew_membership: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const {
        membershipId, monthsPaid, paymentMode, cashAmount, upiAmount, advanceAmount, category, hoursPerDay,
        isCustomPlan, customAmount, weekendHours,
        isCustomDays, customDays, customDaysAmount, startDate: customStartDate, expectedTotal,
      } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      // Renewal creates a new membership row and charges for it, so a double-submit (an
      // impatient second click, a stale tab) would bill the student twice and leave two
      // memberships behind. The fee_due check below can't catch that — a fully-paid renewal
      // leaves the old row at 0 due, so the second attempt sails straight past it. Same
      // re-entry guard delete_membership already uses.
      if (!mem.is_active) {
        return err("This membership has already been renewed or ended — refresh to see the current one.");
      }
      if (Number(mem.fee_due ?? 0) > 0) {
        return err(`This membership still has ₹${Number(mem.fee_due)} pending — clear it before renewing.`);
      }
      // RSP R4: an on-hold membership has a moving end date (resuming extends it) and an open
      // hold row — renewing it used to leave that hold open forever on the old membership.
      if (mem.is_paused) return err("This membership is on hold — resume it before renewing.");
      // RSP R4: this membership is itself an early renewal that hasn't started yet.
      if (mem.start_date > todayISO()) {
        return err(`This student has already renewed early — the new period starts on ${mem.start_date}. Cancel that early renewal first if it needs to change.`);
      }
      const kind = renewalKind(mem.end_date, todayISO());

      const wasCustomPlan = mem.hours_per_day_weekend != null;
      const newCategory = category ?? mem.category;

      // A custom plan renews the same way it was created — a negotiated amount and
      // weekday/weekend hours instead of a fee_config package lookup. If the renewal
      // doesn't explicitly re-specify custom terms, the expiring membership's own custom
      // amount/hours just carry forward unchanged.
      let monthlyFee: number;
      let newHoursPerDay: number;
      let newWeekendHours: number | null = null;
      if (isCustomPlan || (wasCustomPlan && isCustomPlan === undefined)) {
        monthlyFee = customAmount != null ? Number(customAmount) : Number(mem.monthly_fee);
        if (!(monthlyFee > 0)) return err("Enter a valid custom amount");
        newHoursPerDay = hoursPerDay != null ? Number(hoursPerDay) : Number(mem.hours_per_day);
        if (!(newHoursPerDay > 0)) return err("Enter valid weekday hours");
        newWeekendHours = weekendHours != null ? Number(weekendHours) : Number(mem.hours_per_day_weekend ?? newHoursPerDay);
      } else {
        newHoursPerDay = Number(hoursPerDay ?? mem.hours_per_day);
        const pkgFee = await getMembershipPackage(db, newHoursPerDay, newCategory);
        if (!pkgFee) return err("Invalid membership package");
        monthlyFee = pkgFee;
      }

      // RSP R3: an early renewal keeps the same plan. The new membership becomes the active one
      // straight away, so a different plan would apply to the days the student already paid for
      // under the old one (a free upgrade, or a downgrade nobody asked for). Change Plan works
      // normally once the new period has started.
      if (kind === "early") {
        const oldWeekend = mem.hours_per_day_weekend != null ? Number(mem.hours_per_day_weekend) : null;
        if (newCategory !== mem.category || newHoursPerDay !== Number(mem.hours_per_day) || (newWeekendHours ?? null) !== oldWeekend) {
          return err(`An early renewal keeps the same plan (${mem.category}, ${mem.hours_per_day}h/day). Renew on the same plan now, then use Change Plan from ${addDays(mem.end_date, 1)} when the new period starts.`);
        }
      }

      // Same custom-day-count model as create_membership — bypasses the whole-month billing
      // entirely, auto-prorated from monthlyFee but overridable via customDaysAmount.
      const isCustomDaysPlan = !!isCustomDays;
      let months: number;
      let discount: number;
      let gross: number;
      let customDaysCount: number | null = null;
      if (isCustomDaysPlan) {
        customDaysCount = Number(customDays);
        if (!(customDaysCount > 0)) return err("Enter a valid number of days");
        months = Math.max(1, Math.round(customDaysCount / 30));
        discount = 0;
        gross = customDaysAmount != null && customDaysAmount !== ""
          ? Number(customDaysAmount)
          : Math.round((monthlyFee / 30) * customDaysCount);
        if (!(gross > 0)) return err("Enter a valid amount collected");
      } else {
        months = Number(monthsPaid) || 1;
        discount = multiMonthDiscount(months);
        gross = monthlyFee * months;
      }
      const totalBeforeCashback = gross * (1 - discount / 100);

      const { cashbackAmount, contribs: cashbackContribs } = await settlePendingCashbacks(db, mem.student_id, totalBeforeCashback);

      // Any "Pay Later" overtime logged since the last settlement gets folded into this
      // renewal's bill — each row already carries its own flat-rate-computed charge from
      // checkout time (computeOvertimeCharge), so this just sums what's still unbilled
      // rather than re-deriving an amount from raw minutes.
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      const totalFee = totalBeforeCashback - cashbackAmount + overtimeDue;

      // Full payment records totalFee as collected, so it has to be the amount the renewal
      // form showed staff. The forms used to leave out unbilled overtime and count only one
      // of several pending cashbacks, so the ledger could claim money nobody was asked for
      // (or a split payment was rejected as not adding up). expectedTotal is what the form
      // displayed; a mismatch means its data was stale, so stop before anything is written.
      if (advanceAmount == null && expectedTotal != null && Math.abs(Number(expectedTotal) - totalFee) > 0.5) {
        const parts = [
          `₹${Math.round(totalBeforeCashback * 100) / 100} renewal`,
          cashbackAmount > 0 && `− ₹${Math.round(cashbackAmount * 100) / 100} cashback`,
          overtimeDue > 0 && `+ ₹${overtimeDue} unbilled overtime`,
        ].filter(Boolean).join(" ");
        return err(`The amount due is ₹${Math.round(totalFee * 100) / 100} (${parts}), but the form showed ₹${expectedTotal}. Close the form, refresh, and renew again.`);
      }
      if (advanceAmount != null) {
        const adv = Number(advanceAmount);
        if (!(adv >= 0)) return err("Enter a valid advance amount");
        if (Math.round(adv * 100) > Math.round(totalFee * 100)) {
          return err(`The advance (₹${adv}) is more than the ₹${Math.round(totalFee * 100) / 100} due — choose Full payment instead.`);
        }
      }

      const feePaid = advanceAmount != null ? Number(advanceAmount) : totalFee;
      const feeDue = Math.max(totalFee - feePaid, 0);

      const today = todayISO();
      // RSP R2 — the start date follows from the renewal kind:
      //  • early (on or before end_date): the day after end_date, fixed. The student keeps every
      //    remaining day; this is the one case where the new period starts in the future.
      //  • grace (within MEMBERSHIP_GRACE_DAYS after end_date): also the day after end_date, fixed
      //    — the owner's rule is that grace days count as used whether or not the student came.
      //  • late: today by default; staff may backdate (a renewal actually paid a few days ago),
      //    but never into the old period and never into the future.
      // The current end_date is the last day covered (inclusive), so starting on it again would
      // double-count it — and staff picking "today" during the early window used to silently
      // throw away the student's remaining days.
      const continuationStart = addDays(mem.end_date, 1);
      let startDate: string;
      if (kind === "late") {
        startDate = customStartDate || today;
        if (!isISODate(startDate)) return err("Invalid start date");
        if (startDate > today) return err("Start date cannot be in the future");
        if (startDate < continuationStart) {
          return err(`The start date can't be before ${continuationStart} — that would overlap the previous plan.`);
        }
      } else {
        if (customStartDate && customStartDate !== continuationStart) {
          return err(`This is ${kind === "early" ? "an early" : "a grace-period"} renewal — the new period starts on ${continuationStart}, the day after the current plan ends.`);
        }
        startDate = continuationStart;
      }
      // Checked before anything is written: insertPaymentTransactions throws on a split that
      // doesn't add up, and by then the renewal would already be half done.
      if (paymentMode === "split" && feePaid > 0) {
        const splitPaise = Math.round(((Number(cashAmount) || 0) + (Number(upiAmount) || 0)) * 100);
        if (splitPaise !== Math.round(feePaid * 100)) return err("Cash + UPI amounts must add up to the total");
      }
      const endDate = isCustomDaysPlan ? addDays(startDate, customDaysCount! - 1) : endDateForMonths(startDate, months);
      const dueDate = isCustomDaysPlan ? addDays(endDate, 1) : addDays(endDateForMonths(startDate, 1), 1);
      const monthLabel = new Date(startDate).toLocaleString("en-US", { month: "long", year: "numeric" });

      // Claim the renewal before writing anything: switch the old membership off only if it's
      // still active. The is_active check above is a separate read, so two submissions landing
      // together could both pass it and create two memberships with two charges — only one
      // request gets a row back here, and the other stops before anything is written. Every
      // failure below switches the old membership back on, so a failed renewal never leaves
      // the student with no membership at all.
      const { data: claimedRows, error: claimErr } = await db.from("memberships").update({ is_active: false })
        .eq("id", membershipId).eq("is_active", true).select("id");
      if (claimErr) return err(claimErr.message);
      if (!claimedRows?.length) {
        return err("This membership has already been renewed or ended — refresh to see the current one.");
      }
      const restoreOldMembership = () => db.from("memberships").update({ is_active: true }).eq("id", membershipId);

      // Plan can change on renewal — reassign the cabin/seat if the category changed. A new
      // cabin is claimed before the old one is released (and the old one only once the new
      // membership exists), so a failure part-way can't leave the student without a seat.
      let seatType = mem.seat_type;
      let deskId = mem.desk_id;
      let cabinNo = mem.cabin_no;
      let claimedNewDeskId: string | null = null;
      const categoryChanged = newCategory !== mem.category;
      if (categoryChanged) {
        deskId = null;
        cabinNo = null;
        seatType = newCategory === "permanent" ? "fixed" : "floating";
        if (newCategory === "permanent") {
          const { data: freeDesk } = await db.from("desks").select("*")
            .eq("branch_id", mem.branch_id).eq("status", "free").order("sort_order").limit(1).maybeSingle();
          if (!freeDesk) {
            await restoreOldMembership();
            return err("No cabin available for permanent membership");
          }
          if (!(await claimDesk(db, freeDesk.id, mem.student_id))) {
            await restoreOldMembership();
            return err("That cabin was just taken — please try again.");
          }
          deskId = freeDesk.id;
          cabinNo = freeDesk.label;
          claimedNewDeskId = freeDesk.id;
        }
      }

      const { data: newMem, error: mErr } = await db.from("memberships").insert({
        student_id: mem.student_id, branch_id: mem.branch_id,
        category: newCategory, seat_type: seatType,
        desk_id: deskId, cabin_no: cabinNo,
        month: monthLabel, hours_per_day: newHoursPerDay, hours_per_day_weekend: newWeekendHours,
        timings: mem.timings ?? '', start_date: startDate, end_date: endDate,
        due_date: dueDate, months_paid: months, discount_percent: discount,
        monthly_fee: monthlyFee, total_paid: feePaid, fee_due: feeDue,
        payment_mode: storedPaymentMode(paymentMode), created_by_staff_id: staff.id,
        // RSP: which membership this continued (Cancel Early Renewal restores it) and the plan's
        // own price/length (the exact per-day rate for a Delete refund).
        renewed_from_membership_id: mem.id,
        plan_amount: Math.round(totalBeforeCashback * 100) / 100,
        plan_days: isCustomDaysPlan ? customDaysCount : daysBetween(startDate, endDate) + 1,
      }).select("id").single();
      if (mErr) {
        if (claimedNewDeskId) {
          await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", claimedNewDeskId);
        }
        await restoreOldMembership();
        return err(mErr.message);
      }
      // The new membership exists — only now is it safe to give up the old cabin.
      if (categoryChanged && mem.desk_id) {
        await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
      }

      // The payment covers unbilled member overtime and the renewal itself. Each part is
      // recorded under its own category so Revenue's Overtime figure includes member overtime.
      // Overtime is paid off first: whatever a partial advance leaves unpaid stays on the new
      // membership's fee_due, and record_payment books that as membership — so the leftover
      // is always the renewal part, and every rupee ends up under the right heading.
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const overtimePaidNow = r2(Math.min(feePaid, overtimeDue));
      const renewalPaidNow = r2(feePaid - overtimePaidNow);
      let otCash: number | undefined, otUpi: number | undefined, renCash: number | undefined, renUpi: number | undefined;
      if (paymentMode === "split") {
        const cash = r2(Number(cashAmount) || 0);
        const upi = r2(Number(upiAmount) || 0);
        otCash = r2(Math.min(overtimePaidNow, cash));
        otUpi = r2(overtimePaidNow - otCash);
        renCash = r2(cash - otCash);
        renUpi = r2(upi - otUpi);
      }
      const ledgerBase = { student_id: mem.student_id, branch_id: mem.branch_id, membership_id: newMem!.id, created_by_staff_id: staff.id };
      await insertPaymentTransactions(db, {
        ...ledgerBase, category: "overtime",
        notes: `Overtime (${overtimeMinutes}m, Pay Later) settled at renewal`,
      }, paymentMode, overtimePaidNow, otCash, otUpi);
      await insertPaymentTransactions(db, {
        ...ledgerBase, category: "membership",
        notes: [
          kind === "early" ? `Renewal (early — starts ${startDate})` : kind === "grace" ? `Renewal (grace — from ${startDate})` : "Renewal",
          cashbackAmount > 0 ? `₹${r2(cashbackAmount)} cashback applied` : null,
        ].filter(Boolean).join(", "),
      }, paymentMode, renewalPaidNow, renCash, renUpi);

      // (The old membership was already switched off above, as the renewal's claim.)
      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      for (const c of cashbackContribs) {
        await db.from("cashbacks").update({
          status: "redeemed", redeemed_membership_id: newMem!.id,
          redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }

      if (unbilledOvertime?.length) {
        // billed_amount is already correct per-row (set at checkout time) — only mark
        // settled, don't overwrite each row with the aggregate sum.
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString() })
          .in("id", unbilledOvertime.map((o: { id: string }) => o.id));
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, membershipId: newMem!.id, kind, startDate, endDate,
        cashbackApplied: cashbackAmount > 0 ? cashbackAmount : null,
        overtimeCharged: overtimeDue > 0 ? overtimeDue : null,
      });
    },
    // RSP R6 — undo an early renewal before its new period starts (a mistake, or the student
    // changed their mind). Puts the student back exactly where they were: the previous
    // membership active again with its own end date, the renewal money refunded, cashbacks
    // that renewal used back to pending, and anything recorded in the meantime moved back.
    // Overtime that was settled inside the renewal stays settled — it was owed regardless.
    // Money is never deleted from the books: the refund is its own payout row.
    cancel_early_renewal: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, reason } = payload;
      if (!reason || !String(reason).trim()) return err("A reason is required to cancel an early renewal");
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      if (!mem.is_active) return err("This membership is no longer active — refresh to see the current one.");
      if (!(mem.start_date > todayISO())) {
        return err("This renewal has already started — it can't be cancelled. Use Delete Membership instead.");
      }
      if (!mem.renewed_from_membership_id) return err("This membership isn't an early renewal.");
      if (mem.is_paused) return err("This membership is on hold — resume it before cancelling the early renewal.");

      const { data: prev } = await db.from("memberships").select("*").eq("id", mem.renewed_from_membership_id).single();
      if (!prev) return err("The membership this renewed could not be found.");
      if (prev.is_active) return err("The previous membership is already active — refresh to see the current state.");
      if (prev.branch_id !== mem.branch_id) {
        return err("The student was moved to another branch after renewing early, so the previous membership can't be restored here. Use Delete Membership once the new period starts.");
      }

      // Renewal money actually received for the new membership: its "membership" ledger rows
      // (the renewal payment plus anything paid later against its dues). Its "overtime" rows
      // were old overtime settled at renewal and stay settled.
      const { data: paidRows, error: paidErr } = await db.from("transactions").select("amount")
        .eq("membership_id", mem.id).eq("category", "membership");
      if (paidErr) return err(paidErr.message, 500);
      const refund = Math.round((paidRows ?? []).reduce((sum, t: { amount: number }) => sum + Number(t.amount), 0) * 100) / 100;

      // Claim first (only one cancel can win), then restore — same pattern as renewal itself.
      const { data: endedRows, error: endErr } = await db.from("memberships").update({ is_active: false, fee_due: 0 })
        .eq("id", mem.id).eq("is_active", true).select("id");
      if (endErr) return err(endErr.message);
      if (!endedRows?.length) return err("This membership is no longer active — refresh to see the current one.");

      // Hold days taken during the gap pushed the NEW end date out; they belong to the old period.
      const gapHoldDays = Number(mem.hold_days ?? 0);
      const { error: restoreErr } = await db.from("memberships").update({
        is_active: true,
        end_date: gapHoldDays > 0 ? addDays(prev.end_date, gapHoldDays) : prev.end_date,
        hold_days: Number(prev.hold_days ?? 0) + gapHoldDays,
      }).eq("id", prev.id);
      if (restoreErr) {
        await db.from("memberships").update({ is_active: true }).eq("id", mem.id);
        return err(`Couldn't restore the previous membership: ${restoreErr.message}`, 500);
      }

      // Attendance / overtime / holds recorded against the new membership during the gap belong
      // to the period that was actually running.
      await db.from("bookings").update({ membership_id: prev.id }).eq("membership_id", mem.id);
      await db.from("overtime_sessions").update({ membership_id: prev.id }).eq("membership_id", mem.id);
      await db.from("membership_holds").update({ membership_id: prev.id }).eq("membership_id", mem.id);
      // Cashbacks this renewal used as a discount go back to pending for the next renewal.
      await db.from("cashbacks").update({
        status: "pending", redeemed_membership_id: null, redeemed_amount: null, redeemed_at: null,
      }).eq("redeemed_membership_id", mem.id).eq("status", "redeemed");

      if (refund > 0) {
        await recordPayout(db, {
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "membership_refund",
          amount: refund, notes: `Early renewal cancelled — renewal money refunded. Reason: ${String(reason).trim()}`,
          created_by_staff_id: staff.id,
        });
      }
      await db.from("membership_edits").insert({
        membership_id: mem.id, student_id: mem.student_id, branch_id: mem.branch_id,
        edit_type: "cancel_early_renewal", old_value: `${mem.start_date} → ${mem.end_date}`,
        new_value: String(reason).trim(), changed_by_staff_id: staff.id,
      });

      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, refund, restoredMembershipId: prev.id, restoredEndDate: gapHoldDays > 0 ? addDays(prev.end_date, gapHoldDays) : prev.end_date });
    },
    // ─── CLOSE MEMBERSHIP ───
    get_membership_closure_summary: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      { const gap = notStartedYetMessage(mem, "close the membership that is running now"); if (gap) return err(gap); }

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
      const { data: planChanges } = await db.from("membership_plan_changes").select("*")
        .eq("membership_id", membershipId).order("created_at", { ascending: true });
      const { total: unpaidFoodTotal } = await unpaidFoodBillsFor(db, mem.student_id);

      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      // The caution deposit is owed back to the student once the locker is given up —
      // it's a credit against whatever else they owe, not revenue.
      const lockerDepositRefund = locker && !locker.deposit_returned ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount } = await settlePendingCashbacks(db, mem.student_id, cashbackBase);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      // Overstay (RSP O1–O3): only up to the last member check-in after expiry. This preview
      // returns the full charge; the dialog strikes it through if staff tick "waive".
      const { overstayDays, overstayCharge, lastVisitDate, overstayDailyRate } = await computeOverstay(db, mem);

      const totalOwed = membershipDue + lockerDue + foodPassOwed + unpaidFoodTotal + overtimeDue + overstayCharge;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount;
      const netAmount = totalOwed - totalCredit;

      return json({
        membershipDue, lockerDue, lockerDepositRefund,
        foodPassBalance, foodPassRefund, foodPassOwed, unpaidFoodTotal,
        cashbackAmount, overtimeMinutes, overtimeDue,
        overstayDays, overstayCharge, lastVisitDate, overstayDailyRate,
        planEndDate: mem.end_date,
        totalOwed, totalCredit, netAmount,
        canClose: true,
        locker: locker ?? null,
        planChanges: planChanges ?? [],
      });
    },
    // Preview for the Delete Membership confirmation modal — same shape/checks as
    // get_membership_closure_summary, plus the proratedRefund/remainingDays/totalDays lines.
    get_membership_delete_summary: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const computeDeleteSettlement = makeComputeDeleteSettlement(db, staff);
      const { membershipId } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      { const gap = notStartedYetMessage(mem, "delete the membership that is running now"); if (gap) return err(gap); }
      if (!mem.is_active) return err("Membership is not active");

      const settlement = await computeDeleteSettlement(mem);
      return json({ ...settlement, canDelete: true });
    },
    // Ends a membership immediately — runs every check/settlement close_membership does
    // (locker deposit, Food Pass balance, pending cashback, unbilled overtime) plus the
    // prorated refund for the membership's unused days, all netted into one final amount.
    // A positive net still owed blocks the delete until a payment mode is chosen, exactly
    // like close_membership; a negative net pays out each credit as its own ledger entry.
    delete_membership: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const computeDeleteSettlement = makeComputeDeleteSettlement(db, staff);
      const { membershipId, paymentMode, reason, waiveOverstayCharge, withholdLockerDeposit, waiveProratedRefund } = payload;
      // Delete Membership is the most destructive membership action in the app —
      // irreversible, moves real money via prorated refunds/payouts. Open to all staff
      // (not owner-only), but a reason is mandatory and logged to membership_edits
      // alongside cabin/end-date/attendance edits, so every deletion is attributable.
      if (!reason || !reason.trim()) return err("A reason is required to delete a membership");
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      { const gap = notStartedYetMessage(mem, "delete the membership that is running now"); if (gap) return err(gap); }
      if (!mem.is_active) return err("Membership is not active");
      if (await hasOpenSession(db, mem.student_id)) {
        return err("This student is currently checked in — check them out before deleting the membership.");
      }

      const s = await computeDeleteSettlement(mem, !!waiveOverstayCharge, !!withholdLockerDeposit, !!waiveProratedRefund);

      if (s.netAmount > 0 && !paymentMode) {
        return err(`₹${s.netAmount.toFixed(2)} still needs to be collected before deleting — choose a payment mode.`);
      }
      // RSP W2a — waiving overstay needs a reason (checked before anything is written).
      const waiveReason = String(payload.waiveReason ?? "").trim();
      if (waiveOverstayCharge && s.overstayChargeBeforeWaive > 0 && !waiveReason) {
        return err("Enter a reason for waiving the overstay charge");
      }

      // Conditional on is_active so two deletes landing together can't both pay out the
      // refund/deposit/cashback below — the is_active check above is only a separate read.
      const { data: endedRows, error: endErr } = await db.from("memberships").update({ is_active: false, fee_due: 0 })
        .eq("id", membershipId).eq("is_active", true).select("id");
      if (endErr) return err(endErr.message);
      if (!endedRows?.length) return err("Membership is not active");

      await db.from("membership_edits").insert({
        membership_id: membershipId, student_id: mem.student_id, branch_id: mem.branch_id,
        edit_type: "delete_membership", old_value: "active", new_value: reason.trim(),
        changed_by_staff_id: staff.id,
      });

      // Deleting while on hold would otherwise leave the hold row open forever, showing
      // "Still on hold" in Hold History for a membership that no longer exists.
      await db.from("membership_holds")
        .update({ resumed_at: new Date().toISOString(), days_paused: 0 })
        .eq("membership_id", membershipId).is("resumed_at", null);

      if (mem.desk_id) {
        await db.from("desks").update({ status: "free", seat_type: "floating", assigned_student_id: null }).eq("id", mem.desk_id);
      }

      if (s.unbilledOvertime.length) {
        // billed_amount is already correct per-row (set at checkout time) — only mark
        // settled, don't overwrite each row with the aggregate sum.
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString() })
          .in("id", s.unbilledOvertime.map((o: { id: string }) => o.id));
      }

      if (s.locker) {
        await db.from("lockers").update({ is_active: false, fee_due: 0, deposit_returned: true }).eq("id", s.locker.id);
        if (s.lockerDepositRefund > 0) {
          await recordPayout(db, {
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "locker_deposit",
            amount: s.lockerDepositRefund, notes: "Locker caution deposit returned — membership deleted",
            created_by_staff_id: staff.id,
          });
        }
      }
      if (s.foodPass) {
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", s.foodPass.id);
        if (s.foodPassRefund > 0) {
          await recordPayout(db, {
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "food_pass_refund",
            amount: s.foodPassRefund, notes: "Unused Food Pass balance returned — membership deleted",
            created_by_staff_id: staff.id,
          });
        }
      }
      for (const c of s.cashbackContribs) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
      if (s.cashbackAmount > 0) {
        await recordPayout(db, {
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "cashback",
          amount: s.cashbackAmount, notes: "Cashback settled — membership deleted",
          created_by_staff_id: staff.id,
        });
      }
      if (s.proratedRefund > 0) {
        await recordPayout(db, {
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "membership_refund",
          amount: s.proratedRefund, notes: `Refund for ${s.remainingDays} unused day(s) × ₹${s.refundDailyRate} (plan ₹${s.planAmount} ÷ ${s.totalDays} days) — membership deleted`,
          created_by_staff_id: staff.id,
        });
      }

      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      if (s.unpaidFoodBills.length) {
        // Checked: bills left marked unpaid here could be charged again with a later membership.
        const { error: foodSettleErr } = await db.from("food_bills").update({ paid: true, payment_mode: "other" })
          .in("id", s.unpaidFoodBills.map(b => b.id));
        if (foodSettleErr) throw new Error(`Couldn't mark the unpaid food bills as settled: ${foodSettleErr.message}`);
      }

      // Credits were logged in full as payouts above; this records every owed line as income
      // (cash/UPI for the net collected, "other" for the part netted off) — see
      // recordSettlementIncome for why the net alone double-counted the credits.
      await recordSettlementIncome(db, {
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId, created_by_staff_id: staff.id,
      }, s, paymentMode, "membership deletion");
      if (waiveOverstayCharge && s.overstayChargeBeforeWaive > 0) {
        await recordWaiver(db, {
          branch_id: mem.branch_id, student_id: mem.student_id, membership_id: membershipId, waiver_type: "overstay",
          amount: s.overstayChargeBeforeWaive, reason: waiveReason, created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, netAmount: s.netAmount,
        collectedAmount: Math.max(s.netAmount, 0), refundAmount: Math.max(-s.netAmount, 0),
        proratedRefund: s.proratedRefund, remainingDays: s.remainingDays, totalDays: s.totalDays,
        lockerDepositRefund: s.lockerDepositRefund, foodPassRefund: s.foodPassRefund, cashbackAmount: s.cashbackAmount,
        overtimeDue: s.overtimeDue, overstayDays: s.overstayDays, overstayCharge: s.overstayCharge,
      });
    },
    close_membership: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, paymentMode, withholdLockerDeposit, waiveOverstayCharge } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);
      { const gap = notStartedYetMessage(mem, "close the membership that is running now"); if (gap) return err(gap); }
      // Most of this settlement self-heals on a re-run (the deposit is marked returned, the
      // pass is zeroed, fee_due is cleared), but the overstay charge does not — it's derived
      // from end_date vs today, which nothing here resets, so a second Quit would re-bill the
      // same days. Same re-entry guard delete_membership already uses.
      if (!mem.is_active) {
        return err("This membership has already been ended — refresh to see its current state.");
      }

      const { data: locker } = await db.from("lockers").select("*")
        .eq("student_id", mem.student_id).eq("is_active", true).maybeSingle();
      const { data: foodPass } = await db.from("food_passes").select("*")
        .eq("student_id", mem.student_id).maybeSingle();
      const { data: unbilledOvertime } = await db.from("overtime_sessions").select("id, overtime_minutes, billed_amount")
        .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);

      if (await hasOpenSession(db, mem.student_id)) {
        return err("This student is currently checked in — check them out before quitting the membership.");
      }
      const { bills: unpaidFoodBills, total: unpaidFoodTotal } = await unpaidFoodBillsFor(db, mem.student_id);

      // Final settlement: what's owed to the business nets against what's owed back to
      // the student (locker deposit, unredeemed Food Pass balance, unredeemed cashback).
      // withholdLockerDeposit lets staff forfeit the caution deposit instead of refunding it
      // (e.g. locker damage) — it's still deactivated and freed either way, just not paid back.
      const membershipDue = Number(mem.fee_due ?? 0);
      const lockerDue = Number(locker?.fee_due ?? 0);
      const lockerDepositRefund = locker && !locker.deposit_returned && !withholdLockerDeposit ? Number(locker.deposit_amount ?? 0) : 0;
      const foodPassBalance = Number(foodPass?.balance ?? 0);
      const foodPassRefund = Math.max(foodPassBalance, 0);
      const foodPassOwed = Math.max(-foodPassBalance, 0);
      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount, contribs: cashbackContribs } = await settlePendingCashbacks(db, mem.student_id, cashbackBase);
      const overtimeMinutes = (unbilledOvertime ?? []).reduce((s: number, o: { overtime_minutes: number }) => s + Number(o.overtime_minutes), 0);
      const overtimeDue = (unbilledOvertime ?? []).reduce((s: number, o: { billed_amount: number | null }) => s + Number(o.billed_amount ?? 0), 0);

      // Overstay (RSP O1–O3): only up to the last member check-in after expiry; staff can still
      // waive it (the full amount is kept for the waiver log).
      const overstay = await computeOverstay(db, mem);
      const overstayDays = overstay.overstayDays;
      const overstayChargeBeforeWaive = overstay.overstayCharge;
      const overstayCharge = waiveOverstayCharge ? 0 : overstayChargeBeforeWaive;

      const totalOwed = membershipDue + lockerDue + foodPassOwed + unpaidFoodTotal + overtimeDue + overstayCharge;
      const totalCredit = lockerDepositRefund + foodPassRefund + cashbackAmount;
      const netAmount = totalOwed - totalCredit;

      if (netAmount > 0 && !paymentMode) {
        return err(`₹${netAmount.toFixed(2)} still needs to be collected before closing — choose a payment mode.`);
      }
      // RSP W2a — waiving overstay needs a reason (checked before anything is written).
      const waiveReason = String(payload.waiveReason ?? "").trim();
      if (waiveOverstayCharge && overstayChargeBeforeWaive > 0 && !waiveReason) {
        return err("Enter a reason for waiving the overstay charge");
      }

      // Conditional on is_active so two closes landing together can't both pay out the
      // deposit/Food Pass/cashback refunds below — the is_active check above is only a read.
      const { data: endedRows, error: endErr } = await db.from("memberships").update({ is_active: false, fee_due: 0 })
        .eq("id", membershipId).eq("is_active", true).select("id");
      if (endErr) return err(endErr.message);
      if (!endedRows?.length) return err("This membership has already been ended — refresh to see its current state.");

      // Quitting while on hold would otherwise leave the hold row open forever, showing
      // "Still on hold" in Hold History for a membership that's already ended.
      await db.from("membership_holds")
        .update({ resumed_at: new Date().toISOString(), days_paused: 0 })
        .eq("membership_id", membershipId).is("resumed_at", null);

      if (unbilledOvertime?.length) {
        // billed_amount is already correct per-row (set at checkout time) — only mark
        // settled, don't overwrite each row with the aggregate sum.
        await db.from("overtime_sessions").update({ billed_at: new Date().toISOString() })
          .in("id", unbilledOvertime.map((o: { id: string }) => o.id));
      }

      if (locker) {
        await db.from("lockers").update({
          is_active: false, fee_due: 0, deposit_returned: true,
        }).eq("id", locker.id);
        if (lockerDepositRefund > 0) {
          await recordPayout(db, {
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "locker_deposit",
            amount: lockerDepositRefund, notes: "Locker caution deposit returned at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }
      if (foodPass) {
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", foodPass.id);
        if (foodPassRefund > 0) {
          await recordPayout(db, {
            student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "food_pass_refund",
            amount: foodPassRefund, notes: "Unused Food Pass balance returned at membership closure",
            created_by_staff_id: staff.id,
          });
        }
      }
      for (const c of cashbackContribs) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
      if (cashbackAmount > 0) {
        await recordPayout(db, {
          student_id: mem.student_id, branch_id: mem.branch_id, payout_type: "cashback",
          amount: cashbackAmount, notes: "Cashback settled at membership closure",
          created_by_staff_id: staff.id,
        });
      }

      // Release reserved desk if permanent
      if (mem.desk_id) {
        await db.from("desks").update({
          status: "free", seat_type: "floating", assigned_student_id: null,
        }).eq("id", mem.desk_id);
      }

      await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "expiry").eq("status", "pending");

      // Credits were logged in full as payouts above; this records every owed line as income
      // (cash/UPI for the net collected, "other" for the part netted off) — see
      // recordSettlementIncome for why the net alone double-counted the credits.
      if (unpaidFoodBills.length) {
        // Checked: bills left marked unpaid here could be charged again with a later membership.
        const { error: foodSettleErr } = await db.from("food_bills").update({ paid: true, payment_mode: "other" })
          .in("id", unpaidFoodBills.map(b => b.id));
        if (foodSettleErr) throw new Error(`Couldn't mark the unpaid food bills as settled: ${foodSettleErr.message}`);
      }
      await recordSettlementIncome(db, {
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId, created_by_staff_id: staff.id,
      }, { netAmount, membershipDue, overstayCharge, overstayDays, lockerDue, foodPassOwed, unpaidFoodTotal, overtimeDue }, paymentMode, "membership closure");
      if (waiveOverstayCharge && overstayChargeBeforeWaive > 0) {
        await recordWaiver(db, {
          branch_id: mem.branch_id, student_id: mem.student_id, membership_id: membershipId, waiver_type: "overstay",
          amount: overstayChargeBeforeWaive, reason: waiveReason, created_by_staff_id: staff.id,
        });
      }

      await refreshStudentStatus(db, mem.student_id);
      return json({
        ok: true, netAmount,
        collectedAmount: Math.max(netAmount, 0), refundAmount: Math.max(-netAmount, 0),
        cashbackAmount, lockerDepositRefund, foodPassRefund, overtimeDue,
        overstayDays, overstayCharge,
      });
    },
  };
  return h;
}
