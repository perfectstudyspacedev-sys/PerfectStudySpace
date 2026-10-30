// Server-only provider routing. Protocol adapters keep the existing agent tool/approval path.
// Preference: Ollama Cloud -> Gemini -> Claude. Never fall back after a model refusal.
// deno-lint-ignore-file no-explicit-any
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

export type Provider = "ollama" | "gemini" | "claude";
export type Tier = "routine" | "hard";
export interface ProviderAttempt {
  provider: Provider; model: string; status: "ok" | "error" | "skipped"; reason?: string; httpStatus?: number;
}
export interface AIMessage extends Anthropic.Message {
  _pss?: { provider: Provider; model: string; attempts: ProviderAttempt[] };
}
export interface AIClient {
  messages: { create: (params: any) => Promise<AIMessage> };
}
export const AI_SETUP_MESSAGE = "AI is not set up yet: configure OLLAMA_API_KEY, GEMINI_API_KEY or AI_API_KEY in Edge Function secrets";
export const PROVIDER_ORDER: Provider[] = ["ollama", "gemini", "claude"];
const KEY_NAMES: Record<Provider, string> = { ollama: "OLLAMA_API_KEY", gemini: "GEMINI_API_KEY", claude: "AI_API_KEY" };
const DEFAULTS: Record<Provider, Record<Tier, string>> = {
  ollama: { routine: "gemma4:31b", hard: "gpt-oss:120b" },
  gemini: { routine: "gemini-3.8-flash", hard: "gemini-3.8-flash" },
  claude: { routine: "claude-haiku-5-5", hard: "claude-sonnet-5-5" },
};
const MODEL_KEYS: Record<Provider, Record<Tier, string>> = {
  ollama: { routine: "OLLAMA_MODEL", hard: "OLLAMA_MODEL_HARD" },
  gemini: { routine: "GEMINI_MODEL", hard: "GEMINI_MODEL_HARD" },
  claude: { routine: "AI_MODEL", hard: "AI_MODEL_HARD" },
};
// Internal selectors keep the workload tier independent of which provider is available.
export const MODELS = { routine: () => "pss:routine", hard: () => "pss:hard" };
const tierOf = (selector: string): Tier => selector === "pss:hard" ? "hard" : "routine";
const modelValid = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
function configuredModel(provider: Provider, tier: Tier): string {
  return Deno.env.get(MODEL_KEYS[provider][tier])?.trim() || DEFAULTS[provider][tier];
}
export function modelLabel(provider: Provider, model: string): string {
  return provider === "claude" ? model : provider + "/" + model;
}
/** Owner-facing configuration only: never returns credentials or provider response bodies. */
export function providerStatus() {
  return PROVIDER_ORDER.map((provider) => {
    const routine = configuredModel(provider, "routine"), hard = configuredModel(provider, "hard");
    return {
      provider, configured: !!Deno.env.get(KEY_NAMES[provider])?.trim(),
      routine: modelValid(routine) ? routine : "Invalid model configuration",
      hard: modelValid(hard) ? hard : "Invalid model configuration",
      structuredOutputs: provider !== "ollama",
    };
  });
}
export function initialModel(selector: string): string {
  if (!selector.startsWith("pss:")) return selector;
  const p = PROVIDER_ORDER.find((p) => !!Deno.env.get(KEY_NAMES[p])?.trim()) ?? "claude";
  const model = configuredModel(p, tierOf(selector));
  return modelValid(model) ? modelLabel(p, model) : "Invalid model configuration";
}

export class AIRequestError extends Error {
  constructor(message: string, public attempts: ProviderAttempt[], public status?: number) { super(message); }
}
export function attemptsFromError(e: unknown): ProviderAttempt[] {
  return e instanceof AIRequestError ? e.attempts : [];
}
function statusOf(e: any): number | undefined {
  return typeof e?.status === "number" ? e.status : undefined;
}
function safeFailure(e: any, secrets: string[]): string {
  // Provider response bodies can echo prompts, images and credentials. Keep fixed, bounded reasons.
  const status = statusOf(e);
  let text = status ? "HTTP " + status : e?.name === "AbortError" || e?.name === "TimeoutError" ? "Request timed out" : "Provider request failed";
  for (const key of secrets) if (key) text = text.split(key).join("[redacted]");
  return text;
}

async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: any, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body), signal: controller.signal, redirect: "error",
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw Object.assign(new Error("Provider HTTP error"), { status: res.status });
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

