// AI calls for the PSS-AI agents (P1.8 onwards, Appendix F). Claude is called only from edge
// functions; the key lives in Supabase secrets (AI_API_KEY) and never reaches the browser (R7).
// Every run is one agent_runs row (057) with its token counts and estimated cost, and the monthly
// budget (app_settings pssai_ai_budget_usd) is checked before a run starts. Tool calls go through
// the action registry, so each one writes an events row with the run's id (Appendix F rules 1–2).
// deno-lint-ignore-file no-explicit-any
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { istDayStart, todayISO } from "./dates.ts";
import { isSecretKey } from "./audit.ts";

type Db = { from: (table: string) => any };

// D3: Claude Haiku 5.5 for routine work, Claude Sonnet 5.5 for hard cases and screenshots.
// AI_MODEL / AI_MODEL_HARD (Supabase secrets) replace them without a deploy.
export const MODELS = {
  routine: () => Deno.env.get("AI_MODEL")?.trim() || "claude-haiku-5-5",
  hard: () => Deno.env.get("AI_MODEL_HARD")?.trim() || "claude-sonnet-5-5",
};

/** The Claude client, or null when AI_API_KEY is not set (every agent then says it is not set up). */
export function aiClient(): Anthropic | null {
  const apiKey = Deno.env.get("AI_API_KEY")?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
}

// ── Cost ──
// US dollars per million tokens. Cache reads cost a tenth of the input price and cache writes
// 1.25 times it. Claude Haiku 5.5 charges more when one request's prompt is over 100K tokens.
// A model not listed here is counted at a high price, so the budget errs on the safe side.
type Price = { in: number; out: number };
const PRICES: Record<string, Price & { over?: Price & { tokens: number } }> = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, over: { tokens: 100_000, in: 0.50, out: 2.50 } },
  "claude-sonnet-5-5": { in: 2, out: 10 },
};
const UNKNOWN_PRICE: Price = { in: 10, out: 50 };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Estimated cost of one model call, in US dollars. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const rate: Price = !p ? UNKNOWN_PRICE : p.over && u.input_tokens + read + write > p.over.tokens ? p.over : p;
  return (u.input_tokens * rate.in + write * rate.in * 1.25 + read * rate.in * 0.1 + u.output_tokens * rate.out) / 1e6;
}

// ── Monthly budget (D3) ──
export const BUDGET_KEY = "pssai_ai_budget_usd";
export const BUDGET_DEFAULT_USD = 10;

/** This IST month's AI spend so far and the owner's cap. */
export async function monthSpend(db: Db): Promise<{ usedUsd: number; capUsd: number }> {
  const since = istDayStart(`${todayISO().slice(0, 7)}-01`);
  const { data: setting } = await db.from("app_settings").select("value").eq("key", BUDGET_KEY).maybeSingle();
  const cap = Number(setting?.value);
  let used = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("agent_runs").select("id, cost_usd").gte("started_at", since)
      .order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) used += Number(r.cost_usd) || 0;
    if (!data || data.length < 1000) break;
  }
  return { usedUsd: Math.round(used * 10000) / 10000, capUsd: Number.isFinite(cap) && cap >= 0 ? cap : BUDGET_DEFAULT_USD };
}

// ── Run log (agent_runs) ──
export interface RunTotals {
  tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number;
  modelCalls: number; toolCalls: number; costUsd: number;
}
export const emptyTotals = (): RunTotals => ({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, modelCalls: 0, toolCalls: 0, costUsd: 0 });
export type RunStatus = "ok" | "refused" | "cut_short" | "error";

export async function startRun(db: Db, row: { agent: string; model: string; staffId?: string | null; studentId?: string | null }): Promise<string> {
  const { data, error } = await db.from("agent_runs")
    .insert({ agent: row.agent, model: row.model, staff_id: row.staffId ?? null, student_id: row.studentId ?? null, status: "running" })
    .select("id").single();
  if (error || !data?.id) throw new Error(`Could not start the run (is migration 057 applied?): ${error?.message ?? "no id"}`);
  return data.id;
}

export async function finishRun(db: Db, id: string, status: RunStatus, t: RunTotals, error?: string) {
  const { error: e } = await db.from("agent_runs").update({
    status, finished_at: new Date().toISOString(),
    tokens_in: t.tokensIn, tokens_out: t.tokensOut, cache_read_tokens: t.cacheRead, cache_write_tokens: t.cacheWrite,
    model_calls: t.modelCalls, tool_calls: t.toolCalls, cost_usd: Math.round(t.costUsd * 1e6) / 1e6,
    error: error ? error.slice(0, 500) : null,
  }).eq("id", id);
  if (e) console.error("agent_runs update failed:", e.message);
}

