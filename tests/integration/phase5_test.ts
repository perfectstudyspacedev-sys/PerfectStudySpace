// Phases 5 and 6 against a REAL Postgres + PostgREST: the tables of migrations 070–072 and their
// CHECKs and unique indexes (one live rule per bucket, one running experiment per kind, one live
// parent link, a sorted buddy pair), the embeds (focus_ratings → bookings, food_bills →
// food_bill_items, desks!desk_id), .not(…is null), upserts on composite keys, and each new action
// end to end. Switches are put back off at the end, so later suites see the default.
// deno-lint-ignore-file no-explicit-any
import { addDays, call, check, db, done, get, insert, IST_TODAY, phone, where, world } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { resetRetireCache } from "../../supabase/functions/_shared/retire.ts";

const TODAY = IST_TODAY();
const setting = async (key: string, value: string) => { const { error } = await db.from("app_settings").upsert({ key, value }, { onConflict: "key" }); if (error) throw new Error(error.message); };
const SWITCHES = ["pssai_portal", "pssai_policy_learner", "pssai_digital_twin", "pssai_experiments", "pssai_space_yield", "pssai_portal_r4", "pssai_study_buddy", "pssai_certificates", "pssai_parent_digest", "pssai_owner_overview"];
for (const k of SWITCHES) await setting(k, "on");
const sys = async (name: string) => await (await runAction(REGISTRY.get(name)!, { db: db as any, req: new Request("http://x"), action: name, actor: { type: "system", id: null } }, {})).json();
const ist = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00+05:30`)).toISOString();

const w = await world("p5");
const f1 = await insert("desks", { branch_id: w.branch.id, label: "P5-F1", status: "free", seat_type: "floating", sort_order: 1 });
await insert("desks", { branch_id: w.branch.id, label: "P5-C1", status: "reserved", seat_type: "fixed", sort_order: 2 });
async function member(name: string, course: string | null = "TNPSC Group 4") {
  const s = await insert("students", { name, phone: phone(), branch_id: w.branch.id, status: "active", course });
  const m = await insert("memberships", { student_id: s.id, branch_id: w.branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -40), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 21), months_paid: 1, monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: true, plan_amount: 1500, plan_days: 30 });
  const code = await call("create_portal_setup_code", { studentId: s.id }, w.tS);
  const token = (await call("me_set_pin", { phone: s.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token as string;
  return { s, m, token };
}
const session = (studentId: string, date: string, from: string, to: string, extra: any = {}) =>
  insert("bookings", { student_id: studentId, branch_id: w.branch.id, desk_id: f1.id, booking_type: "temporary", status: "completed", start_time: ist(date, from), end_time: ist(date, to), total_pause_minutes: 0, ...extra });

// ── 1. I8 rules on Postgres: learned, signed, shown, applied ──
{
  const decidedAt = new Date(Date.now() - 20 * 86400e3).toISOString();
  // A bucket no other suite uses: 1–7 days, a second hold this month.
  for (let i = 0; i < 6; i++) await insert("approvals", { kind: "student_request", action: "hold", payload: { days: 5, why: "second hold this month", dues: false }, requested_by_type: "student", status: "approved", decided_at: decidedAt, branch_id: w.branch.id });
  const r = await sys("cron_policy_rules");
  const rule = (await db.from("policy_rules").select("*").eq("bucket", "days:1-7|why:second|dues:no").in("status", ["proposed", "active"])).data?.[0];
  check(r.ok && rule?.outcome === "approve" && rule.support >= 6 && Number(rule.agreement) >= 0.9, "P5-1: the weekly job proposes a rule from the owner's decisions", { r, rule });
  const { error: dup } = await db.from("policy_rules").insert({ scope: rule.scope, bucket: rule.bucket, outcome: "approve", support: 6, agreement: 1, description: "dup" });
  check(!!dup, "P5-1: the partial unique index allows one live rule per bucket", dup?.message);
  const signed = await call("decide_policy_rule", { ruleId: rule.id, decision: "sign" }, w.tO);
  check(signed.status === 200 && (await get("policy_rules", rule.id)).status === "active", "P5-1: the owner signs it", signed);

  // A real hold request in that bucket: the second self-hold this month, 5 days.
  const asha = await member("Rule Asha");
  await insert("membership_holds", { membership_id: asha.m.id, student_id: asha.s.id, branch_id: w.branch.id, paused_at: new Date(Date.now() - 2 * 3600e3).toISOString(), resumed_at: new Date(Date.now() - 3600e3).toISOString(), days_paused: 0, requested_by_student: true });
  const req = await call("me_request_hold", { days: 5, reason: "family" }, asha.token);
  const ap = await get("approvals", req.pending_approval);
  const list = await call("list_approvals", {}, w.tO);
  const card = list.approvals?.find((a: any) => a.id === ap?.id);
  check(req.status === 202 && card?.rule?.id === rule.id, "P5-1: the request waits and its card shows the signed rule", { req: req.error ?? req.status, rule: card?.rule });
  const applied = await sys("cron_apply_policy_rules");
  const after = await get("approvals", ap.id);
  const mem = await get("memberships", asha.m.id);
  check(applied.applied >= 1 && after.status === "approved" && after.policy_rule_id === rule.id && mem.is_paused && (await get("policy_rules", rule.id)).applied_count === 1,
    "P5-1: the 15-minute job approves it through the same hold steps; the rule counts it", { applied, after: after.status, paused: mem.is_paused });
  check((await call("decide_policy_rule", { ruleId: rule.id, decision: "retire" }, w.tO)).status === 200, "P5-1: the owner retires it (so later suites are untouched)");
}

// ── 2. I6 the digital twin reads on Postgres ──
{
  const twin = await insert("students", { name: "Twin Renewer", phone: phone(), branch_id: w.branch.id, status: "active" });
  const prev = await insert("memberships", { student_id: twin.id, branch_id: w.branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -70), end_date: addDays(TODAY, -40), due_date: addDays(TODAY, -40), months_paid: 1, monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: false });
  await insert("memberships", { student_id: twin.id, branch_id: w.branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -39), end_date: addDays(TODAY, -9), due_date: addDays(TODAY, -9), months_paid: 1, monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: false, renewed_from_membership_id: prev.id, plan_amount: 1500, plan_days: 30, created_at: ist(addDays(TODAY, -32), "10:00") });
  const res = await Promise.all([
    call("simulate_policy", { policy: "renewal_grace", value: 5 }, w.tO), call("simulate_policy", { policy: "overtime_grace", value: 30 }, w.tO), call("simulate_policy", { policy: "self_hold_days", value: 10 }, w.tO),
  ]);
  check(res.every((x) => x.status === 200) && res[0].renewals >= 1 && res[0].difference <= -400 && typeof res[1].difference === "number" && res[2].requests >= 1,
    "P5-2: all three simulations run on real data (renewals via .not(is null), overtime sessions, hold events)", res.map((x) => x.error ?? [x.policy, x.changed, x.difference]));
}

// ── 3. O6 experiments: the running index, exposures upsert, conversions, keep ──
{
  const v = [{ label: "Tea", value: null }, { label: "Vada", value: null }];
  const tea = await insert("food_items", { branch_id: w.branch.id, name: "P5 Tea", price: 10, quantity: 50, is_active: true });
  const vada = await insert("food_items", { branch_id: w.branch.id, name: "P5 Vada", price: 15, quantity: 50, is_active: true });
  v[0].value = tea.id; v[1].value = vada.id;
  const made = await call("create_experiment", { kind: "menu_feature", name: "P5 menu", branchId: w.branch.id, variants: v }, w.tO);
  const twice = await call("create_experiment", { kind: "menu_feature", name: "P5 menu again", branchId: w.branch.id, variants: v }, w.tO);
  check(made.status === 200 && twice.status === 409, "P5-3: one running experiment per kind and branch (unique index → 409)", [made.status, twice.status, twice.error]);
  const kid = await member("Menu Kid");
  const { experimentVariant } = await import("../../supabase/functions/api/domains/learning.ts");
  const a = await experimentVariant(db as any, "menu_feature", w.branch.id, kid.s.id);
  const b = await experimentVariant(db as any, "menu_feature", w.branch.id, kid.s.id);
  const ex = await where("experiment_exposures", "experiment_id", made.id);
  check(a?.key && a.key === b?.key && ex.length === 1, "P5-3: the exposure upsert on (experiment_id, student_id) keeps one row", ex.length);
  const bill = await insert("food_bills", { branch_id: w.branch.id, student_id: kid.s.id, subtotal: 15, total: 15, paid: true, payment_mode: "cash" });
  await insert("food_bill_items", { food_bill_id: bill.id, food_item_id: a!.value, name: "P5 item", price: 15, quantity: 1 });
  const job = await sys("cron_experiments");
  const conv = (await where("experiment_exposures", "experiment_id", made.id))[0];
  check(job.ok && conv.converted_at, "P5-3: an order of the featured item converts (food_bills → food_bill_items embed)", { job, conv });
  const list = await call("list_experiments", {}, w.tO);
  check(list.status === 200 && list.experiments.find((e: any) => e.id === made.id)?.live?.rows?.length === 2, "P5-3: the list embeds the branch and works out the numbers");
  const kept = await call("update_experiment", { experimentId: made.id, decision: "keep", variant: "A" }, w.tO);
  const featured = (await where("app_settings", "key", `featured_food_item:${w.branch.id}`))[0]?.value;
  check(kept.status === 200 && featured === tea.id && (await get("experiments", made.id)).status === "kept", "P5-3: keeping writes the featured item for the branch (its own setting)", { kept: kept.error, featured });
}

// ── 4. O7 space yield and O10 the owner overview ──
{
  const y = await call("get_space_yield", { branchId: w.branch.id }, w.tO);
  check(y.status === 200 && y.seats === 1 && y.cabins === 1 && y.grid.length === 7 && Array.isArray(y.suggestions), "P5-4: space yield reads bookings with desks!desk_id(seat_type) and the waitlist count", y.error ?? { seats: y.seats, cabins: y.cabins });
  await insert("transactions", { branch_id: w.branch.id, amount: 250, category: "food", payment_mode: "cash" });
  const o = await call("get_owner_overview", {}, w.tO);
  const row = o.branches?.find((b: any) => b.id === w.branch.id);
  check(o.status === 200 && row && row.collectedToday >= 250 && row.collectedMonth >= 250 && typeof o.totals.dues === "number", "P5-4: the owner overview has a row for each branch, from the real tables", o.error ?? row);
}

// ── 5. Portal R4: focus profile, exam coach, Wrapped ──
{
  const st = await member("Focus Student");
  for (let i = 1; i <= 5; i++) {
    const bk = await session(st.s.id, addDays(TODAY, -i), "09:00", "12:00");
    await insert("focus_ratings", { booking_id: bk.id, student_id: st.s.id, rating: 4 + (i % 2), source: "portal" });
  }
  await insert("exam_notices", { source: "tnpsc", exam_name: `P5 Group 4 ${Date.now()}`, exam_family: "tnpsc-group-4", exam_date: addDays(TODAY, 40), status: "confirmed" });
  const [fp, coach, wr] = await Promise.all([call("me_focus_profile", {}, st.token), call("me_exam_coach", {}, st.token), call("me_wrapped", { month: TODAY.slice(0, 7) }, st.token)]);
  check(fp.status === 200 && fp.enough && fp.best === "morning", "P5-5: the focus profile reads focus_ratings → bookings(start_time)", fp.error ?? fp.best);
  check(coach.status === 200 && coach.phase === "near" && coach.daysLeft !== null && coach.daysStudied === 5, "P5-5: the exam coach finds the confirmed exam of the family", coach.error ?? coach);
  check(wr.status === 200 && wr.minutes >= 180 && wr.favouriteDesk === "P5-F1", "P5-5: Wrapped reads sessions with desks!desk_id(label)", wr.error ?? wr);
}

// ── 6. SP21 buddies: the sorted pair CHECK and the .or() read ──
{
  const a = await member("Buddy Anu"), b = await member("Buddy Bala");
  for (const x of [a, b]) await call("me_buddy_join", { window: "night" }, x.token);
  const r = await sys("cron_buddy_matches");
  const m = (await db.from("study_buddy_matches").select("*").or(`student_a.eq.${a.s.id},student_b.eq.${a.s.id}`)).data?.[0];
  check(r.ok && m && m.student_a < m.student_b, "P5-6: the weekly job pairs them, stored in sorted order", { r, m });
  const [lo, hi] = [m.student_a, m.student_b];
  const { error: reversed } = await db.from("study_buddy_matches").insert({ student_a: hi, student_b: lo });
  check(!!reversed, "P5-6: the CHECK refuses an unsorted pair", reversed?.message);
  for (const x of [a, b]) await call("me_buddy_respond", { matchId: m.id, accept: true }, x.token);
  const view = await call("me_buddy", {}, a.token);
  check(view.status === 200 && view.match?.status === "connected" && view.match.firstName === "Buddy" && !JSON.stringify(view).includes(b.s.phone), "P5-6: both said yes: first name only, no phone", view.match);
}

// ── 7. I33 certificates and I34 parent links on Postgres ──
{
  Deno.env.set("CERTIFICATE_SECRET", "integration-certificate-secret");
  const st = await member("Certified Student");
  await session(st.s.id, addDays(TODAY, -3), "09:00", "13:00");
  await session(st.s.id, addDays(TODAY, -2), "14:00", "16:30", { total_pause_minutes: 30 });
  const c = await call("me_issue_certificate", { dateFrom: addDays(TODAY, -10), dateTo: TODAY }, st.token);
  const v = c.certificate ? await call("public_verify_certificate", { id: c.certificate.id }) : null;
  check(c.status === 200 && c.certificate.hours === 6 && c.certificate.days === 2 && v?.valid === true, "P5-7: a certificate is stored (NUMERIC hours, TEXT id CHECK) and checks on the public page", { c: c.error ?? c.certificate, v });
  const { error: badId } = await db.from("study_certificates").insert({ id: "BAD", student_id: st.s.id, hall_name: "x", student_name: "x", date_from: TODAY, date_to: TODAY, hours: 1, days: 1, signature: "x" });
  check(!!badId, "P5-7: the id CHECK refuses anything but 10 lowercase letters and digits", badId?.message);

  const l1 = await call("me_parent_link", {}, st.token);
  const l2 = await call("me_parent_link", {}, st.token);
  const links = await where("parent_links", "student_id", st.s.id);
  check(l1.status === 200 && l2.status === 200 && links.filter((x: any) => !x.revoked_at).length === 1 && links.length === 2, "P5-7: a new link revokes the old one first, so the one-live-link index holds", links.map((x: any) => !!x.revoked_at));
  const { error: twoLive } = await db.from("parent_links").insert({ student_id: st.s.id, token_hash: crypto.randomUUID() });
  check(!!twoLive, "P5-7: the index refuses a second live link", twoLive?.message);
  const r = await sys("cron_parent_digest");
  const token = l2.url.split("/p/")[1];
  const page = await call("public_parent_digest", { token });
  const old = await call("public_parent_digest", { token: l1.url.split("/p/")[1] });
  check(r.ok && page.status === 200 && page.weeks.length === 1 && old.status === 404, "P5-7: the digest upserts on (student_id, week_start); the new link shows it, the old one doesn't", { r, weeks: page.weeks?.length, old: old.status });
  Deno.env.delete("CERTIFICATE_SECRET");
}

// ── 8. S1 retirement: usage report, 410s and duty CHECK, then back off ──
{
  const u = await call("get_staff_module_usage", {}, w.tO);
  check(u.status === 200 && typeof u.total === "number", "P5-8: the usage report counts events", u.error ?? u.total);
  await setting("pssai_retire_staff_ops", "on");
  resetRetireCache();
  const gone = await call("get_staff_grid", {}, w.tO);
  const made = await call("create_staff", { username: `p5_kitchen_${Date.now()}`.slice(0, 40), password: "kitchen-pass-1", displayName: "Cook", role: "staff", branchId: w.branch.id, duty: "kitchen" }, w.tO);
  const desk = await call("create_staff", { username: `p5_desk_${Date.now()}`.slice(0, 40), password: "desk-pass-1", displayName: "Desk", role: "staff", branchId: w.branch.id }, w.tO);
  const { error: badDuty } = await db.from("staff").update({ duty: "chef" }).eq("id", w.staff.id);
  const listed = await call("list_staff", {}, w.tO);
  check(gone.status === 410 && made.status === 200 && desk.status === 400 && !!badDuty && listed.staff?.some((s: any) => s.duty === "kitchen"), "P5-8: retired screens answer 410; only kitchen/housekeeping accounts are made; the duty CHECK holds", { gone: gone.status, made: made.error ?? made.status, desk: desk.status, badDuty: badDuty?.message });
  const deskCall = await call("list_messages", { branchId: w.branch.id }, w.tS);
  check(deskCall.status === 401, "P5-8: a desk-duty account's token stops working once the screens retire (C18)", deskCall.status);
  await setting("pssai_retire_staff_ops", "off");
}

// ── 9. The nightly report lists a floating desk left occupied with nobody in it ──
{
  const { integrityFindings } = await import("../../supabase/functions/api/domains/system.ts");
  const stray = await insert("desks", { branch_id: w.branch.id, label: "P5-STRAY", status: "occupied", seat_type: "floating", sort_order: 9 });
  const f = await integrityFindings(db as any);
  check(f.desks_occupied_without_session.some((d: any) => d.desk_id === stray.id), "P5-9: an occupied floating desk with no open session is in the integrity report", f.counts.desks_occupied_without_session);
  await db.from("desks").update({ status: "free" }).eq("id", stray.id);
}

for (const k of SWITCHES.filter((s) => s !== "pssai_portal")) await setting(k, "off");
done();