// Strip private Gemini history metadata and unsupported prompt caching before another protocol.
// Only fields produced/consumed by the shared tool loop are forwarded.
export function anthropicHistory(messages: any[], cache: boolean): any[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map((b: any) => {
      if (b.type === "text") return { type: "text", text: b.text, ...(cache && b.cache_control ? { cache_control: b.cache_control } : {}) };
      if (b.type === "image") return { type: "image", source: b.source };
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      if (b.type === "tool_result") return { type: "tool_result", tool_use_id: b.tool_use_id, content: b.content, ...(b.is_error ? { is_error: true } : {}) };
      if (cache && (b.type === "thinking" || b.type === "redacted_thinking")) {
        const { _geminiContent: _ignored, ...kept } = b; return kept;
      }
      return null;
    }).filter(Boolean),
  })).filter((m) => typeof m.content === "string" || m.content.length);
}
function systemText(system: any): string {
  return typeof system === "string" ? system : (system ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}
function requestForAnthropic(params: any, model: string, cache: boolean) {
  const system = typeof params.system === "string" ? params.system : (params.system ?? []).map((b: any) =>
    ({ type: "text", text: b.text, ...(cache && b.cache_control ? { cache_control: b.cache_control } : {}) }));
  return {
    model, max_tokens: params.max_tokens, system,
    messages: anthropicHistory(params.messages, cache),
    ...(params.tools?.length ? { tools: params.tools } : {}),
    ...(params.output_config ? { output_config: params.output_config } : {}),
  };
}

/** Native Gemini history keeps each full model response, including opaque thought signatures. */
export function geminiRequest(params: any) {
  const calls = new Map<string, { name: string; nativeId?: string }>();
  for (const m of params.messages) for (const b of Array.isArray(m.content) ? m.content : []) {
    if (b.type === "tool_use") calls.set(b.id, { name: b.name, nativeId: b._geminiNativeId });
  }
  const contents: any[] = [];
  for (const m of params.messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const original = blocks.find((b: any) => b._geminiContent)?._geminiContent;
    if (m.role === "assistant" && original) {
      contents.push(structuredClone(original)); continue;
    }
    const parts: any[] = [];
    for (const b of blocks) {
      if (b.type === "text") parts.push({ text: b.text });
      else if (b.type === "image") {
        if (b.source?.type !== "base64") throw new Error("Only base64 images are supported");
        parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      } else if (b.type === "tool_use") {
        // This branch translates another provider's history, which has no Google signature.
        // Google's documented migration sentinel preserves executed calls/results on failover.
        // Native Gemini responses take the original-content branch above, unchanged.
        parts.push({
          functionCall: { name: b.name, args: b.input },
          thoughtSignature: "skip_thought_signature_validator",
        });
      } else if (b.type === "tool_result") {
        const call = calls.get(b.tool_use_id);
        if (!call) throw new Error("Missing tool call for result");
        parts.push({ functionResponse: {
          name: call.name, ...(call.nativeId ? { id: call.nativeId } : {}),
          response: { result: b.content, ...(b.is_error ? { error: true } : {}) },
        } });
      }
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const schema = params.output_config?.format?.schema;
  return {
    systemInstruction: { parts: [{ text: systemText(params.system) }] },
    contents,
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      ...(schema ? { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } } } : {}),
    },
    ...(params.tools?.length ? { tools: [{ functionDeclarations: params.tools.map((t: any) => ({
      name: t.name, description: t.description, parametersJsonSchema: t.input_schema,
    })) }] } : {}),
  };
}
function geminiMessage(raw: any, model: string): AIMessage {
  const candidate = raw.candidates?.[0];
  const refused = !!raw.promptFeedback?.blockReason ||
    ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"].includes(candidate?.finishReason);
  if (!candidate && !refused) throw new Error("Invalid Gemini response");
  const content: any[] = [];
  for (const part of candidate?.content?.parts ?? []) {
    if (part.thought) continue; // opaque signed parts stay in _geminiContent, never in the displayed answer
    if (typeof part.text === "string") content.push({ type: "text", text: part.text });
    if (part.functionCall) content.push({
      type: "tool_use", id: part.functionCall.id || "gemini_" + crypto.randomUUID(),
      name: part.functionCall.name, input: part.functionCall.args ?? {},
      _geminiNativeId: part.functionCall.id,
    });
  }
  if (content.length && candidate?.content) content[0]._geminiContent = structuredClone(candidate.content);
  const u = raw.usageMetadata ?? {};
  const stop = refused ? "refusal" : candidate?.finishReason === "MAX_TOKENS" ? "max_tokens"
    : candidate?.finishReason !== "STOP" ? "pause_turn"
    : content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  return {
    id: raw.responseId ?? "gemini_" + crypto.randomUUID(), type: "message", role: "assistant", model,
    content, stop_reason: stop, stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0)),
      output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: u.cachedContentTokenCount ?? 0, cache_creation_input_tokens: 0,
    },
  } as unknown as AIMessage;
}
function validMessage(raw: any): raw is AIMessage {
  return Array.isArray(raw?.content) && raw.content.every((b: any) =>
    b && (b.type !== "text" || typeof b.text === "string") &&
    (b.type !== "tool_use" || typeof b.id === "string" && typeof b.name === "string")) &&
    typeof raw.stop_reason === "string" && Number.isFinite(raw.usage?.input_tokens) &&
    raw.usage.input_tokens >= 0 && Number.isFinite(raw.usage?.output_tokens) && raw.usage.output_tokens >= 0 &&
    ["cache_read_input_tokens", "cache_creation_input_tokens"].every((key) => raw.usage[key] == null || Number.isFinite(raw.usage[key]) && raw.usage[key] >= 0);
}

