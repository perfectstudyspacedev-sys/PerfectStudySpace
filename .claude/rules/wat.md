# WAT Rules — Workflows · Agents · Tools

The reliability argument: five chained steps at 90% accuracy leaves you at 59%. Reasoning is probabilistic; scripts are not. Push execution down into scripts and keep reasoning for judgement.

## 1. Tool-first, always

Before doing a mechanical task by reasoning, check `tools/` for a script that already does it. Mechanical means: API calls, data transforms, file operations, exports, report generation, database queries, format conversions.

Only write a new tool when nothing exists. Only reason through it inline when it is genuinely one-off.

**The test:** if you would produce a slightly different result running this twice, it belongs in a script.

## 2. Never invent a tool's behaviour

Read the script before calling it. Do not infer arguments from the filename. If a tool fails, read the full trace before changing anything.

## 3. Paid calls need approval

Before re-running any tool that consumes paid API credits, inference tokens, or metered third-party quota — **ask first.** State what it will cost or roughly how much. A retry loop on a paid endpoint is the most expensive failure mode available to an agent.

## 4. Workflows are preserved, not replaced

`workflows/*.md` are standing instructions. **Do not create or overwrite a workflow without asking**, unless explicitly told to.

You may *append* to a workflow's "Learned constraints" section when you discover a rate limit, a timing quirk, or an undocumented behaviour. That is the improvement loop working.

## 5. The failure loop

When a tool breaks:
1. Read the full error and trace.
2. Fix the script.
3. Verify the fix — actually run it (subject to rule 3).
4. Append what you learned to the workflow's "Learned constraints".
5. Continue.

A fixed tool with no workflow note will break the same way for the next agent.

## 6. File discipline

| Location | Contains | Lifetime |
|---|---|---|
| `.tmp/` | Scraped data, intermediate exports, working files | Disposable, regenerate freely |
| `tools/` | Deterministic scripts | Committed |
| `workflows/` | SOPs | Committed, preserved |
| `.env` | Every secret | Never committed, never read into context |

**Deliverables go where the human can reach them** — the cloud service, the repo, `/mnt/user-data/outputs`. Not `.tmp/`. Local files are for processing.

## 7. Codify what repeats

When you notice yourself or another agent reasoning through the same mechanical sequence a second time, that is a tool waiting to be written. Say so.

`/skillify` does this automatically for browser work — it turns a `/scrape` prototype into a script, a test, and a fixture. **Run it in the lead session after a mission**, never in a teammate while implementers hold files.
