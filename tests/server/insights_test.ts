// PSS-AI Phase 1 against the REAL handler: feature flags, the focus pulse (P1.1) and the owner's
// reads of model outputs (P1.3, P1.6, P1.7).
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
const TODAY = IST_TODAY();
const setFlag = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};

reset();
const b1 = insert("branches", { name: "Hopes", is_active: true });
const b2 = insert("branches", { name: "Ram Nagar", is_active: true });
const owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
const priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
const ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: b2.id });
const [tO, tP, tR] = await Promise.all([owner, priya, ravi].map((s) => tokenFor(s)));
const asha = insert("students", { name: "Asha Rao", phone: "9100000001", branch_id: b1.id, status: "active" });
const bala = insert("students", { name: "Bala Kumar", phone: "9100000002", branch_id: b1.id, status: "active" });
const chitra = insert("students", { name: "Chitra Devi", phone: "9100000003", branch_id: b2.id, status: "active" });
const done1 = insert("bookings", { student_id: asha.id, branch_id: b1.id, booking_type: "temporary", status: "completed", start_time: new Date(Date.now() - 6 * 3600e3).toISOString(), hours: 6, amount: 0 });
const walkin = insert("bookings", { student_id: bala.id, branch_id: b1.id, booking_type: "walkin", status: "completed", start_time: new Date(Date.now() - 3 * 3600e3).toISOString(), hours: 3, amount: 35 });
const active = insert("bookings", { student_id: bala.id, branch_id: b1.id, booking_type: "temporary", status: "active", start_time: new Date(Date.now() - 1 * 3600e3).toISOString(), hours: 6, amount: 0 });
const other = insert("bookings", { student_id: chitra.id, branch_id: b2.id, booking_type: "temporary", status: "completed", start_time: new Date(Date.now() - 5 * 3600e3).toISOString(), hours: 6, amount: 0 });

// ── Feature flags ──
{
  const off = await call("get_feature_flags", {}, tP);
  check(off.status === 200 && off.focusPulse === false && off.anomaly === false && off.discountConfirmOver === 1000, "F1: with no settings every Phase 1 feature is off; confirm threshold ₹1,000", off);
  setFlag("pssai_focus_pulse", "on"); setFlag("pssai_anomaly", "on"); setFlag("pssai_discount_confirm_over", "2500");
  const on = await call("get_feature_flags", {}, tP);
  check(on.focusPulse === true && on.anomaly === true && on.discountConfirmOver === 2500, "F1: switches and threshold read from app_settings", on);
  setFlag("pssai_discount_confirm_over", "abc");
  check((await call("get_feature_flags", {}, tP)).discountConfirmOver === 1000, "F1: a bad threshold falls back to ₹1,000");
  check(rows("events").length === 0, "F1: reading flags writes no event (staff read)");
}

// ── Focus pulse ──
{
  setFlag("pssai_focus_pulse", "off");
  const offTry = await call("record_focus_rating", { bookingId: done1.id, rating: 4 }, tP);
  check(offTry.status === 403 && rows("focus_ratings").length === 0, "P1.1: refused while pssai_focus_pulse is off", offTry);
  setFlag("pssai_focus_pulse", "on");

  const r1 = await call("record_focus_rating", { bookingId: done1.id, rating: 4 }, tP);
  check(r1.status === 200 && rows("focus_ratings").length === 1 && rows("focus_ratings")[0].rating === 4 && rows("focus_ratings")[0].source === "desk" && rows("focus_ratings")[0].student_id === asha.id,
    "P1.1: a member's rating after checkout is saved with the student and source desk", rows("focus_ratings"));
  const r2 = await call("record_focus_rating", { bookingId: done1.id, rating: 2 }, tP);
  check(r2.status === 200 && rows("focus_ratings").length === 1 && rows("focus_ratings")[0].rating === 2, "P1.1: at most one rating per session — a second answer replaces the first", rows("focus_ratings"));

  const w = await call("record_focus_rating", { bookingId: walkin.id, rating: 5 }, tP);
  const a = await call("record_focus_rating", { bookingId: active.id, rating: 5 }, tP);
  const x = await call("record_focus_rating", { bookingId: other.id, rating: 5 }, tP);
  const n = await call("record_focus_rating", { bookingId: "00000000-0000-4000-8000-ffffffffffff", rating: 5 }, tP);
  check(w.status === 400 && /Walk-in/.test(w.error) && a.status === 400 && x.status === 403 && n.status === 404 && rows("focus_ratings").length === 1,
    "P1.1: walk-ins, sessions not yet checked out, other branches and unknown sessions are refused", { w, a, x, n });
  for (const bad of [0, 6, 3.5, "x", null]) {
    const r = await call("record_focus_rating", { bookingId: done1.id, rating: bad }, tP);
    check(r.status === 400 && rows("focus_ratings")[0].rating === 2, `P1.1: rating ${JSON.stringify(bad)} is refused`, r);
  }
  const ev = rows("events").filter((e) => e.action === "record_focus_rating");
  check(ev.length > 0 && ev.every((e) => e.tier === "T1"), "P1.1: every attempt is logged as a T1 event");
}

