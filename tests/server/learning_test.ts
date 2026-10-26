// PSS-AI Phase 5 (owner side) against the REAL api function: I8 policy rules learned from the
// owner's own decisions (signed hold rules applied by the 15-minute job), I6 the digital twin,
// O6 experiments (variants, conversions, keeping a winner), O7 space yield, and S1 retiring the
// desk-staff modules (C18).
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
import { resetRetireCache } from "../../supabase/functions/_shared/retire.ts";
import { overtimeCharge } from "../../supabase/functions/_shared/twin.ts";
import { computeOvertimeCharge } from "../../supabase/functions/_shared/overtime.ts";

const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();
const ts = (date: string, hhmm = "06:00") => `${date}T${hhmm}:00.000Z`;

let TODAY = IST_TODAY();
let b1: any, b2: any, owner: any, priya: any, tO: string, tP: string;
async function setup() {
  reset();
  resetRetireCache();
  TODAY = IST_TODAY();
  b1 = insert("branches", { name: "Hopes", is_active: true, desk_count: 4 });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true, desk_count: 2 });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id, duty: "desk" });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  setSetting("pssai_portal", "on");
}
async function member(name: string, phone: string, extra: any = {}) {
  const s = insert("students", { name, phone, emergency_contact: "9000000009", branch_id: b1.id, status: "active", course: "TNPSC Group 4" });
  const m = insert("memberships", { student_id: s.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -10), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 20), months_paid: 1, monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: true, is_paused: false, plan_amount: 1500, plan_days: 30, ...extra });
  const code = await call("create_portal_setup_code", { studentId: s.id }, tP);
  const token = (await call("me_set_pin", { phone, code: code.code, pin: "482915", acceptPrivacy: true })).token as string;
  return { s, m, token };
}
const decided = (days: number, status: "approved" | "denied", why = "longer than 7 days", extra: any = {}) =>
  insert("approvals", { kind: "student_request", action: "hold", payload: { days, why, dues: false }, requested_by_type: "student", status, decided_at: ts(addDays(TODAY, -20)), policy_rule_id: null, ...extra });

// ── I8: proposed rules ──
await setup();
{
  check((await run("cron_policy_rules")).skipped, "P1: with pssai_policy_learner off the weekly job does nothing");
  setSetting("pssai_policy_learner", "on");
  for (let i = 0; i < 5; i++) decided(9 + (i % 3), "approved");
  check((await run("cron_policy_rules")).proposed === 0 && rows("policy_rules").length === 0, "P1: 5 decisions are not enough for a rule (at least 6)");
  decided(12, "approved");
  // A mixed group (5 approved, 1 denied = 83%) stays a decision for the owner.
  for (let i = 0; i < 5; i++) decided(20, "approved");
  decided(21, "denied");
  // A permanent-seat group of 6 denials becomes a deny rule.
  for (let i = 0; i < 6; i++) decided(3, "denied", "permanent seat (a hold frees the cabin)");
  // Decisions a rule made are not evidence; an old decision is out of the 180 days.
  for (let i = 0; i < 6; i++) decided(25, "approved", "longer than 7 days", { policy_rule_id: "00000000-0000-4000-8000-00000000ffff" });
  for (let i = 0; i < 6; i++) decided(2, "approved", "second hold this month", { decided_at: ts(addDays(TODAY, -200)) });
  const r = await run("cron_policy_rules");
  const rules = rows("policy_rules");
  const long = rules.find((x) => x.bucket === "days:8-14|why:long|dues:no");
  const perm = rules.find((x) => x.bucket === "days:1-7|why:permanent|dues:no");
  check(r.proposed === 2 && rules.length === 2 && long?.outcome === "approve" && long.support === 6 && long.status === "proposed" && perm?.outcome === "deny",
    "P2: 6 like decisions become a proposed rule; mixed, rule-made and old decisions do not", { r, rules: rules.map((x) => [x.bucket, x.outcome, x.support]) });
  check(long.description === "Hold requests of 8–14 days (longer than the self-hold limit) with no dues: you approved 6 of 6.", "P2: the rule is in words", long.description);
  decided(13, "approved");
  const again = await run("cron_policy_rules");
  check(again.proposed === 0 && again.refreshed === 2 && rows("policy_rules").length === 2 && long.support === 7, "P2: the weekly job refreshes a proposal rather than adding a second", { again, support: long.support });

  const staffTries = await Promise.all([call("list_policy_rules", {}, tP), call("decide_policy_rule", { ruleId: long.id, decision: "sign" }, tP)]);
  check(staffTries.every((x) => x.status === 403) && long.status === "proposed", "P3: desk staff can't see or sign rules");
  check((await call("decide_policy_rule", { ruleId: long.id, decision: "retire" }, tO)).status === 409, "P3: a proposal can't be retired before it is signed");
  const signed = await call("decide_policy_rule", { ruleId: long.id, decision: "sign" }, tO);
  check(signed.ok && long.status === "active" && long.decided_by_staff_id === owner.id, "P3: the owner signs a rule", signed);
  const ev = rows("events").find((e) => e.action === "decide_policy_rule" && e.ok);
  check(ev?.actor_type === "owner", "P3: signing a rule is an event with the owner as actor");
  check((await call("decide_policy_rule", { ruleId: perm.id, decision: "dismiss" }, tO)).ok && perm.status === "dismissed", "P3: the owner dismisses the other");
  const list = await call("list_policy_rules", {}, tO);
  check(list.on && list.rules.length === 1 && list.rules[0].id === long.id, "P3: the list shows live rules, not dismissed ones", list.rules?.length);
  for (let i = 0; i < 2; i++) decided(4, "denied", "permanent seat (a hold frees the cabin)");
  await run("cron_policy_rules");
  check(!rows("policy_rules").some((x) => x.bucket === "days:1-7|why:permanent|dues:no" && x.status !== "dismissed"), "P3: a dismissed rule is never proposed again");
  const signedSupport = long.support;
  decided(10, "approved");
  await run("cron_policy_rules");
  check(long.support === signedSupport, "P3: a signed rule keeps the numbers it was signed on", long.support);
}

