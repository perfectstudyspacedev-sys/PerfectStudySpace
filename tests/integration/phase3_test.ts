// Phase 3 against a REAL Postgres + PostgREST: one sale per released hour under real concurrency,
// a release credit reaching the member's renewal through the existing cashback code, and the
// queries an in-memory fake can't prove (relation hints like referral_links!link_id, upsert
// conflict targets, the exam notices' unique index, jsonb).
// deno-lint-ignore-file no-explicit-any
import { addDays, call, check, db, done, get, insert, IST_TODAY, phone, where, world } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { istHour } from "../../supabase/functions/_shared/seats.ts";

const TODAY = IST_TODAY();
Deno.env.delete("AI_API_KEY");
const setting = async (key: string, value: string) => { const { error } = await db.from("app_settings").upsert({ key, value }, { onConflict: "key" }); if (error) throw new Error(error.message); };
for (const k of ["pssai_portal", "pssai_upi_pay", "pssai_hour_release", "pssai_overbooking", "pssai_yield_pricing", "pssai_referral_links", "pssai_portal_r2", "pssai_lead_tools", "pssai_paylater_advice"]) await setting(k, "on");
const sys = async (name: string) => await (await runAction(REGISTRY.get(name)!, { db: db as any, req: new Request("http://x"), action: name, actor: { type: "system", id: null } }, {})).json();
const asAgent = async (name: string, payload: any) => { const r = await runAction(REGISTRY.get(name)!, { db: db as any, req: new Request("http://x"), action: name, actor: { type: "agent", id: null } }, payload); return { status: r.status, ...(await r.json()) }; };
if (!(await db.from("fee_config").select("id").eq("config_type", "membership").eq("cabin_type", "permanent").eq("hours_per_day", 12)).data?.length) {
  await insert("fee_config", { config_type: "membership", cabin_type: "permanent", hours_per_day: 12, fee: 2100, sort_order: 12 });
}