// ── What a tool result may show the model ──
// Contact details and identity documents never go into a prompt (R11); the agents work from
// names, figures and dates. Long lists are cut so one tool call cannot flood the context.
const PERSONAL = /phone|mobile|whatsapp|email|address|aadha?ar|id_?(number|proof|no)\b|dob|birth/i;
export function stripPersonal(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (Array.isArray(value)) return value.map((v) => stripPersonal(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (PERSONAL.test(k) || isSecretKey(k)) continue;
      out[k] = stripPersonal(v, depth + 1);
    }
    return out;
  }
  return value;
}

function capArrays(value: unknown, n: number): unknown {
  if (Array.isArray(value)) {
    const kept = value.slice(0, n).map((v) => capArrays(v, n));
    return value.length > n ? [...kept, { note: `${value.length - n} more items not shown — ask for a narrower date range or one branch` }] : kept;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, capArrays(v, n)]));
  }
  return value;
}

/** JSON for the model, at most maxChars long: long lists are shortened first, then the text is cut. */
export function compactJson(value: unknown, maxChars = 12_000): string {
  let text = JSON.stringify(value) ?? "null";
  for (let n = 200; text.length > maxChars && n >= 3; n = Math.floor(n / 2)) text = JSON.stringify(capArrays(value, n));
  return text.length > maxChars ? `${text.slice(0, maxChars)} …[cut: result too long]` : text;
}

// ── The tool loop ──
export interface AgentTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  run: (input: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
}
export interface LoopResult {
  text: string;
  stop: "done" | "refused" | "cut_short" | "error";
  error?: string;               // set when stop is "error": the AI service failed
  toolCalls: { name: string; ok: boolean }[];
  totals: RunTotals;
}

/** A short, key-free description of a failed AI call. */
export function describeAiError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const message = e instanceof Error ? e.message : String(e);
  return `${status ? `HTTP ${status}: ` : ""}${message}`.slice(0, 300);
}

// Runs Claude with the given tools until it answers, refuses, or hits the step or time limit
// (Appendix F rule 9). Tool errors go back to the model as is_error results; parallel tool calls
// are answered together in one message. Thinking blocks are passed back unchanged. A failed AI
// call ends the loop with stop "error" and the totals so far, so the run's cost is still logged.
export async function toolLoop(opts: {
  client: Anthropic; model: string; system: string; messages: Anthropic.MessageParam[];
  tools: AgentTool[]; maxModelCalls?: number; maxTokens?: number; deadlineMs?: number;
}): Promise<LoopResult> {
  const { client, model, system, tools } = opts;
  const messages = [...opts.messages];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const defs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const totals = emptyTotals();
  const toolCalls: { name: string; ok: boolean }[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 100_000);
  let lastText = "";

  for (let i = 0; i < (opts.maxModelCalls ?? 8); i++) {
    if (Date.now() > deadline) break;
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 4000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: defs as Anthropic.Tool[],
        messages,
      });
    } catch (e) {
      return { text: lastText, stop: "error", error: describeAiError(e), toolCalls, totals };
    }
    totals.modelCalls++;
    totals.tokensIn += response.usage.input_tokens;
    totals.tokensOut += response.usage.output_tokens;
    totals.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    totals.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    totals.costUsd += costUsd(model, response.usage);

    if (response.stop_reason === "refusal") return { text: "", stop: "refused", toolCalls, totals };
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
    if (text) lastText = text;
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) {
      const done = response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence";
      return { text: lastText, stop: done ? "done" : "cut_short", toolCalls, totals };
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    const results = await Promise.all(uses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
      const tool = byName.get(use.name);
      let out: { ok: boolean; text: string };
      if (!tool) out = { ok: false, text: `Unknown tool ${use.name}` };
      else if (!use.input || typeof use.input !== "object" || Array.isArray(use.input)) out = { ok: false, text: "Tool input must be an object" };
      else {
        try { out = await tool.run(use.input as Record<string, unknown>); }
        catch (e) { out = { ok: false, text: e instanceof Error ? e.message : "Tool failed" }; }
      }
      return { type: "tool_result", tool_use_id: use.id, content: out.text, ...(out.ok ? {} : { is_error: true }) };
    }));
    totals.toolCalls += results.length;
    toolCalls.push(...results.map((r, j) => ({ name: uses[j].name, ok: !r.is_error })));
    messages.push({ role: "user", content: results });
  }
  return { text: lastText, stop: "cut_short", toolCalls, totals };
}