// ── I8: signed hold rules decide matching requests ──
{
  const asha = await member("Asha Rao", "9100000001");
  const ravi = await member("Ravi K", "9100000002");
  const meena = await member("Meena S", "9100000003");
  // 10 days (8–14, longer than the self-hold limit) matches; 20 days does not.
  const a1 = await call("me_request_hold", { days: 10, reason: "exams at home" }, asha.token);
  const a2 = await call("me_request_hold", { days: 20, reason: "travel" }, ravi.token);
  check(a1.status === 202 && a2.status === 202 && a1.pending_approval && a2.pending_approval, "A1: holds over 7 days wait for the owner", [a1, a2]);
  const pending = () => rows("approvals").filter((a) => a.status === "pending");
  const ashaAp = pending().find((a) => a.student_id === asha.s.id)!;
  const appr = await call("list_approvals", {}, tO);
  const card = appr.approvals.find((a: any) => a.id === ashaAp.id);
  const other = appr.approvals.find((a: any) => a.student_id === ravi.s.id);
  check(card?.rule?.description === long().description && !other?.rule, "A1: the matching approval card shows the signed rule; the other does not", { card: card?.rule, other: other?.rule });

  setSetting("pssai_policy_learner", "off");
  check((await run("cron_apply_policy_rules")).skipped && ashaAp.status === "pending", "A2: with the switch off no rule applies");
  setSetting("pssai_policy_learner", "on");
  const r = await run("cron_apply_policy_rules");
  check(r.applied === 1 && ashaAp.status === "approved" && ashaAp.policy_rule_id === long().id && /^Signed rule:/.test(ashaAp.reason) && ashaAp.decided_by_staff_id === null,
    "A2: the job approves the matching hold with the rule as the reason", { r, ap: ashaAp });
  check(asha.m.is_paused && rows("membership_holds").some((h) => h.membership_id === asha.m.id && h.planned_resume_date === addDays(TODAY, 10)),
    "A2: it runs the same steps as the owner's Approve: the plan is on hold until day 10", asha.m.is_paused);
  check(long().applied_count === 1 && rows("portal_notifications").some((n) => n.student_id === asha.s.id && n.kind === "request_approved"), "A2: the rule counts the use; the student is told");
  check(pending().some((a) => a.student_id === ravi.s.id), "A2: the 20-day request still waits for the owner");
  const pauseEv = rows("events").find((e) => e.action === "pause_membership" && e.ok && e.actor_type === "system");
  check(!!pauseEv, "A2: the pause is an event with the system as actor", pauseEv?.actor_type);
  check((await run("cron_apply_policy_rules")).applied === 0, "A2: running the job again changes nothing");
  // Review fixes: one rule-approved hold per student per 30 days; a request with dues is another bucket.
  const again = insert("approvals", { kind: "student_request", action: "hold", payload: { days: 9, why: "longer than 7 days", dues: false }, requested_by_type: "student", student_id: asha.s.id, branch_id: b1.id, status: "pending", created_at: ts(TODAY) });
  const withDues = insert("approvals", { kind: "student_request", action: "hold", payload: { days: 10, why: "longer than 7 days", dues: true }, requested_by_type: "student", student_id: ravi.s.id, branch_id: b1.id, status: "pending", created_at: ts(TODAY) });
  const capped = await run("cron_apply_policy_rules");
  check(capped.applied === 0 && again.status === "pending" && withDues.status === "pending", "A5: a second matching hold within 30 days, and a hold with dues, wait for the owner", capped);
  again.status = "denied"; withDues.status = "denied";
  const ashaReq = rows("approvals").find((a) => a.id === ashaAp.id);
  check(ashaReq?.payload?.dues === false, "A5: the request records whether the plan had dues", ashaReq?.payload);

  // A matching request whose plan can't be held goes back to the owner.
  const m3 = await call("me_request_hold", { days: 12 }, meena.token);
  meena.m.is_active = false;
  const back = await run("cron_apply_policy_rules");
  const meenaAp = rows("approvals").find((a) => a.student_id === meena.s.id)!;
  check(m3.status === 202 && back.failed === 1 && meenaAp.status === "pending" && meenaAp.policy_rule_id === null && meenaAp.reason === null, "A3: when the hold can't run, the request goes back to the queue untouched", { back, ap: meenaAp });

  // A retired rule stops.
  meena.m.is_active = true;
  check((await call("decide_policy_rule", { ruleId: long().id, decision: "retire" }, tO)).ok && long().status === "retired", "A4: the owner retires the rule");
  check((await run("cron_apply_policy_rules")).applied === 0 && meenaAp.status === "pending", "A4: a retired rule applies to nothing");
  // A deny rule is never applied by the job, only shown.
  const deny = insert("policy_rules", { scope: "student_request:hold", bucket: "days:8-14|why:long|dues:no", outcome: "deny", support: 6, agreement: 1, description: "x", status: "active", applied_count: 0 });
  check((await run("cron_apply_policy_rules")).applied === 0 && meenaAp.status === "pending", "A4: a deny rule never decides by itself");
  deny.status = "retired";
}
function long() { return rows("policy_rules").find((x) => x.bucket === "days:8-14|why:long|dues:no")!; }

