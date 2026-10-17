// P0.6 — Idempotency-Key against the REAL handler: a retry with the same key gets the stored
// answer and runs nothing; different keys (or none) behave as today; 5xx is never stored.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { raw, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { STALE_CLAIM_MS } from "../../supabase/functions/_shared/idempotency.ts";
const g = globalThis as any;
const TODAY = IST_TODAY();

async function send(action: string, payload: any, token: string | undefined, key?: string) {
  const res = await raw(new Request("http://fn.local/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify({ action, ...payload }),
  }));
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text, replayed: res.headers.get("Idempotent-Replayed") === "true" };
}

let b1: any, priya: any, ravi: any, tP: string, tR: string, mem: any, asha: any;
async function setup() {
  reset();
  b1 = insert("branches", { name: "Hopes", desk_count: 4, locker_capacity: 20, is_active: true, shift_config: ["morning"] });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: b1.id });
  for (const [h, fee] of [[4, 800], [6, 1250], [8, 1500]]) insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: h, fee, sort_order: h });
  asha = insert("students", { name: "Asha Rao", phone: "9100000001", branch_id: b1.id, status: "active", total_visits: 3, total_hours_studied: 12 });
  mem = insert("memberships", { student_id: asha.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -27), end_date: addDays(TODAY, 3), due_date: addDays(TODAY, 3), months_paid: 1, monthly_fee: 1250, total_paid: 750, fee_due: 500, is_active: true, plan_amount: 1250, plan_days: 30 });
  [tP, tR] = await Promise.all([priya, ravi].map((s) => tokenFor(s)));
}
const pay = (extra: any = {}) => ({ membershipId: mem.id, amount: 100, paymentMode: "cash", ...extra });
const payments = () => rows("transactions").filter((t) => t.membership_id === mem.id);

