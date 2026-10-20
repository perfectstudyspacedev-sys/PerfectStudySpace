// F-1 — a cash + UPI split that doesn't add up is refused before anything is written, on every
// payment path that used to check it only when writing the transaction.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
const TODAY = IST_TODAY();

reset();
const b1 = insert("branches", { name: "Hopes", is_active: true, locker_capacity: 10, desk_count: 4 });
const owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
const tO = await tokenFor(owner);
for (const [h, fee] of [[3, 35], [6, 60]]) insert("fee_config", { config_type: "walkin", max_hours: h, fee, sort_order: h });
const st = insert("students", { name: "Asha Rao", phone: "9100000001", branch_id: b1.id, status: "active" });
const mem = insert("memberships", { student_id: st.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -10), end_date: addDays(TODAY, 19), due_date: addDays(TODAY, 19), months_paid: 1, monthly_fee: 1250, total_paid: 950, fee_due: 300, is_active: true });
const st2 = insert("students", { name: "Bala Kumar", phone: "9100000002", branch_id: b1.id, status: "active" });
const lockerDue = insert("lockers", { branch_id: b1.id, student_id: st.id, locker_no: "1", is_active: true, deposit_amount: 100, deposit_returned: false, monthly_fee: 100, amount_paid: 0, fee_due: 300, locker_due_date: addDays(TODAY, 10) });
const lockerPaid = insert("lockers", { branch_id: b1.id, student_id: st2.id, locker_no: "2", is_active: true, deposit_amount: 100, deposit_returned: false, monthly_fee: 100, amount_paid: 200, fee_due: 0, locker_due_date: addDays(TODAY, 3) });
const bad = { paymentMode: "split", cashAmount: 10, upiAmount: 20 };
const snapshot = () => JSON.stringify(["memberships", "lockers", "transactions", "bookings", "students", "desks"].map((t) => rows(t)));

const cases: [string, any][] = [
  ["record_payment", { membershipId: mem.id, amount: 100, ...bad }],
  ["record_locker_payment", { lockerId: lockerDue.id, amount: 100, ...bad }],
  ["add_manual_payment", { studentId: st.id, date: TODAY, reason: "fine", amount: 100, ...bad }],
  ["renew_locker", { lockerId: lockerPaid.id, ...bad }],
  ["add_locker", { studentId: st2.id, branchId: b1.id, lockerNo: "9", ...bad }],
  ["remove_locker", { lockerId: lockerDue.id, ...bad }],
  ["create_walkin", { branchId: b1.id, name: "Walk Two", phone: "9700000001", hours: 3, ...bad }],
];
// a second locker for st2 must not exist for add_locker to reach the payment step
rows("lockers").splice(rows("lockers").indexOf(lockerPaid), 1);
const renewCase = cases.find(([a]) => a === "renew_locker")!;
for (const [action, payload] of cases) {
  if (action === "renew_locker") rows("lockers").push(lockerPaid);
  const before = snapshot();
  const r = await call(action, payload, tO);
  check(r.status === 400 && r.error === "Cash + UPI amounts must add up to the total" && snapshot() === before,
    `F-1: ${action} refuses a split that doesn't add up and changes nothing`, r);
  if (action === "renew_locker") rows("lockers").splice(rows("lockers").indexOf(lockerPaid), 1);
}
void renewCase;

// and a split that does add up still works
const ok = await call("record_payment", { membershipId: mem.id, amount: 30, paymentMode: "split", cashAmount: 10, upiAmount: 20 }, tO);
const tx = rows("transactions");
check(ok.status === 200 && tx.length === 2 && tx.map((t) => `${t.payment_mode}:${t.amount}`).sort().join() === "cash:10,upi:20" && rows("memberships")[0].fee_due === 270,
  "F-1: a correct split is recorded as before (cash and UPI rows)", { ok, tx });

done();