// ── I6: the digital twin ──
await setup();
{
  check((await call("simulate_policy", { policy: "overtime_grace", value: 30 }, tO)).status === 403, "T1: with pssai_digital_twin off nothing is simulated");
  setSetting("pssai_digital_twin", "on");
  check((await call("simulate_policy", { policy: "overtime_grace", value: 30 }, tP)).status === 403, "T1: desk staff can't run it");
  const bad = await Promise.all([call("simulate_policy", { policy: "overtime_grace", value: 61 }, tO), call("simulate_policy", { policy: "renewal_grace", value: -1 }, tO), call("simulate_policy", { policy: "fees", value: 1 }, tO)]);
  check(bad.every((x) => x.status === 400), "T1: out-of-range values and unknown policies are refused", bad.map((x) => x.error));

  // The re-pricing used by the twin agrees with the real rule at today's grace (R1).
  let same = true;
  for (const min of [0, 10, 15, 16, 40, 75, 76, 135, 400]) for (const [booked, base, w3] of [[3, 50, true], [4, 60, false], [8, 80, false]] as [number, number, boolean][]) {
    const a = overtimeCharge(min, booked, base, w3);
    const b = computeOvertimeCharge(min, booked, base, w3) as any;
    if (a.overtimeCharge !== b.overtimeCharge || a.overtimeHours !== b.overtimeHours) same = false;
  }
  check(same, "T2: overtimeCharge at 15 minutes equals computeOvertimeCharge for every case tried");

  const w = insert("bookings", { branch_id: b1.id, booking_type: "walkin", status: "completed", scheduled_hours: 3, hours: 3, amount: 50, start_time: ts(addDays(TODAY, -5)), end_time: ts(addDays(TODAY, -5), "09:20") });
  const w2 = insert("bookings", { branch_id: b1.id, booking_type: "walkin", status: "completed", scheduled_hours: 4, hours: 4, amount: 60, start_time: ts(addDays(TODAY, -4)), end_time: ts(addDays(TODAY, -4), "10:50") });
  // Every checkout's overtime minutes come from the event log (review fix): a member's 10 minutes
  // (under today's grace, never in overtime_sessions) and a re-sent checkout counted once.
  const m10 = insert("bookings", { branch_id: b1.id, booking_type: "temporary", status: "completed", scheduled_hours: 6, hours: 6, amount: 0, start_time: ts(addDays(TODAY, -3)), end_time: ts(addDays(TODAY, -3), "12:10") });
  const stillOpen = insert("bookings", { branch_id: b1.id, booking_type: "walkin", status: "active", scheduled_hours: 3, hours: 3, amount: 50, start_time: ts(TODAY) });
  const co = (bookingId: string, overtimeMinutes: number, day: number, ok = true) => insert("events", { id: rows("events").length + 1, action: "checkout_booking", payload: { bookingId, overtimeMinutes }, ok, actor_type: "staff", occurred_at: ts(addDays(TODAY, day)) });
  co(w.id, 20, -5); co(w2.id, 0, -4); co(w2.id, 50, -4); co(m10.id, 10, -3); co(stillOpen.id, 30, 0); co(w.id, 90, -5, false); co(w2.id, 50, -400);
  const ot = await call("simulate_policy", { policy: "overtime_grace", value: 30 }, tO);
  // Today: 20 min → 1 h (₹5 for a 3-hour walk-in), 50 min → 1 h (₹10), 10 min → free. At 30: 20 → free, 50 → 1 h.
  check(ot.sessions === 3 && ot.currentTotal === 15 && ot.proposedTotal === 10 && ot.difference === -5 && ot.changed === 1 && ot.current === 15,
    "T2: a 30-minute grace re-prices the last 180 days' overtime: ₹5 less", ot);
  const same15 = await call("simulate_policy", { policy: "overtime_grace", value: 15 }, tO);
  check(same15.difference === 0 && same15.changed === 0, "T2: the same grace changes nothing", same15);
  const five = await call("simulate_policy", { policy: "overtime_grace", value: 5 }, tO);
  check(five.changed === 1 && five.difference === 10, "T2b: a shorter grace (5 minutes) prices the member's 10 minutes too: +₹10", five);

  const prevA = insert("memberships", { student_id: null, branch_id: b1.id, end_date: addDays(TODAY, -30), is_active: false, renewed_from_membership_id: null, created_at: ts(addDays(TODAY, -60)) });
  insert("memberships", { student_id: null, branch_id: b1.id, end_date: addDays(TODAY, 3), is_active: true, renewed_from_membership_id: prevA.id, plan_amount: 1500, plan_days: 30, monthly_fee: 1500, created_at: ts(addDays(TODAY, -27)) });
  const prevB = insert("memberships", { student_id: null, branch_id: b1.id, end_date: addDays(TODAY, -40), is_active: false, renewed_from_membership_id: null, created_at: ts(addDays(TODAY, -70)) });
  insert("memberships", { student_id: null, branch_id: b1.id, end_date: addDays(TODAY, -2), is_active: false, renewed_from_membership_id: prevB.id, plan_amount: 1500, plan_days: 30, monthly_fee: 1500, created_at: ts(addDays(TODAY, -32)) });
  insert("bookings", { branch_id: b1.id, membership_id: prevB.id, status: "completed", start_time: ts(addDays(TODAY, -38)) });
  insert("bookings", { branch_id: b1.id, membership_id: prevB.id, status: "completed", start_time: ts(addDays(TODAY, -33)) });
  const rg = await call("simulate_policy", { policy: "renewal_grace", value: 5 }, tO);
  // 3 days late: charged either way. 8 days late: charged today, a late renewal at 5 (₹50 × 8 less). A check-in on day 7 would be refused.
  check(rg.renewals === 2 && rg.changed === 1 && rg.difference === -400 && rg.checkinsRefused === 1 && rg.current === 10, "T3: a 5-day renewal grace: one renewal changes (₹400 less) and one check-in would be refused", rg);

  for (const days of [3, 5, 9, 12, 20]) insert("events", { id: rows("events").length + 1, action: "me_request_hold", payload: { days }, ok: true, occurred_at: ts(addDays(TODAY, -10)), actor_type: "student" });
  insert("events", { id: rows("events").length + 1, action: "me_request_hold", payload: { days: 2 }, ok: false, occurred_at: ts(addDays(TODAY, -10)), actor_type: "student" });
  // Of those, the 5-day one was a second hold in the month and the 9-day one was for a cabin: they go to the owner whatever the limit.
  insert("approvals", { kind: "student_request", action: "hold", payload: { days: 5, why: "second hold this month" }, status: "approved", requested_by_type: "student", created_at: ts(addDays(TODAY, -10)) });
  insert("approvals", { kind: "student_request", action: "hold", payload: { days: 9, why: "permanent seat (a hold frees the cabin)" }, status: "approved", requested_by_type: "student", created_at: ts(addDays(TODAY, -10)) });
  insert("approvals", { kind: "student_request", action: "hold", payload: { days: 12, why: "longer than 7 days" }, status: "approved", requested_by_type: "student", created_at: ts(addDays(TODAY, -10)) });
  const hl = await call("simulate_policy", { policy: "self_hold_days", value: 10 }, tO);
  check(hl.requests === 5 && hl.autoNow === 1 && hl.autoThen === 1 && hl.toApprovalThen === 4 && hl.current === 7, "T4: a 10-day self-hold limit, counting only taken requests and never a cabin or a second hold", hl);
  const hl14 = await call("simulate_policy", { policy: "self_hold_days", value: 14 }, tO);
  check(hl14.autoThen === 2, "T4: at 14 days the 12-day request would run by itself too", hl14);
  check(rows("app_settings").every((s) => !/grace|hold_max/.test(s.key)), "T5: a simulation changes no setting");
}

