# gstack Skill Coverage Audit

Every gstack skill, mapped to an owner or explicitly marked unassigned with a reason. Nothing silently dropped.

Source list: https://github.com/garrytan/gstack/blob/main/docs/skills.md

---

## Assigned to teammate roles

| Skill | Owner role | Notes |
|---|---|---|
| `/office-hours` | `ceo-strategist` | Solo-first; a team adds nothing to a conversation |
| `/plan-ceo-review` | `ceo-strategist` | HOLD SCOPE is the default on client work |
| `/plan-eng-review` | `eng-manager` | The only *required* gate in gstack's dashboard |
| `/plan-design-review` | `design-partner` | Cheapest time to fix a design gap |
| `/plan-devex-review` | `devex-reviewer` | Static, no browser needed |
| `/devex-review` | `devex-reviewer` | Live — needs qa-lead's browser |
| `/autoplan` | `eng-manager` | Solo alternative to the Mission 1 team |
| `/design-consultation` | `design-partner` | Once per project, early |
| `/design-shotgun` | `design-partner` | When direction is genuinely unclear |
| `/design-html` | `design-partner`, `frontend-engineer` | Only on an assigned mockup-to-code task |
| `/review` | `staff-reviewer` | Read-only in team mode — auto-fix blocked by allowlist |
| `/cso` | `security-reviewer` | OWASP + STRIDE |
| `/codex` | `second-opinion` | Requires Codex CLI installed |
| `/investigate` | `debug-investigator` | Auto-activates `/freeze` on the debugged module |
| `/qa-only` | `qa-lead` | Report-only variant — the team-safe one |
| `/browse` | `qa-lead` | Exclusive |
| `/scrape` | `qa-lead` | Exclusive |
| `/skillify` | `qa-lead` | Commits — decline while implementers run |
| `/setup-browser-cookies` | `qa-lead` | Before testing anything behind login |
| `/open-gstack-browser` | `qa-lead` | Headed mode, CAPTCHA/MFA handoff |
| `/benchmark` | `qa-lead` | `perf-reviewer` requests, qa-lead runs |
| `/canary` | `release-engineer`, `devops-engineer` | Via qa-lead's browser |
| `/ship` | `release-engineer` | Lead or solo session only |
| `/land-and-deploy` | `release-engineer` | Never in a teammate |
| `/setup-deploy` | `devops-engineer` | Once per project, outside a mission |
| `/document-release` | `release-engineer`, `docs-writer` | Before merge |
| `/document-generate` | `docs-writer` | Diataxis docs from code |
| `/health` | `test-engineer`, `eng-manager`, `backend-engineer` | Run at mission start and end |
| `/learn` | `eng-manager` | Read accumulated project knowledge before planning |
| `/freeze` | All implementer roles | **First action, every mission** |
| `/unfreeze` | Nobody, deliberately | Reaching across a boundary means messaging the owner instead |
| `/careful` | `data-engineer`, `devops-engineer` | |
| `/guard` | `data-engineer`, `devops-engineer`, `release-engineer` | `/careful` + `/freeze` |

## Lead-only — deliberately not given to any teammate

These run in the main session. Sending them to a teammate either breaks something or wastes tokens.

| Skill | Why lead-only |
|---|---|
| `/qa` | Fixes bugs and commits autonomously. Run after implementers shut down. |
| `/design-review` | Auto-commits up to 30 style fixes to files teammates hold. |
| `/retro` | Reads commit history per human contributor. Weekly ritual, not mission work. |
| `/context-save` / `/context-restore` | Session-level state. See the lead rituals below — these partly mitigate agent teams' lack of in-process teammate resumption. |
| `/landing-report` | Read-only view of the workspace ship queue. A lead's situational awareness. |
| `/plan-tune` | Tunes question sensitivity for your own preferences. Personal config. |
| `/gstack-upgrade` | Modifies the skill install itself. Never mid-mission. |
| `/setup-gbrain` / `/sync-gbrain` | Setup-time. See "the gbrain optimisation" below — worth doing before your first team. |
| `/benchmark-models` | Cross-model skill benchmarking. Evaluation work, not delivery. |
| `/pair-agent` | Bridges a remote agent to your browser. Conflicts with qa-lead's exclusivity. |
| `/make-pdf` | Utility. Use it on a handover doc when a client wants a PDF. |

---

## Two things worth doing before your first mission

### The gbrain optimisation

`/setup-gbrain` and `/sync-gbrain` register the repo for semantic code search and write a guidance block into `CLAUDE.md` so agents prefer `gbrain search` / `code-def` / `code-refs` over `Grep`.

This matters more for teams than for solo sessions. **Every teammate starts with an empty context window and no conversation history** — the first thing each one does is grep around trying to orient. Semantic code search across four simultaneously-orienting teammates is a meaningful reduction in both tokens and wrong turns.

There is a per-repo trust tier worth knowing about if you run client work: **read-only** lets an agent search the shared brain without writing back, which keeps Client A's patterns out of Client B's repo. For a studio running several client codebases, set client repos to read-only and your own products to read-write.

### The context-save ritual

Agent teams cannot resume in-process teammates — `/resume` and `/rewind` do not restore them, and the lead may then try to message teammates that no longer exist.

`/context-save` does not fix that, but it preserves the *thinking*: git state, decisions made, work remaining. Run it before ending any mission that took real effort. Then `/context-restore` in the next session and spawn fresh teammates against the restored context rather than reconstructing from scratch.

Treat it as the mission's closing ritual, the same way `/freeze` is its opening one.

---

## Coverage summary

- **33 skills** bound to teammate roles
- **11 skills** deliberately lead-only, each with a stated reason
- **1 skill** (`/unfreeze`) deliberately unassigned

The unassigned-by-design set is the point of this document: an integration that silently drops a third of a toolkit looks complete until the day you need the missing piece. If gstack ships new skills — it moves fast — add them here first and decide the owner before use, rather than letting them arrive unowned.
