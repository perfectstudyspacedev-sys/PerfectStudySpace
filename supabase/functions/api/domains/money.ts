// Payments, discounts, cashback, Food Pass money, overtime waivers and revenue. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { addMonths, istDayEnd, istDayStart, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { buildDateBuckets, fetchAllRows, insertPaymentTransactions, splitPaymentError, isISODate, recordPayout, recordTransaction, recordWaiver, refreshStudentStatus, requestedRange, settlePendingCashbacks } from "../lib.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // One-off owner-triggered repair for Food Pass balances left negative by orders placed
    // before the "never go negative" fix was deployed — that fix only stops *new* orders
    // from overdrawing the pass, it doesn't retroactively correct a balance a pre-fix order
    // already pushed below zero. For each negative balance, the shortfall is converted into
    // a proper unpaid food_bills row (so it's still owed and gets compulsorily collected at
    // the student's next checkout, same as any other shortfall) and the balance is reset to
    // 0. Safe to run more than once — it only touches rows still sitting below zero.
    fix_negative_food_pass_balances: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { data: passes } = await db.from("food_passes").select("*").lt("balance", 0);
      let fixed = 0;
      for (const p of passes ?? []) {
        const shortfall = -Number(p.balance);
        await db.from("food_bills").insert({
          branch_id: p.branch_id, student_id: p.student_id,
          subtotal: shortfall, total: shortfall, payment_mode: null, paid: false,
          created_by_staff_id: staff.id,
        });
        await db.from("food_passes").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", p.id);
        fixed++;
      }
      return json({ ok: true, checked: (passes ?? []).length, fixed });
    },
    record_payment: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, amount, paymentMode, cashAmount, upiAmount } = payload;
      const { data: mem } = await db.from("memberships").select("*").eq("id", membershipId).single();
      if (!mem) return err("Membership not found");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      // An amount is only ever meaningful against a real outstanding balance. Without these
      // guards a typo'd overpayment was clamped away silently (recorded as revenue but
      // credited to nothing), and a negative amount would *increase* what's owed while
      // filing a negative transaction. Same positive-amount rule the Food Pass top-up,
      // locker, and cashback actions already enforce.
      const payAmount = Number(amount);
      const currentDue = Number(mem.fee_due ?? 0);
      if (!(payAmount > 0)) return err("Payment amount must be greater than 0");
      if (currentDue <= 0) return err("This membership has no pending dues — nothing to collect.");
      if (payAmount > currentDue) {
        return err(`Payment exceeds the pending due of ₹${currentDue} — collect at most that amount.`);
      }
      const splitErr = splitPaymentError(paymentMode, payAmount, cashAmount, upiAmount);
      if (splitErr) return err(splitErr);

      const newDue = Math.max(currentDue - payAmount, 0);
      // Only push the due date forward once the balance is fully cleared — otherwise a
      // partial payment would make a still-overdue membership vanish from overdue views.
      const newDueDate = newDue === 0 ? addMonths(mem.due_date, 1) : mem.due_date;
      await db.from("memberships").update({
        fee_due: newDue, due_date: newDueDate, total_paid: Number(mem.total_paid) + payAmount,
      }).eq("id", membershipId);

      await insertPaymentTransactions(db, {
        student_id: mem.student_id, branch_id: mem.branch_id, membership_id: membershipId,
        category: "membership", created_by_staff_id: staff.id,
      }, paymentMode, payAmount, cashAmount, upiAmount);

      if (newDue === 0) {
        await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      }
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true });
    },
    // Owner-only: reward a loyal/high-hours student by knocking a % or fixed ₹ amount
    // off their currently pending membership fee. No money changes hands — this only
    // reduces fee_due — so it's tracked in its own audited table, not `transactions`.
    apply_loyalty_discount: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { membershipId, discountType, discountValue, remarks } = payload;
      if (!["percent", "fixed"].includes(discountType)) return err("Invalid discount type");
      const value = Number(discountValue);
      if (!(value > 0)) return err("Discount value must be greater than 0");
      // Same cap grant_cashback already enforces. Without it, "1000" typed into the value
      // box with the type left on Percent (meaning ₹1000, a one-keystroke mistake) doesn't
      // just clear the fee — the excess is banked as a cashback below, which is later paid
      // out in real cash at closure. A 1000% discount on ₹2,100 owed banks ₹18,900.
      if (discountType === "percent" && value > 100) return err("Percentage discount cannot exceed 100");

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
        // Cashbacks can stack — no need to merge into an existing pending one anymore, they're
        // all redeemed together at the next renewal/closure.
        await db.from("cashbacks").insert({
          student_id: mem.student_id, branch_id: mem.branch_id,
          month_label: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
          cashback_type: "fixed", cashback_value: bankedAsCashback,
          notes: `Banked from a discount that exceeded the pending fee${remarks ? ` — ${remarks}` : ""}`,
          granted_by_staff_id: staff.id,
        });
      }

      if (newDue === 0) {
        await db.from("alerts").update({ status: "resolved" }).eq("student_id", mem.student_id).eq("alert_type", "payment_due").eq("status", "pending");
      }
      await refreshStudentStatus(db, mem.student_id);
      return json({ ok: true, discountAmount: appliedToFee, newFeeDue: newDue, bankedAsCashback, cashbackBankedNote });
    },
    // Cashback for a top-hours student this month — staff or owner grants it after checking
    // the leaderboard. Sits pending until consumed at the student's next renewal (discount)
    // or, if they close out instead of renewing, paid out in cash at closure.
    grant_cashback: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, branchId, cashbackType, cashbackValue, monthLabel, notes } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: cbStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!cbStudent || cbStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);
      if (!["percent", "fixed"].includes(cashbackType)) return err("Invalid cashback type");
      const value = Number(cashbackValue);
      if (!(value > 0)) return err("Cashback value must be greater than 0");
      if (cashbackType === "percent" && value > 100) return err("Percentage cashback cannot exceed 100");

      // Redemption only makes sense against a renewal or closure, both of which require
      // an active membership — walk-in-only students have neither.
      const { data: activeMem } = await db.from("memberships").select("id")
        .eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (!activeMem) return err("This student doesn't have an active membership — cashback can only be granted to membership students");

      // Multiple cashbacks can sit pending at once — they're all redeemed together at the
      // student's next renewal or closure, whichever comes first.
      await db.from("cashbacks").insert({
        student_id: studentId, branch_id: branchId, month_label: monthLabel || new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
        cashback_type: cashbackType, cashback_value: value, notes: notes || null, granted_by_staff_id: staff.id,
      });
      return json({ ok: true });
    },
    // Pays out a student's pending cashback(s) in cash right away, without waiting for a
    // renewal (discount) or closure (payout) — e.g. the student wants it now instead.
    // Same base and settlement convention as membership closure: current active
    // membership's monthly_fee * months_paid, marked "settled", logged as a payout.
    redeem_cashback_now: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId } = payload;
      const { data: mem } = await db.from("memberships").select("*")
        .eq("student_id", studentId).eq("is_active", true).maybeSingle();
      if (!mem) return err("This student doesn't have an active membership");
      if (!requireBranch(staff, mem.branch_id)) return err("Branch access denied", 403);

      const cashbackBase = Number(mem.monthly_fee) * Number(mem.months_paid);
      const { cashbackAmount, contribs } = await settlePendingCashbacks(db, studentId, cashbackBase);
      if (cashbackAmount <= 0) return err("No pending cashback to redeem");

      for (const c of contribs) {
        await db.from("cashbacks").update({
          status: "settled", redeemed_amount: c.amount, redeemed_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
      await recordPayout(db, {
        student_id: studentId, branch_id: mem.branch_id, payout_type: "cashback",
        amount: cashbackAmount, notes: "Cashback redeemed immediately as cash, outside a renewal/closure",
        created_by_staff_id: staff.id,
      });

      return json({ ok: true, cashbackAmount });
    },
    // All cashback grants for a branch, newest first — lets staff/owner see who still has
    // a cashback pending (yet to avail) vs. already redeemed or settled at closure.
    list_cashbacks: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
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
    },
    record_locker_payment: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { lockerId, amount, paymentMode, cashAmount, upiAmount } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);

      // Same guards as record_payment — an overpayment was previously clamped away silently
      // (booked as revenue but credited to nothing) and a negative amount would have raised
      // the balance owed while filing a negative transaction.
      const payAmount = Number(amount);
      const currentDue = Number(locker.fee_due ?? 0);
      if (!(payAmount > 0)) return err("Payment amount must be greater than 0");
      if (currentDue <= 0) return err("This locker has no pending dues — nothing to collect.");
      if (payAmount > currentDue) {
        return err(`Payment exceeds the pending due of ₹${currentDue} — collect at most that amount.`);
      }
      const splitErr = splitPaymentError(paymentMode, payAmount, cashAmount, upiAmount);
      if (splitErr) return err(splitErr);

      const newDue = Math.max(currentDue - payAmount, 0);
      await db.from("lockers").update({
        fee_due: newDue, amount_paid: Number(locker.amount_paid) + payAmount,
      }).eq("id", lockerId);

      await insertPaymentTransactions(db, {
        student_id: locker.student_id, branch_id: locker.branch_id,
        category: "locker", notes: "Locker pending payment", created_by_staff_id: staff.id,
      }, paymentMode, payAmount, cashAmount, upiAmount);

      await refreshStudentStatus(db, locker.student_id);
      return json({ ok: true });
    },
    // Manually record a payment that no automated flow produced — a cash settlement taken
    // outside the app, a correction for a past date, a one-off charge. Every other
    // transaction here is written as a side effect of some action (checkout, renewal,
    // locker); this is the escape hatch for the rest, so the student's Payment History can
    // be made complete rather than only covering what the software happened to handle.
    // Deliberately does NOT touch fee_due or any membership/locker balance: it records that
    // money moved, it doesn't settle a specific debt. Use the dedicated pay actions for that.
    add_manual_payment: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, date, reason, amount, paymentMode, cashAmount, upiAmount } = payload;
      const { data: student } = await db.from("students").select("id, branch_id").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);

      const payAmount = Number(amount);
      if (!(payAmount > 0)) return err("Enter an amount greater than ₹0");
      if (!reason || !String(reason).trim()) return err("Enter a reason for this payment");
      // Backdating is allowed (that's much of the point — logging what was collected last
      // week), but a future-dated payment would mean money that hasn't been received yet.
      const entryDate = date || todayISO();
      if (entryDate > todayISO()) return err("Payment date cannot be in the future");
      const splitErr = splitPaymentError(paymentMode, payAmount, cashAmount, upiAmount);
      if (splitErr) return err(splitErr);

      // Stamped at noon IST on the chosen day so the row lands on that IST calendar date in
      // every report — istDayStart/istDayEnd bucket by IST, and a raw midnight would sit on
      // the boundary and risk being counted against the neighbouring day.
      const createdAt = entryDate === todayISO()
        ? new Date().toISOString()
        : new Date(`${entryDate}T12:00:00+05:30`).toISOString();

      // "fine" rather than a new "other" enum value: transactions.category is the Postgres
      // enum transaction_category ('desk','food','membership','locker','fine'), so anything
      // outside it fails the insert at runtime. "fine" is the only member no automated flow
      // writes, which leaves it free for manual entries — the reason text below is what
      // actually carries the meaning, and the UI shows it in place of the bare category.
      await insertPaymentTransactions(db, {
        student_id: studentId, branch_id: student.branch_id,
        category: "fine", notes: String(reason).trim(),
        created_by_staff_id: staff.id, created_at: createdAt,
      }, paymentMode, payAmount, cashAmount, upiAmount);

      return json({ ok: true });
    },
    // One-click locker renewal — the previous manual workaround required staff to remember
    // to separately edit the due date AND type in the right amount to "pay", with nothing
    // linking the two (fee_due only ever decreased via record_locker_payment, never
    // increased for a new cycle). This does both atomically: extends the due date by one
    // month and charges the standard monthly fee for it, Pay Now or Pay Later.
    renew_locker: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { lockerId, paymentMode, cashAmount, upiAmount, payLater } = payload;
      const { data: locker } = await db.from("lockers").select("*").eq("id", lockerId).single();
      if (!locker) return err("Locker not found");
      if (!requireBranch(staff, locker.branch_id)) return err("Branch access denied", 403);
      if (!locker.is_active) return err("Locker is not active");
      if (Number(locker.fee_due) > 0) {
        return err(`This locker still has ₹${Number(locker.fee_due)} pending — clear it before renewing.`);
      }

      const monthlyFee = Number(locker.monthly_fee) || 100;
      const today = todayISO();
      // A renewal made before the current due date lapses extends from that due date (so
      // renewing early doesn't lose already-paid-for time) — same rule as membership renewal.
      const newDueDate = locker.locker_due_date && locker.locker_due_date >= today
        ? addMonths(locker.locker_due_date, 1)
        : addMonths(today, 1);

      const feeDue = payLater ? monthlyFee : 0;
      const amountPaidNow = payLater ? 0 : monthlyFee;
      const splitErr = splitPaymentError(paymentMode, amountPaidNow, cashAmount, upiAmount);
      if (splitErr) return err(splitErr);

      await db.from("lockers").update({
        locker_due_date: newDueDate,
        fee_due: feeDue,
        amount_paid: Number(locker.amount_paid) + amountPaidNow,
      }).eq("id", lockerId);

      if (!payLater) {
        await insertPaymentTransactions(db, {
          student_id: locker.student_id, branch_id: locker.branch_id,
          category: "locker", notes: "Locker renewal", created_by_staff_id: staff.id,
        }, paymentMode, monthlyFee, cashAmount, upiAmount);
      }

      await refreshStudentStatus(db, locker.student_id);
      return json({ ok: true, newDueDate, amountCharged: monthlyFee, payLater: !!payLater });
    },
    // ─── FOOD PASS (prepaid wallet) ───
    get_food_pass: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId } = payload;
      const { data: student } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!student) return err("Student not found");
      if (!requireBranch(staff, student.branch_id)) return err("Branch access denied", 403);
      const { data: pass } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
      return json({ pass: pass ?? null });
    },
    topup_food_pass: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { studentId, branchId, amount, paymentMode } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: passStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
      if (!passStudent || passStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);
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
      await recordTransaction(db, {
        student_id: studentId, branch_id: branchId, category: "food",
        amount: amt, payment_mode: paymentMode ?? "cash", notes: "Food Pass top-up",
        created_by_staff_id: staff.id,
      });
      return json({ ok: true, balance: newBalance });
    },
    // Settles one specific unpaid food bill directly for cash/UPI right at order time — used
    // when a Food Pass order exceeds the available balance and staff choose to collect the
    // shortfall immediately instead of leaving it for compulsory collection at checkout.
    // Deliberately does NOT touch food_passes.balance: the shortfall was never deducted from
    // the pass (create_food_bill leaves it unpaid rather than overdrawing), so collecting cash
    // for it now just settles the bill in place, exactly like a non-pass-holder's unpaid bill.
    collect_food_bill_shortfall: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { billId, paymentMode } = payload;
      const { data: bill } = await db.from("food_bills").select("*").eq("id", billId).single();
      if (!bill) return err("Food bill not found");
      if (!requireBranch(staff, bill.branch_id)) return err("Branch access denied", 403);
      if (bill.paid) return err("This bill is already settled");
      await db.from("food_bills").update({ paid: true, payment_mode: paymentMode ?? "cash" }).eq("id", billId);
      await recordTransaction(db, {
        student_id: bill.student_id, branch_id: bill.branch_id, food_bill_id: bill.id,
        category: "food", amount: bill.total, payment_mode: paymentMode ?? "cash",
        notes: "Food Pass shortfall collected at order time", created_by_staff_id: staff.id,
      });
      return json({ ok: true });
    },
    // Per-row "omit from billing" toggle on the student profile's Overtime History table —
    // waives that specific overtime session without deleting its record. Only meaningful for
    // still-unbilled rows: once a row's already been collected/settled, toggling this after
    // the fact wouldn't undo the money that already changed hands.
    set_overtime_excluded: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { overtimeSessionId, excluded, reason } = payload;
      const { data: row } = await db.from("overtime_sessions").select("*").eq("id", overtimeSessionId).single();
      if (!row) return err("Overtime session not found");
      if (!requireBranch(staff, row.branch_id)) return err("Branch access denied", 403);
      if (row.billed_at) return err("This overtime was already billed/settled and can't be excluded");
      if (!!row.excluded === !!excluded) return json({ ok: true });
      // RSP W2b — omitting (or restoring) overtime changes what the student owes, so it needs a
      // reason and is logged with the amount and who did it.
      if (!reason || !String(reason).trim()) return err("Enter a reason");
      const { error: exclErr } = await db.from("overtime_sessions").update({ excluded: !!excluded }).eq("id", overtimeSessionId);
      if (exclErr) return err(exclErr.message, 500);
      await recordWaiver(db, {
        branch_id: row.branch_id, student_id: row.student_id, membership_id: row.membership_id ?? null,
        waiver_type: excluded ? "overtime_omit" : "overtime_restore", amount: Number(row.billed_amount ?? 0),
        reason: String(reason).trim(), related_id: row.id, created_by_staff_id: staff.id,
      });
      return json({ ok: true });
    },
    // ─── REVENUE (owner + staff see own branch only) ───
    get_revenue: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, period, dateFrom, dateTo, allBranches } = payload;
      if ((dateFrom != null && !isISODate(dateFrom)) || (dateTo != null && !isISODate(dateTo))) {
        return err("Invalid date — expected YYYY-MM-DD");
      }
      const range = requestedRange(period, dateFrom, dateTo);
      if (range.from > range.to) return err("Start date must be on or before the end date");

      let branchFilter: string[] = [];
      if (allBranches && isOwnerOrAdmin(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }

      const fromTs = istDayStart(range.from);
      const toTs = istDayEnd(range.to);
      type RevenueTxn = { category: string; amount: number; payment_mode: string; branch_id: string; created_at: string };
      const [txns, payouts] = await Promise.all([
        fetchAllRows<RevenueTxn>(() => db.from("transactions").select("category, amount, payment_mode, branch_id, created_at")
          .in("branch_id", branchFilter).gte("created_at", fromTs).lte("created_at", toTs)
          .order("created_at").order("id")),
        // Cashback payouts, locker deposit refunds, unused Food Pass balances and membership
        // refunds handed back to students aren't revenue transactions — net them out below to
        // show the real final figure.
        fetchAllRows<{ payout_type: string; amount: number }>(() => db.from("payouts").select("payout_type, amount")
          .in("branch_id", branchFilter).gte("created_at", fromTs).lte("created_at", toTs)
          .order("created_at").order("id")),
      ]);

      const cats: Record<string, number> = { desk: 0, membership: 0, food: 0, locker: 0, overtime: 0, fine: 0 };
      const modes: Record<string, number> = { cash: 0, upi: 0, other: 0 };
      for (const t of txns) {
        cats[t.category] = (cats[t.category] ?? 0) + Number(t.amount);
        modes[t.payment_mode] = (modes[t.payment_mode] ?? 0) + Number(t.amount);
      }
      const total = Object.values(cats).reduce((a, b) => a + b, 0);

      // Daily trend — bucket by the IST calendar day each transaction falls on, not its raw
      // UTC date (a payment just after IST midnight would otherwise land on the day before).
      // Every day in the range gets a point, including ₹0 days — plotting only days that had
      // sales made the chart draw a straight line across quiet days as if money came in.
      const byDay: Record<string, number> = {};
      for (const t of txns) {
        const day = toISTDateStr(t.created_at);
        byDay[day] = (byDay[day] ?? 0) + Number(t.amount);
      }
      const trend = buildDateBuckets(range.from, range.to, "day").map(b => ({ date: b.label, amount: byDay[b.label] ?? 0 }));

      // Branch breakdown (useful when allBranches = true)
      const byBranchMap: Record<string, number> = {};
      for (const t of txns) {
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

      const payoutTotals: Record<string, number> = { cashback: 0, locker_deposit: 0, food_pass_refund: 0, membership_refund: 0 };
      for (const p of payouts) {
        payoutTotals[p.payout_type] = (payoutTotals[p.payout_type] ?? 0) + Number(p.amount);
      }
      const totalPayouts = Object.values(payoutTotals).reduce((a, b) => a + b, 0);
      const netRevenue = total - totalPayouts;

      return json({
        total, byCategory: cats, byPaymentMode: modes, trend, byBranch: branchRevenue,
        dateFrom: range.from, dateTo: range.to,
        payouts: payoutTotals, totalPayouts, netRevenue,
      });
    },
    // RSP W1 — "Discounts & Waivers" for the Revenue page: every rupee knocked off or forgiven in
    // the selected range and branch scope, with who applied it. None of this is money in or out
    // (that is in get_revenue / list_transactions) — it is revenue the business chose not to take.
    get_discounts_waivers: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, period, dateFrom, dateTo, allBranches } = payload;
      if ((dateFrom != null && !isISODate(dateFrom)) || (dateTo != null && !isISODate(dateTo))) {
        return err("Invalid date — expected YYYY-MM-DD");
      }
      const range = requestedRange(period, dateFrom, dateTo);
      if (range.from > range.to) return err("Start date must be on or before the end date");
      let branchFilter: string[] = [];
      if (allBranches && isOwnerOrAdmin(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }
      const fromTs = istDayStart(range.from);
      const toTs = istDayEnd(range.to);

      type Who = { display_name?: string | null; username?: string | null } | null;
      type Stu = { name?: string | null; phone?: string | null } | null;
      const whoName = (w: Who) => w?.display_name || w?.username || null;
      const r2 = (n: number) => Math.round(n * 100) / 100;

      const [loyalty, cashbacks, foodBills, waivers, multiMonth, branchRows] = await Promise.all([
        fetchAllRows<{ id: string; discount_amount: number; remarks: string | null; created_at: string; branch_id: string; students: Stu; staff: Who }>(() =>
          db.from("membership_discounts").select("id, discount_amount, remarks, created_at, branch_id, students(name, phone), staff:applied_by_staff_id(display_name, username)")
            .in("branch_id", branchFilter).gte("created_at", fromTs).lte("created_at", toTs).order("created_at").order("id")),
        fetchAllRows<{ id: string; redeemed_amount: number | null; redeemed_at: string; month_label: string | null; branch_id: string; students: Stu; staff: Who }>(() =>
          db.from("cashbacks").select("id, redeemed_amount, redeemed_at, month_label, branch_id, students(name, phone), staff:granted_by_staff_id(display_name, username)")
            .in("branch_id", branchFilter).eq("status", "redeemed").gte("redeemed_at", fromTs).lte("redeemed_at", toTs).order("redeemed_at").order("id")),
        fetchAllRows<{ id: string; discount_amount: number; subtotal: number; created_at: string; branch_id: string; student_name: string | null; student_phone: string | null; staff: Who }>(() =>
          db.from("food_bills").select("id, discount_amount, subtotal, created_at, branch_id, student_name, student_phone, staff:created_by_staff_id(display_name, username)")
            .in("branch_id", branchFilter).gt("discount_amount", 0).gte("created_at", fromTs).lte("created_at", toTs).order("created_at").order("id")),
        fetchAllRows<{ id: string; waiver_type: string; amount: number; reason: string; created_at: string; branch_id: string; students: Stu; staff: Who }>(() =>
          db.from("waivers").select("id, waiver_type, amount, reason, created_at, branch_id, students(name, phone), staff:created_by_staff_id(display_name, username)")
            .in("branch_id", branchFilter).gte("created_at", fromTs).lte("created_at", toTs).order("created_at").order("id")),
        fetchAllRows<{ id: string; monthly_fee: number; months_paid: number; discount_percent: number; created_at: string; branch_id: string; students: Stu; staff: Who }>(() =>
          db.from("memberships").select("id, monthly_fee, months_paid, discount_percent, created_at, branch_id, students(name, phone), staff:created_by_staff_id(display_name, username)")
            .in("branch_id", branchFilter).gt("discount_percent", 0).gte("created_at", fromTs).lte("created_at", toTs).order("created_at").order("id")),
        db.from("branches").select("id, name").in("id", branchFilter).then((r: { data: { id: string; name: string }[] | null }) => r.data ?? []),
      ]);
      const branchName = new Map(branchRows.map((b: { id: string; name: string }) => [b.id, b.name]));

      const items: { id: string; type: string; date: string; student: string | null; phone: string | null; amount: number; by: string | null; detail: string | null; branch: string | null }[] = [];
      for (const d of loyalty) items.push({ id: `loyalty-${d.id}`, type: "loyalty", date: d.created_at, student: d.students?.name ?? null, phone: d.students?.phone ?? null, amount: r2(Number(d.discount_amount)), by: whoName(d.staff), detail: d.remarks, branch: branchName.get(d.branch_id) ?? null });
      for (const c of cashbacks) items.push({ id: `cashback-${c.id}`, type: "cashback", date: c.redeemed_at, student: c.students?.name ?? null, phone: c.students?.phone ?? null, amount: r2(Number(c.redeemed_amount ?? 0)), by: whoName(c.staff), detail: c.month_label ? `Granted for ${c.month_label}; taken off a renewal` : "Taken off a renewal", branch: branchName.get(c.branch_id) ?? null });
      for (const f of foodBills) items.push({ id: `food-${f.id}`, type: "food", date: f.created_at, student: f.student_name, phone: f.student_phone, amount: r2(Number(f.discount_amount)), by: whoName(f.staff), detail: `Off a ₹${r2(Number(f.subtotal))} bill`, branch: branchName.get(f.branch_id) ?? null });
      for (const w of waivers) {
        const sign = w.waiver_type === "overtime_restore" ? -1 : 1;
        items.push({ id: `waiver-${w.id}`, type: w.waiver_type === "overstay" ? "overstay" : "overtime", date: w.created_at, student: w.students?.name ?? null, phone: w.students?.phone ?? null, amount: r2(sign * Number(w.amount)), by: whoName(w.staff), detail: w.waiver_type === "overtime_restore" ? `Put back on the bill — ${w.reason}` : w.reason, branch: branchName.get(w.branch_id) ?? null });
      }
      for (const m of multiMonth) {
        const amount = r2(Number(m.monthly_fee) * Number(m.months_paid) * Number(m.discount_percent) / 100);
        items.push({ id: `multimonth-${m.id}`, type: "multi_month", date: m.created_at, student: m.students?.name ?? null, phone: m.students?.phone ?? null, amount, by: whoName(m.staff), detail: `${m.months_paid} months at ${Number(m.discount_percent)}% off`, branch: branchName.get(m.branch_id) ?? null });
      }
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const totals: Record<string, number> = { loyalty: 0, cashback: 0, food: 0, overstay: 0, overtime: 0, multi_month: 0 };
      for (const it of items) totals[it.type] = r2((totals[it.type] ?? 0) + it.amount);
      const total = r2(Object.values(totals).reduce((a, b) => a + b, 0));
      return json({ totals, total, items, dateFrom: range.from, dateTo: range.to });
    },
    list_transactions: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, period, dateFrom, dateTo, category, search, allBranches } = payload;
      // Defaults to "today" to match get_revenue — the Revenue page drives both handlers from
      // one period toggle, so a different fallback here made the Overview and Transactions
      // tabs silently disagree about which window they were showing.
      if ((dateFrom != null && !isISODate(dateFrom)) || (dateTo != null && !isISODate(dateTo))) {
        return err("Invalid date — expected YYYY-MM-DD");
      }
      const range = requestedRange(period, dateFrom, dateTo);
      if (range.from > range.to) return err("Start date must be on or before the end date");
      // Owner "All branches (consolidated)" applies here exactly as it does in get_revenue;
      // without it the Transactions tab stayed pinned to one branch while the Overview totals
      // above it were consolidated, which read as the filter working only intermittently.
      let branchFilter: string[] = [];
      if (allBranches && isOwnerOrAdmin(staff)) {
        const { data: bs } = await db.from("branches").select("id");
        branchFilter = bs?.map(b => b.id) ?? [];
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        branchFilter = [bid];
      }
      const fromTs = istDayStart(range.from);
      const toTs = istDayEnd(range.to);
      // Numeric instant bounds for the in-JS re-check below — fromTs/toTs carry a +05:30
      // offset while DB timestamps come back as Z/+00:00, so they can't be compared as raw
      // strings (different suffixes); compare parsed instants instead.
      const fromMs = new Date(fromTs).getTime();
      const toMs = new Date(toTs).getTime();

      // Every payout type the Overview nets out of Net Revenue gets a row here too, so the
      // ledger reconciles with the Surrendered-to-Students figure above it. Cashback payouts
      // are the exception: they're already represented per-cashback by the "Cashback
      // settled" rows below (one payouts row can cover several cashbacks), so listing the
      // payouts row as well would show the same money twice.
      const PAYOUT_FEED_LABELS: Record<string, string> = {
        membership_refund: "Membership deleted — refund",
        locker_deposit: "Locker deposit returned",
        food_pass_refund: "Food Pass balance refunded",
      };
      const TXN_CATEGORIES = ["desk", "membership", "food", "locker", "overtime", "fine"];
      const isPayoutCategory = !!category && Object.hasOwn(PAYOUT_FEED_LABELS, category);
      if (category && category !== "cashback" && !isPayoutCategory && !TXN_CATEGORIES.includes(category)) {
        return err("Unknown category");
      }
      const wantCashbacks = !category || category === "cashback";
      const payoutTypes = !category ? Object.keys(PAYOUT_FEED_LABELS) : isPayoutCategory ? [category] : [];
      const wantTxns = !category || TXN_CATEGORIES.includes(category);

      type Joined = { students?: { name?: string; phone?: string } | null; branches?: { name?: string } | null };
      type TxnRow = Joined & { id: string; category: string; amount: number; payment_mode: string | null; notes: string | null; created_at: string };
      type CbRow = Joined & { id: string; cashback_type: string; cashback_value: number; status: string; redeemed_amount: number | null; created_at: string; redeemed_at: string | null };
      type PayoutRow = Joined & { id: string; payout_type: string; amount: number; notes: string | null; created_at: string };

      const [data, cashbackRows, payoutRows] = await Promise.all([
        wantTxns
          ? fetchAllRows<TxnRow>(() => {
            let q = db.from("transactions").select("*, students(name, phone), branches(name)")
              .in("branch_id", branchFilter).gte("created_at", fromTs).lte("created_at", toTs)
              // Paged oldest-first so a payment recorded mid-fetch lands on the last page
              // instead of shifting every later page by one; display order is the sort below.
              .order("created_at").order("id");
            if (category) q = q.eq("category", category);
            return q;
          })
          : Promise.resolve([] as TxnRow[]),
        wantCashbacks
          ? fetchAllRows<CbRow>(() => db.from("cashbacks").select("id, cashback_type, cashback_value, status, redeemed_amount, created_at, redeemed_at, students(name, phone), branches(name)")
            .in("branch_id", branchFilter)
            .or(`and(created_at.gte.${fromTs},created_at.lte.${toTs}),and(redeemed_at.gte.${fromTs},redeemed_at.lte.${toTs})`)
            .order("created_at").order("id"))
          : Promise.resolve([] as CbRow[]),
        payoutTypes.length
          ? fetchAllRows<PayoutRow>(() => db.from("payouts").select("id, payout_type, amount, notes, created_at, students(name, phone), branches(name)")
            .in("branch_id", branchFilter).in("payout_type", payoutTypes)
            .gte("created_at", fromTs).lte("created_at", toTs)
            .order("created_at").order("id"))
          : Promise.resolve([] as PayoutRow[]),
      ]);

      // Shaped to match a normal transaction row (category/amount/payment_mode/created_at,
      // same students/branches joins) so the existing table/CSV export doesn't need two
      // different row shapes — "category" is a readable label since these aren't real rows
      // in the transactions table with a fixed category value to translate. entry_type tells
      // money in ("income", every real transaction) from money handed back ("payout", shown
      // negative) and bookkeeping-only events ("info": a cashback being granted, or applied
      // as a discount whose net effect is already inside the renewal's own transaction).
      const cashbackFeed: Record<string, unknown>[] = [];
      for (const c of cashbackRows) {
        const valueLabel = c.cashback_type === "percent" ? `${c.cashback_value}%` : `₹${Number(c.cashback_value)}`;
        if (new Date(c.created_at).getTime() >= fromMs && new Date(c.created_at).getTime() <= toMs) {
          cashbackFeed.push({
            id: `cashback-grant-${c.id}`, category: `Cashback granted (${valueLabel})`, entry_type: "info",
            amount: c.cashback_type === "fixed" ? Number(c.cashback_value) : null,
            payment_mode: null, notes: null, created_at: c.created_at, students: c.students, branches: c.branches,
          });
        }
        if (c.redeemed_at && c.status !== "pending" && new Date(c.redeemed_at).getTime() >= fromMs && new Date(c.redeemed_at).getTime() <= toMs) {
          // "settled" = paid out in cash (it has a matching payouts row netted from revenue);
          // "redeemed" = taken off a renewal fee, so no separate money moved.
          const paidOut = c.status === "settled";
          const amount = c.redeemed_amount != null ? Number(c.redeemed_amount) : null;
          cashbackFeed.push({
            id: `cashback-${c.status}-${c.id}`, category: `Cashback ${c.status}`, entry_type: paidOut ? "payout" : "info",
            amount: amount != null && paidOut ? -amount : amount,
            payment_mode: null, notes: null, created_at: c.redeemed_at, students: c.students, branches: c.branches,
          });
        }
      }

      const payoutFeed = payoutRows.map(r => ({
        id: `payout-${r.payout_type}-${r.id}`, category: PAYOUT_FEED_LABELS[r.payout_type] ?? r.payout_type, entry_type: "payout",
        amount: -Number(r.amount), payment_mode: null, notes: r.notes, created_at: r.created_at,
        students: r.students, branches: r.branches,
      }));

      let rows: (Joined & { created_at: string })[] = [
        ...data.map(t => ({ ...t, entry_type: "income" })), ...cashbackFeed as (Joined & { created_at: string })[], ...payoutFeed,
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (search) {
        const s = String(search).trim().toLowerCase();
        if (s) rows = rows.filter(r => r.students?.name?.toLowerCase().includes(s) || r.students?.phone?.includes(s));
      }
      return json({ transactions: rows });
    },
  };
  return h;
}
