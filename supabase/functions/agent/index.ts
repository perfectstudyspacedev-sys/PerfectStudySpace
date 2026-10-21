// The agent edge function (PSS-AI P1.8 onwards): the Claude-backed agents. Three kinds of caller:
//  - the owner's app: { agent: "analyst", question, history?, deep? } with an owner or admin staff
//    token ({ agent: "analyst", op: "usage" } returns this month's AI spend);
//  - the student portal (P2.4 A1): { agent: "concierge", message } with a student token;
//  - pg_cron through pg_net: { job: "owner_brief" } with the x-cron-secret header (the same
//    CRON_SECRET as the cron function), at 07:00 IST — see docs/ops/cron.sql.
// Every run needs its switch on (pssai_analyst), the AI_API_KEY secret, and room in the monthly
// AI budget (pssai_ai_budget_usd). The key never leaves this function.
// deno-lint-ignore-file no-explicit-any
import { err, json, sameSecret, withCors } from "../_shared/http.ts";
import { adminClient, authStaff, isOwnerOrAdmin, type StaffRow } from "../_shared/auth.ts";
import { featureOn } from "../_shared/flags.ts";
import { todayISO } from "../_shared/dates.ts";
import { aiClient, MODELS, monthSpend } from "../_shared/ai.ts";
import { askAnalyst, writeOwnerBrief } from "./analyst.ts";
import { answerStudent, DAILY_LIMIT, studentMessagesToday } from "./concierge.ts";
import { runCollections } from "./collections.ts";
import { draftMessage } from "./writer.ts";
import { authStudent } from "../_shared/student.ts";
import { REGISTRY } from "../api/actions.ts";
import { runAction } from "../api/run.ts";

const MAX_QUESTION = 2000;
const MAX_HISTORY = 10;     // earlier turns sent back with a question
const MAX_TURN = 4000;      // characters per earlier turn

Deno.serve(async (req) => withCors(req, await handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null);
  if (req.method !== "POST") return err("Use POST", 405);
  if (req.headers.has("x-cron-secret")) return await handleJob(req);
  try {
    const body = await req.json().catch(() => null);
    if (body?.agent === "concierge") return await handleConcierge(req, body);
    const staff = await authStaff(req);
    if (!staff) return err("Unauthorized", 401);
    if (body?.agent === "writer") {
      // P2.5: AI-drafted welcome / study-report messages for any staff member, for their branch.
      const db = adminClient();
      if (!(await featureOn(db, "ai_messages"))) return err("AI-drafted messages are switched off (pssai_ai_messages)", 403);
      const r = await draftMessage(db, staff, body);
      return "error" in r ? err(r.error, r.status ?? 400) : json(r);
    }
    if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
    if (body?.agent !== "analyst") return err("Unknown agent");
    const db = adminClient();
    if (!(await featureOn(db, "analyst"))) return err("The owner analyst is switched off (pssai_analyst)", 403);
    if (body.op === "usage") return json(await monthSpend(db));

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > MAX_QUESTION) return err(`Ask a question of up to ${MAX_QUESTION} characters`);
    const history = parseHistory(body.history);
    if (!history) return err("Invalid chat history");
    const client = aiClient();
    if (!client) return err("AI is not set up yet: the AI_API_KEY secret is missing", 503);
    const budget = await monthSpend(db);
    if (budget.usedUsd >= budget.capUsd) return err(`This month's AI budget ($${budget.capUsd}) is used up. The owner can raise pssai_ai_budget_usd.`, 429);

    const model = body.deep === true ? MODELS.hard() : MODELS.routine();
    const answer = await askAnalyst({ db, client, model, owner: staff, staffId: staff.id, question, history });
    return json({ ...answer, budget: { usedUsd: budget.usedUsd + answer.costUsd, capUsd: budget.capUsd } });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
}

