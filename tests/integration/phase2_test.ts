// Phase 2 against a REAL Postgres + PostgREST: the portal (and the isolation test the plan
// requires), UPI proofs and the owner's confirm, the approval queue, chat, the Send list ranking
// and the sign-up clean-up — everything whose queries (embeds, upserts, .or filters, arrays) an
// in-memory fake could accept too easily.
// deno-lint-ignore-file no-explicit-any
import { addDays, call, check, db, done, get, insert, IST_TODAY, phone, where, world } from "./harness.ts";
import { rankCandidates } from "../../supabase/functions/agent/collections.ts";

const TODAY = IST_TODAY();
Deno.env.delete("AI_API_KEY"); // no AI in these runs
const setting = async (key: string, value: string) => { const { error } = await db.from("app_settings").upsert({ key, value }, { onConflict: "key" }); if (error) throw new Error(error.message); };
for (const k of ["pssai_portal", "pssai_upi_pay", "pssai_concierge"]) await setting(k, "on");
await setting("upi_vpa", "pss.it@okaxis");
// Once per database (the suites can be run again on the same one).
if (!(await db.from("fee_config").select("id").eq("config_type", "membership").eq("cabin_type", "temporary").eq("hours_per_day", 7)).data?.length) {
  await insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: 7, fee: 1400, sort_order: 7 });
}

async function student(branchId: string, end = addDays(TODAY, 3)) {
  const s = await insert("students", { name: "Portal Student", phone: phone(), emergency_contact: phone(), branch_id: branchId, status: "active" });
  const m = await insert("memberships", { student_id: s.id, branch_id: branchId, category: "temporary", seat_type: "floating", hours_per_day: 7, start_date: addDays(end, -29), end_date: end, due_date: addDays(end, 1), months_paid: 1, monthly_fee: 1400, total_paid: 1400, fee_due: 0, is_active: true, plan_amount: 1400, plan_days: 30 });
  return { s, m };
}
async function enrol(s: any, staffToken: string) {
  const code = await call("create_portal_setup_code", { studentId: s.id }, staffToken);
  const set = await call("me_set_pin", { phone: s.phone, code: code.code, pin: "482915", acceptPrivacy: true });
  return set.token as string;
}

const w = await world("p2");
const a = await student(w.branch.id), b = await student(w.branch.id, addDays(TODAY, 20));
const tA = await enrol(a.s, w.tS), tB = await enrol(b.s, w.tS);
check(!!tA && !!tB && (await where("student_credentials", "student_id", a.s.id)).length === 1, "R1: setup codes and PINs work on the real tables");
check((await call("me_login", { phone: a.s.phone, pin: "000000" })).status === 401 && (await where("student_credentials", "student_id", a.s.id))[0].failed_attempts === 1, "R1: a wrong PIN is counted");

// ── Portal isolation (plan P2 exit gate) ──
{
  await insert("portal_notifications", { student_id: b.s.id, kind: "info", title: "Only for B" });
  const other = { studentId: b.s.id, membershipId: b.m.id, phone: b.s.phone };
  const reads = await Promise.all(["me_profile", "me_membership", "me_receipts", "me_notifications", "me_study_report", "me_privacy", "me_chat_history"].map((x) => call(x, other, tA)));
  const text = JSON.stringify(reads);
  check(reads.every((r) => r.status === 200) && reads[1].membership.id === a.m.id && !text.includes(b.s.phone) && !text.includes(b.m.id) && !text.includes("Only for B"),
    "R2: every portal read with another student's ids answers for the token's student only", reads.map((r) => r.status));
  check((await call("list_students", { branchId: w.branch.id }, tA)).status === 401 && (await call("me_profile", {}, w.tS)).status === 401, "R2: student and staff tokens never cross");
}

