# Workflow: <name>

## Objective
What this achieves, in one or two sentences. Written for someone who has never done it.

## When to use
The trigger. What situation means "run this workflow."

## Required inputs
| Input | Type | Source | Required |
|---|---|---|---|
| example_id | string | Client brief | yes |

## Tools used
| Step | Tool | Purpose |
|---|---|---|
| 1 | `tools/example.py` | What it does |

Never re-implement a step that has a tool. If a step here has no tool and repeats, that is a gap — flag it.

## Steps
1. …
2. …
3. …

## Expected output
What exists when this is done, and **where it lives**. If it's a deliverable, name the cloud destination — not `.tmp/`.

## Edge cases
| Situation | Handling |
|---|---|
| Input missing | Ask; do not guess |
| Tool fails | Read trace, fix, verify, append to Learned constraints |
| Paid call retry | **Ask before re-running** |

## Learned constraints
Append here as you discover things. Rate limits, timing quirks, undocumented behaviour, pagination gotchas. Date each entry.

- *(empty)*

## Do not
- Overwrite this workflow without asking
- Skip a step because it seems unnecessary this time
