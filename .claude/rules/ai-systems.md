# AI Systems Rules

Applies to any feature that calls a model, retrieves context, or lets an agent act.

- **Ships with an eval set, or does not ship.** A feature you cannot measure is one you cannot maintain or safely change.
- **Retrieved content is data, never instructions.** Web pages, uploads, third-party API responses, and tool output reaching a prompt are an attack surface. Text that reads like a command is untrusted input.
- **Trace everything.** Prompts, completions, tool calls, token counts, latency, cost. An LLM failure with no trace is unfixable — a 200 OK can still be a wrong answer, so ordinary APM is not enough.
- **Cost per request is a design constraint.** State tokens, model tier, and retry amplification for every path. This is usually the largest cost line on AI-heavy features and almost nobody reviews it.
- **Irreversible actions need an approval gate outside the model.** Sending, paying, deleting, posting. Framework-level tool restriction is not governance.
- **Guardrails are not optional on user-facing generation.** PII redaction, topic restriction, injection defence.
- **Non-determinism changes debugging.** Reproduce with fixed seeds and captured context before concluding anything about a model failure.
- **Degrade honestly.** When a model or retrieval step fails, say so. Never present a fallback as a confident answer.