// ── O6: experiments ──
await setup();
{
  const variants = [{ label: "5%", value: 5 }, { label: "10%", value: 10 }];
  check((await call("create_experiment", { kind: "winback_offer", name: "Win-back 5 vs 10", variants }, tO)).status === 403, "E1: with pssai_experiments off none can start");
  setSetting("pssai_experiments", "on");
  const bad = await Promise.all([
    call("create_experiment", { kind: "winback_offer", name: "Too much", variants: [{ value: 5 }, { value: 15 }] }, tO),
    call("create_experiment", { kind: "winback_offer", name: "Same", variants: [{ value: 5 }, { value: 5 }] }, tO),
    call("create_experiment", { kind: "next_exam_offer", name: "Odd", variants: [{ value: 3 }, { value: 4 }] }, tO),
    call("create_experiment", { kind: "menu_feature", name: "No branch", variants: [{ value: crypto.randomUUID() }, { value: crypto.randomUUID() }] }, tO),
    call("create_experiment", { kind: "price", name: "Prices", variants }, tO),
    call("create_experiment", { kind: "winback_offer", name: "Win-back", variants }, tP),
  ]);
  check(bad.slice(0, 5).every((x) => x.status === 400) && bad[5].status === 403, "E1: over 10% (C12), equal variants, odd plan lengths, a menu test without a branch, unknown kinds and staff are refused", bad.map((x) => x.status + " " + x.error));
  const made = await call("create_experiment", { kind: "next_exam_offer", name: "3 vs 6 months", variants: [{ label: "3 months", value: 3 }, { label: "6 months", value: 6 }], weeks: 4 }, tO);
  const e = rows("experiments").find((x) => x.id === made.id)!;
  check(made.ok && e.status === "running" && e.variants[0].key === "A" && e.variants[1].value === 6, "E1: the owner starts a 3 vs 6 months test", made);

  // Students get a stable variant; the job records exposure.
  const { experimentVariant } = await import("../../supabase/functions/api/domains/learning.ts");
  const db = adminClient();
  const ids = Array.from({ length: 40 }, () => insert("students", { name: "S", phone: String(9200000000 + rows("students").length), branch_id: b1.id, status: "active" }).id);
  const first = await Promise.all(ids.map((id) => experimentVariant(db, "next_exam_offer", b1.id, id)));
  const second = await Promise.all(ids.map((id) => experimentVariant(db, "next_exam_offer", b1.id, id, false)));
  check(first.every((v, i) => v?.key === second[i]?.key) && new Set(first.map((v) => v?.key)).size === 2, "E2: each student always sees the same variant, and both variants are used");
  check(rows("experiment_exposures").length === 40 && (await experimentVariant(db, "winback_offer", b1.id, ids[0])) === null, "E2: one exposure per student; no running test of another kind answers null");
  setSetting("pssai_experiments", "off");
  check((await experimentVariant(db, "next_exam_offer", b1.id, ids[0])) === null, "E2: with the switch off no variant is used");
  setSetting("pssai_experiments", "on");

  // Conversions: a renewal within 21 days counts; later or before does not.
  for (const x of rows("experiment_exposures")) x.exposed_at = ts(addDays(TODAY, -25));
  const aIds = rows("experiment_exposures").filter((x) => x.variant === "A").map((x) => x.student_id);
  const bIds = rows("experiment_exposures").filter((x) => x.variant === "B").map((x) => x.student_id);
  insert("memberships", { student_id: aIds[0], branch_id: b1.id, is_active: true, created_at: ts(addDays(TODAY, -20)) });
  insert("memberships", { student_id: aIds[1], branch_id: b1.id, is_active: true, created_at: ts(addDays(TODAY, -1)) });
  insert("memberships", { student_id: bIds[0], branch_id: b1.id, is_active: true, created_at: ts(addDays(TODAY, -30)) });
  const job = await run("cron_experiments");
  check(job.converted === 1 && rows("experiment_exposures").filter((x) => x.converted_at).length === 1 && job.ended === 0, "E3: only a renewal within 21 days of being shown counts", job);
  const list = await call("list_experiments", {}, tO);
  const live = list.experiments[0].live;
  check(list.on && live.rows.length === 2 && live.rows.reduce((a: number, r: any) => a + r.n, 0) === 40 && live.winner === null, "E3: the list shows each variant's numbers; one conversion is no winner", live);

  check((await call("update_experiment", { experimentId: e.id, decision: "keep", variant: "C" }, tO)).status === 400, "E4: keeping needs a real variant");
  const kept = await call("update_experiment", { experimentId: e.id, decision: "keep", variant: "B" }, tO);
  check(kept.ok && e.status === "kept" && e.winner === "B" && e.decided_by_staff_id === owner.id && e.result?.rows?.length === 2, "E4: the owner keeps 6 months", e);
  check(rows("app_settings").find((s) => s.key === "next_exam_months")?.value === "6", "E4: keeping writes the real setting (next_exam_months)");
  check((await call("update_experiment", { experimentId: e.id, decision: "drop" }, tO)).status === 409, "E4: a decided experiment can't be decided again");
  check((await experimentVariant(db, "next_exam_offer", b1.id, ids[0])) === null, "E4: a kept experiment no longer hands out variants");

  // The next-exam offer uses the kept plan length.
  const { nextExamOffer } = await import("../../supabase/functions/api/domains/exams.ts");
  const st = insert("students", { name: "Kavi", phone: "9300000001", branch_id: b1.id, status: "active", course: "TNPSC Group 4" });
  insert("memberships", { student_id: st.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -20), end_date: addDays(TODAY, 5), due_date: addDays(TODAY, 5), monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: true, is_paused: false, plan_amount: 1500, plan_days: 30 });
  setSetting("exam_ladder", JSON.stringify([["tnpsc-group-4", "tnpsc-group-2"]]));
  const offer = await nextExamOffer(db, st.id);
  check(offer?.plan?.months === 6, "E4: the next-exam plan is now 6 months", offer?.plan);

  // A win-back test stopped early; then dropped (no setting written).
  const wb = await call("create_experiment", { kind: "winback_offer", name: "Win-back 5 vs 10", variants }, tO);
  const stop = await call("update_experiment", { experimentId: wb.id, decision: "stop" }, tO);
  const wbRow = rows("experiments").find((x) => x.id === wb.id)!;
  check(stop.ok && wbRow.status === "ended" && wbRow.result, "E5: the owner stops a test early; its numbers are kept", wbRow.status);
  check((await call("update_experiment", { experimentId: wb.id, decision: "drop" }, tO)).ok && wbRow.status === "dropped" && !rows("app_settings").some((s) => s.key === "winback_discount_pct"), "E5: dropping it writes no setting");

  // Review fix: "kept" only when the real setting is saved; otherwise the experiment goes back.
  const wb2 = await call("create_experiment", { kind: "winback_offer", name: "Win-back again", variants }, tO);
  (globalThis as any).__FAKE_CHECK__ = (table: string, row: any) => (table === "app_settings" && row.key === "winback_discount_pct" ? "disk full" : null);
  const failedKeep = await call("update_experiment", { experimentId: wb2.id, decision: "keep", variant: "B" }, tO);
  (globalThis as any).__FAKE_CHECK__ = undefined;
  const wb2Row = rows("experiments").find((x) => x.id === wb2.id)!;
  check(failedKeep.status === 500 && wb2Row.status === "running" && wb2Row.winner === null && !rows("app_settings").some((x) => x.key === "winback_discount_pct"), "E5b: if the setting can't be saved, the experiment is not marked kept", { failedKeep: failedKeep.error, status: wb2Row.status });
  await call("update_experiment", { experimentId: wb2.id, decision: "drop" }, tO);

  // An experiment past its end date ends by itself.
  const old = await call("create_experiment", { kind: "winback_offer", name: "Short", variants, weeks: 1 }, tO);
  const oldRow = rows("experiments").find((x) => x.id === old.id)!;
  oldRow.ends_at = ts(addDays(TODAY, -1));
  check((await run("cron_experiments")).ended === 1 && oldRow.status === "ended", "E5: the weekly job ends a test past its end date");

  // The menu test: featured item first in the portal menu, kept per branch.
  const tea = insert("food_items", { branch_id: b1.id, name: "Tea", price: 10, quantity: 50, is_active: true });
  const vada = insert("food_items", { branch_id: b1.id, name: "Vada", price: 15, quantity: 50, is_active: true });
  insert("food_items", { branch_id: b2.id, name: "Coffee", price: 15, quantity: 50, is_active: true });
  const wrongBranch = await call("create_experiment", { kind: "menu_feature", name: "Menu", branchId: b2.id, variants: [{ value: tea.id }, { value: vada.id }] }, tO);
  check(wrongBranch.status === 400, "E6: a menu test uses that branch's own items", wrongBranch.error);
  const menu = await call("create_experiment", { kind: "menu_feature", name: "Tea or vada", branchId: b1.id, variants: [{ label: "Tea", value: tea.id }, { label: "Vada", value: vada.id }] }, tO);
  check(menu.ok, "E6: the owner starts a menu test at Hopes", menu);
  const kid = await member("Anu", "9100000009");
  setSetting("pssai_food_orders", "on");
  const shown = await call("me_food_menu", {}, kid.token);
  const v = rows("experiment_exposures").find((x) => x.student_id === kid.s.id);
  check(!v && [tea.id, vada.id].includes(shown.featured) && shown.items?.[0]?.id === shown.featured, "E6: the variant's item shows first; no exposure is recorded while the student is not at the hall", { featured: shown.featured, first: shown.items?.[0]?.name });
  check((await call("update_experiment", { experimentId: menu.id, decision: "keep", variant: "B" }, tO)).ok
    && rows("app_settings").find((s) => s.key === `featured_food_item:${b1.id}`)?.value === vada.id, "E6: keeping it writes the branch's featured item (one setting per branch)");
  const after = await call("me_food_menu", {}, kid.token);
  check(after.featured === vada.id && after.items[0].id === vada.id, "E6: after the test the kept item stays first", after.featured);
}

