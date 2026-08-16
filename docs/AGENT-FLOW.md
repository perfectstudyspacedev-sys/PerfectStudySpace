# Agent Flow

## Standard software delivery

```text
Client request
  ↓
CTO
  ↓
Office hours / product challenge
  ↓
CEO review
  ↓
Spec
  ↓
Autoplan
  ├─ CEO review
  ├─ Design review
  ├─ Engineering review
  └─ DevEx review
  ↓
Execution graph
  ├─ Frontend
  ├─ Backend
  ├─ Database
  ├─ AI
  └─ Integrations
  ↓
Integration
  ↓
QA + Security + Performance
  ↓
Visual review when relevant
  ↓
Staff review
  ↓
Second-model/adversarial review when required
  ↓
DevEx review when appropriate
  ↓
Ship
  ↓
Land + Deploy
  ↓
Canary
  ↓
Document
  ↓
Retro + Learn
```

## Escalation

Escalate to the CTO when:

- requirements conflict
- architecture changes after implementation begins
- a security issue is material
- migration/deployment risk is high
- two agents disagree on a critical decision
- production behavior is uncertain

## Parallelism

Parallelize only independent work:

Good:
- frontend + backend + DB after interfaces are defined

Bad:
- two agents simultaneously rewriting the same service

Use isolated worktrees where parallel implementation can collide.
