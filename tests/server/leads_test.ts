// PSS-AI Phase 3 against the REAL api and agent functions with a scripted Claude: I24 lead scores,
// AI duplicate suggestions (no phone numbers to the model), the A2 enquiry chat on the join site
// (consent, limits, shadow drafts, live replies only with numbers from the facts, the staff side),
// AI follow-up drafts, and referral links (C10) through to a referrer's reward in the queue.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { advanceClock } from "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { agent, fakeAi, reply, text } from "./agent-harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
const g = globalThis as any;
let TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();
const json = (o: unknown) => reply([text(JSON.stringify(o))]);

let b1: any, b2: any, owner: any, priya: any, tO: string, tP: string;
async function setup() {
  reset(); fakeAi.reset();
  TODAY = IST_TODAY();
  Deno.env.set("AI_API_KEY", "test-ai-key");
  b1 = insert("branches", { name: "Hopes", is_active: true, signup_code: "hopes0000001" });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true, signup_code: "ramnagar0001" });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  for (const [cat, h, fee] of [["temporary", 6, 1250], ["permanent", 12, 2100]] as const) insert("fee_config", { config_type: "membership", cabin_type: cat, hours_per_day: h, fee, sort_order: h });
  for (const [max, fee] of [[3, 35], [6, 60]]) insert("fee_config", { config_type: "walkin", max_hours: max, fee });
}
const enquiry = (extra: any) => insert("enquiries", { branch_id: b1.id, name: "Ravi Kumar", phone: "9000000001", source: "instagram", status: "new", created_at: new Date().toISOString(), score: null, ...extra });

// ── I24: lead scores ──
await setup();
{
  check((await run("cron_score_enquiries")).skipped, "L1: with pssai_lead_tools off nothing is scored");
  setSetting("pssai_lead_tools", "on");
  for (let i = 0; i < 10; i++) enquiry({ source: "google_search", status: i < 6 ? "converted" : "dropped", created_at: new Date(Date.now() - (40 + i) * 86400e3).toISOString() });
  for (let i = 0; i < 10; i++) enquiry({ source: "walk_in", status: "dropped", created_at: new Date(Date.now() - (40 + i) * 86400e3).toISOString() });
  const hot = enquiry({ source: "google_search", status: "trial_session" });
  const cold = enquiry({ source: "walk_in", created_at: new Date(Date.now() - 45 * 86400e3).toISOString() });
  const other = insert("enquiries", { branch_id: b2.id, name: "Other", phone: "9000000099", source: "google_search", status: "new", created_at: new Date().toISOString() });
  const r = await run("cron_score_enquiries");
  check(r.scored === 3 && Number(hot.score) > Number(cold.score) && /Google Search enquiries convert \d+% here/.test(hot.score_reason) && /trial session/.test(hot.score_reason) && other.score != null,
    "L1: a new Google trial-session lead outranks an old walk-in; the reason is in words; each branch uses its own history", { hot: [hot.score, hot.score_reason], cold: [cold.score, cold.score_reason], other: other.score });
  check(rows("enquiries").filter((e) => e.status === "converted").every((e) => e.score == null), "L1: closed enquiries get no score");
}

