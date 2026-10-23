// The independent review of P1.8 and Phase 2 (2026-10-23), checked against a REAL Postgres +
// PostgREST: the cases an in-memory fake could pass too easily — real parallel requests, jsonb key
// order, PostgREST's row limit, and the unique index on confirmed UTRs (067).
// deno-lint-ignore-file no-explicit-any
import { addDays, call, check, db, done, get, insert, IST_TODAY, phone, where, world } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";

const TODAY = IST_TODAY();
Deno.env.delete("AI_API_KEY");
const setting = async (key: string, value: string) => { const { error } = await db.from("app_settings").upsert({ key, value }, { onConflict: "key" }); if (error) throw new Error(error.message); };
for (const k of ["pssai_portal", "pssai_upi_pay", "pssai_waitlist_offers"]) await setting(k, "on");
await setting("upi_vpa", "pss.it@okaxis");
// Once per database (the suites can be run again on the same one).
if (!(await db.from("fee_config").select("id").eq("config_type", "membership").eq("cabin_type", "temporary").eq("hours_per_day", 7)).data?.length) {
  await insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: 7, fee: 1400, sort_order: 7 });
}
const job = async (name: string) => await (await runAction(REGISTRY.get(name)!, { db: db as any, req: new Request("http://x"), action: name, actor: { type: "system", id: null } }, {})).json();

