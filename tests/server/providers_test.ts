// Offline contract/regression tests for provider preference, native adapters and shared guards.
// No provider inference or network request is made.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { reset, rows, insert, tokenFor, check, done } from "./harness.ts";
import { agent, fakeAi, reply, text, toolUse, APIError } from "./agent-harness.ts";
import { createAIClient, MODELS, providerStatus, initialModel } from "../../supabase/functions/_shared/ai-providers.ts";
import { toolLoop, structuredCall, loggedStructuredCall, costUsd, emptyTotals, finishRun } from "../../supabase/functions/_shared/ai.ts";
import { schemaProblem } from "../../supabase/functions/_shared/ai-schema.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";
const g = globalThis as any;
const ENV = ["OLLAMA_API_KEY", "GEMINI_API_KEY", "AI_API_KEY", "OLLAMA_MODEL", "OLLAMA_MODEL_HARD", "GEMINI_MODEL", "GEMINI_MODEL_HARD", "AI_MODEL", "AI_MODEL_HARD"];
function setup(...providers: string[]) {
  for (const key of ENV) Deno.env.delete(key);
  for (const provider of providers) Deno.env.set(provider === "claude" ? "AI_API_KEY" : provider.toUpperCase() + "_API_KEY", provider + "-private-test-key");
  fakeAi.reset(); reset();
}
const schema = { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } };
const params = (extra: any = {}) => ({ model: MODELS.routine(), max_tokens: 1000, system: [{ type: "text", text: "Use facts only", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: "hello" }], ...extra });
const gem = (parts: any[], finishReason = "STOP", usage: any = {}) => ({
  candidates: [{ content: { role: "model", parts }, finishReason }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, ...usage },
});
function mockHttp(handler: (body: any, index: number, url: string, init: any) => any) {
  const requests: any[] = [];
  const fn = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    const index = requests.push({ url: String(url), headers: init.headers, body }) - 1;
    const result = await handler(body, index, String(url), init);
    return result instanceof Response ? result : new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, requests };
}
function scriptedClaude(content = "Claude fallback") { g.__FAKE_AI__ = () => reply([text(content)]); }

// Keys and configured preference; no inference request from the status endpoint.
setup();
check(createAIClient() === null, "P1: no provider key means no AI client");
check(providerStatus().every((p) => !p.configured) && !JSON.stringify(providerStatus()).includes("private"), "P1: provider status contains no key");
setup("claude");
check(initialModel(MODELS.routine()) === "claude-haiku-5-5", "P1: existing Claude-only configuration stays compatible");
setup("ollama", "gemini", "claude");
check(providerStatus().map((p) => p.provider).join(",") === "ollama,gemini,claude", "P1: provider priority is Ollama, Gemini, Claude");
{
  const http = mockHttp(() => reply([text("Ollama first")]));
  const r = await createAIClient({ fetchImpl: http.fn })!.messages.create(params({ _pssDeadline: Date.now() + 1000 }));
  const q = http.requests[0];
  check(r._pss?.provider === "ollama" && http.requests.length === 1 && !fakeAi.requests.length, "P2: configured Ollama wins without contacting other providers");
  check(q.url === "https://ollama.com/v1/messages" && q.headers.Authorization === "Bearer ollama-private-test-key" && !q.headers["x-goog-api-key"], "P2: Ollama Cloud receives only its own bearer key");
  check(q.body.model === "gemma4:31b" && !q.body.system[0].cache_control && !("_pssDeadline" in q.body), "P2: hosted model ID, no unsupported cache metadata or internal deadline");
  await createAIClient({ fetchImpl: http.fn })!.messages.create(params({ model: MODELS.hard() }));
  check(http.requests[1].body.model === "gpt-oss:120b", "P2: deep/tool work selects the configured hard Ollama model");
}
{
  const http = mockHttp((_b, _i, url) => url.includes("ollama.com") ? new Response("upstream private prompt", { status: 503 }) : gem([{ text: "Gemini fallback" }]));
  const r = await createAIClient({ fetchImpl: http.fn })!.messages.create(params());
  check(r._pss?.provider === "gemini" && r._pss.attempts.map((x) => x.status).join(",") === "error,ok", "P3: upstream Ollama failure falls back to Gemini and records attempts");
  check(http.requests[1].headers["x-goog-api-key"] === "gemini-private-test-key" && !http.requests[1].headers.Authorization, "P3: Google gets its own key in the header, never the URL or another key");
  check(!JSON.stringify(r._pss).includes("private prompt"), "P3: upstream error bodies never reach traces");
}
{
  scriptedClaude();
  const http = mockHttp(() => new Response("secret echoed here", { status: 429 }));
  const r = await createAIClient({ fetchImpl: http.fn })!.messages.create(params());
  check(r._pss?.provider === "claude" && r._pss.attempts.map((x) => x.provider).join(",") === "ollama,gemini,claude", "P3: Ollama and Gemini failure reach Claude last");
  check(fakeAi.options[0].apiKey === "claude-private-test-key" && fakeAi.options[0].maxRetries === 0, "P3: Claude has its own key and no hidden retry amplification");
}

