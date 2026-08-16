# WAT Framework — Compliance Audit

Assessment of `company-claude-os-v2` against the WAT (Workflows · Agents · Tools) instructions.

**Verdict: 1 of 3 layers satisfied. Layer 3 is entirely absent, and it is the layer the framework's core argument rests on.**

---

## Layer-by-layer

| WAT requirement | Status | Evidence |
|---|---|---|
| **Layer 1 — Workflows** | ⚠️ Partial | `docs/MISSIONS.md` and the agent bodies are *role* and *team-composition* instructions, not task SOPs. No `workflows/` directory. No SOP has the required shape: objective → inputs → tools → outputs → edge cases. |
| **Layer 2 — Agents** | ✅ Satisfied | 21 agents, explicit orchestration, error escalation, clarifying-question rules, handoff protocol. This layer is arguably over-built. |
| **Layer 3 — Tools** | ❌ **Absent** | Zero `.py` files. No `tools/`. No `.env`. No deterministic execution anywhere. The only scripts in the pack are two bash quality-gate hooks. |
| **Look for existing tools first** | ⚠️ Analogous only | `CLAUDE.md` §12 says "do not reinvent an existing skill." That's skill reuse, not tool reuse. |
| **Learn and adapt on failure** | ⚠️ Partial | `/learn`, `/retro`, `/investigate` capture lessons. But "fix the tool, verify the fix, update the workflow" cannot run — there are no tools to fix. |
| **Check before re-running paid API calls** | ❌ Missing | `settings.json` gates `git push` and `psql`. Nothing gates spend. Relevant given you run paid inference across multiple providers. |
| **Don't create/overwrite workflows without asking** | ❌ Missing | Agents 03 and 04 write specs and plans freely. No preservation rule. |
| **Deliverables to cloud, `.tmp/` disposable** | ❌ Missing | No `.tmp/` convention. No deliverable-destination rule. |
| **Secrets only in `.env`** | ✅ Compatible | Rules already forbid secrets in code, compose files, and CI. `settings.json` denies reading `.env` — correct, since tools read it at runtime, not the agent. |

---

## The finding that matters

WAT's central argument is arithmetic: **five chained steps at 90% accuracy leaves you at 59%.** The prescribed fix is to move execution out of the probabilistic layer into deterministic scripts.

This pack does the opposite. gstack skills, ECC skills, agent definitions, mission templates — **all of it is prompting.** Every one is a probabilistic step. A four-teammate mission with six skill invocations each is roughly twenty-four probabilistic steps with no deterministic floor underneath.

So the pack is not merely missing Layer 3. It is a large, well-organised Layer 2 that WAT would say has grown past the point where more agents help.

**Concrete example.** Agent 12 runs `/qa-only` to check the PSS checkout flow. Under WAT, only the *judgement* — which journeys matter, is this defect real — belongs in the agent. The navigation, form filling, screenshot capture, and assertion should be a Python script that produces identical output every run. Today all of it is a prompt.

---

## The one place the pack already does WAT correctly

**`/skillify`** — it walks back through a `/scrape` prototype and synthesises a **script, a test, and a fixture**, then commits. Subsequent runs execute the script in ~200ms instead of re-reasoning.

That is precisely the WAT loop: prototype probabilistically once, codify deterministically, run cheaply forever after.

Note the tension I introduced: I restricted `/skillify` to agent 12 and told it to decline while implementers run. That restriction is correct for repo safety — the skill commits — but it also throttles the single mechanism in this stack that manufactures Layer 3. **The right resolution is to run `/skillify` deliberately in the lead session after missions, not to relax the teammate restriction.**

---

## What was added to close the gap

- **`.claude/rules/wat.md`** — tool-first rule, the paid-API gate, workflow preservation, `.tmp/` discipline.
- **`workflows/`** with `_TEMPLATE.md` — the SOP shape WAT specifies. Distinct from `docs/MISSIONS.md`, which stays as team composition.
- **`tools/`** with `_template.py` and a README — the convention every generated tool follows.
- **`.tmp/`** — disposable intermediates.
- **`CLAUDE.md` §14** — WAT operating model, inherited by every agent.

---

## What was deliberately not added

**No pre-written tools.** Which tools you need depends on what you actually do repeatedly across PSS, Bites, Alpenglow, and Harmony. Writing speculative scripts would add maintenance burden without evidence. The correct source of tools is observation: run missions, notice what an agent re-derives every time, codify *that*.

**No workflow SOPs.** Same reasoning. A workflow written before the task has been done twice is a guess.

---

## Recommended sequence

1. Run a mission normally.
2. Note every step where an agent reasoned through something mechanical — a report format, an export, an API call, a data reshape.
3. Write one tool for the most repeated of those. Use `tools/_template.py`.
4. Write the workflow SOP that calls it.
5. Repeat. Three to five real tools will do more for reliability than the twenty-first agent did.

The honest measure of whether this pack satisfies WAT is not the file structure — it's whether `tools/` has anything in it a month from now.