// ── O7: space yield ──
await setup();
{
  for (let i = 0; i < 4; i++) insert("desks", { branch_id: b1.id, label: `F${i}`, seat_type: "floating", status: "free" });
  const cab = insert("desks", { branch_id: b1.id, label: "P1", seat_type: "fixed", status: "reserved" });
  // Every day of the last 8 weeks, 18:00–20:00 IST, all four open seats are full.
  for (let d = 1; d <= 56; d++) for (const desk of rows("desks").filter((x) => x.seat_type === "floating")) {
    insert("bookings", { branch_id: b1.id, desk_id: desk.id, status: "completed", start_time: `${addDays(TODAY, -d)}T12:30:00.000Z`, end_time: `${addDays(TODAY, -d)}T14:30:00.000Z` });
  }
  insert("bookings", { branch_id: b1.id, desk_id: cab.id, status: "completed", start_time: `${addDays(TODAY, -3)}T03:30:00.000Z`, end_time: `${addDays(TODAY, -3)}T13:30:00.000Z` });
  check((await call("get_space_yield", { branchId: b1.id }, tP)).status === 403, "Y1: desk staff can't see it");
  const y = await call("get_space_yield", { branchId: b1.id }, tO);
  const weekday = new Date(`${addDays(TODAY, -1)}T00:00:00Z`).getUTCDay();
  check(y.seats === 4 && y.cabins === 1 && y.grid[weekday][18] === 1 && y.grid[weekday][19] === 1 && y.grid[weekday][17] === 0 && y.on === false,
    "Y1: 18:00–20:00 is full every day, 17:00 empty (IST); counts open seats and cabins apart", { seats: y.seats, h18: y.grid[weekday][18], h17: y.grid[weekday][17] });
  const kinds = y.suggestions.map((s: any) => s.kind);
  check(kinds.includes("add_seats") && kinds.includes("quiet_hours") && kinds.includes("cabins_unused"), "Y2: it suggests more seats for the full evenings, filling the quiet hours, and selling cabin hours", kinds);
  check(y.cabinUse > 0 && y.cabinUse < 0.4, "Y2: cabin use is the share of the hall's day", y.cabinUse);
}

