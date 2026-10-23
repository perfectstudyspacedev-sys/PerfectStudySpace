// P2.4 A1 — the student concierge against the REAL agent and api functions with a scripted Claude:
// shadow mode by default (drafts reviewed by staff, acting tools off), live mode, isolation to the
// token's student, no contact details to the model, limits, and failures that leave the message
// for a person.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { agent, fakeAi, reply, text, toolUse, APIError } from "./agent-harness.ts";
const g = globalThis as any;
let TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
// Replies for the next calls (counted from now), the last one repeated.
const script = (...replies: any[]) => { const base = fakeAi.requests.length; g.__FAKE_AI__ = (_p: any, i: number) => { const r = replies[Math.min(i - base, replies.length - 1)]; if (r instanceof Error) throw r; return r; }; };

let b1: any, priya: any, asha: any, bala: any, memA: any, tP: string, tA: string, tB: string;
async function enrol(s: any) {
  const code = await call("create_portal_setup_code", { studentId: s.id }, tP);
  return (await call("me_set_pin", { phone: s.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token as string;
}
async function setup() {
  reset(); fakeAi.reset();
  TODAY = IST_TODAY();
  Deno.env.set("AI_API_KEY", "test-ai-key");
  b1 = insert("branches", { name: "Hopes", is_active: true });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  tP = await tokenFor(priya);
  for (const [h, fee] of [[6, 1250], [8, 1500]]) insert("fee_config", { config_type: "membership", cabin_type: "temporary", hours_per_day: h, fee, sort_order: h });
  asha = insert("students", { name: "Asha Rao", phone: "9100000001", emergency_contact: "9000000001", branch_id: b1.id, status: "active" });
  bala = insert("students", { name: "Bala Kumar", phone: "9100000002", emergency_contact: "9000000002", branch_id: b1.id, status: "active" });
  memA = insert("memberships", { student_id: asha.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -26), end_date: addDays(TODAY, 4), due_date: addDays(TODAY, 4), months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0, is_active: true, plan_amount: 1250, plan_days: 30 });
  insert("memberships", { student_id: bala.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 8, start_date: addDays(TODAY, -2), end_date: addDays(TODAY, 28), due_date: addDays(TODAY, 28), months_paid: 1, monthly_fee: 1500, total_paid: 1500, fee_due: 0, is_active: true, plan_amount: 1500, plan_days: 30 });
  setSetting("pssai_portal", "on"); setSetting("pssai_concierge", "on");
  tA = await enrol(asha); tB = await enrol(bala);
}
// Each message a minute apart, as in real use (the test clock is otherwise frozen).
const say = async (message: string, token = tA) => { const r = await agent({ agent: "concierge", message }, { token }); advanceClock(60e3); return r; };
const chat = () => rows("portal_chat_messages");

// ── Access ──
await setup();
{
  setSetting("pssai_concierge", "off");
  const off = await say("hi");
  setSetting("pssai_concierge", "on");
  const staff = await say("hi", tP);
  const none = await say("hi", "");
  const long = await say("x".repeat(1001));
  check(off.status === 403 && staff.status === 401 && none.status === 401 && long.status === 400 && chat().length === 0 && fakeAi.requests.length === 0,
    "C1: switch off, a staff token, no token and an over-long message are refused before anything is stored", [off.status, staff.status, none.status, long.status]);
}

// ── Shadow mode (the default): drafts for staff, acting tools off ──
await setup();
{
  script(
    reply([toolUse("t1", "me_membership", { studentId: bala.id }), toolUse("t2", "me_profile", {})], "tool_use"),
    reply([text("Asha, your plan has 4 days left — it ends on " + addDays(TODAY, 4) + ".")]),
  );
  const r = await say("How many days left in my plan?");
  const [mine, draft] = chat();
  check(r.status === 200 && r.pending === true && !r.reply, "C2: in shadow mode the student is told the team will reply", r);
  check(mine.role === "student" && mine.status === "sent" && draft.role === "assistant" && draft.status === "draft" && draft.reply_to === mine.id && /4 days left/.test(draft.body), "C2: the question is stored and the answer waits as a draft", chat());
  const q1 = fakeAi.requests[0];
  check(q1.model === "claude-haiku-5-5" && /Review mode: you can only read/.test(q1.system[0].text) && /Tamil script, or Tanglish/.test(q1.system[0].text) && q1.messages.length === 1 && q1.messages[0].content === "How many days left in my plan?",
    "C2: Haiku 5.5, review-mode rules, the D4 language rule, and the student's message as the turn", { model: q1.model });
  const results = fakeAi.requests[1].messages.at(-1).content;
  const sent = JSON.stringify(fakeAi.requests[1]);
  check(results[0].content.includes(memA.id) && !results[0].content.includes("Bala") && results[1].content.includes("Asha Rao") && !sent.includes("9100000001") && !sent.includes("9000000001"),
    "C2: tools answer for the token's student only (another id in the input is dropped) and no phone number reaches the model", results.map((x: any) => x.content.slice(0, 120)));
  const run = rows("agent_runs")[0];
  const ev = rows("events").filter((e) => e.actor_type === "agent");
  check(run.agent === "concierge" && run.student_id === asha.id && run.status === "ok" && ev.length === 3 && ev.every((e) => e.run_id === run.id) && ev.some((e) => e.action === "save_chat_reply"),
    "C2: one concierge run; every tool call and the saved reply are agent events with its id", ev.map((e) => e.action));
  const hist = await call("me_chat_history", {}, tA);
  check(hist.messages.length === 1 && hist.waiting === true, "C2: the student sees only their own message until a person sends the reply", hist);

  const threads = await call("list_chat_threads", { branchId: b1.id }, tP);
  const t = threads.threads?.[0];
  check(t && t.name === "Asha Rao" && t.drafts.length === 1 && t.unanswered === true, "C3: the staff page lists the thread with its draft", threads);
  const edited = await call("send_chat_reply", { studentId: asha.id, draftId: t.drafts[0].id, body: "Hi Asha! 4 days left — your plan ends on " + addDays(TODAY, 4) + ". — Priya" }, tP);
  const again = await call("send_chat_reply", { studentId: asha.id, draftId: t.drafts[0].id, body: "dup" }, tP);
  check(edited.status === 200 && again.status === 409 && draft.status === "sent" && /— Priya/.test(draft.body) && draft.sent_by_staff_id === priya.id, "C3: staff send the draft (edited) once", { edited, again: again.status });
  const hist2 = await call("me_chat_history", {}, tA);
  check(hist2.messages.length === 2 && hist2.waiting === false && rows("portal_notifications").some((n) => n.kind === "chat_reply" && n.student_id === asha.id), "C3: the student sees the reply and gets a notice", hist2);
  check((await call("list_chat_threads", { branchId: b1.id }, tP)).threads.length === 0, "C3: an answered thread leaves the staff list");

  script(reply([toolUse("h", "me_request_hold", { days: 3 })], "tool_use"), reply([text("A team member will help you with the hold.")]));
  await say("Please put my membership on hold for 3 days");
  const holdRes = fakeAi.requests.at(-1).messages.at(-1).content[0];
  check(holdRes.is_error && /Review mode/.test(holdRes.content) && !memA.is_paused && !rows("events").some((e) => e.action === "me_request_hold"), "C4: in shadow mode the hold tool does nothing", holdRes);
  const d2 = chat().filter((m) => m.status === "draft").at(-1);
  await call("discard_chat_draft", { draftId: d2.id }, tP);
  check(d2.status === "discarded", "C4: staff can discard a draft");
}

// ── Live mode ──
await setup();
{
  setSetting("pssai_agent_shadow", "off");
  script(reply([toolUse("h", "me_request_hold", { days: 2, reason: "fever" })], "tool_use"), reply([text("Done — your hold has started and ends in 2 days.")]));
  const r = await say("I have fever, please hold my membership 2 days");
  const pauseEv = rows("events").find((e) => e.action === "pause_membership");
  check(r.status === 200 && r.reply === "Done — your hold has started and ends in 2 days." && chat().at(-1).status === "sent" && chat().at(-1).role === "assistant", "C5: with shadow off the reply goes straight to the student", r);
  check(memA.is_paused && rows("membership_holds")[0].planned_resume_date === addDays(TODAY, 2) && pauseEv?.actor_type === "agent", "C5: the hold tool works within the self-hold rules, as the agent", pauseEv);

  // History: the earlier exchange goes back as turns.
  script(reply([text("You're welcome!")]));
  await say("thanks");
  const msgs = fakeAi.requests.at(-1).messages;
  check(msgs.length === 3 && msgs[0].role === "user" && msgs[1].role === "assistant" && msgs[2].content === "thanks", "C5: earlier messages are sent as alternating turns", msgs.map((m: any) => m.role));
}

// ── Failures leave the message for a person; limits ──
await setup();
{
  setSetting("pssai_agent_shadow", "off");
  script(new APIError(529, "Overloaded"));
  const down = await say("When does my plan end?");
  check(down.pending === true && chat().length === 1 && rows("agent_runs")[0].status === "error", "C6: an AI outage saves no reply; the message waits for staff", { down, chat: chat().length });
  script(reply([], "refusal"));
  const refused = await say("something odd");
  check(refused.pending === true && chat().filter((m) => m.role === "assistant").length === 0, "C6: a refusal saves no reply either");
  const unanswered = await call("list_chat_threads", { branchId: b1.id }, tP);
  check(unanswered.threads[0]?.unanswered === true, "C6: the unanswered thread shows on the staff page");
  Deno.env.delete("AI_API_KEY");
  const n = fakeAi.requests.length;
  const nokey = await say("hello?");
  check(nokey.pending === true && fakeAi.requests.length === n, "C6: without the key the message just waits for staff");
  Deno.env.set("AI_API_KEY", "test-ai-key");

  setSetting("pssai_concierge", "off");
  const direct = await call("me_chat_send", { body: "Can someone call me?" }, tA);
  check(direct.status === 200 && chat().at(-1).body === "Can someone call me?", "C7: with the assistant off, the portal chat still reaches the desk (me_chat_send)", direct);
  setSetting("pssai_concierge", "on");
  script(reply([text("ok")]));
  for (let i = chat().filter((m) => m.role === "student").length; i < 30; i++) insert("portal_chat_messages", { student_id: asha.id, role: "student", body: `m${i}`, status: "sent" });
  const capped = await say("one more");
  check(capped.status === 429, "C7: at most 30 messages per student per day", capped);
  const other = await say("hi", tB);
  check(other.status === 200, "C7: the limit is per student");
  const direct2 = await call("me_chat_send", { body: "and another" }, tA);
  check(direct2.status === 429, "R7: the daily limit holds on the direct path (me_chat_send) too", direct2);
  const ev = rows("events").filter((e) => e.action === "me_chat_send" && e.ok);
  check(ev.length > 0 && ev.every((e) => /^\[\d+ chars\]$/.test(e.payload.body)), "R17: the event log keeps only the length of chat text", ev.at(-1)?.payload);
}

// ── Review 7 and 16: the newest messages always show; sending a reply clears older drafts ──
await setup();
{
  const b2 = insert("branches", { name: "Ram Nagar", is_active: true });
  const other = insert("students", { name: "Elsewhere", phone: "9100000007", branch_id: b2.id, status: "active" });
  const old = new Date(Date.now() - 3 * 86400e3).getTime();
  for (let i = 0; i < 1100; i++) insert("portal_chat_messages", { student_id: other.id, role: "student", body: `x${i}`, status: "sent", created_at: new Date(old + i * 1000).toISOString() });
  insert("portal_chat_messages", { student_id: asha.id, role: "student", body: "Is the AC on?", status: "sent", created_at: new Date(old - 3600e3).toISOString() });
  const d1 = insert("portal_chat_messages", { student_id: asha.id, role: "assistant", body: "Old draft", status: "draft", created_at: new Date(old - 1800e3).toISOString() });
  insert("portal_chat_messages", { student_id: asha.id, role: "student", body: "Hello again?", status: "sent", created_at: new Date(Date.now() - 60e3).toISOString() });
  const d2 = insert("portal_chat_messages", { student_id: asha.id, role: "assistant", body: "New draft", status: "draft", created_at: new Date(Date.now() - 30e3).toISOString() });
  const list = await call("list_chat_threads", { branchId: b1.id }, tP);
  check(list.threads.length === 1 && list.threads[0].studentId === asha.id && list.threads[0].drafts.length === 2, "R7: another branch's 1,100 messages don't push this branch's newest question off the page", list.threads.length);
  const sent = await call("send_chat_reply", { studentId: asha.id, draftId: d2.id, body: "New draft" }, tP);
  check(sent.status === 200 && d2.status === "sent" && d1.status === "discarded", "R16: sending the newest draft discards the older one, so it is never offered next", { d1: d1.status });
}

done();