// ── Model outputs: scores, fingerprints, engagement ──
{
  const at = new Date().toISOString();
  for (const [st, churn, eng] of [[asha, 0.82, 0.31], [bala, 0.15, 0.9], [chitra, 0.6, 0.5]] as [any, number, number][]) {
    rows("student_scores").push({ student_id: st.id, model: "churn", version: "v1", score: churn, reason: churn > 0.5 ? "attendance_drop" : "other", computed_at: at });
    rows("student_scores").push({ student_id: st.id, model: "engagement", version: "v1", score: eng, reason: null, computed_at: at });
  }
  rows("fingerprints").push({ student_id: asha.id, version: "v1", vector: [0.1, 0.2], cluster: "early-bird", computed_at: at });
  rows("fingerprints").push({ student_id: bala.id, version: "v1", vector: [0.3, 0.1], cluster: "night-owl", computed_at: at });

  const one = await call("get_student_scores", { studentId: asha.id }, tO);
  check(one.scores.length === 2 && one.scores[0].model === "churn" && one.fingerprint.cluster === "early-bird", "P1.3: one student's scores and fingerprint", one);
  const branch = await call("get_student_scores", { branchId: b1.id, model: "churn" }, tO);
  check(branch.scores.map((s: any) => s.students.name).join() === "Asha Rao,Bala Kumar", "P1.3: a branch's churn ranking, highest risk first, only that branch", branch.scores);
  const all = await call("get_student_scores", { allBranches: true }, tO);
  check(all.model === "churn" && all.scores.length === 3, "P1.3: all branches for the owner; model defaults to churn");
  const staffTry = await call("get_student_scores", { branchId: b1.id }, tP);
  check(staffTry.status === 403, "P1.3: staff cannot read model scores", staffTry);

  const eng = await call("get_engagement_ranking", { branchId: b1.id }, tO);
  check(eng.ranking.map((r: any) => `${r.rank}:${r.name}:${r.cluster}`).join() === "1:Bala Kumar:night-owl,2:Asha Rao:early-bird", "P1.7: engagement ranking with cluster labels", eng.ranking);
  const empty = await call("get_engagement_ranking", { branchId: b2.id, limit: 1 }, tO);
  check(empty.ranking.length === 1 && empty.ranking[0].name === "Chitra Devi", "P1.7: per branch with a limit", empty);
}

// ── Anomaly flags ──
{
  const f1 = insert("anomaly_flags", { kind: "discount", ref_table: "membership_discounts", ref_id: crypto.randomUUID(), branch_id: b1.id, score: 4.2, explanation: "₹1,500 discount — 5× this staff member's usual", status: "open" });
  insert("anomaly_flags", { kind: "waiver", ref_table: "waivers", ref_id: crypto.randomUUID(), branch_id: b2.id, score: 3.1, explanation: "Overstay waiver of ₹600", status: "ok" });
  const open = await call("list_anomaly_flags", {}, tO);
  check(open.flags.length === 1 && open.flags[0].id === f1.id && open.flags[0].branch_name === "Hopes", "P1.6: open flags by default, with the branch name", open.flags);
  const allFlags = await call("list_anomaly_flags", { status: "all" }, tO);
  check(allFlags.flags.length === 2, "P1.6: all flags on request");
  check((await call("list_anomaly_flags", {}, tP)).status === 403 && (await call("review_anomaly_flag", { flagId: f1.id, status: "ok" }, tP)).status === 403, "P1.6: staff can neither list nor review flags");
  const bad = await call("review_anomaly_flag", { flagId: f1.id, status: "maybe" }, tO);
  const missing = await call("review_anomaly_flag", { flagId: crypto.randomUUID(), status: "ok" }, tO);
  check(bad.status === 400 && missing.status === 404, "P1.6: only ok or problem, and only an existing flag", { bad, missing });
  const rv = await call("review_anomaly_flag", { flagId: f1.id, status: "problem" }, tO);
  check(rv.flag.status === "problem" && rows("anomaly_flags").find((f) => f.id === f1.id).reviewed_by_staff_id === owner.id && (await call("list_anomaly_flags", {}, tO)).flags.length === 0,
    "P1.6: the owner marks a flag problem; it leaves the open list and records who reviewed it", rv);
  const ev = rows("events").filter((e) => e.action === "review_anomaly_flag" && e.ok);
  check(ev.length === 1 && ev[0].actor_id === owner.id, "P1.6: the review is in the event log");
}

// ── Forecast and owner brief ──
{
  const at = new Date().toISOString();
  for (const [i, v] of [[-14, 1000], [-7, 2000], [0, 30000], [7, 42000], [14, 38000]] as [number, number][]) {
    rows("forecasts").push({ id: crypto.randomUUID(), kind: "cash_inflow", period_start: addDays(TODAY, i), value: v, low: v * 0.8, high: v * 1.2, computed_at: at });
  }
  const fc = await call("get_forecast", {}, tO);
  check(fc.kind === "cash_inflow" && fc.rows.map((r: any) => r.value).join() === "30000,42000,38000" && fc.computedAt === at, "P1.7: forecast from the week that contains today onwards, in order (finished weeks dropped)", fc.rows);
  check((await call("get_forecast", {}, tP)).status === 403, "P1.7: staff cannot read the forecast");

  const none = await call("get_owner_brief", {}, tO);
  check(none.brief === null, "P1.3: no owner brief until the analyst (P1.8) writes one", none);
  rows("owner_briefs").push({ id: crypto.randomUUID(), brief_date: addDays(TODAY, -1), body: "Yesterday: ₹12,400 in.", figures: { income: 12400 }, created_at: at });
  rows("owner_briefs").push({ id: crypto.randomUUID(), brief_date: TODAY, body: "Today: ₹8,000 in.", figures: { income: 8000 }, created_at: at });
  const latest = await call("get_owner_brief", {}, tO);
  const byDate = await call("get_owner_brief", { date: addDays(TODAY, -1) }, tO);
  const badDate = await call("get_owner_brief", { date: "yesterday" }, tO);
  check(latest.brief.brief_date === TODAY && byDate.brief.body === "Yesterday: ₹12,400 in." && badDate.status === 400, "P1.3: latest brief, or the brief for a date", { latest, byDate, badDate });
}
void tR;

done();