// ── S1: retiring the desk-staff modules ──
await setup();
{
  for (const [action, n] of [["send_message", 3], ["get_staff_grid", 2], ["list_staff_attendance", 1]] as [string, number][]) {
    for (let i = 0; i < n; i++) insert("events", { id: rows("events").length + 1, action, actor_type: "owner", ok: true, occurred_at: ts(addDays(TODAY, -5)) });
  }
  insert("events", { id: rows("events").length + 1, action: "send_message", actor_type: "staff", ok: true, occurred_at: ts(addDays(TODAY, -40)) });
  check((await call("get_staff_module_usage", {}, tP)).status === 403, "S1: desk staff can't see the usage report");
  const u = await call("get_staff_module_usage", {}, tO);
  check(u.total === 3 && u.views === 3 && u.usage.send_message === 3 && u.usage.end_staff_session === 0 && !u.unusedForAMonth && u.on === false, "S1: the report counts each retiring action in the last 30 days; the owner's own page loads are views, not use", u);
  check(Array.isArray(u.deskAccounts) && u.deskAccounts.includes("Priya"), "S1: it lists the desk accounts that would stop signing in", u.deskAccounts);
  for (const e of rows("events").filter((x) => x.action === "send_message")) e.occurred_at = ts(addDays(TODAY, -40));
  const quiet = await call("get_staff_module_usage", {}, tO);
  check(quiet.unusedForAMonth && quiet.total === 0 && quiet.views === 3, "S1: with only page views in 30 days it says unused for a month", quiet);

  // Switched off (today): attendance marked on every request; reads are logged for the report.
  rows("staff_attendance").length = 0;
  await call("list_messages", { branchId: b1.id }, tP);
  check(rows("staff_attendance").some((a) => a.staff_id === priya.id), "S2: with the switch off a staff request still marks attendance");
  const grid = await call("get_staff_grid", {}, tO);
  check(grid.status === 200 && rows("events").filter((e) => e.action === "get_staff_grid").length === 3, "S2: the staff grid read is logged, so the report sees it", rows("events").filter((e) => e.action === "get_staff_grid").length);

  const cookie = insert("staff", { username: "cookie", display_name: "Cook", role: "staff", is_active: true, branch_id: b1.id, duty: "kitchen" });
  const tK = await tokenFor(cookie);
  setSetting("pssai_retire_staff_ops", "on");
  resetRetireCache();
  rows("staff_attendance").length = 0;
  // Review fix (C18): a desk-duty account stops working once the desk-staff modules retire.
  (globalThis as any).__FAKE_RPC__ = (fn: string, args: any) => {
    if (fn !== "verify_staff_login") return null;
    const st = rows("staff").find((x) => x.username === args.p_username);
    return st ? { data: [{ id: st.id, username: st.username, role: st.role, display_name: st.display_name, branch_id: st.branch_id, branch_name: null }], error: null } : { data: [], error: null };
  };
  const deskLogin = await call("login", { username: "priya", password: "pw" });
  const deskToken = await call("list_messages", { branchId: b1.id }, tP);
  const cookLogin = await call("login", { username: "cookie", password: "pw" });
  check(deskLogin.status === 403 && /retired/.test(deskLogin.error) && deskToken.status === 401 && cookLogin.status === 200 && cookLogin.token, "S3: a desk account can't log in or use an old token; a kitchen account can", [deskLogin.status, deskToken.status, cookLogin.status]);
  (globalThis as any).__FAKE_RPC__ = undefined;
  rows("staff_attendance").length = 0;
  const tasks = await call("list_messages", { branchId: b1.id }, tK);
  check(tasks.status === 200 && rows("staff_attendance").length === 0, "S3: with the switch on attendance is no longer marked", tasks.status);
  const gone = await Promise.all([
    call("list_staff_attendance", {}, tO), call("get_staff_grid", {}, tO), call("assign_staff_override", { staffId: priya.id, branchId: b2.id }, tO),
    call("clear_staff_override", { staffId: priya.id }, tO), call("end_staff_session", { password: "x" }, tK), call("send_message", { branchId: b1.id, content: "hi" }, tK),
  ]);
  check(gone.every((x) => x.status === 410), "S3: the six retired actions answer 410", gone.map((x) => x.status));
  check((await call("list_messages", { branchId: b1.id }, tK)).status === 200 && (await call("list_branch_staff", { branchId: b1.id }, tK)).status === 200, "S3: system notices and assigning tasks stay");
  insert("staff_attendance", { staff_id: cookie.id, branch_id: b1.id, attendance_date: TODAY, first_login_at: ts(TODAY), last_logout_at: ts(TODAY, "07:00") });
  check((await call("list_messages", { branchId: b1.id }, tK)).status === 200, "S3: an ended session no longer cuts a staff member off");

  const accts = await Promise.all([
    call("create_staff", { username: "desk2", password: "pw-123456", displayName: "Desk", role: "staff", branchId: b1.id }, tO),
    call("create_staff", { username: "desk3", password: "pw-123456", displayName: "Desk", role: "staff", branchId: b1.id, duty: "desk" }, tO),
    call("create_staff", { username: "cook", password: "pw-123456", displayName: "Cook", role: "staff", branchId: b1.id, duty: "chef" }, tO),
  ]);
  check(accts.every((x) => x.status === 400) && !rows("staff").some((s) => ["desk2", "desk3", "cook"].includes(s.username)), "S4: a new desk account (or an unknown duty) is refused", accts.map((x) => x.error));
  const cook = await call("create_staff", { username: "kitchen1", password: "pw-123456", displayName: "Cook", role: "staff", branchId: b1.id, duty: "kitchen" }, tO);
  check(cook.ok && rows("staff").find((s) => s.username === "kitchen1")?.duty === "kitchen", "S4: a kitchen account is made", cook);
  const k = rows("staff").find((s) => s.username === "kitchen1")!;
  check((await call("update_staff", { staffId: k.id, duty: "desk" }, tO)).status === 400 && k.duty === "kitchen", "S4: an account can't be turned back into desk staff");
  check((await call("update_staff", { staffId: k.id, duty: "housekeeping" }, tO)).ok && k.duty === "housekeeping", "S4: kitchen can become housekeeping");
  const list = await call("list_staff", {}, tO);
  check(list.staff.find((s: any) => s.username === "kitchen1")?.duty === "housekeeping", "S4: the staff list shows each duty");

  setSetting("pssai_retire_staff_ops", "off");
  resetRetireCache();
  const back = await call("create_staff", { username: "desk4", password: "pw-123456", displayName: "Desk", role: "staff", branchId: b1.id }, tO);
  check(back.ok && (await call("get_staff_grid", {}, tO)).status === 200, "S5: switching it off brings everything back");
}

done();
