// P2.4 A3 — onboarding against the REAL api function: a new student signs up, picks a plan and a
// PIN, may add an ID photo (C3), pays by UPI; the sign-up is kept while the owner decides; Confirm
// registers through create_membership and the chosen PIN works in the portal.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, fake } from "./harness.ts";
import { fakeAi, reply, text } from "./fake-anthropic.ts";
const g = globalThis as any;
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const CODE = "abcd1234efgh";
const FORM = { code: CODE, name: "Kavya Sri", phone: "9300000001", emergencyContact: "9300000009", course: "TNPSC", referralSource: "instagram" };

let b1: any, owner: any, tO: string, ref: string;
async function setup() {
  reset(); fakeAi.reset();
  Deno.env.set("AI_API_KEY", "test-ai-key");
  b1 = insert("branches", { name: "Hopes", is_active: true, signup_code: CODE, desk_count: 4 });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  tO = await tokenFor(owner);
  for (const [cat, h, fee] of [["temporary", 6, 1250], ["temporary", 8, 1500], ["permanent", 12, 2100]] as const) insert("fee_config", { config_type: "membership", cabin_type: cat, hours_per_day: h, fee, sort_order: h });
  for (const [k, v] of [["pssai_portal", "on"], ["upi_vpa", "pss.hall@okaxis"]]) setSetting(k, v);
  const sub = await call("public_signup_submit", FORM);
  ref = sub.ref;
}
const pay = (extra: any = {}) => call("public_signup_pay", { code: CODE, ref, phone: FORM.phone, category: "temporary", hoursPerDay: 6, months: 2, pin: "482915", acceptPrivacy: true, ...extra });

