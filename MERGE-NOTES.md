# Merge Notes — what changed from company-claude-os v1, and why

This is v2. It keeps the organisational design of `company-claude-os` and replaces its enforcement layer, which relied on four mechanisms that do not work in agent teams mode.

Read this before assuming a behaviour carried over.

---

## Kept from v1 — it was better than my earlier pack

| Kept | Why |
|---|---|
| **20-role org structure** | Richer than my 16. Solutions architect, UX researcher, AI engineer, integration engineer, and observability/learning engineer were all genuine gaps in mine. |
| **`.claude/rules/` layer** | Correct separation: roles in agents, constraints in rules, both inherited. Kept all five files essentially verbatim. |
| **Root `CLAUDE.md` as governance** | Mine had only a teammate snippet. v1's full operating doctrine is the right shape. |
| **Karpathy discipline as a shared preamble** | Injecting it into every agent rather than hoping is right. Kept and strengthened. |
| **Ecosystem routing** (ECC / gstack / UI-UX Pro Max / Ruflo / Karpathy) | My pack ignored four of your five installed ecosystems. |
| **Numbered agent files** | Encodes the pipeline order in the filesystem. |
| **Client-project lifecycle** | The end-to-end flow diagram is genuinely useful for a solutions studio. |

---

## Fixed — four mechanisms that silently do nothing in team mode

These are not stylistic disagreements. Each is a documented platform behaviour.

### 1. `skills:` frontmatter is ignored for teammates

v1's entire specialisation model was a `skills:` list in each agent's frontmatter — `gstack:/browse`, `ruflo:memory`, and so on.

> The `skills` and `mcpServers` frontmatter fields in a subagent definition are not applied when that definition runs as a teammate. Teammates load skills and MCP servers from your project and user settings, the same as a regular session.
> — [Claude Code docs, agent teams](https://code.claude.com/docs/en/agent-teams)

So every teammate sees the same skill pool regardless of its list, and the `ecosystem:/skill` syntax is not a form the field accepts in any case. **Fix:** skill guidance moved into each agent's body, where it lands in the system prompt and actually influences behaviour.

### 2. `permissionMode:` is not applied at spawn

v1 assigned `plan` / `acceptEdits` / `default` per agent, with a permission table in SETUP.md.

> Teammates start with the lead's permission settings... you can change individual teammate modes after spawning, but you can't set per-teammate modes at spawn time.

**Fix:** removed from frontmatter to avoid implying a guarantee that does not exist. Restriction is now carried by `tools:`, which is enforced.

### 3. No `tools:` allowlist anywhere — the one thing that *is* enforced

v1 declared reviewers as `permissionMode: plan` but gave them no tool restriction. Combined with `/review`'s auto-fix behaviour, a "read-only" reviewer could have written and committed to files an implementer was holding.

**Fix:** every read-only role — security, performance, staff review, adversarial review, DevEx, QA — now carries a `tools:` list with no `Write` or `Edit`. Auto-fix cannot execute regardless of what the model decides.

### 4. Browser daemon collisions across up to eight agents

The gstack browse daemon is **one persistent Chromium session** — cookies, localStorage, and tabs carry over between commands. v1 gave browser-driving skills to many agents at once:

| Skill | Agents holding it in v1 |
|---|---|
| `/browse` | frontend-lead, qa-browser-lead |
| `/qa` | frontend-lead, qa-browser-lead |
| `/benchmark` | frontend, backend, database, ai-engineer, performance |
| `/design-review` | design-director, frontend-lead |
| `/canary` | performance, devops, observability |

Two agents driving that daemon concurrently corrupt each other's session state and generate bugs that do not exist.

**Fix:** exclusive ownership by `qa-browser-lead`, encoded in `.claude/rules/agent-teams.md` and in every affected agent's body. Others request measurements by message.

---

## Also fixed

**`/review` held by six agents.** backend, database, ai-engineer, integration, staff-reviewer, adversarial — all able to auto-commit fixes concurrently. Now: staff-reviewer only, read-only, with the lead running fix mode after implementers stop.

**`/ship` held by three agents.** integration, devops, release-manager — three agents that sync main and push. Now: release-manager only, running alone, after confirming implementers have shut down.

**No file-ownership mechanism.** v1's CTO agent said "never let two agents edit the same high-conflict files" with nothing to enforce it. Now: the solutions architect emits a file-ownership map as a required plan artifact, and every implementer runs `/freeze <glob>` as its first action.

**Hooks described but not shipped.** v1's SETUP listed hooks as an architectural layer and included none. Now: `TeammateIdle` blocks a teammate going idle while typecheck or lint fails; `TaskCompleted` blocks completion while debug residue is in the diff.

**Unverified skills asserted as available.** `/spec` and `/diagram` appear in v1's agents and setup docs but are not in gstack's published skill list. They may come from ECC or may not exist in your install. Now flagged as verify-first, with an instruction to write the artifact by hand and tell the lead rather than silently skipping the stage.

---

## Added

- **`.claude/rules/agent-teams.md`** — the eight rules that keep parallel agents from destroying each other's work.
- **`.claude/rules/ai-systems.md`** — evals, prompt injection, tracing, cost, irreversible actions. v1 had no AI-specific rules despite shipping an AI engineer role.
- **`21-documentation-engineer`** — v1 had no dedicated doc owner; handover packs are a deliverable for a solutions studio, not an afterthought.
- **`docs/MISSIONS.md`** — seven ready-to-paste team compositions.
- **`docs/SKILL-COVERAGE.md`** — every gstack skill mapped to an owner, or marked lead-only with a reason.

---

## Honest limits

- **Agent teams are experimental.** No session resumption with in-process teammates, task status can lag, one team per session, no nested teams, lead is fixed.
- **gstack moves fast** — verify skill names against your installed version; `/gstack-upgrade` keeps you current.
- **I could not inspect ECC, Ruflo, UI/UX Pro Max, or karpathy-skills.** Their skill names in this pack are referenced generically, exactly as v1 did. Run `ls ~/.claude/skills/` and bind the real names — that remains the highest-leverage edit available.
- **Neither system was designed for the other.** gstack is sequential-by-design with Conductor for parallelism; agent teams parallelise within one workspace. This is a considered composition, not a supported configuration.
