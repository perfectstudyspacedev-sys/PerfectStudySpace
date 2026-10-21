// P2.5 — AI-drafted staff messages (the AI writes words, code gives every figure and link) and the
// live-update signal, against the REAL agent and api functions.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { agent, fakeAi, reply, text } from "./agent-harness.ts";
import { draftKeepsFacts } from "../../supabase/functions/agent/writer.ts";
import { resetLiveCache } from "../../supabase/functions/_shared/live.ts";
const g = globalThis as any;
const TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const FORM_URL = "https://docs.google.com/forms/d/e/abc/viewform";

let b1: any, b2: any, priya: any, ravi: any, asha: any, tP: string, tR: string;
async function setup() {
  reset(); fakeAi.reset();
  Deno.env.set("AI_API_KEY", "test-ai-key");
  b1 = insert("branches", { name: "Hopes", is_active: true });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true });
  priya = insert("staff", { username: "priya", role: "staff", is_active: true, branch_id: b1.id });
  ravi = insert("staff", { username: "ravi", role: "staff", is_active: true, branch_id: b2.id });
  [tP, tR] = await Promise.all([priya, ravi].map((s) => tokenFor(s)));
  asha = insert("students", { name: "Asha Rao", phone: "9100000001", branch_id: b1.id, status: "active" });
  insert("memberships", { student_id: asha.id, branch_id: b1.id, category: "temporary", hours_per_day: 6, start_date: addDays(TODAY, -1), end_date: addDays(TODAY, 29), is_active: true, monthly_fee: 1250 });
  setSetting("welcome_template", `Hi {name}, welcome! Please fill this form: ${FORM_URL}`);
}
const write = (body: any, token = tP) => agent({ agent: "writer", studentId: asha.id, ...body }, { token });

await setup();
{
  check((await write({ kind: "welcome" })).status === 403, "W1: with pssai_ai_messages off there is no draft");
  setSetting("pssai_ai_messages", "on");
  check((await write({ kind: "welcome" }, tR)).status === 403, "W1: staff of another branch can't draft for this student");
  g.__FAKE_AI__ = () => reply([text(JSON.stringify({ text: `Hi Asha! Welcome to Perfect Study Space Hopes — your 6-hour plan runs to ${new Date(addDays(TODAY, 29) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}. Please fill this form: ${FORM_URL}\n— Team Perfect Study Space` }))]);
  const w = await write({ kind: "welcome" });
  const q = fakeAi.requests[0];
  check(w.status === 200 && w.text.includes(FORM_URL) && q.model === "claude-haiku-5-5" && q.messages[0].content.includes(FORM_URL) && !JSON.stringify(q).includes("Rao") && !JSON.stringify(q).includes("9100000001"),
    "W2: the welcome draft keeps the owner's link; the model gets the first name, never the surname or phone", w);
  g.__FAKE_AI__ = () => reply([text(JSON.stringify({ text: "Hi Asha! Welcome. Get 20% off this week!\n— Team Perfect Study Space" }))]);
  const bad = await write({ kind: "welcome" });
  check(bad.status === 422, "W3: a draft that drops the link or adds a figure is not shown", bad);
  check(draftKeepsFacts("Hi! You studied 12h 30m. — Team Perfect Study Space", "Total study time: 12h 30m") && !draftKeepsFacts("Hi! You studied 14h. — Team Perfect Study Space", "Total study time: 12h 30m"), "W3: numbers must come from the facts");

  insert("bookings", { student_id: asha.id, branch_id: b1.id, booking_type: "temporary", status: "completed", start_time: new Date(Date.now() - 26 * 3600e3).toISOString(), end_time: new Date(Date.now() - 21 * 3600e3).toISOString(), total_pause_minutes: 30, hours: 6, amount: 0 });
  g.__FAKE_AI__ = (p: any) => reply([text(JSON.stringify({ text: "Great work Asha — 4h 30m this week. Keep going!\n— Team Perfect Study Space" }))]);
  const s = await write({ kind: "study_report" });
  check(s.status === 200 && /Total study time: 4h 30m/.test(fakeAi.requests.at(-1).messages[0].content) && /4h 30m/.test(s.text), "W4: the study summary's figures are worked out by code (5 h − 30 min pause = 4h 30m)", s);
}

await setup();
{
  const sent: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response("{}", { status: 202 }); }) as any;
  resetLiveCache();
  await call("create_enquiry", { branchId: b1.id, name: "Visitor", phone: "9555555555", source: "walk_in" }, tP);
  check(sent.length === 0, "L1: with pssai_realtime off no signal is sent");
  setSetting("pssai_realtime", "on"); resetLiveCache();
  await call("list_students", { branchId: b1.id }, tP);
  const r = await call("create_enquiry", { branchId: b1.id, name: "Visitor Two", phone: "9555555556", source: "walk_in" }, tP);
  check(r.status === 200 && sent.length === 1 && sent[0].url === "http://fake.local/realtime/v1/api/broadcast" && JSON.stringify(sent[0].body) === JSON.stringify({ messages: [{ topic: `branch:${b1.id}`, event: "changed", payload: {} }] }),
    "L1: after a change the branch gets an empty 'changed' signal (reads send none)", sent);
  await call("create_enquiry", { branchId: b1.id, name: "", phone: "1" }, tP);
  check(sent.length === 1, "L1: a refused change sends no signal");
  globalThis.fetch = realFetch;
}

done();