await setup();
{
  const off = await call("public_signup_plans", { code: CODE });
  check(off.status === 200 && off.selfPay === false && (await pay()).status === 403, "O1: with the switches off the sign-up page offers no payment");
  setSetting("pssai_auto_approve", "on"); setSetting("pssai_upi_pay", "on");
  const plans = await call("public_signup_plans", { code: CODE });
  check(plans.selfPay && plans.permanentFree === 0 && plans.plans.every((p: any) => p.category === "temporary") && plans.plans.length === 2, "O2: with no free permanent desk only temporary plans are offered", plans);
  check((await call("public_signup_plans", { code: "zzzzzzzzzzzz" })).status === 404, "O2: a wrong link is refused");

  const wrongRef = await pay({ ref: "ZZZZ" });
  const wrongPhone = await pay({ phone: "9300000002" });
  const weak = await pay({ pin: "123456" });
  const noConsent = await pay({ acceptPrivacy: false });
  const perm = await pay({ category: "permanent", hoursPerDay: 12 });
  check(wrongRef.status === 404 && wrongPhone.status === 404 && weak.status === 400 && noConsent.status === 400 && perm.status === 400 && /No permanent seat/.test(perm.error),
    "O3: wrong reference or phone, a weak PIN, no consent, and a permanent plan with no free desk are refused", [wrongRef.status, wrongPhone.status, weak.status, noConsent.status, perm.error]);

  g.__FAKE_AI__ = () => reply([text(JSON.stringify({ readable: true, kind: "aadhaar", name_matches: true, note: "Clear card 1234 5678 9012, name matches" }))]);
  const r = await pay({ idPhoto: { data: PNG } });
  const su = rows("signup_requests")[0];
  const proof = rows("payment_proofs")[0];
  check(r.status === 200 && r.amount === 2375 && /^PSS-/.test(r.reference) && proof.purpose === "registration" && proof.signup_request_id === su.id && proof.student_id === null && JSON.stringify(proof.request) === JSON.stringify({ category: "temporary", hoursPerDay: 6, months: 2 }),
    "O3: 2 months of the 6-hour plan costs ₹2,375 (5% off) and creates a registration payment for this sign-up", { r, proof });
  check(/^pbkdf2-sha256\$/.test(su.pin_hash) && !JSON.stringify(su).includes("482915") && new Date(su.keep_until).getTime() > Date.now() + 2.9 * 86400e3, "O3: the PIN is kept only as a hash; the sign-up is kept for 3 days");
  const q = fakeAi.requests[0];
  check(q.model === "claude-sonnet-5-5" && q.messages[0].content[0].type === "image" && q.messages[0].content[1].text === "Name given: Kavya Sri", "O4: the ID photo is checked by Sonnet 5.5 against the name given");
  check(su.id_check.readable === true && su.id_check.name_matches === true && !/\d/.test(su.id_check.note) && su.id_photo_path === `signup-${su.id}.png` && fake.storage[`id-photos/${su.id_photo_path}`], "O4: the result is kept without any digits from the card; the photo is in the private bucket", su.id_check);
  check(!JSON.stringify(rows("events")).includes(PNG.slice(0, 20)) && rows("events").filter((e) => e.action === "public_signup_pay").every((e) => JSON.stringify(e.payload) === "{}"), "O4: no photo, PIN or phone in the event log");

  const sent = await call("public_signup_proof", { code: CODE, ref, phone: FORM.phone, reference: r.reference, utr: "555566667777" });
  check(sent.status === 200 && rows("payment_proofs")[0].status === "submitted", "O5: the payment proof is sent from the sign-up page", sent);
  check((await call("public_signup_proof", { code: CODE, ref, phone: "9399999999", reference: r.reference, utr: "555566667777" })).status === 404, "O5: someone without the right phone can't send proofs for it");

  // The nightly clean-up keeps it while the owner decides.
  advanceClock(30 * 3600e3);
  await call("public_signup_submit", { ...FORM, phone: "9300000002", name: "Other Person" });
  check(rows("signup_requests").some((s) => s.id === su.id), "O6: a sign-up with a payment waiting survives the nightly clean-up");

  const ok = await call("confirm_payment_proof", { proofId: proof.id }, await tokenFor(owner));
  const student = rows("students").find((s) => s.phone === FORM.phone);
  const mem = rows("memberships").find((m) => m.student_id === student?.id);
  const tx = rows("transactions").filter((t) => t.student_id === student?.id);
  check(ok.status === 200 && ok.action === "create_membership" && student?.name === "Kavya Sri" && mem?.months_paid === 2 && tx.length === 1 && Number(tx[0].amount) === 2375 && tx[0].payment_mode === "upi",
    "O7: Confirm registers the student through create_membership: 2 months, ₹2,375 by UPI", { ok, mem: mem?.months_paid, tx });
  check(!rows("signup_requests").some((s) => s.id === su.id) && rows("payment_proofs")[0].student_id === student.id && student.aadhaar_photo_url === `id-photos/${su.id_photo_path}`, "O7: the sign-up is done, the proof points at the new student and the ID photo is linked");
  const login = await call("me_login", { phone: FORM.phone, pin: "482915" });
  check(login.status === 200 && login.token, "O7: the PIN chosen at sign-up now logs in to the portal", login);
}

await setup();
{
  setSetting("pssai_auto_approve", "on"); setSetting("pssai_upi_pay", "on");
  const d1 = insert("desks", { branch_id: b1.id, label: "P1", status: "free", sort_order: 1 });
  insert("desks", { branch_id: b1.id, label: "P2", status: "free", sort_order: 2 });
  const r = await pay({ category: "permanent", hoursPerDay: 12, months: 1 });
  check(r.amount === 2100, "O8: a permanent plan is offered when a desk is free", r);
  await call("public_signup_proof", { code: CODE, ref, phone: FORM.phone, reference: r.reference, utr: "555566668888" });
  rows("fee_config").find((f) => f.cabin_type === "permanent").fee = 2300;
  const stale = await call("confirm_payment_proof", { proofId: rows("payment_proofs")[0].id }, tO);
  check(stale.status === 409 && /now costs ₹2300/.test(stale.error) && !rows("students").some((s) => s.phone === FORM.phone), "O9: if the price changed, nothing is registered", stale);
  rows("fee_config").find((f) => f.cabin_type === "permanent").fee = 2100;
  const ok = await call("confirm_payment_proof", { proofId: rows("payment_proofs")[0].id }, tO);
  const mem = rows("memberships").at(-1);
  check(ok.status === 200 && mem.category === "permanent" && mem.desk_id === d1.id && d1.status !== "free", "O8: confirmed, the first free desk is assigned", { ok, desk: mem.desk_id });
}

done();
