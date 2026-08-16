# Tools

Deterministic Python scripts. This is the layer that makes the system reliable — everything else is probabilistic.

## Conventions

- One task per script. If it needs an "or", split it.
- Arguments via `argparse`, never positional-by-convention.
- Secrets from `.env` via `os.environ`. **Never hardcoded, never printed, never logged.**
- Exit `0` on success, non-zero on failure. Errors to stderr.
- Structured output to stdout — JSON if another tool consumes it.
- Idempotent where possible. Running twice should not double-charge or double-write.
- A docstring at the top stating what it does, what it needs, and **whether it costs money**.

## Cost marking

Any script that consumes paid API credits, inference tokens, or metered quota must declare it in the docstring:

```python
"""COST: ~$0.02 per run (Claude API, ~4k tokens)."""
```

Agents are required to ask before re-running a cost-marked tool.

## Where tools come from

Not from planning sessions. From noticing that an agent re-derived the same mechanical sequence twice, and codifying it.

`/skillify` does this automatically for browser work. Run it in the lead session after a mission.