const w = await world("p3");
const cabin = await insert("desks", { branch_id: w.branch.id, label: "P3-C1", status: "reserved", seat_type: "fixed", sort_order: 1 });
const m = await insert("students", { name: "Cabin Member", phone: phone(), branch_id: w.branch.id, status: "active", course: "TNPSC Group 4" });
await db.from("desks").update({ assigned_student_id: m.id }).eq("id", cabin.id);
const mem = await insert("memberships", { student_id: m.id, branch_id: w.branch.id, category: "permanent", seat_type: "fixed", hours_per_day: 12, start_date: addDays(TODAY, -25), end_date: addDays(TODAY, 4), due_date: addDays(TODAY, 5), months_paid: 1, monthly_fee: 2100, total_paid: 2100, fee_due: 0, is_active: true, desk_id: cabin.id, cabin_no: "P3-C1", plan_amount: 2100, plan_days: 30 });
const code = await call("create_portal_setup_code", { studentId: m.id }, w.tS);
const tM = (await call("me_set_pin", { phone: m.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;

// ── 1. Releasing hours and selling them, twice at once ──
{
  const day = addDays(TODAY, 1);
  const rel = await call("me_release_hours", { date: day, fromHour: 9, toHour: 17 }, tM);
  const list = await call("list_resellable_desks", { branchId: w.branch.id, startTime: istHour(day, 10), hours: 3 }, w.tS);
  check(rel.status === 200 && list.desks?.[0]?.deskLabel === "P3-C1", "P3-1: a released cabin shows for a walk-in in that window (real embeds)", { rel: rel.status, list });
  const sell = () => call("create_walkin", { branchId: w.branch.id, name: "Walk In", phone: phone(), hours: 3, paymentMode: "cash", startTime: istHour(day, 10), releaseId: list.desks[0].releaseId }, w.tS);
  const results = await Promise.all([sell(), sell(), sell()]);
  const sales = await where("seat_resales", "release_id", list.desks[0].releaseId);
  const walkins = (await where("bookings", "desk_id", cabin.id)).filter((b: any) => b.booking_type === "walkin");
  check(results.filter((r) => r.status === 200).length === 1 && sales.length === 1 && walkins.length === 1, "P3-1: three desks selling the same hours at once on Postgres — exactly one sale", results.map((r) => r.status));
  const cb = (await where("cashbacks", "student_id", m.id))[0];
  check(Number(sales[0].credit_amount) > 0 && cb?.status === "pending" && Number(cb.cashback_value) === Number(sales[0].credit_amount), "P3-1: the member's 50% credit is a pending fixed cashback", { sale: sales[0].credit_amount, cb: cb?.cashback_value });
  const owner = await call("list_seat_resales", {}, w.tO);
  check(owner.status === 200 && owner.summary.resales >= 1 && owner.resales.some((r: any) => r.source === "member" && r.desk === "P3-C1"), "P3-1: the owner's resale list reads the release through seat_releases!release_id", owner.summary);

  // ── 2. The credit comes off the member's next renewal (existing renewal code) ──
  const before = Number(cb.cashback_value);
  const quote = await call("me_membership", {}, tM);
  const one = quote.renewalQuotes?.find((q: any) => q.months === 1);
  check(one && Number(one.amount) === 2100 - before, `P3-2: the portal's 1-month renewal quote is ₹2,100 − the ₹${before} credit`, quote.renewalQuotes);
  const r = await call("renew_membership", { membershipId: mem.id, monthsPaid: 1, paymentMode: "cash", category: "permanent", hoursPerDay: 12, expectedTotal: 2100 - before }, w.tS);
  const cbAfter = await get("cashbacks", cb.id);
  check(r.status === 200 && cbAfter.status === "redeemed", "P3-2: renewing at the desk takes the credit off and marks it used", { r: r.status, cb: cbAfter.status });
}

// ── 3. Yield prices: the owner's day and the walk-in charge (upsert on branch_id,price_date) ──
{
  const set1 = await call("set_walkin_price_day", { branchId: w.branch.id, date: TODAY, changePct: 10 }, w.tO);
  const set2 = await call("set_walkin_price_day", { branchId: w.branch.id, date: TODAY, changePct: -10 }, w.tO);
  const rowsToday = (await where("walkin_price_days", "branch_id", w.branch.id)).filter((d: any) => d.price_date === TODAY);
  const q = await call("quote_walkin", { branchId: w.branch.id, hours: 3 }, w.tS);
  check(set1.status === 200 && set2.status === 200 && rowsToday.length === 1 && Number(rowsToday[0].change_pct) === -10 && q.amount === Math.max(Math.round(q.base * 0.9 / 5) * 5, q.base * 0.8), "P3-3: setting a day twice keeps one row (the second wins); the quote follows it", { rows: rowsToday.length, q });
  const job = await sys("cron_yield_prices");
  check(job.ok && job.keptOwnerPrices >= 1, "P3-3: the nightly job leaves the owner's day alone", job);
}

// ── 4. Referral links: attribution upsert and the conversion join (referral_links!link_id) ──
{
  const signup = `p3${String(Date.now()).slice(-10)}`;
  await db.from("branches").update({ signup_code: signup }).eq("id", w.branch.id);
  const link = await call("create_referral_link", { branchId: w.branch.id, channel: "instagram", label: "Bio" }, w.tO);
  const info = await call("public_referral_info", { ref: link.code });
  const ph = phone();
  const s1 = await call("public_signup_submit", { code: signup, ref: link.code, name: "Ref Person", phone: ph, emergencyContact: phone(), referralSource: "" });
  const s2 = await call("public_signup_submit", { code: signup, ref: link.code, name: "Ref Person", phone: ph, emergencyContact: phone(), referralSource: "" });
  const attrs = await where("referral_attributions", "phone", ph);
  check(info.code === signup && s1.status === 200 && s2.status === 200 && attrs.length === 1 && (await where("signup_requests", "phone", ph))[0].referral_source === "instagram", "P3-4: a sign-up through the link is attributed once (upsert on link_id,phone) and needs no dropdown", { s2: s2.status, attrs: attrs.length });
  const st = await insert("students", { name: "Ref Person", phone: ph, branch_id: w.branch.id, status: "active", referral_source: "instagram" });
  await insert("memberships", { student_id: st.id, branch_id: w.branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: TODAY, end_date: addDays(TODAY, 29), due_date: addDays(TODAY, 30), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true });
  const conv = await sys("cron_referral_conversions");
  const links = await call("list_referral_links", {}, w.tO);
  const mine = links.links.find((l: any) => l.code === link.code);
  check(conv.converted >= 1 && mine.signups === 1 && mine.joined === 1, "P3-4: the nightly job finds the membership and the owner sees 1 signed up, 1 joined", { conv, mine });
  const whats = await insert("students", { name: "WA Person", phone: phone(), branch_id: w.branch.id, referral_source: "whatsapp" });
  check(whats.referral_source === "whatsapp", "P3-4: 'whatsapp' is a valid source after 065");
}

// ── 5. Agent writes: dedupe upsert, exam notices' unique index, approval notes ──
{
  const e1 = await insert("enquiries", { branch_id: w.branch.id, name: "Ravi Kumar", phone: phone(), source: "instagram" });
  const e2 = await insert("enquiries", { branch_id: w.branch.id, name: "Ravi K", phone: phone(), source: "walk_in" });
  const row = { a: e2.id, b: e1.id, branchId: w.branch.id, verdict: "same", confidence: 0.8, reason: "Same name" };
  const d1 = await asAgent("save_dedupe_suggestions", { rows: [row] });
  const d2 = await asAgent("save_dedupe_suggestions", { rows: [row] });
  const list = await call("list_enquiry_dedupe", { branchId: w.branch.id }, w.tS);
  check(d1.saved === 1 && d2.saved === 0 && list.suggestions.length === 1, "P3-5: a pair is stored once, in id order (upsert on enquiry_a,enquiry_b)", { d1, d2 });

  const exam = { source: "tnpsc", examName: `TNPSC Group 4 IT ${Date.now()}`, examDate: addDays(TODAY, 80) };
  const x1 = await asAgent("save_exam_notices", { rows: [exam] });
  const x2 = await asAgent("save_exam_notices", { rows: [{ ...exam, examName: exam.examName.toUpperCase() }] });
  check(x1.saved === 1 && x2.saved === 0, "P3-5: the same exam read again (any case) is not added twice", { x1, x2 });

  const ap = await insert("approvals", { kind: "t3_action", action: "grant_cashback", payload: { studentId: m.id }, requested_by_type: "system", student_id: m.id, branch_id: w.branch.id });
  const note = await asAgent("save_approval_note", { approvalId: ap.id, note: { recommendation: "approve", confidence: "high", reasons: ["ok"], questions: [] } });
  const queue = await call("list_approvals", {}, w.tO);
  check(note.status === 200 && queue.approvals.find((a: any) => a.id === ap.id)?.ai_note?.recommendation === "approve", "P3-5: the exception desk's note is stored as jsonb and shown in the queue", note);
}

// ── 6. Pay-later scores (student_scores upsert) and the waitlist from the portal ──
{
  const p = await sys("cron_paylater_scores");
  const adv = await call("get_paylater_advice", { studentId: m.id }, w.tS);
  check(p.scored >= 1 && ["low", "medium", "high"].includes(adv.advice?.band), "P3-6: pay-later scores are written and read back as advice", adv.advice);
  const t = await insert("students", { name: "Wait List", phone: phone(), branch_id: w.branch.id, status: "active" });
  const c2 = await call("create_portal_setup_code", { studentId: t.id }, w.tS);
  const tT = (await call("me_set_pin", { phone: t.phone, code: c2.code, pin: "482915", acceptPrivacy: true })).token;
  const j = await call("me_join_waitlist", { hoursPerDay: 12 }, tT);
  const v = await call("me_waitlist", {}, tT);
  check(j.status === 200 && v.waiting?.position >= 1, "P3-6: a student joins the permanent waitlist from the portal", v.waiting);
}

done();
