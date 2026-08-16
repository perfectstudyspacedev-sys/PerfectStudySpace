# Mission Templates

Ready-to-paste team compositions. One session gets one team — pick the mission, spawn the roster, finish, exit.

**Order matters.** Missions 1-3 are read-only and cannot corrupt the repo. Do those until they feel routine before attempting Mission 4.

---

## Mission 0 — Discovery (lead only, no team)

```text
/office-hours
```

A conversation. A team adds nothing to a conversation.

---

## Mission 1 — Four-lens plan review (4 teammates, read-only) ⭐ start here

```text
Create an agent team to review the plan for [feature].

Spawn four teammates:
- product-ceo-strategist, named "ceo" — /plan-ceo-review in HOLD SCOPE mode
- design-director, named "design" — /plan-design-review
- devex-engineer, named "dx" — /plan-devex-review
- solutions-architect, named "arch" — /learn first, then /plan-eng-review

Have ceo and arch argue directly about any scope expansion arch thinks is
unbuildable in the estimate. Have design challenge arch on any interaction
state the architecture makes expensive. Have dx challenge both on anything
that raises time-to-hello-world.

arch produces the final file-ownership map and names the browser owner.
Synthesise all four into one plan.
```

Four, not three — `/autoplan` runs CEO → Design → Eng → DevEx, so a three-teammate version runs three-quarters of the gate. This is `/autoplan` with real adversarial pressure instead of auto-resolved decisions. Use `/autoplan` solo for routine work; use this for anything that matters.

---

## Mission 2 — Four-lens code review (4 teammates, read-only)

```text
Create an agent team to review this branch against main.

Spawn four teammates, all read-only:
- staff-code-reviewer, named "staff" — /review, report findings, do NOT apply fixes
- security-cso, named "sec" — /cso
- adversarial-second-model-reviewer, named "codex" — /codex review, then /codex challenge
- performance-engineer, named "perf" — static analysis; message qa for measurements

Have staff and codex compare findings explicitly and report OVERLAP,
UNIQUE-TO-CLAUDE, and UNIQUE-TO-CODEX.
Have sec and perf message each other on anything that is both.

Rank everything into one list. Fix nothing.
```

Add `devex-engineer` as a fifth when the change touches onboarding, setup, or docs — spawn `qa-browser-lead` alongside it, since `/devex-review` needs the browser.

---

## Mission 3 — Competing-hypothesis debug (5 teammates, read-only)

```text
Bug: [precise symptom, when it started, what changed, what you already ruled out].

Spawn 5 teammates using the solutions-architect agent type, named
"cache", "auth", "race", "data", "infra" — each investigating ONLY its
named hypothesis with /investigate under the Iron Law: no fixes without
root cause.

Have them message each other and actively try to disprove each other's
theories, like a scientific debate.

Nobody fixes anything. Write the surviving theory and its evidence to
docs/investigations/.
```

The adversarial framing is the mechanism. A single agent finds one plausible cause and stops; five attacking each other beat the anchoring problem.

---

## Mission 4 — Cross-layer feature build (4-5 teammates)

The riskiest mission. Not until 1-3 are routine.

```text
Create an agent team to implement the plan at [path].

Spawn:
- database-data-engineer, named "schema", owning migrations/** and src/db/**
- backend-lead, named "api", owning src/api/** and src/services/**
- frontend-lead, named "ui", owning src/components/** and src/screens/**
- qa-browser-lead, named "qa" — sole browser owner, /qa-only, report don't fix

Every teammate runs /freeze on its glob as its first action.
schema also runs /careful.

Sequencing:
- schema publishes the final table shape to api before api starts
- api publishes the endpoint contract to ui before ui builds against it
- qa tests against the plan's acceptance criteria, not the implementation

Require plan approval from schema before it makes any changes.
Only approve plans that include a rollback path.
Wait for all teammates to finish before you synthesise.
```

**Then, after every teammate has shut down**, the lead runs the auto-committing skills solo:

```text
/review     # safe to auto-fix now — nobody else holds these files
/qa         # full fixing mode with regression tests
/health     # end-of-mission quality score
```

Add `ai-agent-engineer` or `integration-engineer` as a fifth when the feature has an AI or third-party surface.

---

## Mission 5 — Ship (lead only, no team)

```text
/ship
/document-release
/land-and-deploy
/canary
```

**Never as a team.** These sync main, push, merge, and deploy. Any teammate still holding files when `/ship` syncs will lose work or ship half of it.

---

## Mission 6 — Infrastructure migration (3 teammates)

```text
Create an agent team to migrate [project] to [target stack].

Spawn:
- devops-sre, named "infra", owning docker/**, Caddyfile, .github/workflows/**
- database-data-engineer, named "data", owning migrations/** and export/import scripts
- backend-lead, named "app", owning src/** — client SDK swaps and auth only

infra and data run /guard first.

Rules:
- data produces a VERIFIED RESTORE before infra points anything at the new
  database. A backup that has not been restored from does not count.
- infra writes rollback for every step into docs/runbooks/ as it goes.
- Nothing touches production DNS without messaging me first.

Require plan approval from all three.
```

---

## Mission 6.5 — Codify (lead only, after every mission)

The step that stops the system from staying purely probabilistic. Run it as mission close-out, not as a separate occasion.

```text
Review what just happened. For each teammate, identify any mechanical sequence
they reasoned through that should have been a deterministic script —
API calls, data reshaping, exports, report formatting, repeated queries.

For each one:
- If it is clearly repeatable, write the tool now using tools/_template.py
  and mark COST in the docstring if it spends money.
- If it is not yet clear, log it in workflows/ under Learned constraints.

Then run /skillify if any browser prototyping happened this mission.
```

Three to five real tools will do more for reliability than another agent would. If a month passes and `tools/` is still empty, the system is not improving — it is just running.

---

## Mission 7 — Learn (lead only)

```text
/retro
/learn
/context-save
```

Weekly. `/context-save` is the closing ritual of any mission that took real effort — teammates cannot be resumed, so the thinking has to be persisted deliberately.

---

## Decision table

| Situation | Use |
|---|---|
| New product idea | Solo `/office-hours` |
| Routine plan review | Solo `/autoplan` |
| High-stakes plan review | **Mission 1** |
| Routine PR review | Solo `/review` |
| Pre-release or security-sensitive | **Mission 2** |
| Bug with obvious cause | Solo `/investigate` |
| Bug nobody can explain | **Mission 3** |
| Single-layer feature | Solo, sequential pipeline |
| Cross-layer feature, independent files | **Mission 4** |
| A mechanical step repeated twice | Write a tool — not another agent |
| Anything that pushes, merges, deploys | **Always solo** |
| Ten unrelated features at once | Neither — parallel worktrees (gstack's Conductor model) |

The last row matters. If the bottleneck is "many independent projects," agent teams are the wrong tool. They solve "one problem with several independent facets."