// ── UPI renewal: request, proof, owner confirm (twice at once) ──
{
  const req = await call("me_payment_request", { purpose: "renewal", months: 2 }, tA);
  check(req.status === 200 && req.amount === 2660, "R3: a 2-month renewal of a ₹1,400 plan is ₹2,660 (5% off)", req);
  const sent = await call("me_submit_payment_proof", { reference: req.reference, utr: `7${String(Date.now()).slice(-11)}` }, tA);
  const list = await call("list_payment_proofs", {}, w.tO);
  const p = list.proofs?.find((x: any) => x.reference === req.reference);
  check(sent.status === 200 && p?.name === "Portal Student" && p.branch === w.branch.name, "R3: the owner's queue shows the proof with the student and branch (real embeds)", { sent: sent.status, p: p && { name: p.name, branch: p.branch } });
  const [x, y] = await Promise.all([call("confirm_payment_proof", { proofId: p.id }, w.tO), call("confirm_payment_proof", { proofId: p.id }, w.tO)]);
  const proof = await get("payment_proofs", p.id);
  const renewed = await where("memberships", "renewed_from_membership_id", a.m.id);
  const upi = (await where("transactions", "student_id", a.s.id)).filter((t: any) => t.payment_mode === "upi");
  check([x, y].filter((r) => r.status === 200).length === 1 && renewed.length === 1 && upi.length === 1 && Number(upi[0].amount) === 2660 && proof.status === "confirmed" && proof.transaction_ids?.[0] === upi[0].id,
    "R3: two simultaneous confirms renew once; the proof keeps the transaction id (uuid[])", { x: x.status, y: y.status, renewed: renewed.length, upi: upi.length, proof: proof.transaction_ids });
  const ev = (await where("events", "action", "renew_membership")).find((e: any) => e.payload?.membershipId === a.m.id);
  check(ev?.actor_type === "owner" && ev.ok === true, "R3: the renewal is an owner event in the append-only log");
  const notes = await where("portal_notifications", "student_id", a.s.id);
  check(notes.filter((n: any) => n.kind === "payment_confirmed").length === 1, "R3: one 'payment confirmed' notice (dedupe key upsert)");
}

// ── Approvals and holds ──
{
  const long = await call("me_request_hold", { days: 12, reason: "exam travel" }, tB);
  const queue = await call("list_approvals", {}, w.tO);
  const item = queue.approvals?.find((q: any) => q.id === long.pending_approval);
  check(long.status === 202 && item?.name === "Portal Student" && item.action === "hold", "R4: a 12-day hold waits in the owner's queue (with the student's name)", { long, item });
  const ok = await call("decide_approval", { approvalId: long.pending_approval, decision: "approve" }, w.tO);
  const m = await get("memberships", b.m.id);
  const hold = (await where("membership_holds", "membership_id", b.m.id))[0];
  check(ok.status === 200 && m.is_paused === true && hold.planned_resume_date === addDays(TODAY, 12), "R4: approved, the hold starts with its planned end", { ok: ok.status, hold });
  const resumed = await call("me_resume", {}, tB);
  check(resumed.status === 200 && (await get("memberships", b.m.id)).is_paused === false, "R4: the student ends it early");
}

// ── Chat and the staff page ──
{
  const sent = await call("me_chat_send", { body: "Is the AC working today?" }, tB);
  const threads = await call("list_chat_threads", { branchId: w.branch.id }, w.tS);
  const t = threads.threads?.find((x: any) => x.studentId === b.s.id);
  check(sent.status === 200 && t?.unanswered === true && t.name === "Portal Student", "R5: the message shows on the staff page (students!inner embed)", { sent: sent.status, t: !!t });
  await call("send_chat_reply", { studentId: b.s.id, body: "Yes, it's on." }, w.tS);
  const hist = await call("me_chat_history", {}, tB);
  check(hist.messages.length === 2 && hist.messages[1].role === "staff" && hist.waiting === false, "R5: the student sees the desk's reply");
}

// ── Collections ranking on real data ──
{
  const due = await student(w.branch.id, addDays(TODAY, 1));
  await insert("student_scores", { student_id: due.s.id, model: "churn", version: "it", score: 0.9 });
  const ranked = await rankCandidates(db as any, TODAY);
  const mine = ranked.filter((c) => c.branchId === w.branch.id);
  check(mine[0]?.studentId === due.s.id && mine[0].reason === "Plan ends in 1 day", "R6: the ranking (with churn scores) puts the student ending tomorrow first", mine.map((c) => [c.reason, c.priority]));
}

// ── Sign-up clean-up keeps a sign-up whose payment waits ──
{
  const code = `it${String(Date.now()).slice(-10)}`;
  await db.from("branches").update({ signup_code: code }).eq("id", w.branch.id);
  const kept = await insert("signup_requests", { branch_id: w.branch.id, ref_code: "KEEP", name: "Kept Person", phone: phone(), emergency_contact: phone(), referral_source: "instagram", created_at: new Date(Date.now() - 2 * 86400e3).toISOString(), keep_until: new Date(Date.now() + 86400e3).toISOString() });
  const gone = await insert("signup_requests", { branch_id: w.branch.id, ref_code: "GONE", name: "Old Person", phone: phone(), emergency_contact: phone(), referral_source: "instagram", created_at: new Date(Date.now() - 2 * 86400e3).toISOString() });
  const r = await call("public_signup_submit", { code, name: "New Person", phone: phone(), emergencyContact: phone(), referralSource: "instagram" });
  check(r.status === 200 && !!(await get("signup_requests", kept.id)) && !(await get("signup_requests", gone.id)), "R7: the nightly clean-up (a real .or filter on keep_until) keeps the one with a payment waiting", r);
}

done();
