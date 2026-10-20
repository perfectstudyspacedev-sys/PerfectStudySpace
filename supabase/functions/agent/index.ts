// The agent edge function (PSS-AI P1.8 onwards): the Claude-backed agents. Two kinds of caller:
//  - the owner's app: { agent: "analyst", question, history?, deep? } with an owner or admin staff
//    token ({ agent: "analyst", op: "usage" } returns this month's AI spend);
//  - pg_cron through pg_net: { job: "owner_brief" } with the x-cron-secret header (the same
//    CRON_SECRET as the cron function), at 07:00 IST — see docs/ops/cron.sql.
// Every run needs its switch on (pssai_analyst), the AI_API_KEY secret, and room in the monthly
// AI budget (pssai_ai_budget_usd). The key never leaves this function.
import { err, json, sameSecret, withCors } from "../_shared/http.ts";
import { adminClient, authStaff, isOwnerOrAdmin, type StaffRow } from "../_shared/auth.ts";
import { featureOn } from "../_shared/flags.ts";
import { todayISO } from "../_shared/dates.ts";
import { aiClient, MODELS, monthSpend } from "../_shared/ai.ts";
import { askAnalyst, writeOwnerBrief } from "./analyst.ts";

const MAX_QUESTION = 2000;
const MAX_HISTORY = 10;     // earlier turns sent back with a question
const MAX_TURN = 4000;      // characters per earlier turn

Deno.serve(async (req) => withCors(req, await handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null);
  if (req.method !== "POST") return err("Use POST", 405);
  if (req.headers.has("x-cron-secret")) return await handleJob(req);
  try {
    const staff = await authStaff(req);
    if (!staff) return err("Unauthorized", 401);
    if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
    const body = await req.json().catch(() => null);
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
    if (body?.job !== "owner_brief") return err(`Unknown job: ${body?.job}`);
    const db = adminClient();
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
