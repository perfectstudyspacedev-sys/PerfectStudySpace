# Architecture Rules

- Prefer explicit boundaries and simple dependencies.
- Avoid architecture that solves hypothetical scale before measured need.
- Separate domain logic from transport/infrastructure concerns.
- Define data flow and failure modes for non-trivial systems.
- Treat authentication, authorization and trust boundaries as architecture concerns.
- Do not introduce a new framework or service without a concrete requirement.
- Document important irreversible decisions.
- Prefer reversible changes and migration-safe rollout patterns.
