**AI providers — Ollama Cloud → Gemini → Claude**

Implemented 29 October 2026. This is application inference in Supabase Edge Functions, independent of the developer's Gemini File Bridge helper.

**Routing and allowed models**

Only server-configured models can be selected. Public payloads cannot supply provider credentials, endpoint hosts or arbitrary model names. The owner Analyst page's **AI models** panel shows the configured routine/deep models and whether a provider key exists; “Key configured” does not prove that the account/model has been tested live.

| Priority | Provider | Routine default | Deep default | Requests |
|---|---|---|---|---|
| 1 | Ollama Cloud | gemma4:31b | gpt-oss:120b | Text, images supported by model, tool calls; schema-enforced structured tasks are skipped |
| 2 | Gemini | gemini-3.8-flash | gemini-3.8-flash | Native tool calls, structured JSON and images |
| 3 | Claude | claude-haiku-5-5 | claude-sonnet-5-5 | Existing Anthropic tool/structured/image paths |

Priority is fixed to the owner's requested order. Providers with no key are absent from routing. A bad model setting is reported as an invalid server configuration; no arbitrary URL is fetched. Routine/deep are internal workload selectors, so a provider's model can be changed without changing every agent.

The default hosted Ollama IDs were verified in the public cloud catalog. Direct Ollama Cloud uses hosted IDs such as gemma4:31b, not a local CLI alias ending in :cloud. There is no localhost Ollama dependency.

**Important capability difference**

Ollama Cloud's documentation currently says schema-enforced structured outputs are unavailable. Those tasks therefore start with Gemini, then Claude. This includes writer/collections/win-back/enquiry/dedupe/exam/exception structured calls and ID/payment extraction. They do not silently switch to unconstrained free text.

Owner analyst, morning brief and student concierge tool loops can start with Ollama. If it fails, they fall back to configured Gemini and then Claude.

A model refusal, safety block, valid truncated response or schema-invalid completed answer does not trigger a provider switch to seek a different answer. Provider transport/API/malformed-protocol failures can fall back. A provider that failed is skipped for subsequent turns within that client/run. Only generation is retried: tools already executed are represented by their existing results, never replayed by the adapter.

**Supabase Edge Function secrets**

| Secret | Needed for | Notes |
|---|---|---|
| OLLAMA_API_KEY | Ollama Cloud | Bearer key from the Ollama account |
| GEMINI_API_KEY | Gemini | Gemini API/AI Studio key |
| AI_API_KEY | Claude | Existing Anthropic key; remains backward compatible |
| OLLAMA_MODEL | Optional routine override | Default gemma4:31b |
| OLLAMA_MODEL_HARD | Optional deep override | Default gpt-oss:120b |
| GEMINI_MODEL | Optional routine override | Default gemini-3.8-flash |
| GEMINI_MODEL_HARD | Optional deep/image override | Default gemini-3.8-flash |
| AI_MODEL | Optional Claude routine override | Default claude-haiku-5-5 |
| AI_MODEL_HARD | Optional Claude deep/image override | Default claude-sonnet-5-5 |

For all three providers, configure all three keys. With only Ollama configured, structured tasks fail with a clear capability reason; configure Gemini or Claude for those tasks. Existing Claude-only deployments still work.

Keys belong in Supabase backend secrets, never VITE_ frontend variables. Do not pass credentials in app_settings. Do not change staff/student JWT secrets for this provider addition. Existing CRON_SECRET and PORTAL_URL still serve the same purposes.

**Deploy order**

1. Use the confirmed Supabase project `zripsszkprhtyccukrir`. The frontend and local CLI project refs now agree. Source repository: perfectstudyspacedev-sys/PerfectStudySpace, branch pss-ai/all-phases; Cloudflare Pages project: perfectstudyspace.
2. Apply migration **073_ai_provider_attempts.sql**, after the existing migrations. It adds one JSONB trace column to agent_runs; no new feature toggles or business tables are required.
3. Add the provider keys and optional model overrides in Edge Functions → Secrets.
4. Deploy **api** and **agent**; deploy **cron** with the same source if it is part of the release. Use the intended explicit project ref. Keep gateway JWT verification off as in supabase/config.toml; each function retains its own authorization.
5. Deploy the frontend build through GitHub/Cloudflare Pages using npm run build and output dist.
6. Enable the existing feature under test. Keep pssai_agent_shadow=on for student/enquiry chat evaluation.
7. Owner → Analyst → open AI models and confirm provider names/model settings. Ask a factual report question; the answer shows the actual model used.

Migration 073 should be applied first. If a rolling deployment briefly reaches an older database, final run status/usage still saves without the new trace field and logs the missing migration; detailed attempts become available after the migration.

**Manual smoke tests**

