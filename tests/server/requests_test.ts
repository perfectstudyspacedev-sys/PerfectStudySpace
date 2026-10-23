// P2.1 SP6 and P2.3 against the REAL api function: student holds within policy (C1, D5) run at
// once and end by themselves; everything else waits in the owner's queue; a T3 action from an
// agent or a student never runs without the owner; decisions run once.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
let TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};

let b1: any, owner: any, priya: any, asha: any, memA: any, desk: any, tO: string, tP: string, tA: string;
async function student(name: string, phone: string, category = "temporary") {
  const s = insert("students", { name, phone, emergency_contact: "9000000009", branch_id: b1.id, status: "active" });
  const m = insert("memberships", { student_id: s.id, branch_id: b1.id, category, seat_type: category === "permanent" ? "fixed" : "floating", hours_per_day: category === "permanent" ? 12 : 6, start_date: addDays(TODAY, -10), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 20), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true, plan_amount: 1250, plan_days: 30, ...(category === "permanent" ? { desk_id: desk.id, cabin_no: desk.label } : {}) });
  const code = await call("create_portal_setup_code", { studentId: s.id }, tP);
  const token = (await call("me_set_pin", { phone, code: code.code, pin: "482915", acceptPrivacy: true })).token as string;
  return { s, m, token };
}
async function setup() {
  reset();
  TODAY = IST_TODAY();
  b1 = insert("branches", { name: "Hopes", is_active: true, desk_count: 4 });
  desk = insert("desks", { branch_id: b1.id, label: "P1", status: "occupied", seat_type: "fixed", sort_order: 0 });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  setSetting("pssai_portal", "on");
  ({ s: asha, m: memA, token: tA } = await student("Asha Rao", "9100000001"));
}
const hold = (days: number, token = tA) => call("me_request_hold", { days, reason: "exams at home" }, token);
const holds = () => rows("membership_holds");

// ── Self-hold within policy ──
await setup();
{
  const bad = await Promise.all([hold(0), hold(32), hold(2.5)]);
  check(bad.every((r) => r.status === 400), "H1: 0, more than 31 and part days are refused", bad.map((b) => b.error));
  const r = await hold(3);
  const h = holds()[0];
  check(r.status === 200 && r.resumesOn === addDays(TODAY, 3) && memA.is_paused && h.planned_resume_date === addDays(TODAY, 3) && h.requested_by_student === true,
    "H1: a 3-day hold on a temporary plan starts at once and is planned to end in 3 days", { r, h });
  const ev = rows("events").find((e) => e.action === "pause_membership");
  check(ev?.actor_type === "student" && ev.actor_id === asha.id && ev.ok, "H1: the pause is an event with the student as actor", ev);
  check(rows("approvals").length === 0 && rows("portal_notifications").some((n) => n.kind === "hold"), "H1: no approval needed; the student gets a notice");
  check((await hold(2)).status === 400, "H1: a second hold while on hold is refused");

  advanceClock(3 * 86400e3);
  const job = await call("cron_resume_holds", {}, await tokenFor(owner));
  check(job.status === 400 && /Unknown action/.test(job.error), "H2: the resume job is not reachable through the api");
  const res = await runAction(REGISTRY.get("cron_resume_holds")!, { db: adminClient(), req: new Request("http://x"), action: "cron_resume_holds", actor: { type: "system", id: null } }, {});
  const body = await res.json();
  check(body.resumed === 1 && !memA.is_paused && memA.end_date === addDays(TODAY, 23) && holds()[0].days_paused === 3, "H2: on the planned day the job resumes it and adds the 3 days to the end date", { body, end: memA.end_date });
  const again = await (await runAction(REGISTRY.get("cron_resume_holds")!, { db: adminClient(), req: new Request("http://x"), action: "cron_resume_holds", actor: { type: "system", id: null } }, {})).json();
  check(again.resumed === 0, "H2: running the job again changes nothing");

  const second = await hold(2);
  check(second.status === 202 && second.pending_approval && !memA.is_paused && rows("student_requests")[0].details.why === "second hold this month", "H3: a second self-hold in the same month goes to the owner", second);
}

