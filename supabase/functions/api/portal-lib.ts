// Read-only money quotes and member summaries for the student portal (PSS-AI P2.1, P2.2).
// Nothing here writes. A quote uses the same sums as the action that will later take the money
// (renew_membership), and that action re-checks the amount (expectedTotal) when the owner
// confirms the payment, so a quote that went stale can never be charged.
// deno-lint-ignore-file no-explicit-any
import type { Ctx } from "./registry.ts";
import { todayISO, daysBetween } from "../_shared/dates.ts";
import { multiMonthDiscount, renewalKind } from "../_shared/membership.ts";
import { getMembershipPackage, settlePendingCashbacks } from "./lib.ts";

type Db = Ctx["db"];
export const RENEWAL_MONTHS = [1, 2, 3, 6];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The student's current membership: the active one with the latest end date. */
export async function currentMembership(db: Db, studentId: string) {
  const { data } = await db.from("memberships").select("*").eq("student_id", studentId).eq("is_active", true)
    .order("end_date", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/** Why this membership can't be renewed from the portal now, or null. Same refusals as renew_membership. */
export function renewalBlock(mem: any): string | null {
  if (!mem || !mem.is_active) return "There is no active membership to renew.";
  if (Number(mem.fee_due ?? 0) > 0) return `Clear the ₹${Number(mem.fee_due)} still due first.`;
  if (mem.is_paused) return "Your membership is on hold — resume it before renewing.";
  if (mem.start_date > todayISO()) return `You have already renewed — the new period starts on ${mem.start_date}.`;
  return null;
}

/** What renewing the same plan for `months` months costs today. */
export async function quoteRenewal(db: Db, mem: any, months: number): Promise<{ amount: number; parts: Record<string, number> } | { error: string }> {
  const block = renewalBlock(mem);
  if (block) return { error: block };
  if (!RENEWAL_MONTHS.includes(months)) return { error: "Choose 1, 2, 3 or 6 months" };
  const custom = mem.hours_per_day_weekend != null;
  const monthlyFee = custom ? Number(mem.monthly_fee) : await getMembershipPackage(db, Number(mem.hours_per_day), mem.category);
  if (!(monthlyFee > 0)) return { error: "This plan can't be priced online — please renew at the desk." };
  const discount = multiMonthDiscount(months);
  const base = monthlyFee * months * (1 - discount / 100);
  const { cashbackAmount } = await settlePendingCashbacks(db, mem.student_id, base);
  const { data: overtime } = await db.from("overtime_sessions").select("billed_amount")
    .eq("student_id", mem.student_id).is("billed_at", null).eq("excluded", false);
  const overtimeDue = (overtime ?? []).reduce((s: number, o: any) => s + Number(o.billed_amount ?? 0), 0);
  const amount = round2(base - cashbackAmount + overtimeDue);
  return { amount, parts: { monthlyFee, months, discountPercent: discount, cashback: round2(cashbackAmount), overtime: overtimeDue } };
}

/** The renew_membership payload for a portal renewal: same plan, full payment by UPI. */
export function renewalPayload(mem: any, months: number, amount: number) {
  const custom = mem.hours_per_day_weekend != null;
  return {
    membershipId: mem.id, monthsPaid: months, paymentMode: "upi", expectedTotal: amount,
    ...(custom ? {} : { category: mem.category, hoursPerDay: Number(mem.hours_per_day) }),
  };
}

/** What the portal home shows about a membership. */
export function membershipView(mem: any, deskLabel: string | null) {
  if (!mem) return null;
  const today = todayISO();
  return {
    id: mem.id, category: mem.category, hoursPerDay: Number(mem.hours_per_day),
    weekendHours: mem.hours_per_day_weekend != null ? Number(mem.hours_per_day_weekend) : null,
    startDate: mem.start_date, endDate: mem.end_date,
    daysLeft: mem.end_date >= today ? daysBetween(today, mem.end_date) : 0,
    renewalKind: renewalKind(mem.end_date, today), feeDue: Number(mem.fee_due ?? 0),
    monthlyFee: Number(mem.monthly_fee ?? 0), isPaused: !!mem.is_paused, desk: deskLabel,
    notStarted: mem.start_date > today,
  };
}
