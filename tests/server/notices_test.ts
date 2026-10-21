// P2.5 — scheduled portal notices against the REAL handlers: session-end reminders (G3) and
// waitlist offers (G10, C2: 24 hours to accept), each behind its switch and written once.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();

let b1: any, priya: any, tP: string;
async function setup() {
  reset();
  b1 = insert("branches", { name: "Hopes", is_active: true });
  priya = insert("staff", { username: "priya", role: "staff", is_active: true, branch_id: b1.id });
  tP = await tokenFor(priya);
  setSetting("pssai_portal", "on");
}
async function portalStudent(name: string, phone: string) {
  const s = insert("students", { name, phone, branch_id: b1.id, status: "active" });
  const code = await call("create_portal_setup_code", { studentId: s.id }, tP);
  await call("me_set_pin", { phone, code: code.code, pin: "482915", acceptPrivacy: true });
  return s;
}
const ending = (s: any, minutes: number, extra: any = {}) => insert("bookings", { student_id: s.id, branch_id: b1.id, booking_type: "temporary", status: "active", is_paused: false, start_time: new Date(Date.now() - 5 * 3600e3).toISOString(), end_time: new Date(Date.now() + minutes * 60e3).toISOString(), hours: 6, amount: 0, ...extra });

await setup();
{
  const asha = await portalStudent("Asha Rao", "9100000001");
  const bala = insert("students", { name: "Bala", phone: "9100000002", branch_id: b1.id, status: "active" }); // no portal
  const soon = ending(asha, 8);
  ending(asha, 25);
  ending(bala, 5);
  ending(asha, 6, { is_paused: true });
  check((await run("cron_session_reminders")).skipped, "N1: with pssai_session_reminders off nothing is sent");
  setSetting("pssai_session_reminders", "on");
  const r = await run("cron_session_reminders");
  const notes = rows("portal_notifications").filter((n) => n.kind === "session_end");
  check(r.sent === 1 && notes.length === 1 && notes[0].student_id === asha.id && notes[0].dedupe_key === `session-end:${soon.id}` && /8 minutes/.test(notes[0].title),
    "N1: one notice for the session ending in 8 minutes — not the one in 25, not a paused one, not a student without the portal", { r, notes });
  advanceClock(5 * 60e3);
  await run("cron_session_reminders");
  check(rows("portal_notifications").filter((n) => n.kind === "session_end").length === 1, "N1: the next run does not repeat it");
}

await setup();
{
  const asha = await portalStudent("Asha Rao", "9100000001");
  const chitra = await portalStudent("Chitra", "9100000003");
  insert("desks", { branch_id: b1.id, label: "P1", status: "free", sort_order: 1 });
  const w0 = insert("permanent_waitlist", { branch_id: b1.id, name: "No Portal", phone: "9100000009", status: "waiting", created_at: new Date(Date.now() - 3 * 86400e3).toISOString() });
  const w1 = insert("permanent_waitlist", { branch_id: b1.id, name: "Asha Rao", phone: asha.phone, status: "waiting", created_at: new Date(Date.now() - 2 * 86400e3).toISOString() });
  const w2 = insert("permanent_waitlist", { branch_id: b1.id, name: "Chitra", phone: chitra.phone, status: "waiting", created_at: new Date(Date.now() - 1 * 86400e3).toISOString() });
  check((await run("cron_waitlist_offers")).skipped, "N2: with pssai_waitlist_offers off nothing is offered");
  setSetting("pssai_waitlist_offers", "on");
  const r = await run("cron_waitlist_offers");
  check(r.offered === 1 && w1.offer_status === "offered" && w1.student_id === asha.id && !w0.offer_status && !w2.offer_status, "N2: one free desk → the oldest waiting person with portal access is offered it (the one without portal is left to the desk)", r);
  check(new Date(w1.offer_expires_at).getTime() - Date.now() === 24 * 3600e3 && rows("portal_notifications").some((n) => n.kind === "waitlist_offer" && n.student_id === asha.id), "N2: the offer lasts 24 hours (C2) and the student is told");
  check((await run("cron_waitlist_offers")).offered === 0, "N2: the desk is not offered twice while the offer is open");

  const tA = (await call("me_login", { phone: asha.phone, pin: "482915" })).token;
  const mem = await call("me_membership", {}, tA);
  check(mem.waitlistOffer?.id === w1.id, "N3: the portal home shows the offer", mem.waitlistOffer);
  const otherTok = (await call("me_login", { phone: chitra.phone, pin: "482915" })).token;
  check((await call("me_respond_offer", { offerId: w1.id, accept: true }, otherTok)).status === 404, "N3: another student can't answer it");

  advanceClock(25 * 3600e3);
  const r2 = await run("cron_waitlist_offers");
  check(r2.expired === 1 && w1.offer_status === "expired" && w2.offer_status === "offered", "N3: after 24 hours the offer expires and moves to the next person", r2);
  const late = await call("me_respond_offer", { offerId: w1.id, accept: true }, (await call("me_login", { phone: asha.phone, pin: "482915" })).token);
  check(late.status === 404, "N3: an expired offer can't be accepted", late);
  const yes = await call("me_respond_offer", { offerId: w2.id, accept: true }, (await call("me_login", { phone: chitra.phone, pin: "482915" })).token);
  check(yes.status === 202 && w2.offer_status === "accepted" && rows("student_requests").some((q) => q.kind === "waitlist_accept" && q.student_id === chitra.id), "N3: accepting goes to the owner's queue for the desk to finish", yes);
}

done();