// ── Holds that need the owner; resume ──
await setup();
{
  const long = await hold(10);
  const reqRow = rows("student_requests")[0];
  check(long.status === 202 && reqRow.kind === "hold" && reqRow.details.days === 10 && reqRow.approval_id === long.pending_approval && !memA.is_paused, "H4: a 10-day hold waits for the owner", { long, reqRow });
  const list = await call("list_approvals", {}, tO);
  check((await call("list_approvals", {}, tP)).status === 403 && list.approvals.length === 1 && list.approvals[0].name === "Asha Rao" && list.approvals[0].action === "hold", "H4: only the owner sees the queue, with the student's name", list);
  const noReason = await call("decide_approval", { approvalId: long.pending_approval, decision: "deny" }, tO);
  check(noReason.status === 400, "H4: denying needs a reason");
  const yes = await call("decide_approval", { approvalId: long.pending_approval, decision: "approve" }, tO);
  check(yes.status === 200 && memA.is_paused && holds()[0].planned_resume_date === addDays(TODAY, 10) && holds()[0].requested_by_student === false && reqRow.status === "approved",
    "H4: approving starts the hold with its planned end; the request is marked approved", { yes });
  const pauseEv = rows("events").filter((e) => e.action === "pause_membership").at(-1);
  check(pauseEv.actor_type === "owner" && /Approved hold request/.test(pauseEv.reason), "H4: the approved pause runs as the owner with the request as its reason", pauseEv);
  check((await call("decide_approval", { approvalId: long.pending_approval, decision: "approve" }, tO)).status === 409, "H4: an approval can be decided only once");
  const resumed = await call("me_resume", {}, tA);
  check(resumed.status === 200 && !memA.is_paused, "H5: a student on a temporary plan can end their hold early", resumed);

  const p = await student("Bala Kumar", "9100000002", "permanent");
  const ph = await hold(3, p.token);
  check(ph.status === 202 && rows("student_requests").at(-1).details.why.startsWith("permanent"), "H5: a permanent member's hold (it frees the cabin) goes to the owner", ph);
  await call("decide_approval", { approvalId: ph.pending_approval, decision: "approve" }, tO);
  check(p.m.is_paused && desk.status === "free", "H5: approved, the cabin is freed as the desk's hold does today");
  const pr = await call("me_resume", {}, p.token);
  check(pr.status === 400 && /cabin/.test(pr.error), "H5: a permanent member resumes at the desk (a cabin must be picked)", pr);
  advanceClock(3 * 86400e3);
  const job = await (await runAction(REGISTRY.get("cron_resume_holds")!, { db: adminClient(), req: new Request("http://x"), action: "cron_resume_holds", actor: { type: "system", id: null } }, {})).json();
  check(job.toDesk === 1 && p.m.is_paused && rows("alerts").some((a) => a.student_id === p.s.id && a.alert_type === "hold"), "H5: on the planned day a permanent member's hold becomes a desk alert", job);
}

// ── Other requests, denial, limits ──
await setup();
{
  const short = await call("me_request", { kind: "plan_change", details: "" }, tA);
  const bad = await call("me_request", { kind: "free_money", details: "please" }, tA);
  check(short.status === 400 && bad.status === 400, "H6: a request needs a known kind and a few words", { short, bad });
  const r = await call("me_request", { kind: "plan_change", details: "Move me to 8 hours a day from next month" }, tA);
  check(r.status === 202 && rows("approvals")[0].kind === "student_request" && rows("approvals")[0].action === "plan_change", "H6: a plan change goes to the owner (D5)", r);
  const no = await call("decide_approval", { approvalId: r.pending_approval, decision: "deny", reason: "8-hour seats are full this month" }, tO);
  check(no.status === 200 && rows("student_requests")[0].status === "denied" && rows("portal_notifications").some((n) => n.kind === "request_denied" && /full this month/.test(n.body)), "H6: a denial and its reason reach the student", no);
  for (let i = 0; i < 5; i++) await call("me_request", { kind: "refund", details: `refund please ${i}` }, tA);
  const sixth = await call("me_request", { kind: "privacy_download", details: "" }, tA);
  check(sixth.status === 400 && /several requests/.test(sixth.error), "H6: at most 5 open requests per student", sixth);
}

// ── The T3 gate: an agent or a student never runs a T3 action ──
await setup();
{
  const db = adminClient();
  const viaAgent = await runAction(REGISTRY.get("delete_membership")!, { db, req: new Request("http://x"), action: "delete_membership", staff: { id: owner.id, username: "owner", role: "owner", display_name: "Owner", branch_id: null, is_active: true, homeBranchId: null, isOverrideToday: false }, actor: { type: "agent", id: null }, runId: "00000000-0000-4000-8000-0000000000aa" }, { membershipId: memA.id });
  const body = await viaAgent.json();
  check(viaAgent.status === 202 && body.pending_approval && rows("memberships").length === 1 && memA.is_active, "G1: a T3 action from an agent is queued, not run", body);
  const a = rows("approvals")[0];
  check(a.kind === "t3_action" && a.action === "delete_membership" && a.requested_by_type === "agent" && a.run_id === "00000000-0000-4000-8000-0000000000aa", "G1: the queue row keeps the action, the asker and the run", a);
  const ev = rows("events").find((e) => e.action === "delete_membership");
  check(ev?.actor_type === "agent" && ev.ok, "G1: the request itself is an event");
  for (const name of REGISTRY.keys()) {
    const def = REGISTRY.get(name)!;
    if (def.tier === "T3" && (def.callers.includes("student") || def.callers.includes("agent"))) check(false, `G1: ${name} is T3 but callable by students or agents`);
  }
  const yes = await call("decide_approval", { approvalId: body.pending_approval, decision: "approve", reason: "agreed with the student" }, tO);
  const del = rows("events").filter((e) => e.action === "delete_membership").at(-1);
  check(yes.status === 200 && memA.is_active === false && rows("events").filter((e) => e.action === "delete_membership").length === 2 && del.actor_type === "owner" && /Approved request .* \(asked by agent\): agreed with the student/.test(del.reason),
    "G1: approved, it runs once as the owner with the request recorded as its reason", { yes, reason: del.reason });
}

// ── Review 11: an approved hold re-checks the membership first ──
await setup();
{
  const q = await hold(12);
  memA.is_active = false;   // ended (or renewed) before the owner decided
  const late = await call("decide_approval", { approvalId: q.pending_approval, decision: "approve" }, tO);
  check(late.status === 409 && /membership has changed/.test(late.error) && !holds().length && rows("approvals")[0].status === "pending", "R11: a hold approved after the membership ended pauses nothing and stays open for the owner to deny", late);
}

done();
