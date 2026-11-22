// 2b-E transactions (migration 054): the five money actions, old step-by-step api vs new
// one-transaction api, on the local dummy stack only (writes dummy rows).
//   REF_FN  the function with the old steps (default "apiorig": deploy it from commit
//           d560eb0, the api just before this change: bash tests/scale/setup.sh .scale-test d560eb0)
// For every case two "twin" students are put into exactly the same state (membership,
// locker, Food Pass, alerts, their own copy of the food items); the old api acts on one,
// the new on the other, and every row the action touches plus the reply must be equal
// (amounts to the paisa). Then the cases the transactions exist for: a failure half way
// must leave nothing behind, and requests at the same moment must not lose money.
import { execFileSync } from "node:child_process";

const REF = process.env.REF_FN || "apiorig";
const sql = (q) => execFileSync("docker", ["exec", "-i", `${process.env.SCALE_PREFIX || "psslocal"}-db`, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"],
  { input: q, encoding: "utf8" }).trim();
const json1 = (q) => JSON.parse(sql(q) || "null");
const tokens = {};
// One retry when the connection drops before an answer (an idle keep-alive connection through
// an SSH tunnel can be closed by the far end just as it is reused). Safe: every call carries an
// Idempotency-Key, so a write that did arrive is replayed, not done twice.
const call = async (fn, body, key) => {
  key ??= crypto.randomUUID();
  try { return await call1(fn, body, key); } catch (e) { if (!(e instanceof TypeError)) throw e; console.log(`     (connection dropped, retried once: ${e.cause?.message ?? e.message})`); return call1(fn, body, key); }
};
const call1 = async (fn, body, key) => {
  const r = await fetch(`http://127.0.0.1:8010/functions/v1/${fn}`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokens[fn]}`, "idempotency-key": key ?? crypto.randomUUID() },
    body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let fails = 0, passes = 0;
const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (c) passes++; else fails++; };
for (const fn of ["api", REF]) {
  tokens[fn] = (await fetch(`http://127.0.0.1:8010/functions/v1/${fn}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "login", username: "owner", password: "local-owner-pass" }) }).then((r) => r.json())).token;
  if (!tokens[fn]) { console.log(`no owner login on ${fn}`); process.exit(1); }
}

// Replies: ids become "<id>", numbers are rounded to the paisa, keys sorted (the database
// returns JSON keys in its own order; the website reads them by name).
const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) =>
  typeof x === "number" ? Math.round(x * 100) / 100
    : typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x) ? "<id>"
    : x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Two students of one branch with one active membership and nothing else in play (no
// locker, no Food Pass, not checked in). Earlier runs use students up, so any branch with
// two left will do; a fresh 1,500-student seed has room for many runs.
const used = new Set();
function twins() {
  const rows = json1(`WITH free AS (
    SELECT s.id AS student, s.branch_id AS branch, m.id AS membership, s.s_no FROM students s
      JOIN memberships m ON m.student_id = s.id AND m.is_active
     WHERE (SELECT count(*) FROM memberships m2 WHERE m2.student_id = s.id AND m2.is_active) = 1
       AND NOT EXISTS (SELECT 1 FROM lockers l WHERE l.student_id = s.id AND l.is_active)
       AND NOT EXISTS (SELECT 1 FROM food_passes p WHERE p.student_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.student_id = s.id AND b.status = 'active')
       ${used.size ? `AND s.id NOT IN (${[...used].map((x) => `'${x}'`).join(",")})` : ""})
    SELECT json_agg(x) FROM (SELECT student, branch, membership FROM free
     WHERE branch = (SELECT branch FROM free GROUP BY branch HAVING count(*) >= 2 ORDER BY count(*) DESC, branch LIMIT 1)
     ORDER BY s_no LIMIT 2) x`) ?? [];
  for (const r of rows) used.add(r.student);
  return rows;
}

// Put one twin into a given state. Returns the ids the case needs.
function prepare(t, st, tag) {
  const out = { ...t };
  sql(`UPDATE memberships SET fee_due = ${st.feeDue ?? 0}, due_date = '${st.dueDate ?? "2026-11-30"}', total_paid = ${st.totalPaid ?? 5000},
         monthly_fee = ${st.monthlyFee ?? 2100}, months_paid = ${st.monthsPaid ?? 1} WHERE id = '${t.membership}';
       DELETE FROM alerts WHERE student_id = '${t.student}';
       UPDATE students SET status = 'active' WHERE id = '${t.student}';
       ${st.alert ? `INSERT INTO alerts (student_id, branch_id, alert_type, status) VALUES ('${t.student}', '${t.branch}', 'payment_due', 'pending');` : ""}
       ${st.passBalance != null ? `INSERT INTO food_passes (student_id, branch_id, balance) VALUES ('${t.student}', '${t.branch}', ${st.passBalance});` : ""}
       ${st.noMembership ? `UPDATE memberships SET is_active = false WHERE id = '${t.membership}';` : ""}`);
  if (st.lockerDue != null) {
    out.locker = sql(`INSERT INTO lockers (branch_id, student_id, locker_no, monthly_fee, locker_due_date, fee_due, amount_paid)
      VALUES ('${t.branch}', '${t.student}', 'T-${tag}-${crypto.randomUUID().slice(0, 8)}', 100, '2026-12-15', ${st.lockerDue}, 300) RETURNING id`).split("\n")[0];
  }
  out.items = (st.items ?? []).map((it) => sql(`INSERT INTO food_items (branch_id, name, price, quantity)
      VALUES ('${t.branch}', 'T ${it.name}', ${it.price}, ${it.quantity ?? "NULL"}) RETURNING id`).split("\n")[0]);
  if (st.walkin) out.walkin = st.walkin;
  out.t0 = sql("SELECT now()").split("\n")[0];
  return out;
}

// Every row the five actions write, without ids or timestamps, amounts to the paisa.
function snapshot(t) {
  const since = `'${t.t0}'`;
  const walkin = (t.walkin ?? "-").replace(/'/g, "''");
  return json1(`SELECT json_build_object(
    'membership', (SELECT json_build_object('fee_due', round(fee_due, 2), 'due_date', due_date, 'total_paid', round(total_paid, 2), 'is_active', is_active) FROM memberships WHERE id = '${t.membership}'),
    'status', (SELECT status FROM students WHERE id = '${t.student}'),
    'alerts', (SELECT json_agg(status ORDER BY status) FROM alerts WHERE student_id = '${t.student}'),
    'pass', (SELECT round(balance, 2) FROM food_passes WHERE student_id = '${t.student}'),
    'locker', ${t.locker ? `(SELECT json_build_object('fee_due', round(fee_due, 2), 'amount_paid', round(amount_paid, 2)) FROM lockers WHERE id = '${t.locker}')` : "NULL"},
    'stock', (SELECT json_agg(quantity ORDER BY name) FROM food_items WHERE id = ANY(ARRAY[${t.items.map((i) => `'${i}'`).join(",") || "NULL"}]::uuid[])),
    'transactions', (SELECT json_agg(json_build_object('category', category, 'amount', round(amount, 2), 'mode', payment_mode, 'notes', notes,
                        'membership', membership_id IS NOT NULL, 'bill', food_bill_id IS NOT NULL, 'locker_id', locker_id IS NOT NULL) ORDER BY category, amount, payment_mode)
                     FROM transactions WHERE created_at >= ${since}
                      AND (student_id = '${t.student}' OR food_bill_id IN (SELECT id FROM food_bills WHERE created_at >= ${since} AND student_id IS NULL AND branch_id = '${t.branch}' AND student_name = '${walkin}'))),
    'bills', (SELECT json_agg(json_build_object('subtotal', round(subtotal, 2), 'dtype', discount_type, 'dvalue', round(discount_value, 2), 'damount', round(discount_amount, 2),
                        'total', round(total, 2), 'mode', payment_mode, 'paid', paid, 'name', student_name, 'booking', booking_id IS NOT NULL,
                        'items', (SELECT json_agg(json_build_object('name', name, 'price', round(price, 2), 'qty', quantity, 'item', food_item_id IS NOT NULL) ORDER BY name) FROM food_bill_items WHERE food_bill_id = b.id))
                        ORDER BY total, paid)
              FROM food_bills b WHERE created_at >= ${since} AND (student_id = '${t.student}' OR (student_id IS NULL AND branch_id = '${t.branch}' AND student_name = '${walkin}'))),
    'discounts', (SELECT json_agg(json_build_object('type', discount_type, 'value', round(discount_value, 2), 'amount', round(discount_amount, 2), 'remarks', remarks)) FROM membership_discounts WHERE membership_id = '${t.membership}' AND created_at >= ${since}),
    'cashbacks', (SELECT json_agg(json_build_object('month', month_label, 'type', cashback_type, 'value', round(cashback_value, 2), 'notes', notes, 'status', status)) FROM cashbacks WHERE student_id = '${t.student}' AND created_at >= ${since}))`);
}

// One case: same state for both twins, same request (built from each twin's own ids).
// Old first, its rows read, then the new one (from a fresh start time).
async function twinCase(label, state, body) {
  const [a, b] = twins();
  if (!a || !b) { ok(false, `${label}: no free twin students`); return; }
  const A = prepare(a, state, "a"), B = prepare(b, state, "b");
  const ra = await call(REF, body(A)); const sa = snapshot(A);
  B.t0 = sql("SELECT now()").split("\n")[0];
  const rb = await call("api", body(B)); const sb = snapshot(B);
  const replyOk = ra.status === rb.status && same(norm(ra.body), norm(rb.body));
  const rowsOk = same(sa, sb);
  ok(replyOk && rowsOk, `${label}: HTTP ${ra.status}/${rb.status}${rb.body.error ? ` "${rb.body.error}"` : ""}${replyOk ? "" : `\n        old reply ${JSON.stringify(norm(ra.body))}\n        new reply ${JSON.stringify(norm(rb.body))}`}${rowsOk ? "" : `\n        old rows ${JSON.stringify(sa)}\n        new rows ${JSON.stringify(sb)}`}`);
}

const pay = (t, extra) => ({ action: "record_payment", membershipId: t.membership, ...extra });
const lpay = (t, extra) => ({ action: "record_locker_payment", lockerId: t.locker, ...extra });
const top = (t, extra) => ({ action: "topup_food_pass", studentId: t.student, branchId: t.branch, ...extra });
const bill = (t, extra) => ({ action: "create_food_bill", branchId: t.branch, studentId: t.student, studentName: "Twin", studentPhone: "9000000000",
  items: t.items.map((id, i) => ({ foodItemId: id, quantity: [2, 1, 3][i] ?? 1 })), ...extra });
const disc = (t, extra) => ({ action: "apply_loyalty_discount", membershipId: t.membership, ...extra });
const ITEMS = [{ name: "Tea", price: 12.5, quantity: 10 }, { name: "Sandwich", price: 45, quantity: null }];

console.log(`-- equal results: old steps (${REF}) vs one transaction (api)`);
console.log("   record_payment");
await twinCase("part payment, cash", { feeDue: 1000 }, (t) => pay(t, { amount: 300, paymentMode: "cash" }));
await twinCase("full payment, UPI: due date +1 month, alert resolved", { feeDue: 1000, alert: true, dueDate: "2026-01-31" }, (t) => pay(t, { amount: 1000, paymentMode: "upi" }));
await twinCase("split 400 cash + 600 UPI", { feeDue: 1000, alert: true }, (t) => pay(t, { amount: 1000, paymentMode: "split", cashAmount: 400, upiAmount: 600 }));
await twinCase("paise: 0.5 of 1000.50", { feeDue: 1000.5 }, (t) => pay(t, { amount: 0.5, paymentMode: "cash" }));
await twinCase("no payment mode (defaults to cash)", { feeDue: 500 }, (t) => pay(t, { amount: 200 }));
await twinCase("more than due: refused", { feeDue: 1000.5 }, (t) => pay(t, { amount: 2000, paymentMode: "cash" }));
await twinCase("zero: refused", { feeDue: 1000 }, (t) => pay(t, { amount: 0, paymentMode: "cash" }));
await twinCase("nothing due: refused", { feeDue: 0 }, (t) => pay(t, { amount: 10, paymentMode: "cash" }));
console.log("   record_locker_payment");
await twinCase("part payment", { lockerDue: 200 }, (t) => lpay(t, { amount: 50, paymentMode: "cash" }));
await twinCase("full payment, split 60 + 140", { lockerDue: 200 }, (t) => lpay(t, { amount: 200, paymentMode: "split", cashAmount: 60, upiAmount: 140 }));
await twinCase("more than due: refused", { lockerDue: 99.5 }, (t) => lpay(t, { amount: 100, paymentMode: "upi" }));
await twinCase("nothing due: refused", { lockerDue: 0 }, (t) => lpay(t, { amount: 100, paymentMode: "upi" }));
console.log("   topup_food_pass");
await twinCase("first top-up makes the pass", {}, (t) => top(t, { amount: 500, paymentMode: "upi" }));
await twinCase("top-up of an existing pass, no mode", { passBalance: 120.25 }, (t) => top(t, { amount: 79.75 }));
await twinCase("no active membership: refused", { noMembership: true }, (t) => top(t, { amount: 100, paymentMode: "cash" }));
await twinCase("zero: refused", {}, (t) => top(t, { amount: 0 }));
console.log("   create_food_bill");
await twinCase("paid now, cash, counted + uncounted items", { items: ITEMS }, (t) => bill(t, { paymentMode: "cash" }));
await twinCase("left unpaid (no mode)", { items: ITEMS }, (t) => bill(t, {}));
await twinCase("discount 10 off", { items: ITEMS }, (t) => bill(t, { paymentMode: "upi", discountType: "fixed", discountValue: 10, discountAmount: 10 }));
await twinCase("discount larger than the bill: capped", { items: ITEMS }, (t) => bill(t, { paymentMode: "upi", discountType: "fixed", discountValue: 999, discountAmount: 999 }));
await twinCase("negative discount: ignored", { items: ITEMS }, (t) => bill(t, { paymentMode: "cash", discountAmount: -50 }));
await twinCase("Food Pass covers it", { items: ITEMS, passBalance: 500 }, (t) => bill(t, { paymentMode: "cash" }));
await twinCase("Food Pass too low: unpaid, shortfall", { items: ITEMS, passBalance: 20 }, (t) => bill(t, { paymentMode: "cash" }));
await twinCase("empty pass skipped: normal payment", { items: ITEMS, passBalance: 0 }, (t) => bill(t, { paymentMode: "upi", skipFoodPass: true }));
await twinCase("not enough stock: refused", { items: [{ name: "Tea", price: 12.5, quantity: 1 }] }, (t) => bill(t, { paymentMode: "cash" }));
await twinCase("walk-in (no student)", { items: ITEMS, walkin: "Walk In Twin" }, (t) => ({ ...bill(t, { paymentMode: "cash" }), studentId: undefined, studentName: "Walk In Twin" }));
console.log("   apply_loyalty_discount (owner)");
await twinCase("10 percent of 2100", { feeDue: 2100 }, (t) => disc(t, { discountType: "percent", discountValue: 10, remarks: "top hours" }));
await twinCase("7 percent of 2100 (147, float case)", { feeDue: 2100 }, (t) => disc(t, { discountType: "percent", discountValue: 7 }));
await twinCase("fixed 300 off 2100", { feeDue: 2100, alert: true }, (t) => disc(t, { discountType: "fixed", discountValue: 300 }));
await twinCase("fixed equal to the fee: due 0, alert resolved", { feeDue: 2100, alert: true }, (t) => disc(t, { discountType: "fixed", discountValue: 2100 }));
await twinCase("fixed larger than the fee: rest banked as cashback", { feeDue: 500, alert: true }, (t) => disc(t, { discountType: "fixed", discountValue: 800, remarks: "loyal" }));
await twinCase("nothing due: all banked (base = fee x months)", { feeDue: 0, monthlyFee: 1800, monthsPaid: 3 }, (t) => disc(t, { discountType: "percent", discountValue: 5 }));
await twinCase("more than 100 percent: refused", { feeDue: 2100 }, (t) => disc(t, { discountType: "percent", discountValue: 1000 }));

// TWINS_ONLY=1: only the equal-results part (used with 054 hidden, to prove the fallback).
if (process.env.TWINS_ONLY) { console.log(`\nResult: ${passes} PASS, ${fails} FAIL`); process.exit(fails ? 1 : 0); }

console.log("\n-- a failure half way leaves nothing behind (new api; the old one did not)");
{
  const [a] = twins(); const A = prepare(a, { feeDue: 1000 }, "f");
  const r = await call("api", pay(A, { amount: 1000, paymentMode: "split", cashAmount: 100, upiAmount: 100 }));
  const s = snapshot(A);
  ok(r.status === 400 && s.membership.fee_due === 1000 && !s.transactions,
    `split that does not add up: HTTP ${r.status} "${r.body.error}", fee due still ${s.membership.fee_due}, ledger rows ${s.transactions?.length ?? 0}`);
  const [o] = twins(); const O = prepare(o, { feeDue: 1000 }, "g");
  const ro = await call(REF, pay(O, { amount: 1000, paymentMode: "split", cashAmount: 100, upiAmount: 100 }));
  const so = snapshot(O);
  console.log(`     (old steps, same request: HTTP ${ro.status}, fee due ${so.membership.fee_due}, ledger rows ${so.transactions?.length ?? 0})`);
}
{
  const two = [{ name: "Coffee", price: 20, quantity: 5 }, { name: "Tea", price: 12.5, quantity: 1 }];
  const order = (t) => ({ ...bill(t, { paymentMode: "cash" }), items: [{ foodItemId: t.items[0], quantity: 2 }, { foodItemId: t.items[1], quantity: 3 }] });
  const [a] = twins(); const A = prepare(a, { items: two }, "h");
  const r = await call("api", order(A));
  const s = snapshot(A);
  ok(r.status === 400 && same(s.stock, [5, 1]) && !s.bills, `second item out of stock: HTTP ${r.status} "${r.body.error}", stock still ${JSON.stringify(s.stock)}, bills ${s.bills?.length ?? 0}`);
  const [o] = twins(); const O = prepare(o, { items: two }, "i");
  await call(REF, order(O));
  console.log(`     (old steps, same request: stock ${JSON.stringify(snapshot(O).stock)})`);
}

console.log("\n-- requests at the same moment (different keys: two cashiers, two tabs)");
async function race(fn, n, state, body, check) {
  const [a] = twins(); const A = prepare(a, state, "r");
  const rs = await Promise.all(Array.from({ length: n }, () => call(fn, body(A))));
  return check(A, rs, snapshot(A));
}
const sum = (s) => Math.round((s.transactions ?? []).reduce((x, t) => x + t.amount, 0) * 100) / 100;
for (const fn of ["api", REF]) {
  const isNew = fn === "api";
  const tag = isNew ? "new" : "old";
  await race(fn, 2, { feeDue: 1000 }, (t) => pay(t, { amount: 600, paymentMode: "cash" }), (t, rs, s) => {
    const okCount = rs.filter((r) => r.status === 200).length;
    const right = Math.round((1000 - s.membership.fee_due) * 100) === Math.round(sum(s) * 100);
    const line = `${tag}: 2 x 600 on a due of 1000: ${okCount} accepted, fee due ${s.membership.fee_due}, ledger ${sum(s)}`;
    if (isNew) ok(okCount === 1 && right && s.membership.fee_due === 400, `${line}; the other was told "${rs.find((r) => r.status !== 200)?.body.error}"`);
    else console.log(`     (${line}${right ? "" : "  <- money in the ledger that no balance shows"})`);
  });
  await race(fn, 5, {}, (t) => top(t, { amount: 100, paymentMode: "cash" }), (t, rs, s) => {
    const line = `${tag}: 5 top-ups of 100 on a new pass: pass ${s.pass}, ledger ${sum(s)}, answers ${rs.map((r) => r.status).join(",")}`;
    if (isNew) ok(s.pass === 500 && sum(s) === 500, line);
    else console.log(`     (${line}${s.pass === sum(s) ? "" : "  <- pass and ledger disagree"})`);
  });
  await race(fn, 2, { passBalance: 100, items: [{ name: "Thali", price: 80, quantity: null }] }, (t) => ({ ...bill(t, {}), items: [{ foodItemId: t.items[0], quantity: 1 }] }), (t, rs, s) => {
    const paidFromPass = (s.bills ?? []).filter((b) => b.paid).length;
    const line = `${tag}: 2 bills of 80 on a pass of 100: pass ${s.pass}, paid from the pass ${paidFromPass}, left unpaid ${(s.bills ?? []).length - paidFromPass}`;
    if (isNew) ok(s.pass === 20 && paidFromPass === 1, line);
    else console.log(`     (${line}${s.pass === 100 - 80 * paidFromPass ? "" : "  <- food paid from the pass that the balance does not show"})`);
  });
}

console.log(`\nResult: ${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
