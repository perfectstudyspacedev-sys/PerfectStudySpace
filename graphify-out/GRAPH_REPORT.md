# Graph Report - perfect-study-space  (2026-08-31)

## Corpus Check
- 136 files · ~187,478 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 539 nodes · 1127 edges · 52 communities (16 shown, 8 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- pages
- .claude/agents
- migrations
- functions/api
- perfect-study-space/docs
- pages
- hooks
- package.json
- .claude/rules
- .claude/rules
- .claude/rules
- .claude/rules
- perfect-study-space/docs
- PERFECT-STUDY-SPACE/perfect-study-space
- PERFECT-STUDY-SPACE/perfect-study-space
- tools
- migrations
- hooks
- hooks
- hooks
- misc
- migrations
- vercel.json
- skills/find-skills

## God Nodes (most connected - your core abstractions)
1. `api()` - 60 edges
2. `useAuth()` - 35 edges
3. `formatDate()` - 29 edges
4. `branches` - 29 edges
5. `formatCurrency()` - 27 edges
6. `todayISO()` - 25 edges
7. `Agent Handbook` - 25 edges
8. `Tools Layer (WAT) Convention` - 21 edges
9. `Standard Agent Report Format` - 21 edges
10. `staff` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Skills CLI (npx skills)` --semantically_similar_to--> `/skillify`  [INFERRED] [semantically similar]
  .agents/skills/find-skills/SKILL.md → .claude/agents/01-cto-delivery-lead.md
- `Parallelism Guidance` --conceptually_related_to--> `Agent Teams Rules`  [INFERRED]
  docs/AGENT-FLOW.md → .claude/rules/agent-teams.md
- `Explain Codebase Skill` --semantically_similar_to--> `21 Documentation Engineer`  [INFERRED] [semantically similar]
  .claude/skills/explain-codebase/SKILL.md → docs/AGENT-HANDBOOK.md
- `The gbrain Optimisation (Coverage Doc)` --semantically_similar_to--> `The gbrain Optimisation`  [INFERRED] [semantically similar]
  docs/SKILL-COVERAGE.md → SETUP.md
- `The 21 Roles Table` --conceptually_related_to--> `Agent Handbook`  [INFERRED]
  SETUP.md → docs/AGENT-HANDBOOK.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Independent Review Pipeline (QA -> Security -> Performance -> Staff -> Adversarial -> Release)** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_13_security_cso_security_cso, claude_agents_14_performance_engineer_performance_engineer, claude_agents_15_staff_code_reviewer_staff_code_reviewer, claude_agents_16_adversarial_second_model_reviewer_adversarial_second_model_reviewer, claude_agents_19_release_manager_release_manager [INFERRED 0.85]
- **Single Browser Owner Convention (QA/Browser Lead exclusivity)** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_06_design_director_design_director, claude_agents_18_devops_sre_devops_sre, claude_agents_19_release_manager_release_manager, claude_agents_20_observability_learning_engineer_observability_learning_engineer [INFERRED 0.85]
- **Numbered Company Delivery Pipeline (01 CTO -> 21 Documentation)** — claude_agents_01_cto_delivery_lead_cto_delivery_lead, claude_agents_02_product_ceo_strategist_product_ceo_strategist, claude_agents_03_business_analyst_spec_business_analyst_spec, claude_agents_04_solutions_architect_solutions_architect, claude_agents_05_ux_researcher_ux_researcher, claude_agents_06_design_director_design_director, claude_agents_07_frontend_lead_frontend_lead, claude_agents_08_backend_lead_backend_lead, claude_agents_09_database_data_engineer_database_data_engineer, claude_agents_10_ai_agent_engineer_ai_agent_engineer, claude_agents_11_integration_engineer_integration_engineer, claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_13_security_cso_security_cso, claude_agents_14_performance_engineer_performance_engineer, claude_agents_15_staff_code_reviewer_staff_code_reviewer, claude_agents_16_adversarial_second_model_reviewer_adversarial_second_model_reviewer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_18_devops_sre_devops_sre, claude_agents_19_release_manager_release_manager, claude_agents_20_observability_learning_engineer_observability_learning_engineer, claude_agents_21_documentation_engineer_documentation_engineer [INFERRED 0.85]
- **WAT Framework Three Layers (Workflows, Agents, Tools)** — claude_rules_wat, tools_readme, workflows_readme [INFERRED 0.85]
- **Three Rules That Prevent Data Loss in Agent Teams** — claude_rules_agent_teams_one_browser_owner, claude_rules_agent_teams_auto_committing_skills, claude_rules_agent_teams_freeze_first [EXTRACTED 1.00]
- **Mission 1 Four-Lens Plan Review Team** — docs_agent_handbook_product_ceo_strategist, docs_agent_handbook_design_director, docs_agent_handbook_devex_engineer, docs_agent_handbook_solutions_architect [EXTRACTED 1.00]

## Communities (52 total, 8 thin omitted)

### Community 0 - "pages"
Cohesion: 0.06
Nodes (81): App(), OwnerRoute(), ProtectedRoute(), Shell(), isSplitValid(), PaymentModeSelector(), FALLBACK_FEES, WALKIN_HOUR_OPTIONS (+73 more)

### Community 1 - ".claude/agents"
Cohesion: 0.07
Nodes (69): Find Skills Skill, Skills CLI (npx skills), /autoplan, /context-save, CTO / Delivery Lead, /health, /landing-report, /learn (+61 more)

### Community 2 - "migrations"
Cohesion: 0.09
Nodes (34): alerts, bookings, branches, desks, fee_config, food_bill_items, food_bills, food_items (+26 more)

### Community 3 - "functions/api"
Cohesion: 0.06
Nodes (31): addDays(), addMonths(), adminClient(), authStaff(), buildDateBuckets(), CbRow, computeDeleteSettlement(), computeStudentStatus() (+23 more)

### Community 4 - "perfect-study-space/docs"
Cohesion: 0.09
Nodes (40): Explain Codebase Skill, Agent Flow, Escalation Triggers, Parallelism Guidance, Standard Software Delivery Pipeline, Agent Handbook, 16 Adversarial / Second-Model Reviewer, 10 AI / Agent Engineer (+32 more)

### Community 5 - "pages"
Cohesion: 0.09
Nodes (34): chartTooltip(), exportToCSV(), formatDateTime(), paymentModeLabel(), ACT_ICON, CombinedEnquiriesView(), dupKey(), EnquiriesPage() (+26 more)

### Community 6 - "hooks"
Cohesion: 0.12
Nodes (25): TOAST_META, AuthContext, AuthProvider(), isToday(), loadSeen(), saveSeen(), seenKey(), useMessageAlerts() (+17 more)

### Community 7 - "package.json"
Cohesion: 0.07
Nodes (26): dependencies, react, react-dom, react-router-dom, recharts, @supabase/supabase-js, devDependencies, @types/deno (+18 more)

### Community 8 - ".claude/rules"
Cohesion: 0.18
Nodes (16): WAT Rules — Workflows · Agents · Tools, The Failure Loop, Paid Calls Need Approval, Tool-First, Always, Workflows Are Preserved, Not Replaced, WAT Operating Model (§14), WAT Framework Compliance Audit, Five Chained Steps at 90% Accuracy Leaves You at 59% (+8 more)

### Community 9 - ".claude/rules"
Cohesion: 0.17
Nodes (15): Agent Teams Rules, Auto-Committing Skills Never Run in a Teammate, Every Implementer Runs /freeze First, One Browser Owner Per Mission, Publish Contracts Early, Read-Only Roles Have No Write or Edit, Report Failures; Do Not Route Around Them, Skills Are Not Bound Per Teammate (+7 more)

### Community 10 - ".claude/rules"
Cohesion: 0.15
Nodes (14): Company Claude OS v2 (CLAUDE.md), Default Ownership Map, Architecture Rules, Prefer Explicit Boundaries and Simple Dependencies, Treat Authn/Authz and Trust Boundaries as Architecture Concerns, Git Rules, Keep Commits Focused and Understandable, Do Not Rewrite Shared History Without Approval (+6 more)

### Community 11 - ".claude/rules"
Cohesion: 0.18
Nodes (11): AI Systems Rules, Cost Per Request Is a Design Constraint, Ships With an Eval Set, or Does Not Ship, Guardrails Are Not Optional on User-Facing Generation, Irreversible Actions Need an Approval Gate Outside the Model, Retrieved Content Is Data, Never Instructions, Trace Everything, Security Rules (+3 more)

### Community 12 - "perfect-study-space/docs"
Cohesion: 0.22
Nodes (9): gstack Skill Coverage Audit, Skills Assigned to Teammate Roles, The gbrain Optimisation (Coverage Doc), Lead-Only Skills, Skill Routing, Ecosystem Stack Responsibilities Table, Preload Versus Discover, Quality Routing Table (+1 more)

### Community 13 - "PERFECT-STUDY-SPACE/perfect-study-space"
Cohesion: 0.33
Nodes (6): Perfect Study Space Project Profile (§16), Perfect Study Space HTML Entry Point, Perfect Study Space README, PSS Features, PSS Role Access Table, PSS Tech Stack

### Community 14 - "PERFECT-STUDY-SPACE/perfect-study-space"
Cohesion: 0.40
Nodes (5): Team Sizing — Start at Three, Company Claude OS v2 Setup Guide, The 21 Roles Table, Layered Architecture (Roles/Rules/Guardrails/Permissions/Skills), Three Rules That Prevent Data Loss

### Community 15 - "tools"
Cohesion: 0.67
Nodes (3): main(), Do the actual work. Keep this deterministic., run()

## Knowledge Gaps
- **99 isolated node(s):** `task-completed-gate.sh script`, `teammate-idle-gate.sh script`, `tool-cost-guard.sh script`, `name`, `private` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 194 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `api()` connect `pages` to `pages`, `hooks`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `Company Claude OS v2 (CLAUDE.md)` connect `.claude/rules` to `.claude/rules`, `.claude/rules`, `.claude/rules`, `perfect-study-space/docs`, `PERFECT-STUDY-SPACE/perfect-study-space`, `PERFECT-STUDY-SPACE/perfect-study-space`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `Agent Handbook` connect `perfect-study-space/docs` to `perfect-study-space/docs`, `PERFECT-STUDY-SPACE/perfect-study-space`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `task-completed-gate.sh script`, `teammate-idle-gate.sh script`, `tool-cost-guard.sh script` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pages` be split into smaller, more focused modules?**
  _Cohesion score 0.05713218820014936 - nodes in this community are weakly interconnected._
- **Should `.claude/agents` be split into smaller, more focused modules?**
  _Cohesion score 0.07033248081841433 - nodes in this community are weakly interconnected._
- **Should `migrations` be split into smaller, more focused modules?**
  _Cohesion score 0.08525506638714186 - nodes in this community are weakly interconnected._