// A1: the student's message is stored first (so the desk sees it whatever happens), then the
// concierge answers. Without the key or budget, or when the AI fails, the message simply waits
// for a person. In shadow mode the reply is a draft and the student is told the team will reply.
async function handleConcierge(req: Request, body: any): Promise<Response> {
  const db = adminClient();
  if (!(await featureOn(db, "portal"))) return err("The student portal is not open yet", 403);
  const student = await authStudent(req, db);
  if (!student) return err("Unauthorized", 401);
  if (!(await featureOn(db, "concierge"))) return err("The chat assistant is switched off", 403);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 1000) return err("Write a message of up to 1,000 characters");
  if ((await studentMessagesToday(db, student.id)) >= DAILY_LIMIT) return err(`That's ${DAILY_LIMIT} messages today — please ask at the desk, or write again tomorrow`, 429);
  const sent = await runAction(REGISTRY.get("me_chat_send")!, { db, req, action: "me_chat_send", student, actor: { type: "student", id: student.id } }, { body: message });
  const saved = await sent.json().catch(() => null);
  if (sent.status >= 400 || !saved?.id) return err(saved?.error ?? "Could not send the message", 500);
  const waiting = { pending: true, message: "Thanks! The team will reply here soon." };
  const client = aiClient();
  if (!client) return json(waiting);
  const budget = await monthSpend(db);
  if (budget.usedUsd >= budget.capUsd) return json(waiting);
  const { data: shadowRow } = await db.from("app_settings").select("value").eq("key", "pssai_agent_shadow").maybeSingle();
  const shadow = shadowRow?.value !== "off";
  const r = await answerStudent({ db, client, model: MODELS.routine(), student, messageId: saved.id, shadow });
  return json(r.answered ? { reply: r.reply } : waiting);
}

// Earlier turns of the chat, as plain text: user and assistant in turn, starting with the user
// and ending with an answer (the new question follows). Anything else is refused.
function parseHistory(raw: unknown): { role: "user" | "assistant"; text: string }[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_HISTORY || raw.length % 2 !== 0) return null;
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const [i, turn] of raw.entries()) {
    const role = i % 2 === 0 ? "user" : "assistant";
    if (!turn || turn.role !== role || typeof turn.text !== "string") return null;
    const text = turn.text.trim();
    if (!text || text.length > MAX_TURN) return null;
    out.push({ role, text });
  }
  return out;
}

// pg_cron jobs. A skipped job answers 200 with the reason, so the pg_net log says why.
async function handleJob(req: Request): Promise<Response> {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret) return err("CRON_SECRET is not set", 500);
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", secret)) return err("Unauthorized", 401);
  try {
    const body = await req.json().catch(() => ({}));
    const db = adminClient();
    if (body?.job === "collections") {
      // A4: works without AI too (plain messages); the switch is the only gate.
      if (!(await featureOn(db, "collections"))) return json({ skipped: "pssai_collections is off" });
      const owner = await ownerScope(db);
      if (!owner) return err("No active owner account", 500);
      return json(await runCollections(db, owner));
    }
    if (body?.job !== "owner_brief") return err(`Unknown job: ${body?.job}`);
    if (!(await featureOn(db, "analyst"))) return json({ skipped: "pssai_analyst is off" });
    const client = aiClient();
    if (!client) return json({ skipped: "AI_API_KEY is not set" });
    const { data: existing } = await db.from("owner_briefs").select("brief_date").eq("brief_date", todayISO()).maybeSingle();
    if (existing && body.force !== true) return json({ skipped: "today's brief is already written" });
    const budget = await monthSpend(db);
    if (budget.usedUsd >= budget.capUsd) return json({ skipped: "this month's AI budget is used up" });
    const owner = await ownerScope(db);
    if (!owner) return err("No active owner account", 500);
    return json(await writeOwnerBrief({ db, client, model: MODELS.routine(), owner }));
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
}

// The brief reads with the owner's scope (every branch); the actor is still the agent.
async function ownerScope(db: ReturnType<typeof adminClient>): Promise<StaffRow | null> {
  const { data } = await db.from("staff").select("id, username, role, display_name, branch_id, is_active")
    .eq("role", "owner").eq("is_active", true).order("created_at").limit(1).maybeSingle();
  if (!data) return null;
  return { ...data, homeBranchId: data.branch_id, isOverrideToday: false };
}