// ── Same key twice: one transaction, the retry gets the same answer ──
await setup();
{
  const a = await send("record_payment", pay(), tP, "key-1");
  const b = await send("record_payment", pay(), tP, "key-1");
  check(a.status === 200 && b.status === 200 && b.text === a.text && !a.replayed && b.replayed,
    "I1: the retry gets the first answer back (marked Idempotent-Replayed)", { a, b });
  check(payments().length === 1 && rows("memberships")[0].total_paid === 850 && rows("memberships")[0].fee_due === 400,
    "I1: two identical record_payment calls with the same key create one transaction row", { tx: payments(), m: rows("memberships")[0] });
  check(rows("events").filter((e) => e.action === "record_payment").length === 1, "I1: the replay writes no second event");
  const k = rows("idempotency_keys");
  check(k.length === 1 && k[0].key === "key-1" && k[0].status === 200 && k[0].action === "record_payment" && k[0].actor_id === priya.id && /^[0-9a-f]{64}$/.test(k[0].request_hash),
    "I1: the stored key records action, staff, status and a request hash", k);
}
// ── Different keys / no key: as today ──
await setup();
{
  await send("record_payment", pay(), tP, "key-a");
  await send("record_payment", pay(), tP, "key-b");
  check(payments().length === 2, "I2: two calls with different keys create two transactions, as today", payments());
  await send("record_payment", pay(), tP);
  await send("record_payment", pay(), tP);
  check(payments().length === 4 && rows("idempotency_keys").length === 2, "I2: calls without a key behave as today and store nothing");
}
// ── Key misuse ──
await setup();
{
  await send("record_payment", pay(), tP, "key-2");
  const changed = await send("record_payment", pay({ amount: 150 }), tP, "key-2");
  const other = await send("record_payment", pay(), tR, "key-2");
  const action = await send("add_manual_payment", { studentId: asha.id, date: TODAY, reason: "fine", amount: 100, paymentMode: "cash" }, tP, "key-2");
  check([changed, other, action].every((r) => r.status === 422 && /already submitted with different details/.test(r.body.error)) && payments().length === 1 && rows("transactions").length === 1,
    "I3: the same key with a different amount, another staff member or another action is refused and runs nothing", { changed, other, action });
  const order = await send("record_payment", { paymentMode: "cash", amount: 100, membershipId: mem.id }, tP, "key-2");
  check(order.status === 200 && order.replayed && payments().length === 1, "I3: key order in the body does not matter", order);
  const long = await send("record_payment", pay(), tP, "x".repeat(201));
  check(long.status === 400 && payments().length === 1, "I3: an over-long key is refused", long);
}
// ── Refusals are stored; server errors are not ──
await setup();
{
  const bad = await send("record_payment", pay({ amount: 900 }), tP, "key-3");
  const again = await send("record_payment", pay({ amount: 900 }), tP, "key-3");
  check(bad.status === 400 && again.status === 400 && again.replayed && again.text === bad.text && rows("events").length === 1,
    "I4: a refusal (4xx) is stored and replayed without running again", { bad, again });

  // (record_payment updates the membership before it writes the transaction, so this 500 leaves
  // the membership already credited — existing behaviour, reported to the owner, not changed here.)
  g.__FAKE_CHECK__ = (table: string) => { if (table === "transactions") throw new Error("connection lost"); return null; };
  const boom = await send("record_payment", pay(), tP, "key-4");
  g.__FAKE_CHECK__ = undefined;
  check(boom.status === 500 && !rows("idempotency_keys").some((k) => k.key === "key-4"), "I4: a 500 is not stored — the key is released", { boom, keys: rows("idempotency_keys") });
  const retry = await send("record_payment", pay(), tP, "key-4");
  check(retry.status === 200 && !retry.replayed && payments().length === 1, "I4: the retry after a 500 runs the action", { retry, tx: payments() });
}
// ── Still running, abandoned claims, double click ──
await setup();
{
  const row = insert("idempotency_keys", { key: "key-5", action: "record_payment", actor_id: priya.id, request_hash: null, status: 0, response: {} });
  delete row.id;
  const { requestHash } = await import("../../supabase/functions/_shared/idempotency.ts");
  row.request_hash = await requestHash("record_payment", pay(), "test-secret");
  const busy = await send("record_payment", pay(), tP, "key-5");
  check(busy.status === 409 && /still being processed/.test(busy.body.error) && payments().length === 0, "I5: a retry while the first try is still running gets 409 and runs nothing", busy);
  row.created_at = new Date(Date.now() - STALE_CLAIM_MS - 1000).toISOString();
  const takeover = await send("record_payment", pay(), tP, "key-5");
  check(takeover.status === 200 && payments().length === 1 && rows("idempotency_keys").filter((k) => k.key === "key-5").length === 1 && rows("idempotency_keys")[0].status === 200,
    "I5: a claim abandoned for over 5 minutes is taken over and the action runs once", { takeover, keys: rows("idempotency_keys") });

  const [x, y] = await Promise.all([send("record_payment", pay(), tP, "key-6"), send("record_payment", pay(), tP, "key-6")]);
  const ran = [x, y].filter((r) => r.status === 200 && !r.replayed);
  check(payments().length === 2 && ran.length === 1 && [x, y].every((r) => r.status === 200 || r.status === 409),
    "I5: a double click sends two requests at once — one runs, the other gets 409 or the stored answer", { x, y });
}
// ── Checkout and renewal ──
await setup();
{
  const desk = insert("desks", { branch_id: b1.id, label: "C1", status: "occupied", sort_order: 0 });
  const bk = insert("bookings", { student_id: asha.id, branch_id: b1.id, desk_id: desk.id, membership_id: mem.id, booking_type: "temporary", status: "active", start_time: new Date(Date.now() - 3 * 3600e3).toISOString(), end_time: new Date(Date.now() + 3 * 3600e3).toISOString(), hours: 6, scheduled_hours: 6, amount: 0, is_paused: false, total_pause_minutes: 0 });
  const c1 = await send("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, tP, "key-7");
  const c2 = await send("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, tP, "key-7");
  const c3 = await send("checkout_booking", { bookingId: bk.id, overtimeMinutes: 0 }, tP, "key-8");
  check(c1.status === 200 && c2.status === 200 && c2.replayed && c2.text === c1.text, "I6: a retried checkout gets the success answer, not an error", { c1, c2 });
  check(c3.status >= 400, "I6: a new checkout with a new key still hits the existing 'already checked out' guard", c3);

  rows("memberships")[0].fee_due = 0; // renewal needs the old dues cleared
  const renew = { membershipId: mem.id, monthsPaid: 1, paymentMode: "cash", category: "temporary", hoursPerDay: 6, expectedTotal: 1250 };
  const r1 = await send("renew_membership", renew, tP, "key-9");
  const r2 = await send("renew_membership", renew, tP, "key-9");
  const created = rows("memberships").filter((m) => m.renewed_from_membership_id === mem.id);
  check(r1.status === 200 && r2.replayed && r2.text === r1.text && created.length === 1, "I6: a retried renewal creates one new membership", { r1, r2, created: created.length });
}
// ── Reads, idempotent actions, missing table ──
await setup();
{
  await send("list_students", { branchId: b1.id }, tP, "key-10");
  await send("login", { username: "priya", password: "pw" }, undefined, "key-11");
  check(rows("idempotency_keys").length === 0, "I7: reads and actions marked idempotent ignore the key");

  g.__FAKE_CHECK__ = (table: string) => (table === "idempotency_keys" ? { message: "relation \"idempotency_keys\" does not exist", code: "42P01" } : null);
  const origError = console.error; console.error = () => {};
  const a = await send("record_payment", pay(), tP, "key-12");
  const b = await send("record_payment", pay(), tP, "key-12");
  console.error = origError; g.__FAKE_CHECK__ = undefined;
  check(a.status === 200 && b.status === 200 && payments().length === 2, "I7: if the keys table is missing (054 not applied) actions run exactly as before", { a, b });
}

done();
