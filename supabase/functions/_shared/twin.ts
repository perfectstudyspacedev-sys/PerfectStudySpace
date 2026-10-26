// PSS-AI Phase 5, I6 — the digital twin: "what if" a policy were different, worked out on real past
// data. Pure code; nothing here changes a rule. The real rules stay in membership.ts and
// overtime.ts (R1); overtimeCharge() below repeats computeOvertimeCharge with the grace as a
// parameter, and a test proves the two agree at today's grace.
import { OVERTIME_GRACE_MINUTES } from "./overtime.ts";

/** computeOvertimeCharge with the grace minutes as a parameter (simulation only). */
export function overtimeCharge(overtimeMinutes: number, bookedHours: number, baseFee: number, isWalkinThreeHour: boolean, grace = OVERTIME_GRACE_MINUTES) {
  const overtimeHours = Math.ceil(Math.max(0, overtimeMinutes - grace) / 60);
  let addOn = 0;
  for (let h = 1; h <= overtimeHours; h++) addOn += isWalkinThreeHour && h === 1 ? 5 : 10;
  const totalHours = bookedHours + overtimeHours;
  const totalCost = totalHours >= 10 ? 100 : baseFee + addOn;
  return { overtimeHours, overtimeCharge: Math.max(totalCost - baseFee, 0) };
}

export interface OvertimeCase { minutes: number; bookedHours: number; baseFee: number; walkinThreeHour: boolean }
export function simulateOvertimeGrace(cases: OvertimeCase[], proposed: number, current = OVERTIME_GRACE_MINUTES) {
  let now = 0, then = 0, changed = 0;
  for (const c of cases) {
    const a = overtimeCharge(c.minutes, c.bookedHours, c.baseFee, c.walkinThreeHour, current).overtimeCharge;
    const b = overtimeCharge(c.minutes, c.bookedHours, c.baseFee, c.walkinThreeHour, proposed).overtimeCharge;
    now += a; then += b;
    if (a !== b) changed++;
  }
  return { sessions: cases.length, changed, currentTotal: now, proposedTotal: then, difference: then - now };
}

/**
 * Renewal grace (RSP R2): a renewal d days after the plan ended is a "grace" renewal when d ≤ grace —
 * it starts the day after the end, so those d days are charged — and "late" otherwise (it starts
 * the day it is paid, the gap is not charged). Check-ins on day k after the end are allowed while
 * k ≤ grace.
 */
export interface GraceRenewal { daysLate: number; dailyRate: number }
export function simulateRenewalGrace(renewals: GraceRenewal[], checkinDaysAfterEnd: number[], proposed: number, current: number) {
  let changed = 0, difference = 0;
  for (const r of renewals) {
    if (!(r.daysLate > 0)) continue;
    const chargedNow = r.daysLate <= current ? r.daysLate : 0;
    const chargedThen = r.daysLate <= proposed ? r.daysLate : 0;
    if (chargedNow !== chargedThen) { changed++; difference += (chargedThen - chargedNow) * r.dailyRate; }
  }
  const refused = proposed < current ? checkinDaysAfterEnd.filter((k) => k > proposed && k <= current).length : 0;
  return { renewals: renewals.filter((r) => r.daysLate > 0).length, changed, difference: Math.round(difference * 100) / 100, checkinsRefused: refused, checkins: checkinDaysAfterEnd.length };
}

/** C1 self-hold limit: past hold requests that would run by themselves (days ≤ limit) or wait for approval. */
export function simulateHoldLimit(holdDays: number[], proposed: number, current: number) {
  const auto = (limit: number) => holdDays.filter((d) => d >= 1 && d <= limit).length;
  return { requests: holdDays.length, autoNow: auto(current), autoThen: auto(proposed), toApprovalThen: holdDays.length - auto(proposed) };
}
