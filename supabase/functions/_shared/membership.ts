// Pure membership rules (plan length, renewal kind, multi-month discount, unused-days refund,
// student status). Moved unchanged from api/index.ts in PSS-AI P0.2.
import { todayISO, addDays, daysBetween } from "./dates.ts";

// The membership's committed length in days, used to derive a fair per-day rate for
// prorated refunds (Delete Membership) and overstay charges (Quit/Delete Membership).
// Primarily start_date→end_date, but floored at months_paid * 30 — Manage Plan lets staff
// hand-edit end_date to any date independent of start_date/monthly_fee/months_paid (e.g.
// shortening a plan), and without this floor a heavily-shortened end_date collapses
// totalDays down to as little as 1, which turns "grossFee ÷ totalDays" into "grossFee ÷ 1"
// and inflates a single overstay/unused day into the value of the entire remaining plan.
export function membershipTotalDays(mem: { start_date: string; end_date: string; months_paid: number }): number {
  const dateBased = Math.round(
    (new Date(mem.end_date + "T00:00:00Z").getTime() - new Date(mem.start_date + "T00:00:00Z").getTime()) / 86_400_000,
  );
  return Math.max(1, dateBased, Number(mem.months_paid) * 30);
}

// How many days past end_date a membership is still allowed to check in / renew as a
// continuation rather than being treated as a fresh restart. Shared by the check-in gate
// (blocks check-in once past grace) and renew_membership's startDate calc (below) — both
// must agree on the same window, or a renewal inside grace could compute a start date the
// check-in gate would then treat as still-expired.
export const MEMBERSHIP_GRACE_DAYS = 10;

// RSP R2 — which kind of renewal this is, decided only from the current plan's last day:
// "early" up to and including the end date, "grace" within MEMBERSHIP_GRACE_DAYS after it
// (the student can still check in then), "late" after that. Staff never pick the type.
// RSP R5: between an early renewal and its start date the membership hasn't begun yet, so the
// refund / plan / closing maths for it don't apply. Those actions are blocked with a pointer to
// Cancel Early Renewal (which restores the previous membership) instead of new special cases.
export function notStartedYetMessage(mem: { start_date: string }, what: string): string | null {
  if (mem.start_date <= todayISO()) return null;
  return `This membership was renewed early and only starts on ${mem.start_date}. Cancel the early renewal first, then ${what}.`;
}

export function renewalKind(endDate: string, today: string): "early" | "grace" | "late" {
  if (today <= endDate) return "early";
  return daysBetween(endDate, today) <= MEMBERSHIP_GRACE_DAYS ? "grace" : "late";
}

export function multiMonthDiscount(months: number): number {
  if (months >= 6) return 15;
  if (months >= 3) return 10;
  if (months >= 2) return 5;
  return 0;
}

// The single source of truth for what a student's status *is*, given their current
// membership and locker. Deliberately pure and date-driven: the stored students.status
// column only changes when some event calls refreshStudentStatus(), so a membership that
// merely lapses overnight (nobody pays, renews or checks in) would otherwise keep reading
// "Active" forever — which is exactly how 42 lapsed students came to look settled. Anything
// displaying a status derives it through here against today's date rather than trusting
// the stored value, so it can never go stale again.
export function computeStudentStatus(
  mem: { fee_due: number; end_date: string } | null | undefined,
  locker: { locker_due_date: string | null; fee_due?: number | null } | null | undefined,
  today: string,
) {
  // Locker money counts the same with or without a membership: rent past its due date, or
  // an unpaid (Pay Later) rent/deposit balance, means the student still owes the branch.
  const lockerOwes = !!locker && (
    (!!locker.locker_due_date && locker.locker_due_date < today) || Number(locker.fee_due ?? 0) > 0
  );
  // No membership: a walk-in (or ex-member) still holding a locker is a current customer,
  // not "inactive" — otherwise they vanish from the default Students list with the locker
  // (and its deposit) forgotten. Only no membership AND no locker is truly inactive.
  if (!mem) return locker ? (lockerOwes ? "pending" : "active") : "inactive";
  // Pending = owes money, or the paid period has run out and needs renewing. Deliberately
  // not due_date: it's set one month after the start however many months were paid, so a
  // student who paid 3 months upfront read as Pending from month 2 with nothing owed.
  if (Number(mem.fee_due) > 0 || mem.end_date < today) return "pending";
  // An otherwise-active membership still reads as Pending while locker money is owed — a
  // student shouldn't look fully settled while they owe locker rent.
  if (lockerOwes) return "pending";
  return "active";
}

// RSP D1–D3 — refund for the unused days of a deleted membership, at the rate the student actually
// paid for the plan: plan price AFTER the multi-month discount ÷ plan days (the owner's choice;
// it used to use the undiscounted price, refunding more per day than the student had paid).
// plan_amount/plan_days are stored since migration 050; older rows fall back to the best estimate.
// Unused days count from today, or from the start date if the period hasn't begun yet. Holds push
// end_date out without adding paid days, so days-to-end are exactly the unused paid days.
export function unusedDaysRefund(
  mem: { start_date: string; end_date: string; months_paid: number; monthly_fee: number; discount_percent?: number | null; plan_amount?: number | null; plan_days?: number | null; total_paid: number; fee_due?: number | null },
  today: string, waive: boolean,
) {
  const planAmount = mem.plan_amount != null
    ? Number(mem.plan_amount)
    : Number(mem.monthly_fee) * Number(mem.months_paid) * (1 - Number(mem.discount_percent ?? 0) / 100);
  const planDays = mem.plan_days != null && Number(mem.plan_days) > 0 ? Number(mem.plan_days) : membershipTotalDays(mem);
  const refDate = mem.start_date > today ? addDays(mem.start_date, -1) : today;
  const remainingDays = Math.max(0, Math.round(
    (new Date(mem.end_date + "T00:00:00Z").getTime() - new Date(refDate + "T00:00:00Z").getTime()) / 86_400_000,
  ));
  const refundDailyRate = planAmount / planDays;
  const raw = waive ? 0 : refundDailyRate * remainingDays;
  const proratedRefund = Math.round(Math.max(0, Math.min(raw, Number(mem.total_paid) + Number(mem.fee_due ?? 0))));
  return { proratedRefund, remainingDays, totalDays: planDays, planAmount: Math.round(planAmount * 100) / 100, refundDailyRate: Math.round(refundDailyRate * 100) / 100 };
}