/** One request per eligible provider; next provider only on an upstream error, never a refusal.
 * Only generation is retried. Business tools run once, outside this adapter, after a response.
 * Endpoint hosts are fixed; keys/URLs cannot be supplied through public API payloads.
 */
export function createAIClient(options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): AIClient | null {
  const configured = PROVIDER_ORDER.map((provider) => ({ provider, key: Deno.env.get(KEY_NAMES[provider])?.trim() ?? "" })).filter((p) => p.key);
  if (!configured.length) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const secrets = configured.map((p) => p.key);
  const failedProviders = new Set<Provider>();
  let claude: Anthropic | null = null;
  return { messages: { create: async (params: any) => {
    const tier = tierOf(params.model);
    const attempts: ProviderAttempt[] = [];
    const deadline = Math.min(params._pssDeadline ?? Infinity, Date.now() + 90_000);
    for (const c of configured) {
      const model = configuredModel(c.provider, tier);
      if (!modelValid(model)) {
        attempts.push({ provider: c.provider, model: "[invalid]", status: "error", reason: "Invalid server model configuration" });
        continue;
      }
      if (c.provider === "ollama" && params.output_config?.format?.schema) {
        attempts.push({ provider: c.provider, model, status: "skipped", reason: "Ollama Cloud does not support schema-enforced structured output" });
        continue;
      }
      if (failedProviders.has(c.provider)) {
        attempts.push({ provider: c.provider, model, status: "skipped", reason: "Provider failed earlier in this run" });
        continue;
      }
      const timeout = Math.min(options.timeoutMs ?? 25_000, deadline - Date.now());
      if (timeout <= 0) break;
      try {
        let response: AIMessage;
        if (c.provider === "claude") {
          claude ??= new Anthropic({ apiKey: c.key, timeout: 25_000, maxRetries: 0 });
          response = await claude.messages.create(requestForAnthropic(params, model, true) as any, { timeout, maxRetries: 0 }) as AIMessage;
        } else if (c.provider === "ollama") {
          response = await postJson(fetchImpl, "https://ollama.com/v1/messages", {
            Authorization: "Bearer " + c.key, "anthropic-version": "2023-06-01",
          }, requestForAnthropic(params, model, false), timeout);
        } else {
          const raw = await postJson(fetchImpl,
            "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
            { "x-goog-api-key": c.key }, geminiRequest(params), timeout);
          response = geminiMessage(raw, model);
        }
        if (!validMessage(response)) throw new Error("Invalid provider response");
        attempts.push({ provider: c.provider, model, status: "ok" });
        response._pss = { provider: c.provider, model, attempts };
        return response;
      } catch (e) {
        failedProviders.add(c.provider);
        attempts.push({ provider: c.provider, model, status: "error", reason: safeFailure(e, secrets), ...(statusOf(e) ? { httpStatus: statusOf(e) } : {}) });
      }
    }
    const detail = attempts.map((a) => a.provider + ": " + (a.reason ?? a.status)).join("; ");
    throw new AIRequestError(detail || "AI request deadline reached", attempts);
  } } };
}
