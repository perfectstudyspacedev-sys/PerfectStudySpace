# PSS-AI — Execution Plan for Claude Code

| | |
|---|---|
| **Status** | Phase 0 in progress on branch `pss-ai/p0-foundation`. Phases 1–6 not started. |
| **Agreed on** | 2026-10-13 |
| **Execution order** | P0 → P1 → P2 → P3 → P4 → P5 → P6. A phase starts only after the owner ticks the previous phase's exit gate. |
| **Verified against** | `main` at commit `cb7beeb` (RSP + SSP merged, PR #2) |
| **Outside services allowed** | An AI model API, Supabase, and public exam notification pages. Nothing else. No hardware. |
| **Where this file lives** | `docs/plans/PSS-AI-execution-plan.md` |

## Corrections found while building (2026-10-16)

- **Hosting:** both sites run on **Cloudflare Pages** (project `perfect-study-space`: `perfect-study-space.pages.dev` and `join.perfectstudyspace.in`), not Vercel. `vercel.json` is not read there; the security headers live in `public/_headers`. Wherever this plan says "Vercel" (repo facts, R10, Phase 4 config), read "Cloudflare Pages".
- **CORS (P0.1):** the public website (`perfectstudyspace.in`, `www.perfectstudyspace.in`, Cloudflare project `perfect-study-space-web`) posts its enquiry form to the `api` function (`public_create_enquiry`), so it must be on the allow-list. Default list in code: `https://perfect-study-space.pages.dev`, `https://join.perfectstudyspace.in`, `https://perfectstudyspace.in`, `https://www.perfectstudyspace.in`, `http://localhost:5173`. The `ALLOWED_ORIGINS` secret replaces it when set.
- **Extra safety net:** `tests/server/` runs the real `api` function against an in-memory stand-in for Supabase (`npm run test:server`, no Docker). `golden_test.ts` calls every action on a fixed clock and compares every response and the whole database with `golden.snapshot.json`, so refactors (P0.2, P0.4) are proven behaviour-neutral.

## How to use this file in a future chat

- Say **"Build Phase 0"**, **"Build P0.4"**, or **"Build P2 portal R1"**. Refer to items by label, for example *"In P2 skip I27"*.
- Before writing any code, read this whole file, `CLAUDE.md` and everything in `.claude/rules/`.
- **Settled decisions** must not be re-decided. **Open decisions** (D0 to D10): if the phase you are building needs one that is still open, stop and ask the owner. Never guess.
- One branch per phase: `pss-ai/p0-foundation`, `pss-ai/p1-data-brain`, `pss-ai/p2-portal-agents`, and so on.
- When an item is done, mark it ✅ in this file in the same commit as the code.
- Tick an exit-gate box only with evidence: test output, build output or browser-QA notes. Never by assertion.
- **Phases 0 and 1 are written at build level.** Phases 2 to 6 are written at spec level. Before building one of them, re-read the repo, rewrite that phase's items here in the same detail as Phase 0, and get the owner's approval on the rewrite.

---

## Ground rules (apply to every phase)

| # | Rule |
|---|---|
| R1 | **Money logic does not change.** These functions may be moved and wrapped but not altered: `renewalKind`, `endDateForMonths`, `addMonths`, `addDays`, `daysBetween`, `membershipTotalDays`, `multiMonthDiscount`, `computeOvertimeCharge`, `computeOverstay`, `unusedDaysRefund`, `settlementIncomeRows`, `recordSettlementIncome`, `insertPaymentTransactions`, `recordTransaction`, `recordPayout`, `recordWaiver`, `claimDesk`, `findOverlappingSession`, `hasOpenSession`, `unpaidFoodBillsFor`, `computeStudentStatus`, plus the money paths inside `checkout_booking`, `create_membership`, `renew_membership`, `cancel_early_renewal`, `close_membership`, `delete_membership`. If a test shows a value that looks wrong, report it to the owner; do not fix it inside this plan. |
| R2 | **Migrations** are append-only from `052`. Only the database-data-engineer role writes them. Additions only: no DROP or type change of an existing column before the S1 step in Phase 5. Never edit `001` to `051`. Every new table gets `ENABLE ROW LEVEL SECURITY` with no policies, matching the repo (all access goes through the edge functions' service-role client). |
| R3 | **Agents never calculate money.** They only call registry actions; the existing code does the maths. |
| R4 | **Every action is registered** with its tier, allowed callers, input check and idempotency setting (P0.4). |
| R5 | **Response shape stays the same.** Success returns the JSON body; failure returns `{ error }` with an HTTP status. `api()` in `src/lib/api.js` must keep working unless a task says otherwise. |
| R6 | **Staff and owner behaviour stays the same** until the phase that changes it: `requireBranch`, `isOwnerOrAdmin`, the hidden admin role, branch overrides and End Session all keep working. |
| R7 | **No new outside services and no hardware.** AI calls happen only inside edge functions. The AI key never reaches the browser. npm or Python packages are fine; hosted third-party services are not. |
| R8 | **Keep `openWhatsApp()`** and every existing WhatsApp button. |
| R9 | **Every new feature has an off switch**: an `app_settings` row with key `pssai_<feature>`, value `on` or `off`, default `off`. The owner switches it on after QA. |
| R10 | **Deploy order, every time:** migrations → `supabase functions deploy <name>` → frontend (Cloudflare Pages rebuild from `main`). |
| R11 | **Personal data:** never write Aadhaar images, ID numbers, PINs, passwords or payment screenshots into the event log or an AI prompt, except the one AI call whose job is to read that document. Redact them from event payloads. |
| R12 | **Verification:** `npm run build`, `npm run test` (from P0.3) and browser QA by the qa-browser-lead role. Never claim tests pass without running them. |

---

## Settled decisions (do not re-decide)

| # | Decision |
|---|---|
| S1 | PSS stays on Supabase: Postgres, Edge Functions, Storage, Realtime and pg_cron. Moving to the VPS is out of scope for this plan. |
| S2 | Outside services are limited to an AI model API, Supabase and public exam notification pages. |
| S3 | Agents decide and talk; existing code calculates and commits money. |
| S4 | There is no payment gateway. The owner (or the person chosen in D2) confirms every UPI payment in one tap. |
| S5 | There is no messaging API. Reminders show in the student portal; WhatsApp stays a one-tap send through `openWhatsApp()`. |
| S6 | Self check-in uses a printed QR poster plus a location check on the student's phone. No kiosk, camera or Wi-Fi sensing. |
| S7 | Student portal login is phone number plus PIN. The owner resets forgotten PINs. |
| S8 | The student portal lives on the existing student site, `join.perfectstudyspace.in`, under `/me`. Sign-up links (`/<code>`) keep working. (Design default; change only if the owner asks.) |
| S9 | Permission tiers T0 to T3 follow Appendix D. T3 always goes to the owner's approval queue. |
| S10 | The single `api` edge function stays the entry point for the existing apps. New edge functions: `cron` (P0) and `agent` (P1). |
| S11 | Behaviour models train on the developer's own machine from a Supabase export. Their scores are written back to Supabase. |
| S12 | Students never call staff actions. The portal uses new `me_*` actions that take the student from the login token, never from the request body. |

## Open decisions (stop and ask if the phase needs one)

| # | Decision | Options | Needed by | Status |
|---|---|---|---|---|
| D0 | Test runner | Proposed: Vitest for pure TypeScript modules in `supabase/functions/_shared/` | P0.3 | Open |
| D1 | Cash handling | Allow cash at the hall, or UPI only | P2 | Open |
| D2 | Payment confirmation | Who confirms UPI payments (owner or one trusted person), and how quickly | P2 | Open |
| D3 | AI models | Which model the agents use (routine and hard cases); which small open model to distil later | P1.8 | Open |
| D4 | Agent language | Tamil, English, or mirror the student's mix | P2 | Open |
| D5 | T3 auto-approve limits | For example, waivers under a set rupee amount | P3 | Open |
| D6 | Portal PIN rules | PIN length, lockout after failed tries, how the owner resets a PIN | P2 | Open |
| D7 | Released-hours credit | Share of the resale price credited to a member who releases hours (SP10) | P3 | Open |
| D8 | Exam sources | Which exam bodies to track; read from their sites or enter dates by hand | P3 | Open |
| D9 | Location check | How close to the branch a student must be to check in; consent wording under the DPDP Act, 2023 | P4 | Open |
| D10 | Food | Keep a kitchen person, an outside vendor, or vending | P4 | Open |

## Labels at a glance

| Label | Meaning |
|---|---|
| P0 to P6 | Phases; P0.1, P0.2 … are build steps inside a phase |
| F1 to F10 | Foundation work |
| A1 to A8 | Agents and the permission gate |
| I1 to I34, O1 to O10 | AI features and owner impact engines |
| G1 to G39 | Gaps found in the current repo |
| SP1 to SP23, R1 to R4 | Student portal features and releases |
| S1 (Phase 5) | Retiring the desk-staff modules |

---

## Repo facts (verified 2026-10-13, `main` @ `cb7beeb`)

- **Frontend:** React 19, Vite 6, React Router 7, Recharts. Deployed on Cloudflare Pages (see Corrections; `vercel.json` is unused there). `src/main.jsx` loads `JoinApp.jsx` when the host starts with `join.` (`isSignupHost()` in `src/lib/signupLink.js`), otherwise `App.jsx`. `JoinApp.jsx` routes `/:code`, `/join/:code` and `*` to `JoinPage`.
- **API client:** `api(action, payload)` in `src/lib/api.js` calls `supabase.functions.invoke('api', { body: { action, ...payload }, headers: { Authorization: 'Bearer <token>' } })`. The staff token is in `sessionStorage` (`pss_token`).
- **Back end:** one Deno edge function, `supabase/functions/api/index.ts`, 5,827 lines with 124 `if (action === …)` branches (some branches handle several action names). `supabase/config.toml` sets `verify_jwt = false` for `api`; auth happens in code.
- **Request flow today:** CORS preflight → parse `{ action, ...payload }` → public actions (`login`, `public_create_enquiry`, `public_signup_info`, `public_signup_submit`) → `authStaff(req)` → `markAttendanceIfNeeded()` → the action chain → `Unknown action: <name>` → catch-all `500`.
- **Roles:** `staff`, `owner`, `admin` (admin ranks above owner and is hidden from owner lists). Helpers: `isOwner`, `isAdmin`, `isOwnerOrAdmin`, `requireBranch`.
- **Pure helpers at the top of `index.ts`:** `todayISO`, `toISTDateStr`, `istInstant`, `istDayStart`, `istDayEnd`, `addMonths`, `addDays`, `daysBetween`, `membershipTotalDays`, `MEMBERSHIP_GRACE_DAYS` (10), `notStartedYetMessage`, `renewalKind`, `endDateForMonths`, `multiMonthDiscount`, `OVERTIME_GRACE_MINUTES` (15), `computeOvertimeCharge`, `computeStudentStatus`, `settlementIncomeRows`, `unusedDaysRefund`.
- **Helpers that touch the database:** `recordTransaction`, `recordWaiver`, `recordPayout`, `recordSettlementIncome`, `computeOverstay`, `unpaidFoodBillsFor`, `insertPaymentTransactions`, `hasOpenSession`, `findOverlappingSession`, `claimDesk`, `createAlert`, `upsertStudent`, `refreshStudentStatus`, `purgeExpiredSignups`, `claimSignup`.
- **Lazy work inside read paths:** `list_active_memberships` creates expiry alerts with `createAlert` at the end of the action; `purgeExpiredSignups()` runs inside sign-up reads and writes.
- **Known flags:** `DEV_MODE = true` at line 12 of `index.ts` and in `src/lib/devMode.js`. CORS is `Access-Control-Allow-Origin: *`.
- **Discount guards that already exist:** `apply_loyalty_discount` and `grant_cashback` reject percentages over 100.
- **Database:** 51 migrations (`001_initial.sql` → `051_self_signup.sql`). RLS is on with no policies. `students.phone` is unique (`idx_students_phone`). `staff.role` is the `staff_role` enum. `app_settings` (key/value) exists since `048`. Live tables with `created_by_staff_id`: `bookings`, `food_bills`, `memberships`, `transactions`, `enquiries`, `permanent_waitlist`, `payouts`, `inventory_logs`, `waivers`.
- **WhatsApp today:** `openWhatsApp()` in `src/lib/utils.js` builds `wa.me` links. Used by `WalkInModal`, `MembershipPage` (welcome message, study report) and `EnquiriesPage`.
- **Polling hooks:** `useMessageAlerts` (30 s), `usePendingSignups` (30 s), `useSessionAlerts` (60 s), `useTaskAlerts` (60 s).
- **Tests:** no test, lint or typecheck scripts, and no `tests/` folder.
- **Agent roles in `.claude/agents/`:** `07-frontend-lead`, `08-backend-lead`, `09-database-data-engineer`, `10-ai-agent-engineer`, `11-integration-engineer`, `12-qa-browser-lead`, `18-devops-sre` and others. There is no `test-engineer` file even though `CLAUDE.md` names that role.
- **Before Phase 0:** confirm with the owner that migrations `049`, `050` and `051` are applied in production. The RSP plan notes they were built and merged; deployment status must be checked.

---

# PHASE 0 — Foundation (build level)

**Branch:** `pss-ai/p0-foundation` · **Needs:** D0 · **Students see:** no change · **Build in this order:** P0.1 → P0.10

## ✅ P0.1 Security quick fixes (closes G37, G38)

- Set `DEV_MODE = false` in `supabase/functions/api/index.ts` and in `src/lib/devMode.js`. Before flipping, grep every `DEV_MODE` use and list in the PR description what behaviour changes (today it lets `join_permanent_waitlist` succeed even when the branch has vacant permanent seats).
- `README.md`: remove the default-login table. Replace it with one line: "Set strong passwords for the seeded accounts at first deploy."
- CORS: replace `*` with an allow-list read from a new secret `ALLOWED_ORIGINS` (comma-separated: the staff site, `https://join.perfectstudyspace.in`, and `http://localhost:5173` for development). Echo the request's `Origin` only when it is on the list. Add `idempotency-key` to `Access-Control-Allow-Headers` (needed by P0.6).

Acceptance:
- [x] `grep -rn "DEV_MODE = true"` finds nothing
- [x] A request from an origin not on the list receives no CORS allow header (`tests/server/cors_test.ts`, 15 checks); the staff site and the join site still work (allowed origins verified in the same test; live check after deploy)
- [x] README contains no passwords

Owner steps: set the `ALLOWED_ORIGINS` secret (optional: the code has the same list built in); change the seeded account passwords.

Behaviour changed by `DEV_MODE = false` (listed as P0.1 asks): (1) `join_permanent_waitlist` is refused while the branch has free permanent seats ("Permanent seats are still available — register directly instead of waitlisting"); (2) the Students spreadsheet view is owner/admin only again (`StudentsPage`), and the Membership page's waitlist tab follows the "branch is full" rule. The golden master shows (1) as the only server-side change.

## P0.2 Move pure helpers to `_shared` (F1, part a)

- Create `supabase/functions/_shared/` (Supabase's folder for code shared between functions).
- Move these functions **without changing a line of their logic**:
  - `_shared/dates.ts`: `IST_OFFSET_MS`, `todayISO`, `toISTDateStr`, `istInstant`, `istDayStart`, `istDayEnd`, `addMonths`, `addDays`, `daysBetween`, `endDateForMonths`
  - `_shared/membership.ts`: `membershipTotalDays`, `MEMBERSHIP_GRACE_DAYS`, `notStartedYetMessage`, `renewalKind`, `multiMonthDiscount`, `unusedDaysRefund`, `computeStudentStatus`
  - `_shared/overtime.ts`: `OVERTIME_GRACE_MINUTES`, `computeOvertimeCharge`
  - `_shared/settlement.ts`: `settlementIncomeRows` and its `SettlementOwed` type
- Split `computeOverstay` into a pure `overstayFromLastVisit(mem, lastVisitDate, today)` in `_shared/overstay.ts`, plus the existing database query that stays in the action code and calls it. The result must be identical for every input.
- Keep every signature as it is. Functions that need "today" already take it as a parameter (`unusedDaysRefund(…, today, …)`, `renewalKind(endDate, today)`).
- `_shared` modules must not import from URLs, so Vitest can load them.
- `index.ts` imports them back.

Acceptance:
- [ ] `index.ts` no longer defines the moved functions
- [ ] `supabase functions serve api` starts locally; login, one check-in and one checkout with overtime work (browser QA)
- [ ] The diff of each moved function body is whitespace-only (reviewer checks; `overstayFromLastVisit` is the one allowed split)

## P0.3 Money regression tests (F5, closes G21) — needs D0

- Add Vitest as a dev dependency. Add scripts: `"test": "vitest run"` and `"test:integration": "vitest run --config vitest.integration.config.ts"`.
- Unit tests in `tests/money/*.test.ts` import from `supabase/functions/_shared/`. Write every unit case in **Appendix A** as its own named test.
- Integration cases (Appendix A, part 2) go in `tests/integration/` and run against a local Supabase (`supabase start`, needs Docker). They skip themselves when no local Supabase is running. They are required before Phase 2, not before the end of Phase 0.

Acceptance:
- [ ] `npm run test` passes and covers every Appendix A unit case
- [ ] Test names match the case numbers in Appendix A

## P0.4 Action registry and domain split (F1, part b)

Create `supabase/functions/api/registry.ts`:

```ts
export type Caller = 'public' | 'staff' | 'owner' | 'admin' | 'agent' | 'student' | 'system';
export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

export interface Ctx {
  db: ReturnType<typeof adminClient>;
  req: Request;
  staff?: StaffRow;            // set for staff/owner/admin callers
  student?: { id: string };    // set for student callers (P2)
  actor: { type: Caller; id: string | null };
  runId?: string;              // agent runs (P1)
}

export interface ActionDef<P = Record<string, unknown>> {
  name: string;
  tier: Tier;
  callers: Caller[];
  mutating: boolean;           // false = read only
  idempotent: boolean;         // true = safe to retry without a key
  validate?: (p: unknown) => P; // throw Error(message) → 400
  handler: (ctx: Ctx, p: P) => Promise<Response>;
}
```

- Move each action body into a handler file under `supabase/functions/api/domains/`, unchanged. Suggested split: `auth.ts` (login, whoami, public actions), `branches.ts`, `sessions.ts` (check-in, checkout, attendance, session pause/resume, today's bookings, walk-ins), `members.ts` (create, renew, change, close, delete membership, holds, early renewal, waitlist, lockers), `money.ts` (payments, discounts, cashback, revenue, transactions, waivers, payouts, Food Pass money), `food.ts`, `enquiries.ts`, `staff.ts` (staff, attendance, overrides, tasks, messages, alerts), `reports.ts` (dashboard, daily report, actionable items, top students, referral stats), `signup.ts`.
- Handlers keep calling `json()` / `err()` and the existing helpers. Move `json`, `err`, `corsHeaders`, `adminClient`, `authStaff`, `signToken`, `verifyToken` into `_shared/http.ts` and `_shared/auth.ts` so the `cron` and `agent` functions can reuse them.
- `index.ts` becomes the router: CORS → parse body → look up the action → public actions run without auth → otherwise `authStaff` and `markAttendanceIfNeeded` → caller check → `validate` → idempotency (P0.6) → handler → event write (P0.5) → response. An unknown name still returns `Unknown action: <name>` with status 400.
- Callers for existing actions come from today's checks: actions that check `isOwnerOrAdmin` get `['owner','admin']`; the rest get `['staff','owner','admin']`; the four public actions get `['public']`.
- Add `validate` only where the handler already checks its input by hand. Do not add new rejections in Phase 0.

Acceptance:
- [ ] Every action name handled today is in the registry. A test compares registry names to a checked-in list, `tests/registry/actions.snapshot.json`.
- [ ] `index.ts` is under 300 lines
- [ ] Browser QA gives the same results as before for: login, dashboard, check-in, checkout with overtime, food order with a Food Pass, new membership, early and grace renewals, an enquiry, the revenue page, the sign-up link
- [ ] No frontend file changed in this step

## P0.5 Event log and actor audit (F8, F2) — migrations 052, 053

`052_event_log.sql`:

```sql
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('public','staff','owner','admin','agent','student','system')),
  actor_id UUID,
  run_id UUID,
  branch_id UUID,     -- no foreign keys: the log must survive deletes
  student_id UUID,
  ok BOOLEAN NOT NULL,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_action_time  ON events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_student_time ON events (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor_time   ON events (actor_type, actor_id, occurred_at DESC);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- plus a trigger that raises an exception on UPDATE or DELETE of events
```

- Write one event for every mutating action, success or failure. Write T0 reads only when the caller is `agent` or `student`.
- Redact from `payload`: keys containing `password`, `pin`, `aadhaar`, `photo`, `image`, and any string over 1 KB.

`053_actor_audit.sql`: add nullable `actor_type TEXT`, `actor_id UUID` and `run_id UUID` to `bookings`, `food_bills`, `memberships`, `transactions`, `enquiries`, `permanent_waitlist`, `payouts`, `inventory_logs`, `waivers`. No backfill (null means a row from before this plan). Add a helper `withActor(row, ctx)` and use it at every insert site that sets `created_by_staff_id`.

Acceptance:
- [ ] Ten different mutating actions each write exactly one event row
- [ ] UPDATE and DELETE on `events` fail
- [ ] A login and a sign-up leave no password, PIN or Aadhaar data in any event payload
- [ ] Every insert that sets `created_by_staff_id` also sets `actor_type` and `actor_id` (grep check)

## P0.6 Idempotency keys (F4) — migration 054

`054_idempotency_keys.sql`: `idempotency_keys (key TEXT PRIMARY KEY, action TEXT NOT NULL, actor_id UUID, status INT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`, with RLS on.

- `src/lib/api.js`: accept an optional third argument `api(action, payload, { idempotencyKey })` and send it as the `Idempotency-Key` header. When no key is given, generate one with `crypto.randomUUID()`. Forms that can be retried (payments, checkout, renewals) create one key per submit and reuse it on retry.
- Router: for actions with `mutating: true` and `idempotent: false`, if the key already exists return the stored status and body; otherwise run the handler and store the response (2xx and 4xx; never 5xx).
- The existing guards stay: the `checkout_booking` status check, the renewal claim guard and `claimSignup`.

Acceptance:
- [ ] Two identical `record_payment` calls with the same key create one transaction row
- [ ] Two calls with different keys behave as they do today

## P0.7 Scheduler and the `cron` function (F3, closes G20)

- Owner steps: enable the `pg_cron` and `pg_net` extensions in the Supabase dashboard; add the secret `CRON_SECRET`.
- New edge function `supabase/functions/cron/index.ts`. Add `[functions.cron] verify_jwt = false` to `supabase/config.toml`. Reject any request without the correct `x-cron-secret` header. Jobs are registry actions with caller `system`:
  - `cron_expiry_alerts`: the same logic as the alert loop at the end of `list_active_memberships`, for all branches
  - `cron_purge_signups`: calls `purgeExpiredSignups`
  - `cron_purge_idempotency`: deletes keys older than 48 hours
  - `cron_integrity_report`: see P0.8
- Put the schedules in `docs/ops/cron.sql` for the owner to run in the SQL editor. It is not a migration because it contains the project URL and secret. pg_cron uses UTC unless `cron.timezone` is set: expiry alerts at 06:00 IST = `30 0 * * *`; sign-up purge at 00:05 IST = `35 18 * * *`; key purge hourly; integrity report at 02:00 IST = `30 20 * * *`.
- Read paths: when `app_settings.pssai_cron` is `on`, `list_active_memberships` skips its alert loop and sign-up reads skip `purgeExpiredSignups`. When it is `off`, behaviour is exactly as today.

Acceptance:
- [ ] Each job runs once when triggered manually with the secret, and is refused without it
- [ ] With the flag on, opening the Members page creates no alerts; the 06:00 job does

## P0.8 Nightly integrity report (F10, closes G19)

`cron_integrity_report` runs read-only checks and writes one `events` row with `action = 'integrity_report'` and the findings as its payload:

1. Memberships whose stored `end_date` or `due_date` differ from what `fix_membership_dates` would compute (compute only; no writes)
2. Food Passes with a negative balance
3. Bookings with `status = 'active'` that started more than 24 hours ago

Add an owner/admin T0 action `get_integrity_report` that returns the latest report. On the Dashboard, show a card to owner and admin when the report has any findings.

Acceptance:
- [ ] On a staging copy, the counts match what the `fix_*` actions would change
- [ ] The Dashboard card appears only for owner and admin

## P0.9 Declare permission tiers (A8, part 1)

- Give every registry action a tier using the rules in **Appendix D**.
- In Phase 0 tiers are only declared and written to `events.tier`. Staff and owner access still uses today's checks. Enforcement for `agent` and `student` callers starts in Phase 2.

Acceptance:
- [ ] A test fails if any registry entry has no tier
- [ ] The T3 set equals the explicit list in Appendix D

## P0.10 Pre-deploy check (F9, closes G39)

Add `scripts/predeploy.mjs` and the script `"predeploy": "node scripts/predeploy.mjs"`. It fails when:

- `DEV_MODE = true` appears in either file
- `README.md` contains `owner123` or `staff123`
- migration numbers are not contiguous from `001`, or a number repeats
- `npm run build` or `npm run test` fails

On success it prints the deploy order (R10). It runs manually before a deploy. (npm will also run it automatically before any `deploy` script added later.)

Acceptance:
- [ ] The script exits non-zero when `DEV_MODE` is flipped back to `true` in a scratch commit

## Phase 0 deploy order

1. Owner confirms migrations `049`–`051` are applied
2. Migrations `052`, `053`, `054`
3. Owner enables `pg_cron` and `pg_net`; sets `CRON_SECRET` and `ALLOWED_ORIGINS`
4. `supabase functions deploy api` and `supabase functions deploy cron`
5. Owner runs `docs/ops/cron.sql`
6. Frontend
7. After the first clean night, owner sets `pssai_cron` to `on`

## Phase 0 exit gate

- [ ] `npm run test` passes, including every Appendix A unit case
- [ ] Every action is in the registry with a tier, and every mutating action writes an event with an actor
- [ ] `npm run predeploy` refuses a deploy with `DEV_MODE` on
- [ ] Production on Supabase works with no change in behaviour (build plus browser QA notes)

---

# PHASE 1 — Data brain (build level, read-only AI)

**Branch:** `pss-ai/p1-data-brain` · **Needs:** D3 (for P1.8) · **Students see:** an optional focus rating at checkout · **Nothing is written automatically by AI**

## P1.1 Focus pulse (I9) — migration 055

`055_focus_pulse.sql`: `focus_ratings (booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5), source TEXT NOT NULL DEFAULT 'desk' CHECK (source IN ('desk','portal')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())`, with RLS on.

- New action `record_focus_rating`: tier T1; callers staff, owner, admin (student from P2); upsert by `booking_id`.
- UI: after a member checkout in `BookingsPage`, show an optional row of 1–5 buttons ("How focused was today?") with a Skip button. It never blocks checkout. Walk-ins are not asked. Flag: `pssai_focus_pulse`.

Acceptance:
- [ ] One rating per booking at most; Skip leaves no row; walk-ins never see the prompt

## P1.2 ML workspace (`ml/`)

- A Python project managed with uv (`ml/pyproject.toml`), using pandas, scikit-learn and lifelines, with pytest and ruff (both already allowed in `.claude/settings.json`).
- `ml/export.py` reads with the Supabase service key from `ml/.env`. That file is gitignored and never committed (`.claude/settings.json` already denies reading `.env`). Export `bookings`, `memberships`, `transactions`, `focus_ratings`, `waivers` and `cashbacks` to `ml/data/` (gitignored) as Parquet.
- `ml/features.py` builds:
  - per student per day: arrival minute (IST), minutes used against `scheduled_hours`, number of sessions, weekend flag, food bills, focus rating
  - per membership: plan, `months_paid`, tenure, holds, days since last visit, past renewal kinds (early, grace, late), dues
- `ml/publish.py` upserts results into the tables from P1.3.
- Add `ml/.env` and `ml/data/` to `.gitignore`.

## P1.3 Model output tables — migration 056

`056_model_outputs.sql`, every table with RLS on:

- `student_scores (student_id UUID REFERENCES students(id) ON DELETE CASCADE, model TEXT, version TEXT, score NUMERIC, reason TEXT, computed_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (student_id, model))`, plus an append-only `student_score_history` with the same columns and its own id
- `fingerprints (student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, version TEXT, vector REAL[], cluster TEXT, computed_at TIMESTAMPTZ DEFAULT now())`
- `anomaly_flags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), kind TEXT, ref_table TEXT, ref_id UUID, branch_id UUID, score NUMERIC, explanation TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ok','problem')), reviewed_by_staff_id UUID, created_at TIMESTAMPTZ DEFAULT now())`
- `forecasts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), kind TEXT, period_start DATE, value NUMERIC, low NUMERIC, high NUMERIC, computed_at TIMESTAMPTZ DEFAULT now())`
- `owner_briefs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), brief_date DATE NOT NULL UNIQUE, body TEXT NOT NULL, figures JSONB, created_at TIMESTAMPTZ DEFAULT now())`

New T0 reads (owner and admin): `get_student_scores`, `list_anomaly_flags`, `get_forecast`, `get_owner_brief`. New T1 action (owner and admin): `review_anomaly_flag`.

## P1.4 Focus Fingerprint (I1)

- Version 1: engineered features from P1.2, scaled, then PCA and k-means clusters. It is fast and easy to explain.
- Version 2, only if version 1 holds up: a small GRU encoder trained to predict the next day's minutes, with its hidden state used as the vector.
- Write `fingerprints` rows. The owner reviews the clusters and gives each one a plain-language label.

Acceptance:
- [ ] Every active member has a fingerprint and a cluster
- [ ] Cluster labels are approved by the owner

## P1.5 Churn model (I2)

- Label: a membership counts as churned when no new membership for that student starts within `MEMBERSHIP_GRACE_DAYS` (10) after its `end_date`.
- Prediction point: 21 days before `end_date` (configurable).
- Models: a Cox baseline (lifelines) and a gradient-boosting classifier at the prediction point. Keep the one that validates better.
- Reason codes come from the top contributing feature group: `attendance_drop`, `dues`, `short_tenure`, `holds`, `late_payer`, `other`.
- Validation is time-based: train on older months, test on the most recent two to three months. Report the concordance index and the hit rate at the owner's weekly contact budget (for example the top 20 per branch), compared with the baseline "everyone expiring in the next 7 days".

Acceptance:
- [ ] A validation report in `ml/reports/churn-<date>.md` shows the model beating the 7-day baseline at the same contact budget
- [ ] Scores and reasons for every active member are in `student_scores`

## P1.6 Anomaly detector (I23) and discount confirm (closes G14, G15)

- Inputs: waivers, discounts and cashbacks, manual attendance edits (`add_attendance` / `update_attendance` events) and overtime exclusions (`set_overtime_excluded`).
- Method: baselines per staff member and per branch; robust z-scores or Isolation Forest; flag the top N per week. Explanations come from a fixed template, not from a language model.
- Owner page "Flags" (OwnerRoute) lists open flags; the owner marks each one ok or problem.
- G14: the server already rejects percentages over 100; keep that. Add a confirm dialog in the discount and cashback forms when a flat amount is above the fee due or above `app_settings.pssai_discount_confirm_over` (default ₹1,000).

Acceptance:
- [ ] The owner reviews two weeks of flags and agrees the false-alarm rate is acceptable

## P1.7 Cash-flow forecast (I31) and engagement score (closes G35, G36)

- I31: expected income per week for the next 60 days = for each active membership, renewal amount × (1 − churn score) on its expected renewal date, plus dues × a collection rate learned from history. Write weekly rows to `forecasts` with low and high bands.
- Engagement score: new T0 action `get_engagement_ranking` built from fingerprints and churn scores. Keep `get_top_students` until the UI switches over.

## P1.8 Owner analyst (A6, closes G34) — new `agent` edge function

- New `supabase/functions/agent/index.ts` with `[functions.agent] verify_jwt = false` in `supabase/config.toml`. Secrets: `AI_API_KEY`, `AI_MODEL` (from D3).
- Auth: an owner or admin staff token, checked with `authStaff` from `_shared/auth.ts`.
- Tools: registry actions with tier T0 from this allow-list: `get_dashboard`, `get_revenue`, `list_transactions`, `get_daily_report`, `get_referral_stats`, `get_discounts_waivers`, `get_actionable_items`, `list_enquiries`, `get_student_profile`, `get_student_scores`, `list_anomaly_flags`, `get_forecast`, `get_integrity_report`. Add `list_active_memberships` only after `pssai_cron` is on, because it has a side effect until then.
- Tools run through the same registry with actor `{ type: 'agent', id: 'owner-analyst' }` and the owner's branch scope. Every run gets a `run_id`; every tool call writes an event.
- System prompt rules: answer only from tool results; give figures with dates and branch; say "I don't know" when data is missing; never claim to have changed anything.
- Daily brief: a `cron_owner_brief` job at 07:00 IST (`30 1 * * *` UTC) asks the analyst to write a brief from yesterday's figures and stores it in `owner_briefs`. The Dashboard shows it to owner and admin.
- UI: an `/analyst` chat page behind `OwnerRoute`.
- Evaluation: `tests/agents/analyst-eval.md` with 20 owner questions and expected figures computed by SQL.

Acceptance:
- [ ] At least 18 of 20 eval answers match the SQL figures
- [ ] No analyst run writes anything except event rows (checked in the event log)

## Phase 1 exit gate

- [ ] The churn model beats the 7-day reminder on historical data (P1.5 report)
- [ ] The owner has reviewed two weeks of anomaly flags and accepts the false-alarm rate
- [ ] Owner analyst passes its evaluation

---

# PHASE 2 — Self-service portal and agents (spec level)

**Branch:** `pss-ai/p2-portal-agents` · **Needs:** D1, D2, D4, D6 · **Refine this phase to build level before starting**

The student portal arrives, payments move into it, and the first agents start. With no payment gateway, the owner confirms each UPI payment in one tap. Agents run in shadow mode for two weeks (flag `pssai_agent_shadow`): every reply is a draft until a person approves it.

## P2.1 Student portal, release R1 (SP1 to SP8)

**Where:** the existing student site. Extend `JoinApp.jsx` into a `PortalApp`:
- `/me/login`, `/me` (home), `/me/pay`, `/me/receipts`, `/me/report`, `/me/hold`, `/me/chat`, `/me/privacy`
- Keep `/:code` and `/join/:code` for sign-up. Put the `/me/*` routes before `/:code` (sign-up codes are 12 characters, so `me` never collides).
- Make it installable: a web app manifest and a small service worker served from the same site.

**Login (SP1), migration `063_student_auth`:**
- `student_credentials (student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, pin_hash TEXT NOT NULL, failed_attempts INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, pin_set_at TIMESTAMPTZ NOT NULL DEFAULT now())`
- `student_setup_codes (student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`
- `student_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ)`
- PINs and setup codes are hashed with PBKDF2 (WebCrypto, available in Deno) and a per-row salt.
- Setting a PIN: new students set it at the end of sign-up. For existing students, staff or the owner press "Portal setup code" on `StudentProfilePage`. That creates a 6-digit code valid for 24 hours and opens `openWhatsApp()` with it pre-typed. The student enters the code and chooses a PIN.
- Student tokens are separate from staff tokens: signed with a new secret `STUDENT_JWT_SECRET`, carrying `typ: 'student'` and `sub: <student_id>`, valid for 30 days, kept in the portal's `localStorage`. Add `authStudent()` in `_shared/auth.ts`. A staff token is never accepted for `me_*` actions, and a student token is never accepted for staff actions.
- PIN length, lockout and reset follow D6.

**Portal actions** (caller `student`; the student id always comes from the token):

| Action | Tier | Purpose |
|---|---|---|
| `me_login`, `me_set_pin`, `me_logout` | public / T1 | Login and PIN setup |
| `me_profile`, `me_update_contact` | T0 / T1 | SP1 (contact fields only; never name, branch or plan) |
| `me_membership` | T0 | SP2: plan, days left, renewal kind via `renewalKind`, dues |
| `me_payment_request`, `me_submit_payment_proof` | T2 | SP3 (see P2.2) |
| `me_receipts` | T0 | SP4: confirmed transactions for this student only |
| `me_study_report` | T0 | SP5: same data as `get_student_study_report`, plus focus ratings |
| `me_request_hold`, `me_resume` | T1 | SP6: within policy runs `pause_membership` / `resume_membership`; outside policy creates an approval |
| `me_chat` | T1 | SP7: messages to the A1 concierge |
| `me_privacy`, `me_privacy_request` | T0 / T1 | SP8: consents, data download or deletion request (handled by the owner) |
| `me_notifications`, `me_mark_read` | T0 / T1 | Inbox from `058_portal_notifications` |

## P2.2 UPI pay links and payment proof check (closes G11, G13, G17, G18)

- The owner sets `app_settings` rows `upi_vpa` and `upi_payee_name`.
- `me_payment_request` returns `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<reference>&cu=INR` for renewal, dues, Food Pass top-up or locker renewal. The amount comes from the existing code, never from the client. On a computer, show the same link as a QR code (an npm QR package is fine).
- `057_payment_proofs`: `payment_proofs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID NOT NULL REFERENCES students(id), purpose TEXT NOT NULL CHECK (purpose IN ('renewal','dues','food_pass','locker')), amount_expected NUMERIC NOT NULL, reference TEXT NOT NULL UNIQUE, utr TEXT, image_path TEXT, ai_reading JSONB, status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','confirmed','rejected')), decided_by_staff_id UUID REFERENCES staff(id), decided_at TIMESTAMPTZ, reject_reason TEXT, transaction_ids UUID[], created_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Screenshots go in a private Storage bucket `payment-proofs`.
- After upload, the `agent` function reads the screenshot with the AI model and stores `{ amount, utr, paid_at, payee_vpa, confidence }` in `ai_reading`. It flags mismatches with the expected amount or VPA. **It never confirms anything.**
- The owner's approval queue shows each proof next to the AI reading. **Confirm** runs the existing action (`renew_membership`, `record_payment`, `topup_food_pass` or `renew_locker`) with payment mode `upi` and the owner as actor, then stores the resulting transaction ids. **Reject** needs a reason, which the student sees.
- Cash stays a staff/owner entry if D1 allows it.

## P2.3 Permission gate and approval queue (A8, part 2) — migration `059_agent_runs_approvals`

- `agent_runs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ, status TEXT, tokens_in INT, tokens_out INT)`
- `approvals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), kind TEXT NOT NULL CHECK (kind IN ('t3_action','payment','student_request')), action TEXT, payload JSONB NOT NULL, requested_by_type TEXT NOT NULL, requested_by_id UUID, run_id UUID, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')), decided_by_staff_id UUID REFERENCES staff(id), decided_at TIMESTAMPTZ, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
- Router rule: when the caller is `agent` or `student` and the action is T3, do not run it. Create an `approvals` row and return `{ pending_approval: <id> }`. On approval, the owner's click runs the action with the owner as actor and the original request recorded as `reason`.
- Owner page "Approvals" (OwnerRoute): pending items, with Approve and Deny (a reason is required to deny).

## P2.4 Agents

All agents follow **Appendix F**.

| Agent | Where it works | Tools (registry actions) | Notes |
|---|---|---|---|
| A1 Student concierge | `/me/chat` | `me_*` reads, `me_request_hold`, `me_payment_request` | Answers dues, balance, holds, Food Pass. Language follows D4. |
| A4 Collections and renewals | Daily `cron_collections` at 08:00 IST | T0 reads, `student_scores`, notification insert | Ranks students by churn score and dues. Creates portal notifications. Builds an owner "Send list" page: one AI-drafted message per student with a WhatsApp button (`openWhatsApp()`). Closes G12. |
| A3 Onboarding | Sign-up and `/me` | `signup` actions, `me_payment_request`, AI photo check | With `pssai_auto_approve` on: the student picks a plan in the portal, pays through P2.2, and after the owner confirms payment the registration completes through the existing `create_membership` (and `claimDesk` for permanent seats). The AI checks that ID photos are readable and the name matches; problems go to the owner. Closes G7, G8. |

## P2.5 Other Phase 2 items

| Item | What | Closes |
|---|---|---|
| AI-written messages | Welcome messages and study-report summaries are drafted by the AI, shown in the portal, and still sendable with one tap through `openWhatsApp()` | G27; G9 and G26 partly |
| Session-end reminders | `cron_session_reminders` every 5 minutes creates a portal notification for sessions ending within 10 minutes. Replaces `useSessionAlerts` for students. | G3 |
| Waitlist offers | When a permanent seat frees, the next person on `permanent_waitlist` gets a portal offer with an accept deadline | G10 |
| Live updates | Replace the four polling hooks with Supabase Realtime **Broadcast**. The edge function sends a tiny "changed" signal on channel `branch:<id>` with no row data; the client re-fetches through `api()`. (Table-change subscriptions would need RLS policies, which this repo does not use.) | G28 |
| I27 Usage-fit plans | The concierge can suggest a better-fitting plan; the change itself stays T3 | — |
| Migration `058_portal_notifications` | `portal_notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, action_url TEXT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())` | — |
| Migration `064_student_requests` | Holds, plan changes and refunds asked for by students are stored here and linked to `approvals` | — |

**Removed in Phase 2:** the browser polling hooks (after Realtime is verified); the sign-up claim lock (`claimSignup`, `release_signup_request`, `SIGNUP_CLAIM_MINUTES`) once auto-approval is on; the owner repair buttons for `fix_membership_dates` and `fix_negative_food_pass_balances`, once the nightly report has run clean for a few weeks. **`openWhatsApp()` stays.**

**Integration tests required before Phase 2 ships:** every Appendix A part 2 case, plus a portal isolation test (a student token can never read or change another student's data).

## Phase 2 exit gate

- [ ] Most renewals at the pilot branch are paid through the portal, with payments confirmed within the time agreed in D2
- [ ] Two weeks of shadow mode with replies passing the agreed accuracy bar on a real-chat test set
- [ ] No T3 action ran without owner approval (checked in `events` and `approvals`)
- [ ] The portal isolation test passes

---

# PHASE 3 — Owner impact engines (spec level)

**Branch:** `pss-ai/p3-owner-impact` · **Needs:** D5, D7, D8 · **Runs at one pilot branch against a control branch**

| Item | What to build | Data and actions | Closes |
|---|---|---|---|
| O1 Seat-hour overbooking | Predict, per permanent member and hour, the chance they won't use their desk, from check-in history and declared absences (SP10). Offer the expected free hours minus a safety buffer to walk-ins. A member who arrives anyway gets a fallback seat or a credit. | Migration `060_overbooking` (resold hours, fallback credits). Walk-in sales go through the existing `create_walkin`. | — |
| I3 Yield pricing | Walk-in prices follow forecast occupancy and the exam calendar, within an owner floor and ceiling | Reads `fee_config`; never writes outside owner limits; price changes are T3 unless inside D5 limits | G33 |
| A2 Enquiry and sales agent | A chat on the public enquiry page (new public action `public_enquiry_chat`, rate-limited by IP and phone) that creates or updates the enquiry. Drafts follow-ups that the owner sends in one tap. | `create_enquiry`, `update_enquiry`, `add_enquiry_activity`, `add_enquiry_followup` | G22 |
| I24 Lead scorer | Ranks enquiries by chance of converting | `student_scores`-style table for enquiries, or a `score` column added in `060` | G25 |
| AI enquiry dedupe | The AI judges whether two enquiries are the same person; merges go through the existing merge flow | Existing merge logic in `EnquiriesPage` and its actions | G23 |
| Referral attribution | A tracked link per channel replaces the referral dropdown | Migration `066_referral_links` | G24 |
| I25 Exam-notification radar | The `cron` function fetches the exam pages chosen in D8, the AI extracts exam names and dates, and demand surges are predicted. If a site can't be read, the owner enters dates by hand. Respect each site's terms. | Migration `067_exam_notices` | — |
| I26 Win-back | Finds past members at the right point in their exam cycle and drafts a return offer for the owner to send | Portal notifications and the "Send list" page | — |
| O9 Next-exam plans | Suggests a ready plan for the next exam in the student's path, using an owner-maintained `exam_ladder` setting in `app_settings` | Portal notification (SP12) | — |
| O3 Pay-later advice | A risk score tells the owner whether to allow pay-later. No lending partner; the owner decides. | `student_scores` with model `paylater` | G16 |
| A7 Exception desk | Drafts a recommended decision, with reasons, for each pending approval | Reads `approvals`; writes only a draft note | — |
| Portal R2 | SP9 waitlist, SP10 Release my hours (migration `065_hour_release`, credit share from D7), SP11 referral and cashback, SP12 next-exam plans | `me_*` actions | — |

## Phase 3 exit gate

- [ ] A measurable revenue gain at the pilot branch compared with the control branch over a full month
- [ ] Every overbooking collision was handled by the fallback, with no escalated complaint
- [ ] Released hours are resold and credited correctly, with zero double-bookings

---

# PHASE 4 — Self check-in at a pilot branch (spec level)

**Branch:** `pss-ai/p4-self-checkin` · **Needs:** D9, D10 · **Staff stay present as a fallback for four weeks**

| Item | What to build | Closes |
|---|---|---|
| Self check-in (SP13) | Migration `061_checkin_location`: add `latitude`, `longitude`, `checkin_key` to `branches`; a `checkin_records` table with the location result and consent. A printed QR poster encodes `https://join.perfectstudyspace.in/me/checkin?b=<branch>&k=<checkin_key>`. New action `me_check_in` (T1) checks the key and the phone's location against the D9 radius, then runs the same logic as `check_in_member` with the student as actor. Desk choice: permanent members get their own desk; others get one from seat matching. The owner can reprint with a new key. | G1 |
| Self checkout | New action `me_check_out` runs the same logic as `checkout_booking`, so overtime and Food Pass rules are unchanged | — |
| A5 Session watch | Reminds students in the portal before quota end, closes forgotten sessions, applies overtime by rule and flags manual edits. The "Correct checkout time" control becomes an exception path. Without sensors an early exit cannot be verified. | G4; G2 and G5 partly |
| I4 Seat matching | Replaces the first-free-desk choice in `create_walkin` with placement based on study profiles | G6 |
| O2 part 2 | The nightly check also compares self check-ins, billed sessions and confirmed payments | — |
| I20, I21 Food | Orders decrement stock automatically; demand is forecast; supplier orders are drafted for the owner | G29, G30 |
| I22 Complaint to ticket | Complaints in the portal (SP17) become tickets with type and priority | — |
| Photo-proof tasks | Housekeeping tasks are confirmed with a phone photo | G31 |
| Portal R3 | SP13 self check-in, SP14 live seats (counts only, no names), SP15 seat preferences, SP16 food ordering, SP17 report a problem | — |
| Config | `public/_headers` (Cloudflare Pages): change `Permissions-Policy` from `geolocation=()` to `geolocation=(self)` | — |

**Questions to settle with the owner while refining Phase 4:**
1. Self checkout when a Food Pass shortfall must be collected: block checkout until a UPI proof is confirmed, or allow checkout and carry the amount as dues?
2. The forgotten-session rule: at what time is an open session closed, at what end time, and is any overtime charged?

## Phase 4 exit gate

- [ ] Four weeks at the pilot branch with staff present but not needed
- [ ] Every open session is closed automatically by the end of the day
- [ ] Every remaining staff-only action call is logged and explained
- [ ] Every member at the pilot branch checked in through the portal for four weeks

---

# PHASE 5 — Self-improving system and staff retirement (spec level)

**Branch:** `pss-ai/p5-self-improving`

| Item | What to build |
|---|---|
| I7 Your own small model | **First check the AI provider's terms on training with its outputs; skip I7 if not allowed.** Fine-tune a small open model on logged agent runs (inputs, tool calls, outcomes, owner approvals). Route routine portal chats to it; keep the large model for hard cases. Compare both on the same test sets. |
| I8 Policy learner | Groups the owner's past approvals and denials and proposes new coded rules. A rule applies only after the owner signs it off. |
| I6 Digital twin | Simulates a policy change (for example a 7-day grace period) on real behaviour data before it goes live |
| O6 Weekly experiments | Small tests on offers, hours and menu; keeps the winners after owner review |
| O7 Space-yield optimiser | Occupancy heat-maps suggest which zones become premium cabins, group rooms or extra seats |
| I13, I10 | Study Wrapped card and exam coach in the portal |
| Portal R4 | SP18 focus profile, SP19 exam coach, SP20 Study Wrapped, SP21 study buddy (opt-in) |
| S1 Retire desk-staff modules | Migration `062_deprecate_staff_ops` marks tables deprecated; a later migration drops them after the data is archived. Remove: `markAttendanceIfNeeded` on every request; `staff_attendance` reads, `list_staff_attendance`, `end_staff_session` and the logout cut-off in `authStaff`; `assign_staff_override`, `clear_staff_override`; `list_branch_staff`, `get_staff_grid`; staff-to-staff `list_messages`, `send_message`, `MessagesPage`; `StaffPage`; `TasksPage` unless housekeeping still uses it. `create_staff` and `update_staff` shrink to owner, admin and kitchen/housekeeping accounts. Do this only after the staff modules sit unused for a full month. |

## Phase 5 exit gate

- [ ] The small model handles most chats at the large model's accuracy on the test sets (or I7 is skipped by decision)
- [ ] Staff modules sat unused for a full month before the retirement migration
- [ ] Monthly active portal users meet a target set with the owner from the R1 baseline

---

# PHASE 6 — New student products (spec level)

**Branch:** `pss-ai/p6-student-products`

| Item | What to build |
|---|---|
| I33 Verified study certificate (SP22) | A record of real study hours, signed with an HMAC secret, with a public check page at `join.perfectstudyspace.in/verify/<id>` |
| I34 Parent digest (SP23) | A weekly read-only summary link that the student chooses to share; the student can revoke it |
| O10 One owner, every branch | One dashboard, one approval queue and one brief across all branches |

## Phase 6 exit gate

- [ ] The owner reviews student uptake of certificates and parent links and keeps what is used

---

# Appendix A — Money regression tests

Values marked "pinned" record what the code returns today. If one looks wrong, report it to the owner; do not change the code inside this plan.

## Part 1: unit tests (required in P0.3)

| # | Function | Input | Expected |
|---|---|---|---|
| A1 | `renewalKind` | end `2026-10-15`, today `2026-10-15` | `early` |
| A2 | `renewalKind` | end `2026-10-15`, today `2026-10-16` | `grace` |
| A3 | `renewalKind` | end `2026-10-15`, today `2026-10-25` | `grace` (day 10) |
| A4 | `renewalKind` | end `2026-10-15`, today `2026-10-26` | `late` (day 11) |
| A5 | `addMonths` | `2026-01-31`, 1 | `2026-02-28` |
| A6 | `addMonths` | `2028-01-31`, 1 | `2028-02-29` |
| A7 | `endDateForMonths` | `2026-08-20`, 1 | `2026-09-19` |
| A8 | `endDateForMonths` | `2026-10-01`, 1 | `2026-10-31` |
| A9 | `endDateForMonths` | `2026-01-31`, 1 | `2026-02-28` (clamped, no extra day removed) |
| A10 | `endDateForMonths` | `2026-09-01`, 3 | `2026-11-30` |
| A11 | `multiMonthDiscount` | 1, 2, 3, 5, 6, 12 | 0, 5, 10, 10, 15, 15 |
| A12 | `membershipTotalDays` | start `2026-09-01`, end `2026-11-30`, months 3 | 90 |
| A13 | `membershipTotalDays` | start `2026-09-01`, end `2026-09-02`, months 1 | 30 (floored at months × 30) |
| A14 | `unusedDaysRefund` | plan_amount 3375, plan_days 90, start `2026-09-01`, end `2026-11-30`, total_paid 3375, fee_due 0, today `2026-10-01`, waive false | refund 2250 (60 days × ₹37.50), rate 37.5 |
| A15 | `unusedDaysRefund` | same as A14 with waive true | refund 0 |
| A16 | `unusedDaysRefund` | same as A14 with total_paid 1000 | refund 1000 (never more than paid + fee due) |
| A17 | `unusedDaysRefund` | plan_amount 1250, plan_days 30, start `2026-11-01`, end `2026-11-30`, total_paid 1250, today `2026-10-20` | refund 1250 (period not started: counts from the start date) |
| A18 | `unusedDaysRefund` | plan_amount null, plan_days null, monthly_fee 1250, months_paid 3, discount_percent 10, start `2026-09-01`, end `2026-11-30`, total_paid 3375, today `2026-10-01` | refund 2250 (legacy-row estimate) |
| A19 | `overstayFromLastVisit` | end `2026-10-15`, monthly 1250, last visit `2026-10-22`, today `2026-10-30` | 7 days, charge 292, daily rate 41.67 |
| A20 | `overstayFromLastVisit` | end `2026-10-15`, monthly 1250, last visit `2026-11-05`, today `2026-11-10` | 10 days (capped), charge 417 |
| A21 | `overstayFromLastVisit` | no visit after expiry | 0 days, charge 0 |
| A22 | `overstayFromLastVisit` | end on or after today | 0 days, charge 0 |
| A23 | `computeOvertimeCharge` | 15 min, booked 6 h, base 0, not walk-in 3 h | 0 hours, charge 0 (inside grace) |
| A24 | `computeOvertimeCharge` | 16 min, 6 h, base 0, false | 1 hour, charge 10 |
| A25 | `computeOvertimeCharge` | 76 min, 6 h, base 0, false | 2 hours, charge 20 |
| A26 | `computeOvertimeCharge` | 30 min, 3 h, base 0, walk-in 3 h true | 1 hour, charge 5 (discounted first hour) |
| A27 | `computeOvertimeCharge` | 76 min, 9 h, base 0, false | 2 hours, total 100, charge 100 (pinned: the 10-hour cap) |
| A28 | `computeStudentStatus` | no membership, no locker | `inactive` |
| A29 | `computeStudentStatus` | no membership, locker due before today | `pending` |
| A30 | `computeStudentStatus` | membership fee_due 100 | `pending` |
| A31 | `computeStudentStatus` | membership end before today | `pending` |
| A32 | `computeStudentStatus` | membership clear, locker fee_due > 0 | `pending` |
| A33 | `computeStudentStatus` | membership clear, no locker owed | `active` |

## Part 2: integration tests (required before Phase 2 ships)

| # | Scenario | Expected |
|---|---|---|
| B1 | Two `claimDesk` calls for the same free desk at the same time | Exactly one succeeds |
| B2 | `checkout_booking` called twice for one session | Second call returns "This session has already been checked out." and charges nothing |
| B3 | `add_attendance` overlapping an existing session | Refused by `findOverlappingSession` |
| B4 | Early renewal on a ₹1,250/month plan ending 15 Oct, renewed 10 Oct | New period starts 16 Oct, same plan |
| B5 | Renewal while on hold / with unpaid dues / already renewed early | Each refused with its message |
| B6 | Cancel early renewal | Previous membership restored; full renewal money refunded as a `membership_refund` payout |
| B7 | Food order that would take a Food Pass negative, then checkout | Pass never ends negative; shortfall collected |
| B8 | Split payment where cash + UPI ≠ total | Refused: "Cash + UPI amounts must add up to the total" |
| B9 | Quit 25 days after expiry with last visit on day 7 | Overstay 7 days, not 25 |
| B10 | Delete a 3-month ₹3,750 plan (₹3,375 after 10%) after 30 days | Refund ₹2,250 |

---

# Appendix B — Migrations (append-only, owner: database-data-engineer)

| # | File | Phase | Purpose |
|---|---|---|---|
| 052 | `052_event_log.sql` | P0 | Immutable event per action |
| 053 | `053_actor_audit.sql` | P0 | Actor columns on money and activity tables |
| 054 | `054_idempotency_keys.sql` | P0 | Idempotency key store |
| 055 | `055_focus_pulse.sql` | P1 | Focus ratings |
| 056 | `056_model_outputs.sql` | P1 | Scores, fingerprints, anomaly flags, forecasts, owner briefs |
| 057 | `057_payment_proofs.sql` | P2 | UPI payment proofs and owner decisions |
| 058 | `058_portal_notifications.sql` | P2 | Portal inbox |
| 059 | `059_agent_runs_approvals.sql` | P2 | Agent runs and approval queue |
| 060 | `060_overbooking.sql` | P3 | Resold hours and fallback credits |
| 061 | `061_checkin_location.sql` | P4 | Branch location, check-in key, check-in records |
| 062 | `062_deprecate_staff_ops.sql` | P5 | Marks desk-staff tables deprecated |
| 063 | `063_student_auth.sql` | P2 | Student PINs, setup codes, sessions |
| 064 | `064_student_requests.sql` | P2 | Holds, plan changes, refunds asked for by students |
| 065 | `065_hour_release.sql` | P3 | Released hours and member credits |
| 066 | `066_referral_links.sql` | P3 | Tracked referral links |
| 067 | `067_exam_notices.sql` | P3 | Exam notices read from public pages |

Numbers are indicative. Because phases ship in order, the migration owner may renumber unbuilt ones so files are applied in the order they ship; update this table in the same commit.

---

# Appendix C — File ownership and browser owner

Every implementer runs `/freeze <glob>` on their paths first (see `.claude/rules/agent-teams.md`).

| Path | Owner (`.claude/agents/`) |
|---|---|
| `supabase/migrations/**` | `09-database-data-engineer` (sole owner) |
| `supabase/functions/api/**`, `supabase/functions/_shared/**`, `supabase/functions/cron/**` | `08-backend-lead` |
| `supabase/functions/agent/**`, prompts, `tests/agents/**` | `10-ai-agent-engineer` |
| `ml/**` | `10-ai-agent-engineer`, with `09-database-data-engineer` for features |
| `src/**` (owner app, staff app, student portal) | `07-frontend-lead` |
| `tests/money/**`, `tests/integration/**`, `tests/registry/**` | `08-backend-lead` until a test-engineer role file exists (`CLAUDE.md` names one; `.claude/agents/` has none) |
| `scripts/predeploy.mjs`, `docs/ops/**`, `supabase/config.toml`, `vercel.json` | `18-devops-sre` |
| `package.json`, `src/lib/api.js` | `07-frontend-lead` (claim explicitly in each phase's ownership map) |
| **Browser QA** | `12-qa-browser-lead` — the single browser owner |

---

# Appendix D — Permission tier rules

| Tier | Rule | Agents | Students |
|---|---|---|---|
| T0 | Reads: `list_*`, `get_*`, `lookup_*`, `search_*`, `whoami`, `me_*` reads | Allowed | Own data only |
| T1 | Messages, notes, enquiries, follow-ups, tasks, alerts, focus ratings, waitlist joins, session pause/resume, check-in, holds within policy, contact-detail updates | Allowed | Own requests only |
| T2 | Money comes in, with amounts calculated by code: `record_payment`, `record_locker_payment`, `add_manual_payment`, `topup_food_pass`, `create_food_bill`, `collect_food_bill_shortfall`, `create_walkin`, `create_membership`, `renew_membership`, `renew_locker`, `add_locker`, `checkout_booking`, payment requests and proofs | Allowed | Own payments only |
| T3 | Money goes out, records are destroyed or policy changes. Always the owner's approval queue for agents and students. | Approval only | Approval only |

**Explicit T3 list:** `delete_membership`, `close_membership`, `cancel_early_renewal`, `change_membership_plan`, `change_membership_cabin`, `transfer_student_branch`, `apply_loyalty_discount`, `grant_cashback`, `redeem_cashback_now`, `set_overtime_excluded`, `add_attendance`, `update_attendance`, `fix_membership_dates`, `fix_negative_food_pass_balances`, `update_fee_config`, `update_welcome_template`, `update_branch`, `add_desk`, `remove_desk`, `remove_locker`, `update_locker_due_date`, `update_locker_number`, `create_food_item`, `update_food_item`, `create_staff`, `update_staff`, `assign_staff_override`, `clear_staff_override`, `end_staff_session`, `delete_enquiries`, `rotate_signup_link`.

When unsure, choose the higher tier. Tiers do not change what staff, owner and admin can do today (R6).

---

# Appendix E — Out of scope

Cut on 2026-10-13. Do not build these or add services for them: payment gateway, WhatsApp Business API, SMS login codes, ID-verification providers, edge cameras, Wi-Fi presence sensing, check-in kiosk, noise sensors, smart power, lending partners, pre-sold expansion, Google review automation, next-branch picker, cohort insights for coaching centres, federated learning, licensing to other halls, the VPS port, outside CI services.

Deferred (allowed later, not part of any phase): I14 burnout watch, I15 Tamil voice agent, I16 syllabus doubt-solver, I28 referral graph, I32 voice business assistant, O4 demand-mix filler, O8 commitment plans.

---

# Appendix F — Rules for every agent

1. Agents act only through registry actions. No direct database writes, no raw SQL.
2. Every run has a `run_id`; every tool call writes an event with `actor_type = 'agent'`.
3. T3 actions always become approvals (P2.3). Agents never see or compute money beyond what an action returns.
4. Student messages, enquiry text, web pages and screenshots are untrusted input. Business rules live in code, not in prompts, so instructions inside a message cannot change them.
5. Answer only from tool results. When data is missing, say so.
6. Each agent has a test set of at least 20 real-style cases in `tests/agents/` and a pass bar agreed with the owner before its flag goes on.
7. Shadow mode first (`pssai_agent_shadow`): replies are drafts until a person approves them, for at least two weeks.
8. Log tokens per run in `agent_runs`. Route routine traffic to the cheaper model chosen in D3.
9. Keep each agent turn within the Edge Function time limit. Split long jobs across `cron` runs.
10. The AI key lives only in Supabase secrets (`AI_API_KEY`).
