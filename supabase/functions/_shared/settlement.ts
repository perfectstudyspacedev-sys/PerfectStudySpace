// How a final settlement's owed lines become income rows. Moved unchanged from api/index.ts
// in PSS-AI P0.2.

// Income side of a membership close/delete settlement. Everything the student owed is
// settled at that moment — the positive net (if any) in cash/UPI, and the rest by netting it
// against the credits owed back to them (deposit, Food Pass balance, cashback, unused-days
// refund) — while each of those credits is logged in full as its own payout. Recording only
// the net as income took the credits off Net Revenue twice (once inside the net, then again
// as payouts) and, when the net favoured the student, dropped the dues they settled from
// revenue altogether. The netted part goes in as payment mode "other", since no cash or UPI
// moved for it, so the payment-channel split still matches what reached the drawer.
// Each owed line is recorded under its own category (membership / locker / food / overtime)
// so the Revenue breakdown shows, say, overtime as overtime; the cash collected is applied
// to the lines in that order and whatever it doesn't cover was settled by the netting.
export type SettlementOwed = {
  netAmount: number; membershipDue: number; overstayCharge: number; overstayDays: number;
  lockerDue: number; foodPassOwed: number; unpaidFoodTotal: number; overtimeDue: number;
};
export function settlementIncomeRows(s: SettlementOwed, paymentMode: string | undefined, label: string) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines = [
    { category: "membership", amount: s.membershipDue + s.overstayCharge, what: [
      s.membershipDue > 0 && `membership due ₹${r2(s.membershipDue)}`,
      s.overstayCharge > 0 && `₹${r2(s.overstayCharge)} for ${s.overstayDays} day(s) used after expiry`,
    ] },
    { category: "locker", amount: s.lockerDue, what: [`locker rent ₹${r2(s.lockerDue)}`] },
    { category: "food", amount: s.foodPassOwed + s.unpaidFoodTotal, what: [
      s.unpaidFoodTotal > 0 && `unpaid food bills ₹${r2(s.unpaidFoodTotal)}`,
      s.foodPassOwed > 0 && `Food Pass deficit ₹${r2(s.foodPassOwed)}`,
    ] },
    { category: "overtime", amount: s.overtimeDue, what: [`overtime ₹${r2(s.overtimeDue)}`] },
  ];
  let cashLeft = r2(Math.max(s.netAmount, 0));
  const rows: { category: string; amount: number; payment_mode: string; notes: string }[] = [];
  for (const line of lines) {
    const amount = r2(line.amount);
    if (!(amount > 0)) continue;
    const what = line.what.filter(Boolean).join(", ");
    const paid = r2(Math.min(cashLeft, amount));
    const offset = r2(amount - paid);
    cashLeft = r2(cashLeft - paid);
    if (paid > 0) {
      rows.push({ category: line.category, amount: paid, payment_mode: paymentMode ?? "cash", notes: `Final settlement at ${label} (${what})` });
    }
    if (offset > 0) {
      rows.push({ category: line.category, amount: offset, payment_mode: "other", notes: `Settled against refunds owed to the student at ${label} — no cash changed hands (${what})` });
    }
  }
  return rows;
}