// Refusals and truncated output must never be bypassed by another provider.
{
  const http = mockHttp(() => reply([], "refusal"));
  const r = await toolLoop({ client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", messages: [{ role: "user", content: "hi" }], tools: [] });
  check(r.stop === "refused" && http.requests.length === 1, "P4: Ollama refusal stops the run without provider fallback");
}
setup("gemini", "claude");
{
  const http = mockHttp(() => ({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: {} }));
  const r = await toolLoop({ client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", messages: [{ role: "user", content: "hi" }], tools: [] });
  check(r.stop === "refused" && !fakeAi.requests.length, "P4: Gemini safety refusal also stops without Claude fallback");
}
setup("ollama", "gemini", "claude");
{
  const http = mockHttp(() => reply([text("partial")], "max_tokens"));
  const r = await toolLoop({ client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", messages: [], tools: [] });
  check(r.stop === "cut_short" && http.requests.length === 1, "P4: truncated output is reported, not retried on another provider");
}

// Structured vision skips unsupported Ollama Cloud and keeps schema/image semantics.
{
  const http = mockHttp(() => gem([{ text: JSON.stringify({ answer: "read" }) }], "STOP", { promptTokenCount: 1200, cachedContentTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 50 }));
  const r = await structuredCall<{ answer: string }>({
    client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.hard(), system: "Read only",
    content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } }, { type: "text", text: "read the image" }], schema,
  });
  const q = http.requests[0];
  check(r.data?.answer === "read" && q.url.includes("generativelanguage.googleapis.com") && http.requests.length === 1, "P5: structured output skips Ollama Cloud before making a request");
  check(q.body.generationConfig.responseFormat.text.schema.required[0] === "answer" && q.body.contents[0].parts[0].inlineData.mimeType === "image/png", "P5: Google gets JSON Schema and the original inline image");
  check(r.totals.providerAttempts[0].status === "skipped" && r.totals.models[0] === "gemini/gemini-3.8-flash", "P5: capability skip and actual model are recorded");
  check(r.totals.tokensIn === 1000 && r.totals.cacheRead === 200 && r.totals.tokensOut === 150, "P5: cached input and thinking tokens are accounted for once");
  const expected = costUsd("gemini/gemini-3.8-flash", { input_tokens: 1000, output_tokens: 150, cache_read_input_tokens: 200 });
  check(Math.abs(r.totals.costUsd - expected) < 1e-12, "P5: cost uses the actual provider model and usage");
}
setup("ollama");
{
  const http = mockHttp(() => { throw new Error("must not call unsupported API"); });
  const r = await structuredCall({ client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", content: "hi", schema });
  check(r.stop === "error" && r.data === null && !http.requests.length && /does not support/.test(r.error ?? ""), "P5: Ollama-only structured tasks fail honestly and make no unsupported request");
}

// Google function-calling retains full signed model content across parallel tool results.
setup("gemini");
{
  let executed = 0;
  const signed = { role: "model", parts: [
    { text: "private thought", thought: true, thoughtSignature: "opaque-thinking-signature" },
    { functionCall: { name: "read_fact", args: { n: 1 }, id: "native-1" }, thoughtSignature: "opaque-call-signature" },
    { functionCall: { name: "read_fact", args: { n: 2 }, id: "native-2" } },
  ] };
  const http = mockHttp((_b, i) => i === 0 ? gem(signed.parts) : gem([{ text: "The answer" }]));
  const r = await toolLoop({
    client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", messages: [{ role: "user", content: "read" }],
    tools: [{ name: "read_fact", description: "read", input_schema: { type: "object", properties: { n: { type: "integer" } } }, run: async () => { executed++; return { ok: true, text: "fact" }; } }],
  });
  const q = http.requests[1].body;
  check(r.text === "The answer" && executed === 2 && r.toolCalls.length === 2, "P6: native Gemini parallel calls execute each business tool once");
  check(JSON.stringify(q.contents[1]) === JSON.stringify(signed), "P6: the entire Gemini response and thought signatures are returned unchanged");
  check(q.contents[2].parts.map((p: any) => p.functionResponse.id).join(",") === "native-1,native-2", "P6: function response IDs and names match the original calls");
  check(q.tools[0].functionDeclarations[0].parametersJsonSchema.type === "object" && !r.text.includes("private thought"), "P6: native tool schemas work and thought text is not displayed");
}
setup("gemini", "claude");
{
  let executed = 0; scriptedClaude("Recovered without repeating the tool");
  const http = mockHttp((_b, i) => i === 0
    ? gem([{ functionCall: { name: "once", args: {}, id: "native-call" }, thoughtSignature: "do-not-send-to-claude" }])
    : new Response("", { status: 503 }));
  const r = await toolLoop({
    client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", messages: [{ role: "user", content: "do it" }],
    tools: [{ name: "once", description: "read", input_schema: { type: "object", properties: {} }, run: async () => { executed++; return { ok: true, text: "already done" }; } }],
  });
  check(r.stop === "done" && executed === 1 && fakeAi.requests[0].messages.at(-1).content[0].type === "tool_result", "P7: mid-loop fallback preserves the existing result without executing the tool twice");
  check(!JSON.stringify(fakeAi.requests[0]).includes("do-not-send-to-claude") && !JSON.stringify(fakeAi.requests[0]).includes("_gemini"), "P7: Gemini protocol/signature metadata is not forwarded to Claude");
}

// A successful Ollama tool call can precede a transport failure and Gemini takeover.
setup("ollama", "gemini");
{
  let executed = 0;
  const http = mockHttp((_b, i, url) => url.includes("ollama.com")
    ? i === 0 ? reply([toolUse("foreign-call", "once", {})], "tool_use") : new Response("", { status: 503 })
    : gem([{ text: "Recovered from Ollama" }]));
  const r = await toolLoop({
    client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", messages: [{ role: "user", content: "read" }],
    tools: [{ name: "once", description: "read", input_schema: { type: "object", properties: {} }, run: async () => { executed++; return { ok: true, text: "already done" }; } }],
  });
  const q = http.requests.at(-1).body;
  check(r.stop === "done" && executed === 1 && q.contents[2].parts[0].functionResponse.response.result === "already done", "P7: Ollama-to-Gemini failover carries completed results without repeating the tool");
  check(q.contents[1].parts[0].thoughtSignature === "skip_thought_signature_validator" && q.contents[1].parts[0].functionCall.name === "once", "P7: foreign tool history uses Google's documented migration signature sentinel");
}

// Failed requests redact body text and keys; deadlines and aborts are bounded.
setup("ollama", "gemini", "claude");
{
  g.__FAKE_AI__ = () => { throw new APIError(503, "claude-private-test-key and student's private prompt"); };
  const http = mockHttp(() => new Response("ollama-private-test-key student secret", { status: 401 }));
  let error: any; try { await createAIClient({ fetchImpl: http.fn })!.messages.create(params()); } catch (e) { error = e; }
  const saved = JSON.stringify({ message: error?.message, attempts: error?.attempts });
  check(error?.attempts.length === 3 && /HTTP 401/.test(saved) && /HTTP 503/.test(saved), "P8: all-provider failure has a bounded diagnostic for each attempt");
  check(!/private-test-key|student secret|private prompt/.test(saved), "P8: neither credentials nor provider error bodies appear in diagnostics");
}
{
  const http = mockHttp(() => { throw new Error("deadline should prevent HTTP"); });
  let failed = false; try { await createAIClient({ fetchImpl: http.fn })!.messages.create(params({ _pssDeadline: Date.now() - 1 })); } catch { failed = true; }
  check(failed && !http.requests.length, "P8: an expired shared deadline prevents any new provider request");
}
setup("ollama", "gemini");
{
  const http = mockHttp((_b, _i, url, init) => url.includes("ollama.com")
    ? new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    : gem([{ text: "after timeout" }]));
  const r = await createAIClient({ fetchImpl: http.fn, timeoutMs: 5 })!.messages.create(params());
  check(r._pss?.provider === "gemini" && /timed out/.test(r._pss.attempts[0].reason ?? ""), "P8: timed-out Ollama request is aborted before Gemini fallback");
}
{
  Deno.env.set("OLLAMA_MODEL", "https://untrusted.example/steal");
  const http = mockHttp(() => gem([{ text: "valid provider" }]));
  const r = await createAIClient({ fetchImpl: http.fn })!.messages.create(params());
  check(r._pss?.provider === "gemini" && http.requests.every((q) => !q.url.includes("untrusted")), "P9: model configuration cannot turn the fixed provider endpoint into an arbitrary URL");
  check(providerStatus()[0].routine === "Invalid model configuration", "P9: unsafe model strings are not echoed by owner status");
  Deno.env.delete("OLLAMA_MODEL");
}

// Validate structured replies before they can become a payment reading or a saved draft.
setup("gemini");
{
  const http = mockHttp(() => gem([{ text: '{"answer":7,"extra":true}' }]));
  const r = await structuredCall({ client: createAIClient({ fetchImpl: http.fn })!, model: MODELS.routine(), system: "facts", content: "hi", schema });
  check(r.stop === "error" && !r.data && /schema/.test(r.error ?? "") && r.totals.modelCalls === 1, "P10: schema-invalid output is rejected but its actual usage is counted");
}
check(schemaProblem({ answer: "ok" }, schema) === null && !!schemaProblem({}, schema) && !!schemaProblem({ answer: "ok", extra: true }, schema), "P10: required fields and additionalProperties are enforced");
check(!!schemaProblem(JSON.parse('{"answer":"ok","constructor":7}'), schema), "P10: inherited object names cannot bypass additionalProperties");
check(schemaProblem(null, { anyOf: [{ type: "null" }, { type: "integer" }] }) === null && !!schemaProblem("wrong", { enum: ["allowed"] }), "P10: nullable and enum constraints are enforced");
check(!!schemaProblem([0], { type: "array", items: { type: "integer", minimum: 1 } }) && !!schemaProblem("long", { type: "string", maxLength: 2 }), "P10: nested numeric and string constraints are enforced");

// Existing callers also get the same provider routing; structured runs save their real model.
{
  const original = globalThis.fetch;
  const http = mockHttp(() => gem([{ text: '{"answer":"saved"}' }]));
  globalThis.fetch = http.fn;
  try {
    const r = await loggedStructuredCall(adminClient(), { agent: "provider-test", model: MODELS.routine() }, { system: "facts", content: "hi", schema });
    check("data" in r && rows("agent_runs")[0].model === "gemini/gemini-3.8-flash" && rows("agent_runs")[0].provider_attempts[0].provider === "gemini", "P11: structured agents log the real provider/model and attempts");
  } finally { globalThis.fetch = original; }
}

// End-to-end owner analyst: adapters cannot grant extra tools or disclose contact fields.
setup("ollama", "gemini", "claude");
{
  const branch = insert("branches", { name: "Hopes", is_active: true });
  const owner = insert("staff", { role: "owner", username: "owner", is_active: true, branch_id: null });
  const student = insert("students", { name: "Test Member", phone: "9876543210", emergency_contact: "9123456780", branch_id: branch.id });
  insert("app_settings", { key: "pssai_analyst", value: "on" });
  let googleCalls = 0;
  const http = mockHttp((_body, _i, url) => {
    if (url.includes("ollama.com")) return new Response("", { status: 503 });
    googleCalls++;
    if (googleCalls === 1) return gem([{ functionCall: { name: "get_student_profile", args: { studentId: student.id }, id: "read-profile" }, thoughtSignature: "signed" }]);
    if (googleCalls === 2) return gem([{ functionCall: { name: "record_payment", args: { amount: 100 }, id: "forbidden-payment" }, thoughtSignature: "signed-2" }]);
    return gem([{ text: "I can read the profile, but cannot record a payment." }]);
  });
  const original = globalThis.fetch; globalThis.fetch = http.fn;
  try {
    const r = await agent({ agent: "analyst", question: "Read this profile and record a payment" }, { token: await tokenFor(owner) });
    const run = rows("agent_runs")[0];
    check(r.status === 200 && r.stop === "done" && r.model === "gemini/gemini-3.8-flash", "P12: real analyst handler works through provider fallback and reports actual model");
    check(rows("transactions").length === 0 && r.toolCalls[1].ok === false, "P12: changing provider does not expose payment tools");
    const sentResults = http.requests.filter((q) => q.url.includes("googleapis")).map((q) => JSON.stringify(q.body.contents.filter((c: any) => c.role === "user")));
    check(sentResults.every((s) => !s.includes("9876543210") && !s.includes("9123456780")), "P12: profile contact fields are redacted before Gemini sees tool results");
    check(run.status === "ok" && run.provider_attempts.length === 6 && rows("events")[0].run_id === run.id, "P12: actual model, ordered fallback attempts and existing tool audit remain linked");
    check(http.requests.filter((q) => q.url.includes("ollama.com")).length === 1 && run.provider_attempts[2].status === "skipped", "P12: a failed provider is not retried on every tool-loop turn");
    const status = await agent({ agent: "analyst", op: "usage" }, { token: await tokenFor(owner) });
    check(status.providers.length === 3 && !JSON.stringify(status).includes("private-test-key"), "P12: owner can inspect configured models without exposing credentials");
    insert("app_settings", { key: "pssai_ai_budget_usd", value: "0" });
    const before = http.requests.length;
    const blocked = await agent({ agent: "analyst", question: "again" }, { token: await tokenFor(owner) });
    check(blocked.status === 429 && http.requests.length === before, "P12: shared monthly budget blocks every provider before a new run");
  } finally { globalThis.fetch = original; }
}
{
  const writes: any[] = [];
  const db: any = { from: () => ({ update: (row: any) => {
    writes.push(row);
    return { eq: async () => "provider_attempts" in row ? { error: { code: "PGRST204", message: "provider_attempts column missing" } } : { error: null } };
  } }) };
  const totals = emptyTotals(); totals.models.push("gemini/gemini-3.8-flash");
  await finishRun(db, "run", "ok", totals);
  check(writes.length === 2 && writes[1].status === "ok" && !("provider_attempts" in writes[1]), "P13: old database still gets final run status while migration 073 is being rolled out");
}
setup();
done();
