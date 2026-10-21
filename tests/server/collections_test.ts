// P2.4 A4 — collections against the REAL agent and api functions with a scripted Claude: code ranks
// who to remind; the AI only drafts text; a draft with an amount the code did not give (or without
// the sign-off) is replaced by the template; the Send list and portal notices are written once.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { agent, fakeAi, reply, text } from "./agent-harness.ts";
import { draftIsSafe, rankCandidates } from "../../supabase/functions/agent/collections.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
const g = globalThis as any;
const TODAY = IST_TODAY();
const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const job = () => agent({ job: "collections" }, { cronSecret: "cron-test-secret" });

let b1: any, owner: any, priya: any, tO: string, tP: string, S: Record<string, any> = {};
function member(key: string, end: number, extra: any = {}, churn?: number) {
  const s = insert("students", { name: `${key} Kumar`, phone: `91000000${String(Object.keys(S).length).padStart(2, "0")}`, branch_id: b1.id, status: "active" });
  insert("memberships", { student_id: s.id, branch_id: b1.id, category: "temporary", hours_per_day: 6, start_date: addDays(TODAY, end - 30), end_date: addDays(TODAY, end), monthly_fee: 1250, fee_due: 0, is_active: true, is_paused: false, ...extra });
  if (churn != null) insert("student_scores", { student_id: s.id, model: "churn", version: "v1", score: churn });
  S[key] = s;
  return s;
}
async function setup() {
  reset(); fakeAi.reset(); S = {};
  Deno.env.set("AI_API_KEY", "test-ai-key");
  b1 = insert("branches", { name: "Hopes", is_active: true });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null, created_at: "2020-01-01T00:00:00Z" });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  [tO, tP] = await Promise.all([owner, priya].map((s) => tokenFor(s)));
  member("Asha", 2, {}, 0.8);                 // ends in 2 days, likely to leave
  member("Bala", 20, { fee_due: 600 });        // dues only
  member("Chitra", 25);                        // nothing to say
  member("Deepa", -4);                         // in grace
  member("Ezhil", -20);                        // lapsed beyond grace, no dues: win-back is Phase 3
  member("Farah", 1);                          // reminded yesterday
  insert("send_list", { list_date: addDays(TODAY, -1), branch_id: b1.id, student_id: S.Farah.id, reason: "x", message: "m", status: "sent" });
}

await setup();
{
  const ranked = await rankCandidates(adminClient(), TODAY);
  check(JSON.stringify(ranked.map((c) => c.firstName)) === JSON.stringify(["Asha", "Deepa", "Bala"]), "K1: code ranks Asha (ends in 2 days, churn 0.8), Deepa (in grace), Bala (dues) — not Chitra, Ezhil or Farah (reminded yesterday)", ranked.map((c) => [c.firstName, c.priority]));
  check(ranked[0].reason === "Plan ends in 2 days" && ranked[1].reason === "Plan ended 4 days ago" && ranked[2].reason === "₹600 due", "K1: each has a plain reason", ranked.map((c) => c.reason));
  const c = ranked[2];
  check(draftIsSafe("Hi Bala, ₹600 is due. — Team Perfect Study Space", c) && !draftIsSafe("Hi Bala, pay ₹500 now. — Team Perfect Study Space", c) && !draftIsSafe("Hi Bala, ₹600 is due.", c) && !draftIsSafe("Hi Bala, renew now and get a discount! — Team Perfect Study Space", c),
    "K1: a draft passes only with the given amounts, the sign-off and no offers");

  setSetting("pssai_collections", "off");
  check((await job()).skipped === "pssai_collections is off", "K2: with pssai_collections off the job does nothing");
  setSetting("pssai_collections", "on");
  g.__FAKE_AI__ = () => reply([text(JSON.stringify({ messages: [
    { i: 0, text: "Hi Asha, your plan at Perfect Study Space ends in 2 days. Renew at the desk to keep your seat.\n— Team Perfect Study Space" },
    { i: 1, text: "Hi Deepa, your plan ended. Come back soon!" },
    { i: 2, text: "Hi Bala, please pay ₹500 today.\n— Team Perfect Study Space" },
  ] }))]);
  const r = await job();
  const list = rows("send_list").filter((x) => x.list_date === TODAY);
  const by = (k: string) => list.find((x) => x.student_id === S[k].id);
  check(r.ok && r.listed === 3 && r.drafted === 1 && list.length === 3, "K2: three people are listed; one AI draft passed the checks", r);
  check(/ends in 2 days/.test(by("Asha").message) && /ended on/.test(by("Deepa").message) && /₹600 due/.test(by("Bala").message) && !/₹500/.test(by("Bala").message),
    "K2: Deepa's draft (no sign-off) and Bala's draft (wrong amount) were replaced by the template", list.map((x) => x.message));
  const sent = JSON.stringify(fakeAi.requests[0]);
  check(sent.includes("Asha") && !sent.includes("Kumar") && !/9100000\d{3}/.test(sent) && fakeAi.requests[0].model === "claude-haiku-5-5", "K2: the model gets first names and amounts only — no surnames, no phone numbers");
  check(rows("portal_notifications").filter((n) => n.kind === "renewal_reminder").length === 3, "K2: each listed student gets a portal notice");
  const ev = rows("events").find((e) => e.action === "save_send_list");
  check(ev?.actor_type === "agent" && rows("agent_runs")[0].agent === "collections", "K2: the list is saved by the agent through save_send_list, and the run is logged");
  const again = await job();
  check(again.listed === 0 && rows("send_list").filter((x) => x.list_date === TODAY).length === 3 && rows("portal_notifications").length === 3, "K2: running again the same day adds nothing", again);

  const staffList = await call("list_send_list", {}, tP);
  const ownerList = await call("list_send_list", {}, tO);
  check(staffList.status === 403 && ownerList.rows.length === 3 && ownerList.rows[0].name && ownerList.rows[0].phone, "K3: the owner's Send list has name, phone, reason and message; staff can't see it", ownerList.rows?.[0]);
  const upd = await call("update_send_list_item", { id: by("Asha").id, status: "sent", message: "Edited text" }, tO);
  check(upd.status === 200 && by("Asha").status === "sent" && by("Asha").message === "Edited text" && by("Asha").handled_by_staff_id === owner.id, "K3: the owner marks a message sent (and can edit it)", by("Asha"));
  check((await call("save_send_list", { listDate: TODAY, rows: [] }, tO)).status === 400, "K3: the agent-only save is closed to people");
}
await setup();
{
  setSetting("pssai_collections", "on");
  Deno.env.delete("AI_API_KEY");
  const r = await job();
  check(r.listed === 3 && r.drafted === 0 && fakeAi.requests.length === 0 && rows("send_list").filter((x) => x.list_date === TODAY).every((x) => x.message.includes("— Team Perfect Study Space")), "K4: without AI the list still goes out, with the plain template", r);
  Deno.env.set("AI_API_KEY", "test-ai-key");
}

done();
