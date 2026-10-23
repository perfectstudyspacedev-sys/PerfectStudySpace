// P2.2 — UPI pay links and payment proofs against the REAL api function: amounts come from code,
// proofs are checked (UTR reuse, amount, payee), the AI only reads screenshots, and the owner's
// Confirm runs the existing payment action once (with payment mode upi) or not at all.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays, fake } from "./harness.ts";
import { fakeAi, reply, text } from "./fake-anthropic.ts";
import { sameRequest } from "../../supabase/functions/api/payments-lib.ts";
const g = globalThis as any;
let TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
// A tiny valid PNG (1×1) and a "screenshot" that is really text.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const NOT_IMAGE = btoa("hello, this is not an image");

let b1: any, owner: any, priya: any, asha: any, memA: any, tO: string, tP: string, tA: string;
async function setup() {
  reset(); fakeAi.reset();
  TODAY = IST_TODAY();
  Deno.env.set("AI_API_KEY", "test-ai-key");
  b1 = insert("branches", { name: "Hopes", is_active: true, desk_count: 4, locker_capacity: 10 });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  for (const [h, fee] of [[4, 800], [6, 1250], [8, 1500]]) insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: h, fee, sort_order: h });
  asha = insert("students", { name: "Asha Rao", phone: "9100000001", emergency_contact: "9000000001", branch_id: b1.id, status: "active" });
  memA = insert("memberships", { student_id: asha.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -27), end_date: addDays(TODAY, 2), due_date: addDays(TODAY, 2), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true, plan_amount: 1250, plan_days: 30 });
  for (const [k, v] of [["pssai_portal", "on"], ["pssai_upi_pay", "on"], ["upi_vpa", "pss.hall@okaxis"], ["upi_payee_name", "Perfect Study Space"]]) setSetting(k, v);
  const code = await call("create_portal_setup_code", { studentId: asha.id }, tP);
  tA = (await call("me_set_pin", { phone: asha.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
}
const pay = (purpose: string, extra: any = {}) => call("me_payment_request", { purpose, ...extra }, tA);
const proofs = () => rows("payment_proofs");

// ── Requests: switch, set-up, amounts from code ──
await setup();
{
  setSetting("pssai_upi_pay", "off");
  check((await pay("renewal", { months: 1 })).status === 403, "U1: with pssai_upi_pay off the portal cannot ask for a payment");
  setSetting("pssai_upi_pay", "on");
  rows("app_settings").find((r) => r.key === "upi_vpa").value = "";
  const noVpa = await pay("renewal", { months: 1 });
  check(noVpa.status === 503 && /not set up/.test(noVpa.error), "U1: without upi_vpa the student is sent to the desk", noVpa);
  setSetting("upi_vpa", "pss.hall@okaxis");

  const r3 = await pay("renewal", { months: 3, amount: 1 });
  check(r3.status === 200 && r3.amount === 3375 && /^PSS-[A-Z2-9]{8}$/.test(r3.reference) && r3.upiLink === `upi://pay?pa=pss.hall@okaxis&pn=Perfect%20Study%20Space&am=3375.00&tn=${r3.reference}&cu=INR`,
    "U1: a 3-month renewal costs ₹3,375 by the plan's rules (a client amount is ignored) and the link carries the reference", r3);
  const again = await pay("renewal", { months: 3 });
  const other = await pay("renewal", { months: 1 });
  check(again.reference === r3.reference && other.reference !== r3.reference && other.amount === 1250 && proofs().length === 2, "U1: asking again within a day reuses the same request; a different plan gets its own", proofs().map((p) => p.reference));
  check((await pay("dues")).status === 400, "U1: no dues → nothing to pay");
  const food = await Promise.all([pay("food_pass", { amount: 50 }), pay("food_pass", { amount: 250.5 }), pay("food_pass", { amount: 500 })]);
  check(food[0].status === 400 && food[1].status === 400 && food[2].amount === 500, "U1: Food Pass top-ups are whole rupees from ₹100 to ₹5,000", food.map((f) => f.status));
  check((await pay("gift")).status === 400, "U1: unknown purposes are refused");
}

// ── Proofs: UTR, screenshot, checks, AI reading ──
await setup();
{
  const r = await pay("renewal", { months: 1 });
  const bad = await Promise.all([
    call("me_submit_payment_proof", { reference: r.reference, utr: "12345" }, tA),
    call("me_submit_payment_proof", { reference: r.reference }, tA),
    call("me_submit_payment_proof", { reference: r.reference, image: { data: NOT_IMAGE } }, tA),
    call("me_submit_payment_proof", { reference: "PSS-NOPENOPE", utr: "123456789012" }, tA),
  ]);
  check(bad[0].status === 400 && bad[1].status === 400 && bad[2].status === 400 && /JPG, PNG or WebP/.test(bad[2].error) && bad[3].status === 404, "U2: a short UTR, nothing at all, a non-image file and an unknown reference are refused", bad.map((b) => b.error));

  setSetting("pssai_proof_reading", "on");
  g.__FAKE_AI__ = () => reply([text(JSON.stringify({ is_payment_screenshot: true, status: "success", amount: 1200, utr: "4321 0987 6543", paid_at: "21 Oct 2026, 10:02", payee_vpa: "someone.else@okaxis", payee_name: "Someone", confidence: "high" }))], "end_turn", { input_tokens: 1500, output_tokens: 90 });
  const sent = await call("me_submit_payment_proof", { reference: r.reference, utr: "123456789012", image: { data: PNG } }, tA);
  const p = proofs().find((x) => x.reference === r.reference);
  const req = fakeAi.requests[0];
  check(sent.status === 200 && p.status === "submitted" && p.utr === "123456789012" && p.image_path === `${asha.id}/${p.id}.png` && fake.storage[`payment-proofs/${p.image_path}`]?.contentType === "image/png",
    "U2: the proof is stored with its UTR, and the screenshot goes to the private bucket", { sent, p });
  check(req.model === "claude-sonnet-5-5" && req.messages[0].content[0].type === "image" && req.output_config?.format?.type === "json_schema" && !("tools" in req), "U2: the screenshot is read by Sonnet 5.5 with a JSON schema (D3)", { model: req.model });
  check(p.ai_reading.amount === 1200 && p.ai_reading.utr === "432109876543" && rows("agent_runs")[0].agent === "proof-reader", "U2: the reading is stored (UTR digits only) and the run is logged");
  const w = p.checks.join(" | ");
  check(/₹1200 differs from ₹1250/.test(w) && /Paid to someone.else@okaxis/.test(w) && /UTR typed 123456789012 differs/.test(w), "U2: code flags the wrong amount, the wrong payee and a UTR that differs from the one typed", p.checks);
  const ev = rows("events").filter((e) => e.action === "me_submit_payment_proof" && e.ok).at(-1);
  check(ev && ev.payload.image === "[redacted]" && !JSON.stringify(rows("events")).includes(PNG.slice(0, 30)), "U2: the screenshot never reaches the event log (R11)", ev?.payload);

  // The same UTR on a second payment is flagged.
  const f = await pay("food_pass", { amount: 300 });
  await call("me_submit_payment_proof", { reference: f.reference, utr: "123456789012" }, tA);
  const p2 = proofs().find((x) => x.reference === f.reference);
  check(p2.checks.some((c: string) => c.includes(`already sent with ${r.reference}`)), "U2: a UTR already used on another payment is flagged", p2.checks);

  setSetting("pssai_proof_reading", "off");
  const n = fakeAi.requests.length;
  const f2 = await pay("food_pass", { amount: 400 });
  await call("me_submit_payment_proof", { reference: f2.reference, image: { data: PNG } }, tA);
  check(fakeAi.requests.length === n && proofs().find((x) => x.reference === f2.reference).ai_reading === null, "U2: with pssai_proof_reading off no AI call is made");
}

// ── The owner's queue: confirm and reject ──
await setup();
{
  const r = await pay("renewal", { months: 1 });
  await call("me_submit_payment_proof", { reference: r.reference, utr: "111122223333" }, tA);
  const p = proofs()[0];
  const staffList = await call("list_payment_proofs", {}, tP);
  const list = await call("list_payment_proofs", {}, tO);
  check(staffList.status === 403 && list.proofs.length === 1 && list.proofs[0].name === "Asha Rao" && list.proofs[0].amount_expected === 1250 && list.proofs[0].image_path === undefined,
    "U3: only the owner sees the queue; each proof shows the student and amount (never the storage path)", list.proofs?.[0]);
  check((await call("confirm_payment_proof", { proofId: p.id }, tP)).status === 403, "U3: desk staff cannot confirm");

  const ok = await call("confirm_payment_proof", { proofId: p.id }, tO);
  const fresh = rows("memberships").find((m) => m.renewed_from_membership_id === memA.id);
  const tx = rows("transactions").filter((t) => t.student_id === asha.id && t.payment_mode === "upi");
  check(ok.status === 200 && ok.action === "renew_membership" && fresh && fresh.start_date === addDays(TODAY, 3) && tx.length === 1 && Number(tx[0].amount) === 1250,
    "U3: Confirm runs renew_membership (early renewal from the day after the end date) and records ₹1,250 by UPI", { ok, fresh: fresh?.start_date, tx });
  const after = proofs()[0];
  check(after.status === "confirmed" && after.decided_by_staff_id === owner.id && JSON.stringify(after.transaction_ids) === JSON.stringify([tx[0].id]), "U3: the proof is confirmed with the transaction it recorded", after);
  const renewEv = rows("events").find((e) => e.action === "renew_membership");
  check(renewEv?.actor_type === "owner" && renewEv.actor_id === owner.id && renewEv.payload.paymentMode === "upi", "U3: the renewal event has the owner as actor (P2.2)", renewEv);
  check(rows("portal_notifications").some((n) => n.student_id === asha.id && n.kind === "payment_confirmed"), "U3: the student is told");
  const twice = await call("confirm_payment_proof", { proofId: p.id }, tO);
  check(twice.status === 409 && rows("memberships").length === 2 && rows("transactions").filter((t) => t.payment_mode === "upi").length === 1, "U3: confirming again does nothing", twice);
}
await setup();
{
  // Two clicks at once: one runs, the other is refused.
  const f = await pay("food_pass", { amount: 300 });
  await call("me_submit_payment_proof", { reference: f.reference, utr: "111122223333" }, tA);
  const p = proofs()[0];
  const [x, y] = await Promise.all([call("confirm_payment_proof", { proofId: p.id }, tO), call("confirm_payment_proof", { proofId: p.id }, tO)]);
  const pass = rows("food_passes")[0];
  check([x, y].filter((r) => r.status === 200).length === 1 && Number(pass?.balance) === 300 && rows("transactions").length === 1, "U4: a double click confirms once — ₹300 on the Food Pass, one transaction", { x: x.status, y: y.status, pass });

  // The price changed after the request: confirm refuses and puts the proof back.
  const r = await pay("renewal", { months: 1 });
  await call("me_submit_payment_proof", { reference: r.reference, utr: "444455556666" }, tA);
  insert("cashbacks", { student_id: asha.id, status: "pending", cashback_type: "fixed", cashback_value: 100 });
  const pr = proofs().find((q) => q.reference === r.reference);
  const stale = await call("confirm_payment_proof", { proofId: pr.id }, tO);
  check(stale.status === 409 && /now costs ₹1150, but ₹1250 was paid/.test(stale.error) && pr.status === "submitted" && pr.decided_by_staff_id === null && rows("memberships").length === 1,
    "U4: if the amount changed since the request, nothing is charged and the proof goes back to the queue", stale);

  const noReason = await call("reject_payment_proof", { proofId: pr.id, reason: "" }, tO);
  const rejected = await call("reject_payment_proof", { proofId: pr.id, reason: "Amount does not match — please pay ₹1,150" }, tO);
  check(noReason.status === 400 && rejected.status === 200 && pr.status === "rejected" && rows("portal_notifications").some((n) => n.kind === "payment_rejected" && /₹1,150/.test(n.body)),
    "U4: Reject needs a reason, which the student sees", { noReason, rejected });
  const receipts = await call("me_receipts", {}, tA);
  check(receipts.upiPayments.some((u: any) => u.status === "rejected" && /₹1,150/.test(u.rejectReason)), "U4: the rejected payment and its reason show in the student's receipts");
  check((await call("reject_payment_proof", { proofId: pr.id, reason: "again" }, tO)).status === 409, "U4: a decided payment can't be decided again");
}
await setup();
{
  // Dues and lockers run their own actions.
  memA.fee_due = 400;
  const d = await pay("dues");
  await call("me_submit_payment_proof", { reference: d.reference, utr: "777788889999" }, tA);
  const dc = await call("confirm_payment_proof", { proofId: proofs()[0].id }, tO);
  check(d.amount === 400 && dc.action === "record_payment" && memA.fee_due === 0, "U5: dues are paid through record_payment", { d, dc, due: memA.fee_due });
  const locker = insert("lockers", { branch_id: b1.id, student_id: asha.id, locker_no: "L7", monthly_fee: 150, fee_due: 0, is_active: true, locker_due_date: addDays(TODAY, 1), amount_paid: 150 });
  const l = await pay("locker");
  await call("me_submit_payment_proof", { reference: l.reference, image: { data: PNG } }, tA);
  const pl = proofs().find((x) => x.reference === l.reference);
  const img = await call("get_payment_proof_image", { proofId: pl.id }, tO);
  check(img.status === 200 && img.url.includes(pl.image_path) && (await call("get_payment_proof_image", { proofId: pl.id }, tP)).status === 403, "U5: the owner opens the screenshot through a short-lived link; staff cannot", img);
  const lc = await call("confirm_payment_proof", { proofId: pl.id }, tO);
  check(l.amount === 150 && lc.action === "renew_locker" && locker.locker_due_date > addDays(TODAY, 1), "U5: a locker month is paid through renew_locker", { l: l.amount, lc, due: locker.locker_due_date });
}

// ── Review fixes: request reuse, UTR reuse, read once, the public cap ──
await setup();
{
  // R6: Postgres hands jsonb keys back in its own order; reuse must not depend on it.
  check(sameRequest({ months: 3, membershipId: "m1" }, { membershipId: "m1", months: 3 }) && !sameRequest({ months: 3, membershipId: "m1" }, { membershipId: "m1", months: 1 }), "R6: requests compare field by field");
  const r = await pay("renewal", { months: 3 });
  const stored = proofs()[0];
  stored.request = { months: 3, membershipId: memA.id };   // the order a real database returns
  const again = await pay("renewal", { months: 3 });
  check(again.reference === r.reference && proofs().length === 1, "R6: asking again reuses the open request whatever the stored key order", proofs().length);

  // R12: one UPI payment (one UTR) can confirm only one proof.
  const f1 = await pay("food_pass", { amount: 500 });
  const f2 = await pay("food_pass", { amount: 600 });
  await call("me_submit_payment_proof", { reference: f1.reference, utr: "999900001111" }, tA);
  await call("me_submit_payment_proof", { reference: f2.reference, utr: "999900001111" }, tA);
  const c1 = await call("confirm_payment_proof", { proofId: proofs().find((x) => x.reference === f1.reference).id }, tO);
  const c2 = await call("confirm_payment_proof", { proofId: proofs().find((x) => x.reference === f2.reference).id }, tO);
  check(c1.status === 200 && c2.status === 409 && /already paid for/.test(c2.error) && Number(rows("food_passes")[0].balance) === 500, "R12: the second proof with the same UTR can't be confirmed — the pass is credited once", c2);

  // R5 + R19: only a proof's first screenshot is read by itself; the proof is saved first.
  setSetting("pssai_proof_reading", "on");
  g.__FAKE_AI__ = () => reply([text(JSON.stringify({ is_payment_screenshot: true, status: "success", amount: 1250, utr: null, paid_at: null, payee_vpa: "pss.hall@okaxis", payee_name: null, confidence: "high" }))]);
  const d = await pay("food_pass", { amount: 700 });
  await call("me_submit_payment_proof", { reference: d.reference, image: { data: PNG } }, tA);
  const reads = fakeAi.requests.length;
  for (let i = 0; i < 3; i++) await call("me_submit_payment_proof", { reference: d.reference, image: { data: PNG } }, tA);
  const pd = proofs().find((x) => x.reference === d.reference);
  check(reads === 1 && fakeAi.requests.length === 1 && pd.ai_reading === null && pd.checks.some((c: string) => /press Read/.test(c)), "R5: sending new screenshots again doesn't spend the AI budget; the owner is asked to read the new one", { reads, now: fakeAi.requests.length });
  const owned = await call("read_payment_proof", { proofId: pd.id }, tO);
  check(owned.status === 200 && rows("agent_runs").at(-1).staff_id === owner.id, "R5: the owner's own Read still works and is logged as the owner's");
  setSetting("pssai_public_ai_daily", "1");
  const e = await pay("food_pass", { amount: 800 });
  await call("me_submit_payment_proof", { reference: e.reference, image: { data: PNG } }, tA);
  const pe = proofs().find((x) => x.reference === e.reference);
  check(fakeAi.requests.length === 2 && pe.status === "submitted" && /limit/.test(pe.ai_reading?.unread ?? ""), "R5: past the daily cap for public-started reads, the proof is kept unread for the owner", pe.ai_reading);
  setSetting("pssai_public_ai_daily", "40");
  g.__FAKE_AI__ = () => { throw new Error("overloaded"); };
  const h = await pay("food_pass", { amount: 900 });
  const sentH = await call("me_submit_payment_proof", { reference: h.reference, utr: "123412341234", image: { data: PNG } }, tA);
  check(sentH.status === 200 && proofs().find((x) => x.reference === h.reference).status === "submitted", "R19: when the AI read fails, the proof is still saved as sent", sentH);
}

done();
