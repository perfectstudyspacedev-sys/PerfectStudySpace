# Skill Routing

## Stack responsibilities

### Anthropic official
Trusted baseline for Claude Code, official tooling, frontend, security, review, language support, MCP, and code-development workflows.

### ECC
Engineering specialists:
- architecture
- backend
- frontend
- testing/TDD
- security
- DevOps
- debugging
- refactoring
- documentation
- research-first workflows
- hooks/rules
- language/framework expertise

### gstack
Workflow system:
- product discovery
- specification
- planning
- design
- browser QA
- security
- performance
- review
- DevEx
- ship/deploy
- canary
- docs
- learning
- safety
- cross-model review

### UI/UX Pro Max
Design intelligence:
- UX
- UI
- typography
- color
- layout
- components
- accessibility
- responsive behavior
- visual quality

### Karpathy
Behavioral quality:
- no assumptions
- expose confusion
- simplicity
- surgical edits
- verify goal

### Ruflo
Orchestration and memory:
- task routing
- swarm execution
- memory
- RAG
- coordination
- learned patterns

---

## Preload versus discover

Preload skills only when they are central to the role.

Example:

Frontend:
```yaml
skills:
  - frontend-design
  - ui-ux-pro-max
  - testing
```

Architect:
```yaml
skills:
  - architecture
  - gstack:/plan-eng-review
  - security
```

Do not preload the entire ecosystem.

---

## Dynamic capabilities

When a project needs:
- payments -> activate payment/integration skills
- WhatsApp -> activate messaging/Meta skills
- Supabase -> activate PostgreSQL/RLS/Supabase skills
- iOS -> activate gstack iOS workflows
- data extraction -> activate `/scrape`
- reusable workflow creation -> activate `/skillify`
- multi-model comparison -> activate `/benchmark-models`
- dangerous production work -> activate `/careful`, `/freeze`, `/guard`

---

## Quality routing

```text
UI issue          -> Design Director + Frontend + /design-review
Bug                -> QA + /investigate + implementation owner
Security issue     -> Security/CSO + implementation owner
Performance issue  -> Performance + relevant engineer
Code quality       -> Staff Reviewer
Critical review    -> Staff Reviewer + /codex
Production issue   -> SRE + /investigate + CTO
Knowledge gap      -> Research + /learn
```
