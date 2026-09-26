# Graph Report - perfect-study-space  (2026-09-26)

## Corpus Check
- 23 files · ~200,301 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 671 nodes · 1270 edges · 131 communities (37 shown, 65 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.82)
- Token cost: 627,656 input · 0 output

## Community Hubs (Navigation)
- Edge Function API Core
- Core Database Schema
- App Shell, Auth & API Client
- Missions, WAT Audit & Tools
- NPM Package Manifest
- CTO Orchestration & Learning Loop
- Membership & Students UI
- Agent Discipline & Report Format
- Release, DevOps & Docs Roles
- QA, Frontend & Design Roles
- Notification Bell & Alert Hooks
- Backend, Database & Ownership Map
- Delivery Pipeline & Review Roles
- Revenue & Reports Pages
- Claude OS Setup & Merge Notes
- Student Profile & Payment Modes
- Food Menu & Formatting Utils
- Enquiries Pipeline UI
- Active Session & Checkout UI
- Dashboard & Walk-in Flow
- Architect & Plan Review Gate
- Explain & Find Skills
- Project Overview & Access Roles
- Enquiries Schema
- Inventory Schema
- Tasks & Recurring Routines UI
- Membership Plan Changes Schema
- Membership Edit History Schema
- Food Stock Logs Schema
- Food Inventory Logs Schema
- Planning, Review & Safety Gates
- Skills CLI Discovery
- Browser Ownership & Auto-Commit Rules
- Teammate Tool & Skill Limits
- Untrusted Input Rules
- Authorization & Least Privilege
- Secrets & File Discipline
- Locker Orphan Guard
- App Settings Schema
- Vercel Deploy Config
- Task Completed Gate Hook
- Teammate Idle Gate Hook
- Tool Cost Guard Hook
- Contracts & Failure Reporting
- Cost & Paid-Call Approval
- Approval Gates & Rollback
- Tracing & Smoke Verification
- Quality Gates & Success Criteria
- Brand Logo
- Hopes Locker Renumbering
- Bookings Table
- Core Operating Principles
- Team Sizing — start at 3
- Degrade Honestly
- Ships With An Eval Set, Or Does Not Ship
- Non-Determinism Changes Debugging
- Avoid Architecture Solving Hypothetical Scale
- Document Important Irreversible Decisions
- Prefer Explicit Boundaries And Simple Dependenci
- No New Framework/Service Without Concrete Requir
- Prefer Reversible, Migration-Safe Rollout Patter
- Separate Domain Logic From Transport/Infra
- Commit/PR Messages Describe The Outcome
- Keep Commits Focused And Understandable
- Inspect The Diff Before Committing
- Use Isolated Branches/Worktrees For Parallel Wor
- Do Not Mix Unrelated Refactors With Feature Work
- Do Not Rewrite Shared History Without Approval
- Use Canary/Observability Workflows For Meaningfu
- Escalate Uncertainty Instead Of Guessing
- Treat Database Migrations As Production Code
- Do Not Disable Security Controls To Make Deploym
- Verify Environment Configuration Before Deployme
- For AI Systems, Evaluate Prompt Injection/Tool A
- Review SSRF/XSS/CSRF/Injection/Privesc/Leakage/S
- Check Dependency And Supply-Chain Risk
- Protect Sensitive Logs And Telemetry
- Review Authentication And Authorization Separate
- Treat Webhooks As Untrusted; Design For Replay/I
- Use E2E/Browser Tests For Critical User Journeys
- Treat Test Failures As Evidence, Not Noise
- Integration Test Boundaries
- Do Not Hide Failing Tests With Skips
- Prefer Tests That Exercise Real Business Behavio
- Add Regression Coverage For Important Bug Fixes
- Re-Run The Relevant Test Suite After Changes
- Unit Test Core Logic
- Codify What Repeats
- The Failure Loop (read error, fix, verify, appen
- Never Invent A Tool's Behaviour
- Reliability Argument: 5 Chained Steps At 90% = 5
- Tool-First, Always
- Workflows Are Preserved, Not Replaced
- HTML Entry Point
- Overtime Sessions Table
- Payouts Table
- /unfreeze
- Staff Attendance Table
- Students Table
- Staff Table
- Memberships Table
- Staff Table (2)

## God Nodes (most connected - your core abstractions)
1. `CTO / Delivery Lead` - 35 edges
2. `formatDate()` - 29 edges
3. `api()` - 29 edges
4. `formatCurrency()` - 27 edges
5. `todayISO()` - 26 edges
6. `QA / Browser Engineering Lead` - 26 edges
7. `Frontend Lead` - 25 edges
8. `useAuth()` - 24 edges
9. `Database / Data Engineer` - 24 edges
10. `Release Manager` - 23 edges

## Surprising Connections (you probably didn't know these)
- `QA / Browser Engineering Lead` --semantically_similar_to--> `Security / CSO`  [INFERRED] [semantically similar]
  .claude/agents/12-qa-browser-lead.md → docs/AGENT-HANDBOOK.md
- `WAT Operating Model` --semantically_similar_to--> `gbrain Semantic Search Optimisation`  [INFERRED] [semantically similar]
  CLAUDE.md → SETUP.md
- `Staff Code Reviewer` --references--> `Greptile`  [EXTRACTED]
  docs/AGENT-HANDBOOK.md → .claude/agents/15-staff-code-reviewer.md
- `Mission 6 — Infrastructure migration` --references--> `/guard`  [EXTRACTED]
  docs/MISSIONS.md → .claude/agents/09-database-data-engineer.md
- `Mission 3 — Competing-hypothesis debug` --references--> `/investigate`  [EXTRACTED]
  docs/MISSIONS.md → .claude/agents/04-solutions-architect.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Single Browser Owner Constraint** — claude_agents_12_qa_browser_lead_qa_browser_lead, docs_agent_handbook_05_ux_researcher, docs_agent_handbook_06_design_director, docs_agent_handbook_07_frontend_lead, docs_agent_handbook_08_backend_lead, docs_agent_handbook_14_performance_engineer, docs_agent_handbook_17_devex_engineer, docs_agent_handbook_18_devops_sre, docs_agent_handbook_19_release_manager, docs_agent_handbook_20_observability_learning_engineer [EXTRACTED 1.00]
- **Pre-Implementation Planning Review Gate** — docs_agent_handbook_02_product_ceo_strategist, docs_agent_handbook_03_business_analyst_spec_author, docs_agent_handbook_04_solutions_architect, docs_agent_handbook_06_design_director, docs_agent_handbook_17_devex_engineer [EXTRACTED 1.00]
- **Read-Only Parallel Review Roles** — docs_agent_handbook_13_security_cso, docs_agent_handbook_14_performance_engineer, docs_agent_handbook_15_staff_code_reviewer, docs_agent_handbook_16_adversarial_second_model_reviewer, docs_agent_handbook_17_devex_engineer [INFERRED 0.85]
- **Safety Gates For Risky/Irreversible Actions** — claude_rules_ai_systems_irreversible_action_approval_gate, claude_rules_production_no_disabling_security_controls, claude_rules_production_rollback_strategy, claude_rules_wat_paid_calls_need_approval [INFERRED 0.75]
- **Verification-Before-Completion Discipline** — claude_rules_testing_define_success_before_implementing, claude_rules_testing_failures_as_evidence, claude_rules_production_quality_gates_required, claude_rules_git_inspect_diff_before_commit [INFERRED 0.75]
- **Browser Session Single-Ownership Pattern** — claude_rules_agent_teams_browser_exclusivity, claude_rules_agent_teams_qa_browser_lead, claude_rules_agent_teams_auto_committing_skills_segregation [INFERRED 0.80]
- **Four Mechanisms Fixed From v1 to v2** — merge_notes_skills_frontmatter_ignored, merge_notes_permissionmode_not_applied, merge_notes_tools_allowlist_enforced, merge_notes_browser_daemon_collision [EXTRACTED 1.00]
- **Rules Preventing Data Loss in Agent Teams** — setup_three_rules_data_loss, merge_notes_browser_daemon_collision, merge_notes_file_ownership_mechanism, claude_safety [INFERRED 0.85]
- **Read-only Attack Phase Agents (safe to run parallel with implementers)** — docs_agent_handbook_12_qa_browser_lead, docs_agent_handbook_13_security_cso, docs_agent_handbook_14_performance_engineer, docs_agent_handbook_15_staff_code_reviewer, docs_agent_handbook_16_adversarial_second_model_reviewer, docs_agent_handbook_17_devex_engineer [EXTRACTED 1.00]
- **Auto-Committing Skills Run Only In Lead Session** — docs_agent_handbook_review, docs_agent_handbook_qa, docs_agent_handbook_design_review, docs_agent_handbook_skillify, docs_agent_handbook_ship, docs_agent_handbook_land_and_deploy, docs_agent_handbook_01_cto_delivery_lead [EXTRACTED 1.00]
- **Execution Graph Build-Phase Agents (parallel after interfaces defined)** — docs_agent_handbook_07_frontend_lead, docs_agent_handbook_08_backend_lead, docs_agent_handbook_09_database_data_engineer, docs_agent_handbook_10_ai_agent_engineer, docs_agent_handbook_11_integration_engineer [EXTRACTED 1.00]
- **WAT Three-Layer Framework** — concept_wat_layer_workflows, concept_wat_layer_agents, concept_wat_layer_tools [EXTRACTED 1.00]
- **Read-only review missions 1-3** — docs_missions_mission1_four_lens_plan_review, docs_missions_mission2_four_lens_code_review, docs_missions_mission3_competing_hypothesis_debug [EXTRACTED 1.00]
- **Lead-only auto-committing skill governance** — concept_lead_only_skills, skill_qa, skill_design_review, skill_ship [EXTRACTED 1.00]

## Communities (131 total, 65 thin omitted)

### Community 0 - "Edge Function API Core"
Cohesion: 0.06
Nodes (33): addDays(), addMonths(), adminClient(), authStaff(), buildDateBuckets(), CbRow, computeDeleteSettlement(), computeStudentStatus() (+25 more)

### Community 1 - "Core Database Schema"
Cohesion: 0.13
Nodes (25): alerts, bookings, branches, desks, fee_config, food_bill_items, food_bills, food_items (+17 more)

### Community 2 - "App Shell, Auth & API Client"
Cohesion: 0.15
Nodes (21): OwnerRoute(), ProtectedRoute(), AuthContext, AuthProvider(), useAuth(), api(), COMBINED_HALL_ID, getStoredBranchId() (+13 more)

### Community 3 - "Missions, WAT Audit & Tools"
Cohesion: 0.09
Nodes (21): .tmp/ disposable intermediates directory, Five chained steps at 90% accuracy = 59% argument, WAT Layer 2 — Agents, WAT Layer 3 — Tools, WAT Layer 1 — Workflows, .claude/rules/wat.md, Mission 0 — Discovery, Mission 3 — Competing-hypothesis debug (+13 more)

### Community 4 - "NPM Package Manifest"
Cohesion: 0.07
Nodes (26): dependencies, react, react-dom, react-router-dom, recharts, @supabase/supabase-js, devDependencies, @types/deno (+18 more)

### Community 5 - "CTO Orchestration & Learning Loop"
Cohesion: 0.11
Nodes (26): Lead-only auto-committing skills, Escalation Criteria to CTO, CTO / Delivery Lead, Observability / Learning Engineer, Auto-Committing Skills Run Only In Lead (destructive in a team, safe solo), /context-restore skill, /context-save skill, /landing-report skill (+18 more)

### Community 6 - "Membership & Students UI"
Cohesion: 0.16
Nodes (23): DEV_MODE, formatCurrency(), formatDate(), getMultiMonthDiscount(), openWhatsApp(), shiftDate(), ActiveMembersTab(), CombinedMembershipView() (+15 more)

### Community 7 - "Agent Discipline & Report Format"
Cohesion: 0.17
Nodes (25): Karpathy Discipline, PreToolUse Cost Hook, Standard Report Format, Tools Layer (WAT), Product / CEO Strategist, Business Analyst / Spec Author, UX Researcher, AI / Agent Engineer (+17 more)

### Community 8 - "Release, DevOps & Docs Roles"
Cohesion: 0.15
Nodes (24): Greptile, DevOps / SRE, Release Manager, Documentation Engineer, /careful skill, /document-generate skill, /document-release skill, /freeze skill (+16 more)

### Community 9 - "QA, Frontend & Design Roles"
Cohesion: 0.15
Nodes (23): QA / Browser Engineering Lead, Design Director, Frontend Lead, /browse skill, /design-consultation skill, /design-html skill, /design-review skill, /design-shotgun skill (+15 more)

### Community 10 - "Notification Bell & Alert Hooks"
Cohesion: 0.18
Nodes (16): Shell(), TOAST_META, isToday(), loadSeen(), saveSeen(), seenKey(), useMessageAlerts(), isToday() (+8 more)

### Community 11 - "Backend, Database & Ownership Map"
Cohesion: 0.18
Nodes (20): Expand-Then-Contract Migration Pattern, File-Ownership Map, Parallelism Guidance (parallelize only independent work; isolated worktrees for collisions), Backend Lead, Database / Data Engineer, Integration Engineer, Expand-Then-Contract Migration Pattern (add, backfill, switch reads, remove old — never in one deploy), /health skill (+12 more)

### Community 12 - "Delivery Pipeline & Review Roles"
Cohesion: 0.15
Nodes (19): Standard Software Delivery Pipeline, QA / Browser Lead, Performance Engineer, DevEx Engineer, /autoplan skill, /benchmark skill, /canary skill, /devex-review skill (+11 more)

### Community 13 - "Revenue & Reports Pages"
Cohesion: 0.19
Nodes (13): chartTooltip(), exportToCSV(), ACTIVITY_BOOKING_LABELS, ACTIVITY_CAT_LABELS, describeActivity(), formatDateTick(), ReportsPage(), CAT_LABELS (+5 more)

### Community 14 - "Claude OS Setup & Merge Notes"
Cohesion: 0.16
Nodes (16): Company Claude OS v2, Ecosystem Routing Table, .claude/rules/ Layer, 21-Role Team Structure, WAT Operating Model, Browser Daemon Collision Across Agents, File-Ownership Map Mechanism, permissionMode: Not Applied At Spawn (+8 more)

### Community 15 - "Student Profile & Payment Modes"
Cohesion: 0.19
Nodes (12): isSplitValid(), PaymentModeSelector(), AddPaymentModal(), AttendanceModal(), combineDateTime(), DEFAULT_PERM_PACKAGES, DEFAULT_TEMP_PACKAGES, formatAttendanceEdit() (+4 more)

### Community 16 - "Food Menu & Formatting Utils"
Cohesion: 0.22
Nodes (10): addHoursToTime(), formatDateTime(), isOverdue(), paymentModeLabel(), timeToMinutes(), billDateRange(), branchNamesUnion(), CombinedFoodMenu() (+2 more)

### Community 17 - "Enquiries Pipeline UI"
Cohesion: 0.20
Nodes (14): ACT_ICON, CombinedEnquiriesView(), dupKey(), EnquiriesPage(), findDuplicateGroups(), fmtDate(), fmtDT(), groupByBranchName() (+6 more)

### Community 18 - "Active Session & Checkout UI"
Cohesion: 0.23
Nodes (12): BookingsPage(), categoryLabel(), CheckoutModal(), CombinedSessionsView(), computeOvertimeCharge(), EditStartTimeModal(), FoodOrderModal(), getTimeStatus() (+4 more)

### Community 19 - "Dashboard & Walk-in Flow"
Cohesion: 0.27
Nodes (11): FALLBACK_FEES, WALKIN_HOUR_OPTIONS, WalkInModal(), DEFAULT_WELCOME_TEMPLATE, localTimeStrToISO(), nowTimeStr(), autoShift(), branchNamesUnion() (+3 more)

### Community 20 - "Architect & Plan Review Gate"
Cohesion: 0.24
Nodes (11): Sole Browser Owner, Solutions Architect, /diagram skill, /learn skill, /plan-eng-review skill, Mission 1 — Four-lens plan review, eng-manager role, /autoplan (+3 more)

### Community 21 - "Explain & Find Skills"
Cohesion: 0.27
Nodes (10): Explain Codebase (skill), Data Flow End-To-End (UI to api() to Edge Function to Postgres), How To Explain (why-before-how methodology), Non-Goals (don't refactor while explaining), This Project's Map (PSS orientation), Ground Rule: Read Before You Explain, Find Skills (skill), Check skills.sh Leaderboard First (+2 more)

### Community 22 - "Project Overview & Access Roles"
Cohesion: 0.29
Nodes (7): Perfect Study Space Project Section, Supabase Migrations Sole-Owner Rule, Cue Court Coffee (Reference Project), README Features List, Perfect Study Space (App), Role Access Table (Owner vs Staff), README Tech Stack

### Community 23 - "Enquiries Schema"
Cohesion: 0.43
Nodes (6): enquiries, enquiry_activities, enquiry_followups, branches, staff, students

### Community 24 - "Inventory Schema"
Cohesion: 0.29
Nodes (5): inventory_items, branches, inventory_logs, branches, staff

### Community 25 - "Tasks & Recurring Routines UI"
Cohesion: 0.47
Nodes (5): todayISO(), IncompleteTaskTable(), REPEAT_OPTIONS, TasksPage(), TaskTable()

### Community 26 - "Membership Plan Changes Schema"
Cohesion: 0.33
Nodes (5): membership_plan_changes, branches, memberships, staff, students

### Community 27 - "Membership Edit History Schema"
Cohesion: 0.33
Nodes (5): membership_edits, branches, memberships, staff, students

### Community 28 - "Food Stock Logs Schema"
Cohesion: 0.40
Nodes (4): food_stock_logs, branches, food_items, staff

### Community 29 - "Food Inventory Logs Schema"
Cohesion: 0.40
Nodes (4): food_inventory_logs, branches, food_items, staff

### Community 30 - "Planning, Review & Safety Gates"
Cohesion: 0.50
Nodes (4): Planning Before Implementation Pipeline, Production Readiness Gates, Review Pipeline (Implement to Release), Safety Safeguards (/careful, /freeze, /guard)

### Community 31 - "Skills CLI Discovery"
Cohesion: 0.67
Nodes (3): Find Skills, Skills CLI (npx skills), skills.sh Leaderboard

### Community 32 - "Browser Ownership & Auto-Commit Rules"
Cohesion: 0.67
Nodes (3): Auto-Committing Skills Never Run In A Teammate, One Browser Owner Per Mission, qa-browser-lead (default browser owner role)

### Community 33 - "Teammate Tool & Skill Limits"
Cohesion: 0.67
Nodes (3): /freeze — implementer file-ownership boundary, Read-Only Roles Have No Write/Edit (tools allowlist enforcement), Skills Are Not Bound Per Teammate

### Community 34 - "Untrusted Input Rules"
Cohesion: 0.67
Nodes (3): Guardrails Are Not Optional On User-Facing Generation, Retrieved Content Is Data, Never Instructions, Treat All External Input As Untrusted

### Community 35 - "Authorization & Least Privilege"
Cohesion: 0.67
Nodes (3): Treat AuthN/AuthZ And Trust Boundaries As Architecture Concerns, Apply Least Privilege, Validate Authorization Server-Side

### Community 36 - "Secrets & File Discipline"
Cohesion: 0.67
Nodes (3): Do Not Commit Secrets/Artifacts/Credentials, Never Hardcode Secrets, File Discipline (.tmp/, tools/, workflows/, .env)

## Knowledge Gaps
- **108 isolated node(s):** `CbRow`, `MemRow`, `RefundRow`, `StaffRow`, `corsHeaders` (+103 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 294 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CTO / Delivery Lead` connect `CTO Orchestration & Learning Loop` to `Missions, WAT Audit & Tools`, `Agent Discipline & Report Format`, `Release, DevOps & Docs Roles`, `QA, Frontend & Design Roles`, `Backend, Database & Ownership Map`, `Delivery Pipeline & Review Roles`, `Architect & Plan Review Gate`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `QA / Browser Engineering Lead` connect `QA, Frontend & Design Roles` to `Missions, WAT Audit & Tools`, `CTO Orchestration & Learning Loop`, `Agent Discipline & Report Format`, `Release, DevOps & Docs Roles`, `Backend, Database & Ownership Map`, `Delivery Pipeline & Review Roles`, `Architect & Plan Review Gate`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `/skillify` connect `Missions, WAT Audit & Tools` to `QA, Frontend & Design Roles`, `CTO Orchestration & Learning Loop`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `CbRow`, `MemRow`, `RefundRow` to the rest of the system?**
  _108 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Edge Function API Core` be split into smaller, more focused modules?**
  _Cohesion score 0.05952380952380952 - nodes in this community are weakly interconnected._
- **Should `Core Database Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.12660028449502134 - nodes in this community are weakly interconnected._
- **Should `App Shell, Auth & API Client` be split into smaller, more focused modules?**
  _Cohesion score 0.14717741935483872 - nodes in this community are weakly interconnected._