| Test | Setup / action | Expected |
|---|---|---|
| Priority | All three keys configured; ask the owner analyst a routine report question | Ollama/gemma4:31b answers first; provider_attempts shows it |
| Deep | Ask the analyst with Deep answer selected | Ollama/gpt-oss:120b is the first eligible default |
| Gemini-only | In staging remove Ollama key; keep Gemini and Claude | Gemini answers first |
| Claude-only | In staging keep only the existing AI_API_KEY | Existing Claude routine/deep flow still works |
| Structured image | All keys configured; submit a test payment screenshot | Ollama attempt is skipped with capability reason; Gemini is used; owner confirmation is still required |
| Provider error | On staging use a deliberately invalid Ollama test key, then ask a question | Recorded failure, then Gemini; error bodies and keys are not logged |
| Refusal | Run each provider's existing evaluation refusal cases | Refusal is retained; no other provider is called to bypass it |
| Tool integrity | Ask for an unsupported payment/refund action | Existing tool allow-list and owner approval rules still apply |
| Budget | On staging set pssai_ai_budget_usd=0 | Every provider is blocked before a new run |
| Shadow | Ask concierge for a hold with shadow on | No acting tool runs; reply waits for staff |
| Model visibility | Inspect Analyst's model label and agent_runs after a successful request | Actual successful provider/model, not merely the preferred candidate |
| Vision accuracy | Run payment/ID extraction evaluations using representative images | JSON is schema-validated, but the owner must still evaluate extraction accuracy |

Changing keys or model settings in staging is for exercising routing, not a production failover drill. Never use invented bank proofs against live memberships.

Read the latest model calls:

~~~sql
SELECT
  started_at,
  agent,
  model,
  status,
  model_calls,
  tokens_in,
  tokens_out,
  cost_usd,
  provider_attempts,
  error
FROM public.agent_runs
ORDER BY started_at DESC
LIMIT 20;
~~~

Provider attempts contain only provider, model, ok/error/skipped, a fixed reason and optional HTTP status. They do not contain prompts, images, response bodies, tool content or credentials.

**Budgets, token accounting and failures**

- The existing monthly application budget and public daily limits still wrap the shared AI layer.
- Gemini cached prompt tokens are counted once; thinking tokens count toward output usage/cost.
- Ollama/Claude responses keep their provider usage. Unknown model prices use the existing conservative fallback estimate.
- Default Ollama estimates use published per-token cloud rates; do not assume a subscription makes inference free. Gemini estimates use paid standard rates, not free-tier assumptions. Gemini 3.8 Flash rates are date-aware for the published 2027-01-01 change.
- Estimates are not a strict provider billing cap. Concurrent/in-flight calls and failed requests with unknown usage can still incur provider charges; use provider-side account controls too.
- One generation attempt per eligible provider, no hidden SDK retries. Per-provider requests are aborted at 25 seconds, with a shared generation/loop deadline. Failure is exposed honestly; empty/outage answers are not saved as successful chat replies.
- Google-native tool history retains the full signed model response. Gemini thought signatures are returned unchanged to Google and stripped before another provider sees that history.
- When Gemini takes over a tool loop from Ollama/Claude, foreign function calls use Google's documented migration signature sentinel. Existing results accompany those calls; the adapter does not execute them again.
- Do not add raw prompt/completion logging: the project deliberately excludes personal contact details and image bodies from the audit/run logs.

**Offline verification**

npm run test:server now uses the installed deno.exe directly on Windows. test:integration has the same launcher correction. Provider tests mock HTTP and Anthropic; no real model inference or paid provider check is part of the automated suite.

Latest verification (29 October 2026): npm run predeploy passed the production build, 109 unit tests and all 30 server suites. Focused production type checks passed for the shared AI modules. An existing seat-resale repeat-arrival test failed on the first full run, then passed both independently and on the final full run; this intermittent check is unrelated to provider routing and remains worth tracking. No live inference or deployment was performed.

- tests/server/providers_test.ts: provider preference; exact request credentials; unsupported structured capability; native JSON/image mapping; signed parallel tools; mid-loop recovery without repeating tools; refusals; timeouts/deadlines; sanitized diagnostics; schema checks; actual-model usage/run logs; owner status; existing redaction/tool/budget enforcement.
- Existing agent/concierge/payment/onboarding/writer/collections/enquiry/exam suites cover the original behavior through the shared layer.
- Existing tests/agents evaluation sets remain the live accuracy gates. Re-run them per configured provider before enabling direct replies.

**Official sources checked**

- [Ollama Cloud and hosted model IDs](https://docs.ollama.com/cloud)
- [Ollama Anthropic compatibility and bearer authentication](https://docs.ollama.com/api/anthropic-compatibility)
- [Ollama Cloud structured-output limitation](https://docs.ollama.com/capabilities/structured-outputs)
- [Ollama cloud pricing](https://ollama.com/pricing)
- [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models)
- [Gemini native function/part API](https://ai.google.dev/api/generate-content)
- [Gemini thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
