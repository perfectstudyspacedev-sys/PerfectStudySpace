// Overtime billing rule. Moved unchanged from api/index.ts in PSS-AI P0.2.

export const OVERTIME_GRACE_MINUTES = 15;

// Overtime is billed in whole-hour blocks after the grace period, flat-rate — not prorated
// per minute against whatever the person's own hourly rate happens to be. Any overshoot past
// grace immediately bills a full hour block; going further into a second block bills another
// full hour, and so on. A walk-in whose *original* booking was exactly 3 hours gets a
// discounted first overtime hour (hour 4, ₹5 instead of ₹10) as a one-off special case — every
// other hour, for anyone (walk-in or member), is a flat ₹10. Once total hours used for this
// visit (booked/allotted hours + overtime hours) reaches 10, the total cost for the visit is
// capped at a flat ₹100 rather than continuing to add up — computed once, at checkout, per
// visit (never re-aggregated across separate days/sessions).
export function computeOvertimeCharge(overtimeMinutes: number, bookedHours: number, baseFee: number, isWalkinThreeHour: boolean) {
  const overtimeHours = Math.ceil(Math.max(0, overtimeMinutes - OVERTIME_GRACE_MINUTES) / 60);
  let addOn = 0;
  for (let h = 1; h <= overtimeHours; h++) {
    addOn += isWalkinThreeHour && h === 1 ? 5 : 10;
  }
  const totalHours = bookedHours + overtimeHours;
  const totalCost = totalHours >= 10 ? 100 : baseFee + addOn;
  const overtimeCharge = Math.max(totalCost - baseFee, 0);
  return { overtimeHours, overtimeCharge, totalCost };
}