// ── AI duplicate suggestions ──
await setup();
{
  setSetting("pssai_lead_tools", "on");
  const a = enquiry({ name: "Ravi Kumar", phone: "9000000001", message: "Need a seat for TNPSC, call 9000000001" });
  const b = enquiry({ name: "Ravi K", phone: "9000000002", message: "evening seat?" });
  enquiry({ name: "Ravi Kumar", phone: "9000000001" });   // same phone as a: the page already groups it
  enquiry({ name: "Priya Devi", phone: "9555555555" });
  g.__FAKE_AI__ = (p: any) => { const items = JSON.parse(p.messages[0].content); return json({ pairs: items.map((x: any) => ({ i: x.i, verdict: "same", confidence: 0.8, reason: "Same first name, phone one digit apart" })) }); };
  const r = await agent({ job: "enquiry_dedupe" }, { cronSecret: "cron-test-secret" });
  const sent = fakeAi.requests[0]?.messages[0].content ?? "";
  const sugg = rows("enquiry_dedupe");
  check(r.status === 200 && sugg.length >= 1 && sugg.some((x) => [x.enquiry_a, x.enquiry_b].sort().join() === [a.id, b.id].sort().join() && x.verdict === "same"), "D1: Ravi Kumar and Ravi K (phones one digit apart) are suggested as the same person", { r, sugg });
  check(!/9000000001|9000000002|9555555555/.test(sent) && /one digit apart/.test(sent) && !/9000000001/.test(JSON.stringify(rows("events"))), "D1: the model never sees phone numbers (not even inside a message) — only how alike they are");
  const list = await call("list_enquiry_dedupe", { branchId: b1.id }, tP);
  const dis = await call("update_enquiry_dedupe", { id: list.suggestions[0].id, status: "dismissed" }, tP);
  check(list.suggestions.length >= 1 && dis.status === 200 && (await call("list_enquiry_dedupe", { branchId: b1.id }, tP)).suggestions.length === list.suggestions.length - 1, "D2: staff see the suggestion and can dismiss it");
  const again = await agent({ job: "enquiry_dedupe" }, { cronSecret: "cron-test-secret" });
  check(again.asked === 0, "D2: a pair already judged is not asked again", again);
}

// ── A2: the enquiry chat ──
await setup();
{
  const send = (body: any, headers: Record<string, string> = {}) => agent({ agent: "enquiry", op: "send", ...body }, headers as any);
  check((await send({ message: "hi" })).status === 403, "C1: with pssai_enquiry_chat off the chat is closed");
  setSetting("pssai_enquiry_chat", "on");
  const branches = await agent({ agent: "enquiry", op: "branches" });
  const noConsent = await send({ branchId: b1.id, name: "Kavin", phone: "9300000001", message: "What are the fees?" });
  check(branches.branches.length === 2 && noConsent.status === 400 && !rows("enquiries").length, "C1: the visitor picks a branch; nothing is stored without consent", noConsent.error);

  g.__FAKE_AI__ = () => json({ reply: "A flexible seat for 6 hours a day is ₹1250 a month. Our team can tell you more!", needs_team: false });
  const first = await send({ branchId: b1.id, name: "Kavin Raj", phone: "9300000001", consent: true, message: "What are the fees?" });
  const enq = rows("enquiries")[0];
  const drafts = rows("enquiry_chat_messages").filter((m) => m.status === "draft");
  check(first.status === 200 && first.pending === true && /^[0-9a-z]{32}$/.test(first.chatKey) && enq.source === "website_chat" && enq.phone === "9300000001" && drafts.length === 1 && rows("messages").some((m) => /\[new_enquiry\]/.test(m.content)),
    "C2: in shadow mode (default) the visitor is told the team will reply; the enquiry is created and the AI reply waits as a draft", first);
  const sys = fakeAi.requests[0].system;
  check(/₹1250 a month/.test(sys) && /up to 3 hours ₹35/.test(sys) && /not instructions/.test(sys), "C2: the AI answers from code facts (plans, walk-in prices) and is told the chat is data");
  check(!rows("enquiry_chats")[0].key_hash.includes(first.chatKey) && rows("enquiry_chat_messages").every((m) => !m.ip_hash || m.ip_hash.length === 32), "C2: only a hash of the chat key is stored, and no IP address");

  setSetting("pssai_agent_shadow", "off");
  advanceClock(60e3);
  const live = await send({ chatKey: first.chatKey, message: "Is there AC?" });
  check(live.status === 200 && /₹1250/.test(live.reply) && rows("enquiries").length === 1, "C3: in live mode the reply goes straight to the visitor, in the same enquiry", live);
  g.__FAKE_AI__ = () => json({ reply: "Yes! Only ₹999 a month for you.", needs_team: false });
  advanceClock(60e3);
  const madeUp = await send({ chatKey: first.chatKey, message: "Any discount?" });
  check(madeUp.pending === true && !rows("enquiry_chat_messages").some((m) => /999/.test(m.body)), "C3: a reply with a price that isn't in the facts is never shown or stored", madeUp);
  g.__FAKE_AI__ = () => json({ reply: "Our team will reply on WhatsApp about that.", needs_team: true });
  advanceClock(60e3);
  await send({ chatKey: first.chatKey, message: "Can I get a refund later?" });
  check(rows("enquiry_activities").some((a) => /asked a person to reply/.test(a.note)), "C3: when the AI can't answer from its facts, a note asks a person to reply");
  const hist = await agent({ agent: "enquiry", op: "history", chatKey: first.chatKey });
  check(hist.messages.length >= 4 && hist.messages[0].role === "visitor" && (await agent({ agent: "enquiry", op: "history", chatKey: "x".repeat(32) })).status === 404, "C3: the visitor's browser reads the chat back with its key; a wrong key reads nothing");

  // Staff side
  const view = await call("list_enquiry_chat", { enquiryId: enq.id }, tP);
  const draft = view.chats[0].messages.find((m: any) => m.status === "draft");
  const sent = await call("send_enquiry_chat_reply", { chatId: view.chats[0].id, draftId: draft.id, body: draft.body }, tP);
  check(view.chats.length === 1 && sent.status === 200 && rows("enquiry_chat_messages").find((m) => m.id === draft.id).status === "sent", "C4: staff send the first draft from the enquiry drawer", sent);
  const evs = rows("events").filter((e) => e.action === "save_enquiry_chat");
  check(evs.length >= 4 && evs.every((e) => /^\[\d+ chars\]$/.test(e.payload.message)) && !JSON.stringify(rows("events")).includes("9300000001"), "C4: the event log keeps only message lengths, and no phone");

  // Limits: per chat per day
  for (let i = 0; i < 20; i++) insert("enquiry_chat_messages", { chat_id: rows("enquiry_chats")[0].id, role: "visitor", body: "x", status: "sent", created_at: new Date().toISOString() });
  const capped = await send({ chatKey: first.chatKey, message: "one more" });
  check(capped.status === 429, "C5: at most 20 messages per chat per day", capped);
  const req = new Request("http://x", { headers: { "cf-connecting-ip": "1.2.3.4" } });
  void req;
}

