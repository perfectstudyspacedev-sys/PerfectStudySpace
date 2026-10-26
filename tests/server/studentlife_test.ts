// PSS-AI Phase 5 (portal R4, SP21) and Phase 6 against the REAL api function: the focus profile,
// exam coach and Study Wrapped; study buddies (opt-in both ways, first names only after both say
// yes); verified study certificates (HMAC under CERTIFICATE_SECRET, public check page); the parent
// digest link (hash-only token, revocable, no amounts or phone numbers); and the owner overview.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";

const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();
// An IST wall-clock time on a date, as a UTC instant.
const ist = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00.000+05:30`)).toISOString();

const TODAY = IST_TODAY();            // 2026-10-16, a Friday (determinism.ts)
let b1: any, b2: any, owner: any, priya: any, tO: string, tP: string, f1: any, f2: any;
async function setup() {
  reset();
  b1 = insert("branches", { name: "Hopes", is_active: true, desk_count: 3 });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true, desk_count: 1 });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  f1 = insert("desks", { branch_id: b1.id, label: "F1", seat_type: "floating", status: "free" });
  f2 = insert("desks", { branch_id: b1.id, label: "F2", seat_type: "floating", status: "free" });
  insert("desks", { branch_id: b1.id, label: "P1", seat_type: "fixed", status: "reserved" });
  insert("desks", { branch_id: b2.id, label: "R1", seat_type: "floating", status: "free" });
  setSetting("pssai_portal", "on");
}
async function member(name: string, phone: string, course: string | null = "TNPSC Group 4", opts: { membership?: boolean; branch?: any } = {}) {
  const branch = opts.branch ?? b1;
  const s = insert("students", { name, phone, emergency_contact: "9000000009", branch_id: branch.id, status: "active", course });
  const m = opts.membership === false ? null : insert("memberships", { student_id: s.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -40), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 20), months_paid: 1, monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: true, is_paused: false, plan_amount: 1500, plan_days: 30 });
  const code = await call("create_portal_setup_code", { studentId: s.id }, branch.id === b1.id ? tP : tO);
  const token = (await call("me_set_pin", { phone, code: code.code, pin: "482915", acceptPrivacy: true })).token as string;
  return { s, m, token };
}
const session = (studentId: string, date: string, from: string, to: string, extra: any = {}) =>
  insert("bookings", { student_id: studentId, branch_id: b1.id, desk_id: f1.id, booking_type: "temporary", status: "completed", start_time: ist(date, from), end_time: ist(date, to), total_pause_minutes: 0, ...extra });

// ── SP18 focus profile, SP19 exam coach, SP20 Study Wrapped ──
await setup();
{
  const asha = await member("Asha Rao", "9100000001");
  const off = await Promise.all(["me_focus_profile", "me_exam_coach", "me_wrapped"].map((a) => call(a, {}, asha.token)));
  check(off.every((x) => x.status === 200 && x.on === false), "R1: with pssai_portal_r4 off the three pages answer off");
  setSetting("pssai_portal_r4", "on");
  const rate = (date: string, from: string, rating: number) => {
    const b = session(asha.s.id, date, from, from === "09:00" ? "12:00" : "21:00");
    insert("focus_ratings", { booking_id: b.id, student_id: asha.s.id, rating, created_at: b.end_time });
  };
  rate(addDays(TODAY, -6), "09:00", 5); rate(addDays(TODAY, -5), "09:00", 4); rate(addDays(TODAY, -4), "18:00", 2); rate(addDays(TODAY, -3), "18:00", 3);
  const few = await call("me_focus_profile", {}, asha.token);
  check(few.on && !few.enough && few.ratings === 4, "R1: with 4 ratings the profile says there are not enough yet", few);
  rate(addDays(TODAY, -2), "09:00", 5); rate(addDays(TODAY, -1), "18:00", 2);
  const fp = await call("me_focus_profile", {}, asha.token);
  const morning = fp.windows.find((w: any) => w.window === "morning");
  check(fp.enough && fp.best === "morning" && morning.average === 4.7 && morning.ratings === 3 && fp.windows.find((w: any) => w.window === "evening").average === 2.3,
    "R1: 6 ratings: mornings average 4.7, evenings 2.3 — mornings are the best window", fp.windows);

  insert("exam_notices", { exam_name: "TNPSC Group 4 2026", exam_family: "tnpsc-group-4", exam_date: addDays(TODAY, 20), status: "confirmed" });
  insert("exam_notices", { exam_name: "SSC CGL", exam_family: "ssc-cgl", exam_date: addDays(TODAY, 5), status: "confirmed" });
  const coach = await call("me_exam_coach", {}, asha.token);
  // The 6 sessions above: 3 × 3 h + 3 × 3 h = 18 h over 14 days → 1.3 h a day against a 6-hour plan.
  check(coach.daysLeft === 20 && coach.phase === "last_month" && coach.examDate === addDays(TODAY, 20) && coach.avgHours === 1.3 && coach.target === 6 && !coach.onTrack && coach.daysStudied === 6,
    "R2: the coach counts down to the next confirmed exam of the student's family, against the plan's hours", coach);
  check(/1\.3 h a day/.test(coach.tips[0]) && coach.tips.some((t: string) => /Revise/.test(t)) && coach.tips.some((t: string) => /6 of the last 14 days/.test(t)), "R2: off-track and irregular-days advice comes first; last-month advice follows", coach.tips);
  const ravi = await member("Ravi K", "9100000002", null);
  const noExam = await call("me_exam_coach", {}, ravi.token);
  check(noExam.phase === "no_exam" && noExam.daysLeft === null && /Tell the desk/.test(noExam.tips.join(" ")), "R2: without a course the coach asks the student to tell the desk", noExam.phase);

  // Wrapped for September: 1, 2, 3 and 10 September.
  for (const [d, from, to, pause, desk] of [["2026-09-01", "09:00", "12:00", 0, f1], ["2026-09-02", "09:00", "14:00", 30, f1], ["2026-09-03", "14:00", "17:00", 0, f2], ["2026-09-10", "09:00", "12:00", 0, f1]] as [string, string, string, number, any][]) {
    session(asha.s.id, d, from, to, { total_pause_minutes: pause, desk_id: desk.id });
  }
  for (const [i, h] of [1, 2, 3, 20, 30].entries()) {
    const o = insert("students", { name: `Other ${i}`, phone: `92000000${i}0`, branch_id: b1.id, status: "active" });
    session(o.id, "2026-09-05", "06:00", `${String(6 + Math.min(h, 17)).padStart(2, "0")}:00`);
    if (h > 17) session(o.id, "2026-09-06", "06:00", `${String(6 + h - 17).padStart(2, "0")}:00`);
  }
  session(asha.s.id, "2026-09-15", "09:00", "12:00", { status: "cancelled" });
  const w = await call("me_wrapped", {}, asha.token);
  check(w.month === "2026-09" && w.minutes === 810 && w.days === 4 && w.longestStreak === 3 && w.bestDay.date === "2026-09-02" && w.bestDay.minutes === 270 && w.favouriteDesk === "F1",
    "R3: Wrapped for last month: 13.5 hours over 4 days, a 3-day streak, the best day 2 September (4.5 h after a break), favourite desk F1", w);
  check(w.percentile === 60 && w.focus === null, "R3: more than 3 of the branch's 5 other members (counts only) → 60th percentile", { p: w.percentile, f: w.focus });
  const oct = await call("me_wrapped", { month: "2026-10" }, asha.token);
  const future = await call("me_wrapped", { month: "2026-12" }, asha.token);
  check(oct.month === "2026-10" && oct.to === TODAY && oct.focus === 3.5 && future.month === "2026-09", "R3: this month runs to today; a future month falls back to last month", { oct: [oct.month, oct.to, oct.focus], future: future.month });
  check(!JSON.stringify(w).includes("Other") && !JSON.stringify(w).includes("9200"), "R3: no other member's name or phone is in the answer");
}

// ── SP21 study buddies ──
await setup();
{
  const asha = await member("Asha Rao", "9100000001");
  const ravi = await member("Ravi Kumar", "9100000002");
  const meena = await member("Meena S", "9100000003");
  const kavi = await member("Kavi P", "9100000004", "SSC CGL");
  const nomem = await member("No Plan", "9100000005", "TNPSC Group 4", { membership: false });
  const nocourse = await member("No Course", "9100000006", null);
  check((await call("me_buddy", {}, asha.token)).on === false && (await call("me_buddy_join", { window: "evening" }, asha.token)).status === 403, "B1: with pssai_study_buddy off nothing opens");
  setSetting("pssai_study_buddy", "on");
  const bad = await Promise.all([call("me_buddy_join", { window: "lunch" }, asha.token), call("me_buddy_join", { window: "evening" }, nomem.token), call("me_buddy_join", { window: "evening" }, nocourse.token)]);
  check(bad.every((x) => x.status === 400) && rows("study_buddies").length === 0, "B1: an unknown window, no plan or no exam is refused", bad.map((x) => x.error));
  for (const [st, win] of [[asha, "evening"], [ravi, "evening"], [meena, "morning"], [kavi, "evening"]] as [any, string][]) await call("me_buddy_join", { window: win }, st.token);
  check(rows("study_buddies").length === 4 && rows("study_buddies").find((p) => p.student_id === asha.s.id)?.exam_family === "tnpsc-group-4", "B1: four members opt in; the exam family comes from their course");

  const r = await run("cron_buddy_matches");
  const m = rows("study_buddy_matches");
  check(r.made === 1 && m.length === 1 && [m[0].student_a, m[0].student_b].sort().join() === [asha.s.id, ravi.s.id].sort().join() && m[0].student_a < m[0].student_b,
    "B2: only the same branch, exam family and window are paired (Asha and Ravi)", { r, m });
  check(rows("portal_notifications").filter((n) => n.kind === "buddy").length === 2, "B2: both are told, without names");
  const mine = await call("me_buddy", {}, asha.token);
  check(mine.match?.status === "proposed" && mine.match.window === "evening" && !mine.match.firstName && !JSON.stringify(mine).includes("Ravi") && !JSON.stringify(mine).includes("9100000002"),
    "B3: before both say yes the match shows the window and exam only — no name, no phone", mine.match);
  check((await call("me_buddy_respond", { matchId: m[0].id, accept: true }, meena.token)).status === 404, "B3: someone else's match is not found");
  const yes1 = await call("me_buddy_respond", { matchId: m[0].id, accept: true }, asha.token);
  check(yes1.ok && yes1.matchStatus === "proposed" && m[0].status === "proposed", "B3: one yes keeps it proposed", m[0]);
  check((await call("me_buddy_respond", { matchId: m[0].id, accept: true }, asha.token)).status === 409, "B3: a second answer is refused");
  check(!(await call("me_buddy", {}, ravi.token)).match.firstName, "B3: Ravi still sees no name");
  await call("me_buddy_respond", { matchId: m[0].id, accept: true }, ravi.token);
  const both = await call("me_buddy", {}, asha.token);
  check(m[0].status === "connected" && both.match.firstName === "Ravi" && !JSON.stringify(both).includes("Kumar") && !JSON.stringify(both).includes("9100000002"),
    "B4: after both say yes each sees the other's first name only, never a phone number", both.match);
  check(rows("portal_notifications").filter((n) => n.kind === "buddy").length === 4, "B4: both are told they have a buddy");
  check((await run("cron_buddy_matches")).made === 0, "B4: connected members are not paired again");

  await call("me_buddy_leave", {}, asha.token);
  check(m[0].status === "ended" && rows("study_buddies").find((p) => p.student_id === asha.s.id)?.active === false && (await call("me_buddy", {}, asha.token)).profile === null, "B5: leaving ends the match and the profile");
  const eva = await member("Eva M", "9100000007");
  await call("me_buddy_join", { window: "evening" }, eva.token);
  await run("cron_buddy_matches");
  const m2 = rows("study_buddy_matches").find((x) => [x.student_a, x.student_b].includes(eva.s.id))!;
  check(m2 && [m2.student_a, m2.student_b].includes(ravi.s.id) && !rows("study_buddy_matches").some((x) => x !== m[0] && [x.student_a, x.student_b].includes(asha.s.id)), "B5: Ravi is offered a new buddy; Asha (left) is not", m2);
  const no = await call("me_buddy_respond", { matchId: m2.id, accept: false }, eva.token);
  check(no.ok && no.matchStatus === "declined" && m2.status === "declined" && !(await call("me_buddy", {}, ravi.token)).match, "B5: a no declines it; neither sees the other", m2.status);
  await run("cron_buddy_matches");
  check(rows("study_buddy_matches").filter((x) => [x.student_a, x.student_b].includes(eva.s.id) && [x.student_a, x.student_b].includes(ravi.s.id)).length === 1, "B5: a declined pair is never offered again");
  // Review fix: two "yes" at the same moment still connect.
  const fia = await member("Fia N", "9100000008"), gopi = await member("Gopi R", "9100000009");
  for (const x of [fia, gopi]) await call("me_buddy_join", { window: "afternoon" }, x.token);
  await run("cron_buddy_matches");
  const m3 = rows("study_buddy_matches").find((x) => [x.student_a, x.student_b].includes(fia.s.id))!;
  const both2 = await Promise.all([fia, gopi].map((x) => call("me_buddy_respond", { matchId: m3.id, accept: true }, x.token)));
  check(both2.every((r) => r.ok) && m3.status === "connected" && m3.a_answer === "yes" && m3.b_answer === "yes", "B6: two yes answers at the same moment connect the pair", { statuses: both2.map((r) => r.matchStatus ?? r.error), m3 });
}

// ── I33 certificates ──
await setup();
{
  Deno.env.delete("CERTIFICATE_SECRET");
  const asha = await member("Asha Rao", "9100000001");
  for (const [d, from, to] of [["2026-09-01", "09:00", "12:00"], ["2026-09-02", "09:00", "14:00"], ["2026-09-20", "14:00", "16:00"]]) session(asha.s.id, d, from, to);
  const range = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };
  check((await call("me_issue_certificate", range, asha.token)).status === 403 && (await call("public_verify_certificate", { id: "abcdefghjk" })).status === 404, "C1: with pssai_certificates off nothing is issued or checked");
  setSetting("pssai_certificates", "on");
  check((await call("me_issue_certificate", range, asha.token)).status === 503 && rows("study_certificates").length === 0, "C1: without the CERTIFICATE_SECRET secret issuing is refused");
  Deno.env.set("CERTIFICATE_SECRET", "test-certificate-secret-0123");
  const bad = await Promise.all([
    call("me_issue_certificate", { dateFrom: "2026-09-01", dateTo: addDays(TODAY, 1) }, asha.token),
    call("me_issue_certificate", { dateFrom: "2025-09-01", dateTo: "2026-09-30" }, asha.token),
    call("me_issue_certificate", { dateFrom: "2026-09-30", dateTo: "2026-09-01" }, asha.token),
    call("me_issue_certificate", { dateFrom: "2026-08-01", dateTo: "2026-08-31" }, asha.token),
  ]);
  check(bad.every((x) => x.status === 400), "C2: a future end, more than 12 months, a reversed range and dates with no study are refused", bad.map((x) => x.error));
  const c = await call("me_issue_certificate", range, asha.token);
  const row = rows("study_certificates")[0];
  check(c.ok && /^[0-9a-z]{10}$/.test(c.certificate.id) && c.certificate.hours === 10 && c.certificate.days === 3 && c.certificate.name === "Asha Rao" && c.certificate.hall === "Perfect Study Space — Hopes" && /\/verify\/[0-9a-z]{10}$/.test(c.certificate.verifyUrl),
    "C3: a certificate counts completed sessions: 10 hours over 3 days, with a check link", c.certificate);
  check(/^[0-9a-f]{64}$/.test(row.signature), "C3: it is signed (HMAC-SHA256)");
  const v = await call("public_verify_certificate", { id: row.id });
  check(v.found && v.valid && v.hours === 10 && v.name === "Asha Rao" && v.from === "2026-09-01" && !("phone" in v) && !("student_id" in v), "C4: the public check page shows the hall, name, hours and dates, and that it checks", v);
  row.hours = 100;
  check((await call("public_verify_certificate", { id: row.id })).valid === false, "C4: a changed number no longer checks");
  row.hours = 10;
  check((await call("public_verify_certificate", { id: "nope" })).found === false && (await call("public_verify_certificate", { id: "zzzzzzzzzz" })).found === false, "C4: a bad or unknown id is not found");
  const list = await call("me_certificates", {}, asha.token);
  check(list.on && list.certificates.length === 1 && list.certificates[0].id === row.id, "C5: the student lists their certificates");
  check((await call("me_revoke_certificate", { id: row.id }, asha.token)).ok && (await call("me_revoke_certificate", { id: row.id }, asha.token)).status === 404, "C5: the student withdraws one, once");
  const after = await call("public_verify_certificate", { id: row.id });
  check(after.found && after.revoked && !after.valid && !("name" in after) && !("hours" in after), "C5: a withdrawn certificate shows only that it was withdrawn — no name or hours (review fix)", after);
  const ravi = await member("Ravi K", "9100000002");
  check((await call("me_revoke_certificate", { id: rows("study_certificates")[0].id }, ravi.token)).status === 404, "C5: nobody else can withdraw it");
  for (let i = 0; i < 4; i++) await call("me_issue_certificate", range, asha.token);
  check((await call("me_issue_certificate", range, asha.token)).status === 429 && rows("study_certificates").length === 5, "C6: at most 5 a month");
  const ev = rows("events").filter((e) => e.action === "me_issue_certificate");
  check(ev.length >= 5 && ev.every((e) => e.actor_type === "student"), "C6: each issue is an event with the student as actor");
  Deno.env.delete("CERTIFICATE_SECRET");
  check((await call("public_verify_certificate", { id: rows("study_certificates")[1].id })).valid === false, "C6: with the secret gone nothing checks");
}

// ── Review fixes: sessions closed at 23:30 don't count; the monthly cap holds under two taps ──
await setup();
{
  Deno.env.set("CERTIFICATE_SECRET", "test-certificate-secret-0123");
  setSetting("pssai_certificates", "on");
  const asha = await member("Asha Rao", "9100000001");
  session(asha.s.id, "2026-09-01", "09:00", "12:00");
  const forgot = session(asha.s.id, "2026-09-02", "09:00", "15:00");
  insert("anomaly_flags", { kind: "session_auto_closed", ref_table: "bookings", ref_id: forgot.id, branch_id: b1.id, explanation: "No checkout by 23:30", status: "open" });
  const range = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };
  const c = await call("me_issue_certificate", range, asha.token);
  check(c.certificate?.hours === 3 && c.certificate.days === 1, "X5: a session nobody checked out of (closed at 23:30) is not counted on a certificate", c.certificate);
  for (let i = 0; i < 3; i++) await call("me_issue_certificate", range, asha.token);
  const two = await Promise.all([call("me_issue_certificate", range, asha.token), call("me_issue_certificate", range, asha.token)]);
  check(two.filter((r) => r.status === 200).length === 1 && two.some((r) => r.status === 429) && rows("study_certificates").length === 5, "X8: two taps at the cap make one certificate, not two", two.map((r) => r.status));
  const v = await call("public_verify_certificate", { id: c.certificate.id });
  check(v.valid && /^pss-cert:v2\|\[/.test((await import("../../supabase/functions/_shared/study.ts")).certificateText(rows("study_certificates")[0])), "X7: certificates are signed as v2 (fields as a list, the issue date included) and check", v.valid);
  Deno.env.delete("CERTIFICATE_SECRET");
}

// ── I34 parent digest ──
await setup();
{
  const asha = await member("Asha Rao", "9100000001");
  check((await call("me_parent_info", {}, asha.token)).on === false && (await call("me_parent_link", {}, asha.token)).status === 403, "D1: with pssai_parent_digest off there is no link");
  setSetting("pssai_parent_digest", "on");
  const link = await call("me_parent_link", {}, asha.token);
  const token = link.url?.split("/p/")[1];
  const pl = rows("parent_links")[0];
  check(link.ok && /^[0-9a-z]{32}$/.test(token) && /^[0-9a-f]{64}$/.test(pl.token_hash) && !JSON.stringify(pl).includes(token), "D1: the link carries a 32-character token; only its hash is kept", pl);
  const ev = rows("events").find((e) => e.action === "me_parent_link");
  check(ev && !JSON.stringify(ev).includes(token), "D1: the token is not in the event log");
  const empty = await call("public_parent_digest", { token });
  check(empty.status === 200 && empty.weeks.length === 0 && pl.last_viewed_at, "D2: before Sunday's summary the page is empty; the visit is noted", empty);
  check((await call("me_parent_info", {}, asha.token)).link?.lastViewedAt, "D2: the student sees when the link was last opened");

  // This week (Monday 12 October to today): 12 Oct 3 h, 14 Oct 2 h with a 30-minute break; last week's day is not in it.
  session(asha.s.id, "2026-10-12", "09:00", "12:00");
  session(asha.s.id, "2026-10-14", "15:00", "17:30", { total_pause_minutes: 30 });
  session(asha.s.id, "2026-10-09", "09:00", "12:00");
  insert("food_bills", { student_id: asha.s.id, branch_id: b1.id, total: 80, is_paid: false });
  const r = await run("cron_parent_digest");
  const d = rows("parent_digests")[0];
  check(r.weekStart === "2026-10-12" && r.made === 1 && d.summary.minutes === 300 && d.summary.daysAttended === 2 && d.summary.days.length === 7 && d.summary.name === "Asha" && d.summary.planEnds === addDays(TODAY, 20),
    "D3: the weekly job freezes the week: 5 hours over 2 days, first name only, when the plan ends", d?.summary);
  const view = await call("public_parent_digest", { token });
  const text = JSON.stringify(view);
  check(view.weeks.length === 1 && !text.includes("9100000001") && !/fee|amount|total|paid|₹/i.test(text) && !text.includes("Rao"), "D3: the parent page holds no phone number, amounts or surname", view.weeks[0]);
  check(rows("portal_notifications").some((n) => n.kind === "parent_digest" && n.student_id === asha.s.id), "D3: the student is told the summary is ready");
  check((await run("cron_parent_digest")).made === 1 && rows("parent_digests").length === 1, "D3: running it again replaces the same week");

  const link2 = await call("me_parent_link", {}, asha.token);
  const token2 = link2.url.split("/p/")[1];
  check((await call("public_parent_digest", { token })).status === 404 && (await call("public_parent_digest", { token: token2 })).weeks.length === 1, "D4: a new link replaces the old one, which stops at once");
  check((await call("me_revoke_parent_link", {}, asha.token)).ok && (await call("public_parent_digest", { token: token2 })).status === 404 && (await call("me_parent_info", {}, asha.token)).link === null, "D4: the student stops the link");
  check((await call("me_revoke_parent_link", {}, asha.token)).status === 404 && (await run("cron_parent_digest")).made === 0, "D4: nothing more is frozen without a live link");
  check((await call("public_parent_digest", { token: "short" })).status === 404, "D4: a malformed token is not found");
}

// ── O10 one owner, every branch ──
await setup();
{
  check((await call("get_owner_overview", {}, tP)).status === 403, "O1: desk staff can't see it");
  check((await call("get_owner_overview", {}, tO)).on === false, "O1: with pssai_owner_overview off it answers off");
  setSetting("pssai_owner_overview", "on");
  const asha = await member("Asha Rao", "9100000001");
  const ravi = await member("Ravi K", "9100000002", null, { branch: b2 });
  asha.m.fee_due = 400; asha.m.end_date = addDays(TODAY, 4);
  insert("bookings", { student_id: asha.s.id, branch_id: b1.id, desk_id: f1.id, status: "active", start_time: ist(TODAY, "09:00") });
  insert("transactions", { branch_id: b1.id, amount: 500, category: "membership", created_at: ist(TODAY, "10:00") });
  insert("transactions", { branch_id: b1.id, amount: 300, category: "membership", created_at: ist("2026-10-02", "10:00") });
  insert("transactions", { branch_id: b1.id, amount: 1000, category: "membership", created_at: ist("2026-09-28", "10:00") });
  insert("transactions", { branch_id: b2.id, amount: 200, category: "walkin", created_at: ist(TODAY, "09:30") });
  insert("approvals", { kind: "student_request", action: "hold", status: "pending", branch_id: b1.id, payload: {}, requested_by_type: "student" });
  insert("tickets", { branch_id: b2.id, student_id: ravi.s.id, category: "wifi", status: "open" });
  insert("food_orders", { branch_id: b1.id, student_id: asha.s.id, status: "placed", items: [], total: 0 });
  const o = await call("get_owner_overview", {}, tO);
  const hopes = o.branches.find((b: any) => b.id === b1.id);
  const ram = o.branches.find((b: any) => b.id === b2.id);
  check(hopes.checkedIn === 1 && hopes.seats === 2 && hopes.freeSeats === 1 && hopes.collectedToday === 500 && hopes.collectedMonth === 800 && hopes.dues === 400 && hopes.endingThisWeek === 1 && hopes.approvals === 1 && hopes.foodOrders === 1,
    "O2: Hopes: 1 in, 1 seat free, ₹500 today and ₹800 this month, ₹400 dues, 1 plan ending, 1 approval, 1 food order", hopes);
  check(ram.collectedToday === 200 && ram.tickets === 1 && ram.checkedIn === 0, "O2: Ram Nagar has its own row", ram);
  check(o.totals.collectedToday === 700 && o.totals.collectedMonth === 1000 && o.totals.approvals === 1 && o.totals.tickets === 1, "O2: totals add up across branches", o.totals);
}

done();
