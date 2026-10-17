// RSP O1–O3 overstay charge, as a pure function (split out of computeOverstay in PSS-AI P0.2 so
// it can be unit-tested). Counted from the day after end_date up to the student's LAST MEMBER
// CHECK-IN after it (the caller looks that date up; walk-in visits don't count); nothing if they
// never came back or the plan hasn't ended. Capped at MEMBERSHIP_GRACE_DAYS, because check-in is
// refused after the grace period. Rate is the plan's normal daily rate, monthly fee ÷ 30.
import { daysBetween } from "./dates.ts";
import { MEMBERSHIP_GRACE_DAYS } from "./membership.ts";

export function overstayFromLastVisit(
  mem: { end_date: string; monthly_fee: number },
  lastVisitDate: string | null,
  today: string,
) {
  const dailyRate = Number(mem.monthly_fee) / 30;
  const none = { overstayDays: 0, overstayCharge: 0, lastVisitDate: null as string | null, overstayDailyRate: Math.round(dailyRate * 100) / 100 };
  if (mem.end_date >= today) return none;
  if (!lastVisitDate) return none;
  const overstayDays = Math.min(Math.max(daysBetween(mem.end_date, lastVisitDate), 0), MEMBERSHIP_GRACE_DAYS);
  return { ...none, overstayDays, overstayCharge: Math.round(dailyRate * overstayDays), lastVisitDate };
}