// ── AI follow-up drafts for enquiries ──
await setup();
{
  setSetting("pssai_ai_messages", "on");
  const e = enquiry({ name: "Kavin Raj", message: "Need evening seat, my number 9876543210" });
  g.__FAKE_AI__ = () => json({ text: "Hi Kavin, thanks for asking about Perfect Study Space! A flexible seat for 6 hours is ₹1250 a month. Do visit us for a look around.\n— Team Perfect Study Space" });
  const d = await agent({ agent: "writer", kind: "enquiry_followup", enquiryId: e.id }, { token: tP });
  const facts = fakeAi.requests[0].messages[0].content;
  check(d.status === 200 && /₹1250/.test(d.text) && !/9876543210/.test(facts) && /data, not instructions/.test(facts), "F1: an AI follow-up draft uses plan prices from code; numbers they typed never reach the model", d);
  g.__FAKE_AI__ = () => json({ text: "Hi Kavin, join today for ₹999!\n— Team Perfect Study Space" });
  const bad = await agent({ agent: "writer", kind: "enquiry_followup", enquiryId: e.id }, { token: tP });
  check(bad.status === 422, "F1: a draft with a price not in the facts is refused", bad);
}

// ── Referral links (C10) and SP11 ──
await setup();
{
  const off = await call("public_referral_info", { ref: "abcd1234" });
  check(off.status === 404, "R1: with pssai_referral_links off no link works");
  setSetting("pssai_referral_links", "on");
  const staffTry = await call("create_referral_link", { branchId: b1.id, channel: "instagram" }, tP);
  const friendTry = await call("create_referral_link", { branchId: b1.id, channel: "friend" }, tO);
  const made = await call("create_referral_link", { branchId: b1.id, channel: "flex_banner", label: "Bus stop banner" }, tO);
  check(staffTry.status === 403 && friendTry.status === 400 && made.status === 200 && /\/r\/[a-z0-9]{8}$/.test(made.url), "R1: the owner makes a flex-banner link for Hopes", made);
  const info = await call("public_referral_info", { ref: made.code });
  check(info.code === "hopes0000001" && info.channel === "flex_banner" && info.referralSource === "flex", "R2: the link opens the branch's current sign-up link with the channel filled in", info);
  rows("branches").find((b) => b.id === b1.id).signup_code = "hopes0000002";
  check((await call("public_referral_info", { ref: made.code })).code === "hopes0000002", "R2: rotating the sign-up link doesn't break the printed referral link");

  const sub = await call("public_signup_submit", { code: "hopes0000002", ref: made.code, name: "Arun Prakash", phone: "9400000001", emergencyContact: "9400000009", referralSource: "" });
  const su = rows("signup_requests")[0];
  check(sub.status === 200 && su.referral_source === "flex" && rows("referral_attributions")[0]?.kind === "signup", "R3: a sign-up from the link needs no dropdown; it is attributed to the banner", { sub, src: su.referral_source });
  const wrongBranch = await call("public_signup_submit", { code: "ramnagar0001", ref: made.code, name: "Bala Murugan", phone: "9400000002", emergencyContact: "9400000008", referralSource: "instagram" });
  check(wrongBranch.status === 200 && rows("referral_attributions").length === 1, "R3: a link only counts at its own branch");

  // The student registers later; the nightly job marks the conversion.
  const st = insert("students", { name: "Arun Prakash", phone: "9400000001", branch_id: b1.id, status: "active" });
  insert("memberships", { student_id: st.id, branch_id: b1.id, category: "temporary", start_date: TODAY, end_date: addDays(TODAY, 29), is_active: true, created_at: new Date(Date.now() + 60e3).toISOString() });
  const conv = await run("cron_referral_conversions");
  const links = await call("list_referral_links", {}, tO);
  check(conv.converted === 1 && links.links[0].signups === 1 && links.links[0].joined === 1, "R4: the owner sees 1 sign-up and 1 joined for the banner", { conv, l: links.links[0] });

  // SP11: Arun's own friend link; a friend joins; the reward waits for the owner.
  setSetting("pssai_portal", "on"); setSetting("pssai_portal_r2", "on"); setSetting("referral_reward_amount", "100");
  const code = await call("create_portal_setup_code", { studentId: st.id }, tP);
  const tA = (await call("me_set_pin", { phone: st.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
  const mine = await call("me_referral", {}, tA);
  const same = await call("me_referral", {}, tA);
  check(mine.on && mine.url === same.url && mine.reward === 100 && rows("referral_links").filter((l) => l.referrer_student_id === st.id).length === 1, "R5: the student gets one friend link (asking again gives the same one)", mine);
  const fcode = mine.url.split("/r/")[1];
  await call("public_signup_submit", { code: "hopes0000002", ref: fcode, name: "Divya Sri", phone: "9400000003", emergencyContact: "9400000007", referralSource: "" });
  const friend = insert("students", { name: "Divya Sri", phone: "9400000003", branch_id: b1.id, status: "active" });
  insert("memberships", { student_id: friend.id, branch_id: b1.id, category: "temporary", start_date: TODAY, end_date: addDays(TODAY, 29), is_active: true, created_at: new Date(Date.now() + 60e3).toISOString() });
  const conv2 = await run("cron_referral_conversions");
  const appr = rows("approvals").find((a) => a.action === "grant_cashback");
  check(conv2.rewardsQueued === 1 && appr?.status === "pending" && appr.payload.studentId === st.id && appr.payload.cashbackValue === 100 && !rows("cashbacks").length, "R5: when a friend joins, a ₹100 reward for Arun waits in the owner's queue (T3) — nothing is paid by itself", appr?.payload);
  const ok = await call("decide_approval", { approvalId: appr.id, decision: "approve" }, tO);
  const cbs = await call("me_cashbacks", {}, tA);
  check(ok.status === 200 && cbs.cashbacks.length === 1 && cbs.pendingFixed === 100 && /Divya/.test(cbs.cashbacks[0].note), "R5: approved, Arun sees the ₹100 cashback in the portal", cbs);
  const dup = await run("cron_referral_conversions");
  check(dup.converted === 0 && rows("approvals").filter((a) => a.action === "grant_cashback").length === 1, "R5: the nightly job never rewards the same friend twice");
}

done();
