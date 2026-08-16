# Company Claude OS v2 — Setup

A Claude Code operating system for a software solutions company, built for **agent teams**.

This is `company-claude-os` v1 with its enforcement layer rebuilt. **Read `MERGE-NOTES.md`** for what changed and why — four mechanisms in v1 silently do nothing in team mode, and if you assume they work you will lose work.

---

## What this is and is not

This is a **routing and governance layer**. It does not replace Anthropic official plugins, ECC, gstack, UI/UX Pro Max, karpathy-skills, or Ruflo — it decides who uses what, when, and with which guardrails. Keep those ecosystems independently upgradeable.

Architecture separates:

| Layer | Where | Enforced? |
|---|---|---|
| **Roles** | `.claude/agents/` | Partly — `tools:` is enforced, `skills:`/`permissionMode:` are not |
| **Rules** | `.claude/rules/` | By inheritance into every agent |
| **Guardrails** | `.claude/hooks/` | Yes — exit code 2 blocks |
| **Permissions** | `.claude/settings.json` | Yes |
| **Skills** | Upstream ecosystems | Loaded from user/project settings, shared by all teammates |

---

## Install

```bash
# 1. Copy into the target repository
cp -R company-claude-os-v2/.claude .
cp company-claude-os-v2/CLAUDE.md .
cp -R company-claude-os-v2/docs .
chmod +x .claude/hooks/*.sh

# 2. Ecosystems (once per machine)
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git \
  ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
# plus your ECC, Ruflo, UI/UX Pro Max, karpathy-skills installs

# 3. Roles — user scope makes them available in every project
cp .claude/agents/*.md ~/.claude/agents/

# 4. Per project, once
/setup-deploy            # if this project deploys
/design-consultation     # if there is no DESIGN.md yet
/sync-gbrain             # semantic code search — see below
```

`.claude/settings.json` enables agent teams via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. Merge it into an existing settings file rather than overwriting.

### Verify before your first serious project

```bash
ls ~/.claude/skills/
find ~/.claude/skills -maxdepth 2 -name "SKILL.md" | head -50
# and inside Claude Code:
/plugin
```

Two skills referenced in v1 — `/spec` and `/diagram` — are **not** in gstack's published list. They may come from ECC or may not exist in your install. Confirm before relying on them; the affected agents are instructed to write the artifact by hand and report the substitution rather than silently skipping a stage.

**The highest-leverage edit available to you:** bind real skill names from ECC, Ruflo, UI/UX Pro Max, and karpathy-skills into the relevant agent bodies. Those ecosystems are referenced generically here because I could not inspect them. Named skills work far better than "invoke available skills."

---

## The gbrain optimisation — do this before your first team

`/sync-gbrain` registers the repo for semantic code search and writes guidance into `CLAUDE.md` so agents prefer `gbrain search` / `code-def` / `code-refs` over `Grep`.

This matters more in teams than solo: **every teammate starts with an empty context window** and greps around to orient. Four teammates orienting simultaneously is exactly the workload semantic search pays for.

Note the per-repo trust tier. Running several client codebases? Set client repos to **read-only** so an agent can search the shared brain without writing one client's patterns into another's.

---

## The 21 roles

| # | Role | Model | Writes? | Browser? |
|---|---|---|---|---|
| 01 | CTO / Delivery Lead | Opus | Yes | Via QA |
| 02 | Product / CEO Strategist | Opus | Docs only | No |
| 03 | Business Analyst / Spec | Sonnet | Specs only | No |
| 04 | Solutions Architect | Opus | Plans only | No |
| 05 | UX Researcher | Sonnet | Docs only | No |
| 06 | Design Director | Opus | Tokens, DESIGN.md | No |
| 07 | Frontend Lead | Sonnet | Yes | No |
| 08 | Backend Lead | Sonnet | Yes | No |
| 09 | Database / Data Engineer | Opus | Yes — sole migration owner | No |
| 10 | AI / Agent Engineer | Opus | Yes | No |
| 11 | Integration Engineer | Sonnet | Yes | No |
| 12 | QA / Browser Lead | Sonnet | **No** | **Yes — exclusive** |
| 13 | Security / CSO | Opus | **No** | No |
| 14 | Performance Engineer | Sonnet | **No** | Via QA |
| 15 | Staff Code Reviewer | Opus | **No** | No |
| 16 | Adversarial / Second-Model | Sonnet | **No** | No |
| 17 | DevEx Engineer | Opus | **No** | Via QA |
| 18 | DevOps / SRE | Sonnet | Yes | Via QA |
| 19 | Release Manager | Sonnet | Yes | Via QA |
| 20 | Observability / Learning | Sonnet | Yes | Via QA |
| 21 | Documentation Engineer | Sonnet | Docs only | No |

Roles 12-17 carry no `Write` or `Edit` in their `tools:` allowlist. **That restriction is enforced by the platform** and is what makes it safe to run them in parallel with implementers.

---

## The three rules that prevent data loss

Detail in `.claude/rules/agent-teams.md`. In short:

1. **One browser owner per mission.** The browse daemon is a single Chromium session; two drivers corrupt each other's state and produce phantom bugs.
2. **Auto-committing skills never run in a teammate.** `/review`, `/qa`, `/design-review`, `/skillify`, `/ship`, `/land-and-deploy` — lead only, after implementers stop.
3. **Every implementer runs `/freeze <glob>` first.** File ownership is convention; `/freeze` makes it real.

---

## Running it

Start with `docs/MISSIONS.md`. Mission 1 (four-lens plan review) is the right first run — read-only, four teammates, cannot corrupt anything, and it produces the file-ownership map every later mission depends on.

Do not start at Mission 4. Parallel implementation is where file conflicts and coordination failures appear, and you want the review and debug patterns in muscle memory first.

---

## Cost

Token cost scales linearly per teammate; each has its own context window, and gstack skills are themselves long structured prompts. Stacking multiplies.

- Set **Default teammate model** to Sonnet in `/config`; keep an Opus lead.
- Start at 3 teammates. Three focused beat five scattered.
- Read-only missions (1, 2, 3) have the clearest return — they catch defects before a client does and cannot corrupt the repo.
- Mission 4 is hardest to justify on cost. Try it once the others are routine.

---

## Known limitations

Agent teams are experimental: no session resumption with in-process teammates, task status can lag, one team per session, no nested teams, lead is fixed for the session, permissions set at spawn from the lead's mode, split panes need tmux or iTerm2 (hence `teammateMode: in-process`).

gstack moves fast — verify skill names against your installed version and use `/gstack-upgrade`.

---

## Rollout

| Week | Do |
|---|---|
| 1 | Install. Run Mission 1 on a plan you already understand. Nothing writes. |
| 2 | Mission 2 on a real branch. Mission 3 next time a bug is genuinely unclear. |
| 3 | Bind real ECC / Ruflo / UI-UX skill names into agent bodies. Run `/sync-gbrain`. |
| 4 | Mission 4 on a low-stakes internal feature. Watch for file conflicts. |
| 5+ | Tune hooks and permissions. Mission 6 for the next infrastructure migration. |