async function student(branchId: string) {
  const s = await insert("students", { name: "Review Student", phone: phone(), emergency_contact: phone(), branch_id: branchId, status: "active" });
  const end = addDays(TODAY, 5);
  const m = await insert("memberships", { student_id: s.id, branch_id: branchId, category: "temporary", seat_type: "floating", hours_per_day: 7, start_date: addDays(end, -29), end_date: end, due_date: addDays(end, 1), months_paid: 1, monthly_fee: 1400, total_paid: 1400, fee_due: 0, is_active: true, plan_amount: 1400, plan_days: 30 });
  return { s, m };
}
async function enrol(s: any, staffToken: string) {
  const code = await call("create_portal_setup_code", { studentId: s.id }, staffToken);
  return (await call("me_set_pin", { phone: s.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token as string;
}

const w = await world("rv");

// ── 1. A burst of parallel wrong PINs is one counted try ──
{
  const a = await student(w.branch.id);
  await enrol(a.s, w.tS);
  const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => call("me_login", { phone: a.s.phone, pin: String(300000 + i * 7) })));
  const cred = (await where("student_credentials", "student_id", a.s.id))[0];
  // Requests that arrive after a count see the new number, so a few may be counted — never more
  // than 5 checks before the lock, however many are sent.
  const counted = cred.locked_until ? 5 : cred.failed_attempts;
  check(burst.every((r) => r.status === 401) && counted <= 5, "RV1: 30 parallel wrong PINs give at most 5 checks on Postgres, not 30", { counted, locked: cred.locked_until });
  if (!cred.locked_until && cred.failed_attempts === 4) {
    // The 5th try sets the lock — and is still checked, so the right PIN works.
    const ok = await call("me_login", { phone: a.s.phone, pin: "482915" });
    check(ok.status === 200, "RV1: the 5th try (which sets the lock) still checks the PIN", ok.status);
  } else if (!cred.locked_until) {
    const ok = await call("me_login", { phone: a.s.phone, pin: "482915" });
    check(ok.status === 200, "RV1: the student's own PIN still works after the burst", ok.status);
  }
  // Five more bursts: the account is locked whatever the timing.
  for (let k = 0; k < 5; k++) await Promise.all(Array.from({ length: 10 }, (_, i) => call("me_login", { phone: a.s.phone, pin: String(400000 + k * 100 + i) })));
  const locked = await call("me_login", { phone: a.s.phone, pin: "482915" });
  check(locked.status === 401 && !!(await where("student_credentials", "student_id", a.s.id))[0].locked_until, "RV1: after enough bursts the PIN is locked, even for the right PIN", locked.status);
}

// ── 6. Asking to pay again reuses the open request (real jsonb key order) ──
{
  const b = await student(w.branch.id);
  const tB = await enrol(b.s, w.tS);
  const r1 = await call("me_payment_request", { purpose: "renewal", months: 3 }, tB);
  const r2 = await call("me_payment_request", { purpose: "renewal", months: 3 }, tB);
  const rows = (await where("payment_proofs", "student_id", b.s.id)).filter((p: any) => p.status === "requested");
  check(r1.status === 200 && r2.reference === r1.reference && rows.length === 1, "RV6: a second ask reuses the open request — Postgres's jsonb key order no longer breaks the match", { r1: r1.reference, r2: r2.reference, rows: rows.length });

  // ── 12. One UTR confirms one proof (067's unique index refuses a race) ──
  const f1 = await call("me_payment_request", { purpose: "food_pass", amount: 300 }, tB);
  const f2 = await call("me_payment_request", { purpose: "food_pass", amount: 400 }, tB);
  const utr = `8${String(Date.now()).slice(-11)}`;
  await call("me_submit_payment_proof", { reference: f1.reference, utr }, tB);
  await call("me_submit_payment_proof", { reference: f2.reference, utr }, tB);
  const p1 = (await where("payment_proofs", "reference", f1.reference))[0], p2 = (await where("payment_proofs", "reference", f2.reference))[0];
  const [x, y] = await Promise.all([call("confirm_payment_proof", { proofId: p1.id }, w.tO), call("confirm_payment_proof", { proofId: p2.id }, w.tO)]);
  const passes = await where("food_passes", "student_id", b.s.id);
  check([x, y].filter((r) => r.status === 200).length === 1 && passes.length === 1 && [300, 400].includes(Number(passes[0].balance)), "RV12: two proofs with one UTR confirmed at once — only one credits the Food Pass", { x: x.status, y: y.status, balance: passes[0]?.balance });
  const { error } = await db.from("payment_proofs").update({ status: "confirmed" }).eq("id", (x.status === 200 ? p2 : p1).id);
  check(error?.code === "23505", "RV12: the database itself refuses a second confirmed proof with the same UTR", error?.message);
}

// ── 7. The staff chat page shows the newest question past 1,000 rows ──
{
  const c = await student(w.branch.id);
  const other = await world("rv2");
  const noisy = await student(other.branch.id);
  const old = Date.now() - 3 * 86400e3;
  const bulk = Array.from({ length: 1100 }, (_, i) => ({ student_id: noisy.s.id, role: "student", body: `n${i}`, status: "sent", created_at: new Date(old + i * 1000).toISOString(), sent_at: new Date(old + i * 1000).toISOString() }));
  for (let i = 0; i < bulk.length; i += 500) { const { error } = await db.from("portal_chat_messages").insert(bulk.slice(i, i + 500)); if (error) throw new Error(error.message); }
  await insert("portal_chat_messages", { student_id: c.s.id, role: "student", body: "Is the AC working?", status: "sent", sent_at: new Date().toISOString() });
  const t = await call("list_chat_threads", { branchId: w.branch.id }, w.tS);
  check(t.status === 200 && t.threads.some((x: any) => x.studentId === c.s.id && x.unanswered), "RV7: with 1,100 other messages, this branch's newest question still shows (newest first, branch filtered in SQL)", t.threads?.length);
}

// ── 9. An accepted offer keeps its desk while the owner decides ──
{
  const wl = await world("rv3");
  const d = await student(wl.branch.id), e = await student(wl.branch.id);
  const tD = await enrol(d.s, wl.tS); await enrol(e.s, wl.tS);
  await insert("desks", { branch_id: wl.branch.id, label: "RV-P1", status: "free", sort_order: 1 });
  const w1 = await insert("permanent_waitlist", { branch_id: wl.branch.id, name: d.s.name, phone: d.s.phone, status: "waiting", created_at: new Date(Date.now() - 86400e3).toISOString() });
  const w2 = await insert("permanent_waitlist", { branch_id: wl.branch.id, name: e.s.name, phone: e.s.phone, status: "waiting" });
  await job("cron_waitlist_offers");
  const yes = await call("me_respond_offer", { offerId: w1.id, accept: true }, tD);
  await job("cron_waitlist_offers");
  const after = await get("permanent_waitlist", w2.id);
  check(yes.status === 202 && (await get("permanent_waitlist", w1.id)).offer_status === "accepted" && !after.offer_status, "RV9: after an accept, the next 15-minute run does not offer the same desk to the next person", { yes: yes.status, next: after.offer_status });
}

// ── Found while testing: re-sending the sign-up form (the SSP path from before Phase 2) ──
{
  const code = `rv${String(Date.now()).slice(-10)}`;
  await db.from("branches").update({ signup_code: code }).eq("id", w.branch.id);
  const ph = phone();
  const first = await call("public_signup_submit", { code, name: "First Try", phone: ph, emergencyContact: phone(), referralSource: "instagram" });
  const again = await call("public_signup_submit", { code, name: "Second Try", phone: ph, emergencyContact: phone(), referralSource: "instagram" });
  const row = (await where("signup_requests", "phone", ph))[0];
  check(first.status === 200 && again.status === 200 && again.updated === true && again.ref === first.ref && row.name === "Second Try",
    "RV-SSP: sending the form again corrects the waiting entry (an update with .or() needs its columns selected on PostgREST 12.2)", { first: first.status, again });
}

done();
