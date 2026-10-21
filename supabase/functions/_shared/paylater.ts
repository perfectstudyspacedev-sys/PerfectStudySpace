// PSS-AI Phase 3, O3 — pay-later advice. Pure code: a risk from the student's own history, and
// what to allow (C13: up to 50% of the fee, for 15 days, with the owner's OK). Advice only — staff
// and the owner decide, and nothing is blocked (R6).

export const PAYLATER_DAYS = 15;          // C13
export const PAYLATER_MAX_PCT = 50;       // C13

export interface PaylaterFacts {
  pastPlans: number;        // ended memberships
  pastUnpaid: number;       // of those, ended with fees still due
  duesNow: number;          // rupees due on the current plan
  churn: number | null;     // churn score 0–1, when the model has one
  renewals: number;         // renewals of earlier plans
}

export function paylaterRisk(f: PaylaterFacts): { risk: number; band: "low" | "medium" | "high"; reasons: string[] } {
  const reasons: string[] = [];
  let risk = 0.15;
  const unpaidShare = f.pastPlans > 0 ? f.pastUnpaid / f.pastPlans : 0;
  if (f.pastUnpaid > 0) { risk += 0.5 * unpaidShare; reasons.push(`${f.pastUnpaid} of ${f.pastPlans} earlier plans ended with fees unpaid`); }
  if (f.duesNow > 0) { risk += 0.2; reasons.push(`₹${Math.round(f.duesNow).toLocaleString("en-IN")} is due now`); }
  if (f.churn !== null) { risk += 0.25 * f.churn; if (f.churn >= 0.6) reasons.push("likely to leave (churn score)"); }
  if (f.renewals > 0) { risk -= Math.min(0.15, f.renewals * 0.03); reasons.push(`renewed ${f.renewals} time${f.renewals === 1 ? "" : "s"} before`); }
  if (!f.pastPlans) reasons.push("no earlier plans to judge by");
  risk = Math.round(Math.max(0, Math.min(1, risk)) * 1000) / 1000;
  return { risk, band: risk < 0.35 ? "low" : risk < 0.6 ? "medium" : "high", reasons };
}

export function paylaterAdvice(band: "low" | "medium" | "high"): { maxPercent: number; days: number; text: string } {
  if (band === "low") return { maxPercent: PAYLATER_MAX_PCT, days: PAYLATER_DAYS, text: `Low risk: up to ${PAYLATER_MAX_PCT}% may be paid later, within ${PAYLATER_DAYS} days, with the owner's OK.` };
  if (band === "medium") return { maxPercent: 25, days: PAYLATER_DAYS, text: `Medium risk: allow at most 25% later, within ${PAYLATER_DAYS} days, with the owner's OK — or ask for full payment.` };
  return { maxPercent: 0, days: 0, text: "High risk: ask for full payment now." };
}
