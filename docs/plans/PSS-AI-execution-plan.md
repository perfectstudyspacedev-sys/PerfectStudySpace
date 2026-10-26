# PSS-AI — Execution Plan for Claude Code

| | |
|---|---|
| **Status** | All work is on the single branch `pss-ai/all-phases`. Phase 0 built (P0.1–P0.10 ✅); Phase 1 built (P1.1–P1.8 ✅). On 2026-10-20 the owner asked for every phase to be built now, ahead of the exit gates, with the decisions below; every new feature ships switched off, so each exit gate is still ticked by the owner before its switches go on. Phases 2–6 in progress. |
| **Agreed on** | 2026-10-13 |
| **Execution order** | P0 → P1 → P2 → P3 → P4 → P5 → P6. A phase starts only after the owner ticks the previous phase's exit gate. |
| **Verified against** | `main` at commit `cb7beeb` (RSP + SSP merged, PR #2) |
| **Outside services allowed** | An AI model API, Supabase, and public exam notification pages. Nothing else. No hardware. |
| **Where this file lives** | `docs/plans/PSS-AI-execution-plan.md` |

## Corrections found while building (2026-10-16)

- **Hosting:** both sites run on **Cloudflare Pages** (project `perfect-study-space`: `perfect-study-space.pages.dev` and `join.perfectstudyspace.in`), not Vercel. `vercel.json` is not read there; the security headers live in `public/_headers`. Wherever this plan says "Vercel" (repo facts, R10, Phase 4 config), read "Cloudflare Pages".
- **CORS (P0.1):** the public website (`perfectstudyspace.in`, `www.perfectstudyspace.in`, Cloudflare project `perfect-study-space-web`) posts its enquiry form to the `api` function (`public_create_enquiry`), so it must be on the allow-list. Default list in code: `https://perfect-study-space.pages.dev`, `https://join.perfectstudyspace.in`, `https://perfectstudyspace.in`, `https://www.perfectstudyspace.in`, `http://localhost:5173`. The `ALLOWED_ORIGINS` secret replaces it when set.
- **Extra safety net:** `tests/server/` runs the real `api` function against an in-memory stand-in for Supabase (`npm run test:server`, no Docker). `golden_test.ts` calls every action on a fixed clock and compares every response and the whole database with `golden.snapshot.json`, so refactors (P0.2, P0.4) are proven behaviour-neutral.
- **Deploy order matters more from P0.6:** the frontend now sends an `Idempotency-Key` header on every call. The `api` function built from this branch allows that header (CORS); the one live today does not, so a browser would refuse every call if the frontend went live first. Keep R10: functions before frontend.

## Independent review of Phase 0 (2026-10-17)

A read-only staff-level reviewer read the whole branch. Fixed (first on `pss-ai/p0-foundation`; included in `pss-ai/all-phases`):

| # | Finding | Fix |
|---|---|---|
| 1 | Blocker: anonymous calls could store their whole body in the append-only log, which nothing could delete | Public callers store only named fields (login: username; sign-up: referral source; enquiry: branch, package), cut to 100 characters. Every payload is capped: 50 keys, 64-character keys, 50 array items, 1 KB strings, 8 KB in all. `purge_events()` is the one way to delete (≥ 30 days old). |
| 2 | A key on every call stored an unsalted hash of payloads that hold passwords, plus extra writes | The app sends `Idempotency-Key` only from the four money forms; the request hash is an HMAC with the server secret. |
| 3 | Deploying the function before 053 would break every money insert half-way | One check per function instance; without the columns, inserts are not stamped and the gap is logged. |
| 4 | The integrity report flagged healthy memberships | It compares end dates only and accepts the months rule or the custom-days rule; F-3 raised. |
| 5 | One retry key per page | Keys are per booking or membership. |
| 6 | A stale claim could be re-run while a slow first try was still alive | Stale after 15 minutes (the function limit is 400 s). |
| 7 | Redaction missed `siteKey`, `aadhar`, `pwd`, `otp`, `token`, `secret` and hid `pincode` | Whole-word matching on key names plus whole keys `siteKey`/`apiKey`. |
| 8 | `predeploy --root` without a value; one gap listed many times | Usage message; only the first gap is reported. |
| — | If the scheduled jobs stop, nobody knows | The Dashboard card warns when the latest report is over 36 hours old. |

Checked and found sound by the reviewer: the router behaves as before, money helpers unchanged (R1), the `actorDb` proxy on supabase-js 2.49.1, the idempotency race handling, the cron secret check and `cron.sql`, migrations 052–054.

## Findings for the owner (F-1 to F-3 fixed on 2026-10-20 with the owner's approval, A3)

**Decisions the review raised (owner):** how long to keep the event log (`purge_events(INTERVAL)` exists, minimum 30 days; nothing deletes automatically — for example run `SELECT purge_events(INTERVAL '400 days');` monthly), and whether that period also answers erasure requests: staff actions such as a new registration keep the student's name and phone in their event payload until purged. Public calls (login, sign-up, website enquiry) no longer store any personal data. The public actions have no rate limit (unchanged from before Phase 0); each anonymous call now adds at most a few hundred bytes to the log.

- ✅ **Fixed:** `splitPaymentError()` (lib.ts) now runs before the first write in `record_payment`, `record_locker_payment`, `add_manual_payment`, `renew_locker`, `add_locker`, `remove_locker` and `create_walkin` (`tests/server/split_test.ts`: each refuses a bad split with 400 and changes nothing; a correct split still records cash and UPI rows). `insertPaymentTransactions` is unchanged.
- **F-1 Split payment mismatch (found in P0.6 tests).** If `record_payment` is called with a cash + UPI split that does not add up, it lowers the membership's due and raises its total paid first, then refuses the split with a 500 — so the membership is credited and no transaction is written. The staff app cannot send such a split (its forms check it first), so today it needs a hand-made API call. `add_locker`, `remove_locker`, `record_locker_payment`, `add_manual_payment`, `renew_locker` and `create_walkin` also check the split only when writing the transaction and may leave the same partial write (not checked one by one). Suggested fix, for the owner to approve: check the split before any write, as `create_membership` and `renew_membership` already do. This matters before agents (Phase 2) call payment actions.
- ✅ **Fixed (F-2 and F-3):** `membershipDateDrift()` (lib.ts) reads every membership (paged) and lists only end dates that match neither the months rule nor the custom-days rule (plus holds), skipping end dates set by hand (`change_membership_plan` events with `newEndDate`). Both the nightly report and `fix_membership_dates` use it; the fix changes only those end dates and never due dates (`cron_test.ts` I1, I2, F-3). In the golden master the seeded 30- and 90-day plans keep their sold end dates, so the later locker charge and early-delete refund follow those dates (3 calls changed, all from `fix_membership_dates`).
- **F-3 `fix_membership_dates` rewrites correct memberships (found in the Phase 0 review).** It resets every end date to start + months (+ hold days) and every due date to start + 1 month + 1 day. That is wrong for custom-day plans (end = start + days − 1; a 45-day plan would gain 16 unpaid days), for due dates moved a month on by paying off a due (`record_payment`), and for end dates changed by hand in `change_membership_plan`. Do not run it on live data until it is fixed. Suggested fix, for the owner to approve: change only end dates that match neither the months rule nor the days rule (what the nightly report now lists) and never touch due dates. Fix F-2 in the same change.
- **F-2 `fix_membership_dates` sees at most 1,000 memberships (found in P0.8).** It reads memberships with one plain select, and Supabase returns at most 1,000 rows per request by default, so with more memberships than that it checks only some of them. The integrity report pages through all of them, so its count can be higher than what one `fix_membership_dates` run fixes. Suggested fix, for the owner to approve: page through all rows, as the report does.

## How to use this file in a future chat

- Say **"Build Phase 0"**, **"Build P0.4"**, or **"Build P2 portal R1"**. Refer to items by label, for example *"In P2 skip I27"*.
- Before writing any code, read this whole file, `CLAUDE.md` and everything in `.claude/rules/`.
- **Settled decisions** must not be re-decided. Decisions D0 to D10 and the owner answers A1–A5, C1–C24 are settled (2026-10-20); build with them.
- **One branch for every phase: `pss-ai/all-phases`** (owner decision, 2026-10-18). Build each remaining phase on it, one commit per item; never create a branch per phase, and do not touch `main` or any other branch. Phases 0 and 1 were first built on `pss-ai/p0-foundation` and `pss-ai/p1-data-brain`; those two are left as they are (historical), and `pss-ai/all-phases` contains everything in them.
- When an item is done, mark it ✅ in this file in the same commit as the code.
- Tick an exit-gate box only with evidence: test output, build output or browser-QA notes. Never by assertion.
- **Phases 0 and 1 are written at build level.** Phases 2 to 6 are written at spec level. Before building one of them, re-read the repo and write the build-level detail here (as-built notes per item); by A1 no separate approval is needed.

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

## Decisions (all settled by the owner on 2026-10-20)

The owner accepted every suggestion in the 2026-10-20 question list ("all suggestions, build all the phases"). Nothing below needs asking again; change a value only if the owner says so.

| # | Decision | Settled |
|---|---|---|
| D0 | Test runner | Vitest for TypeScript modules; Deno for the server suites; pytest for `ml/` |
| D1 | Cash handling | Cash at the desk stays allowed (staff/owner entry); students pay by UPI in the portal |
| D2 | Payment confirmation | The owner confirms each UPI payment, target within 2 hours between 08:00 and 22:00 IST |
| D3 | AI models | Claude Haiku 5.5 for routine chats; Claude Sonnet 5.5 for hard cases and reading payment screenshots. Monthly AI spend capped by an owner setting. I7 (training our own small model) is skipped. |
| D4 | Agent language | Reply in the student's own language: English, or Tamil (Tamil script or Tanglish) |
| D5 | Auto-approve limits | Waivers up to ₹200 and holds up to 7 days run without the owner; refunds, plan changes and price changes always go to the approval queue |
| D6 | Portal PIN | 6 digits; locked for 15 minutes after 5 wrong tries; the owner resets by sending a new setup code |
| D7 | Released-hours credit | 50% of the resale price, as portal credit |
| D8 | Exam sources | TNPSC, UPSC, SSC, IBPS/SBI, TNUSRB, RRB — read from their public pages, with manual entry when a page can't be read |
| D9 | Location check | Within 100 m of the branch; consent text drafted in the build, shown before the first check-in |
| D10 | Food | Not chosen. Build food ordering so it works for a kitchen person, an outside vendor or vending (a fulfilment queue any of them can work from) |

### Owner answers to the build questions (2026-10-20)

| # | Answer |
|---|---|
| A1 | Write each phase's build-level rewrite into this file and build it without a separate approval |
| A2 | Build all phases back to back; every new feature stays switched off until the owner deploys and switches it on. Exit gates are measured later, in operation |
| A3 | Fix F-1, F-2 and F-3, with tests |
| A4 | One independent review after each phase |
| A5 | Pilot branch: Hopes. Control branch (Phase 3): Ram Nagar |
| C1 | Student self-hold without approval: up to 7 days, once a calendar month; anything longer goes to approval |
| C2 | Waitlist seat offer: 24 hours to accept |
| C3 | ID photo at self sign-up: optional; Aadhaar or college ID; the AI only checks it is readable and the name matches |
| C4 | Agent pass bar: 18 of 20 test cases |
| C5 | Business legal name and grievance contact: owner fills `app_settings` keys `business_legal_name`, `grievance_contact_name`, `grievance_contact_phone`, `grievance_contact_email`; the privacy page shows them |
| C6 | Sign-off on drafted WhatsApp messages: "Team Perfect Study Space" |
| C7 | Overbooking allowed: 20% safety margin; a member who arrives anyway gets another desk, else 1 free day |
| C8 | Walk-in automatic prices within 20% of today's `fee_config` prices |
| C9 | Enquiry chat lives on the join site (this repo); the public website links to it |
| C10 | Referral channels: Instagram, Google, flex banner, friend, WhatsApp, other |
| C11 | Exam ladder: drafted in the build (e.g. TNPSC Group 4 → Group 2 → Group 1); the owner edits it in settings |
| C12 | Largest discount in win-back or next-exam offers: 10% |
| C13 | Pay-later: allowed up to 50% of the fee, for 15 days, with owner approval |
| C14 | Self checkout with a Food Pass shortfall: allow it and add the amount as dues |
| C15 | Forgotten sessions: closed at 23:30 IST at the booked end time, no overtime charged |
| C16 | Complaint categories: cleanliness, noise, Wi-Fi, seat, food, other |
| C17 | Housekeeping tasks that need a photo: all daily cleaning tasks |
| C18 | Retire the desk-staff screens after a month unused; keep owner, admin, kitchen and housekeeping accounts |
| C19 | Portal target: 70% of active members use it each month |
| C20 | Study buddy (opt-in) and weekly experiments on offers, hours and menu: yes |
| C21 | Study certificate shows the hall name, hours studied, date range and a check link |
| C22 | Parent weekly summary: Sunday 19:00 IST |
| C23 | Event log kept 400 days |
| C24 | The large discount/cashback confirm stays always on |

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

**Branch:** `pss-ai/all-phases` · **Needs:** D0 · **Students see:** no change · **Build in this order:** P0.1 → P0.10

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

## ✅ P0.2 Move pure helpers to `_shared` (F1, part a)

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
- [x] `index.ts` no longer defines the moved functions
- [x] Login, check-in and checkout with overtime give identical results before and after (golden master, `tests/server`); `supabase functions serve` itself still to be run on a machine with the Supabase CLI
- [x] The diff of each moved function body is whitespace-only (checked by script: byte-identical apart from `export`; `overstayFromLastVisit` is the one allowed split)

## ✅ P0.3 Money regression tests (F5, closes G21) — needs D0 (Vitest, approved 2026-10-16)

- Add Vitest as a dev dependency. Add scripts: `"test": "vitest run"` and `"test:integration": "vitest run --config vitest.integration.config.ts"`.
- Unit tests in `tests/money/*.test.ts` import from `supabase/functions/_shared/`. Write every unit case in **Appendix A** as its own named test.
- Integration cases (Appendix A, part 2) go in `tests/integration/` and run against a local Supabase (`supabase start`, needs Docker). They skip themselves when no local Supabase is running. They are required before Phase 2, not before the end of Phase 0. *(Built in Phase 2 as Deno suites; they also run against a bare Postgres + PostgREST — see `tests/integration/README.md`.)*

Acceptance:
- [x] `npm run test` passes and covers every Appendix A unit case (33/33; no pinned value differed from the code)
- [x] Test names match the case numbers in Appendix A

## ✅ P0.4 Action registry and domain split (F1, part b)

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
- *As built:* every handler still validates its own input, so no `validate` was added in P0. Registry metadata (`registry.ts`) is kept apart from the handlers (`actions.ts` joins them and refuses to start on any mismatch) so Vitest can load it without the edge runtime. The router does not re-check staff/owner/admin callers in P0 (R6: each handler's own check stays the only one); caller enforcement starts with the agent and student callers. `computeDeleteSettlement`, which was declared inside the old handler, moved into `domains/members.ts` behind a small factory that hands it the same `db` and `staff`.

Acceptance:
- [x] Every action name handled today is in the registry (123). A test compares registry names to a checked-in list, `tests/registry/actions.snapshot.json`.
- [x] `index.ts` is under 300 lines (37)
- [x] Same results as before for: login, dashboard, check-in, checkout with overtime, food order with a Food Pass, new membership, early and grace renewals, an enquiry, the revenue page, the sign-up link — the golden master (all 123 actions, 193 calls, final database) is identical after the split; every moved block was checked byte-identical by script. Live browser QA against a deployed function still to do after deploy.
- [x] No frontend file changed in this step

## P0.5 Event log and actor audit (F8, F2) — migrations 052, 053 ✅

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

- *As built:* `withActor` (in `_shared/audit.ts`) is applied once, by the router, through `actorDb()`: the request's database client stamps `actor_type`, `actor_id` and `run_id` on every insert into the nine tables. This replaces calling it at each of the 51 insert sites, most of them inside money paths that R1 says not to touch; no site can be missed and no action code changed. Rows written outside the api (seeds, SQL) stay NULL. The grep check is replaced by tests that look at the rows themselves. The event is written with the plain client after the handler answers; a failed event write is reported with `console.error` and never changes the response. Events are written only when an action runs (not for 401 or an unknown action). The append-only trigger also refuses TRUNCATE. After the review: public callers store only named fields, every payload is capped at 8 KB, secret keys are matched by whole words, `purge_events()` is the only way to delete, and stamping switches itself off if 053 is missing. Responses that return whole rows (for example `list_enquiries`, `create_enquiry`) now include the three new columns; the app ignores them.

Acceptance:
- [x] Ten different mutating actions each write exactly one event row — `tests/server/events_test.ts` E1 (plus: reads write none, refused and thrown actions write one failed event, a broken events insert does not break the action). The golden master now records 95 events for its 193 calls and is otherwise identical once the new columns are removed (checked by script).
- [x] UPDATE and DELETE on `events` fail — migrations 001–053 were applied to a real Postgres (PGlite; 002 and 010 skipped there for lack of Supabase's `storage` schema): UPDATE, DELETE and TRUNCATE are refused by the trigger, the tier/actor CHECKs refuse bad values, RLS is on, and re-applying 052/053 is harmless.
- [x] A login and a sign-up leave no password, PIN or Aadhaar data in any event payload — events_test E4 (also a staff password set through `create_staff`)
- [x] Every insert that sets `created_by_staff_id` also sets `actor_type` and `actor_id` — by construction (`actorDb`); events_test A1 checks every row the ten actions inserted, and the golden master records the stamped rows of all 123 actions

## P0.6 Idempotency keys (F4) — migration 054 ✅

`054_idempotency_keys.sql`: `idempotency_keys (key TEXT PRIMARY KEY, action TEXT NOT NULL, actor_id UUID, status INT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`, with RLS on.

- `src/lib/api.js`: accept an optional third argument `api(action, payload, { idempotencyKey })` and send it as the `Idempotency-Key` header. When no key is given, generate one with `crypto.randomUUID()`. Forms that can be retried (payments, checkout, renewals) create one key per submit and reuse it on retry.
- Router: for actions with `mutating: true` and `idempotent: false`, if the key already exists return the stored status and body; otherwise run the handler and store the response (2xx and 4xx; never 5xx).
- The existing guards stay: the `checkout_booking` status check, the renewal claim guard and `claimSignup`.

- *As built:* the table also has `request_hash` (SHA-256 of the action and payload, key order ignored), so a key reused for a different request, by another staff member or for another action gets 422 and runs nothing. `status = 0` marks a request still running: a retry then gets 409; a claim left for over 5 minutes by a request that died is taken over. A 5xx releases the key, so a retry runs the action again exactly as today (see F-1 for what a 500 can leave behind). A replay writes no second event and carries the header `Idempotent-Replayed: true`. If the table is missing (054 not applied) actions run as before. Over-long keys (over 200 characters) get 400. In the app, `api()` takes `{ idempotencyKey }` and thrown errors carry `err.status`; `useRetryKey()` (`src/hooks/useRetryKey.js`) keeps one key per submit and per booking or membership for record payment, checkout and both renewal forms, kept after a network error, a 5xx or a 409, and dropped once the server has answered. Changed after the review: calls without a key send no header (the plan said to generate one for every call; that only added writes and stored hashes of password payloads), the request hash is an HMAC keyed with the server secret, and a claim is stale after 15 minutes.

Acceptance:
- [x] Two identical `record_payment` calls with the same key create one transaction row — `tests/server/idempotency_test.ts` I1 (also checkout and renewal, I6; double click, I5)
- [x] Two calls with different keys behave as they do today — I2 (and calls without a key)

## P0.7 Scheduler and the `cron` function (F3, closes G20) ✅

- Owner steps: enable the `pg_cron` and `pg_net` extensions in the Supabase dashboard; add the secret `CRON_SECRET`.
- New edge function `supabase/functions/cron/index.ts`. Add `[functions.cron] verify_jwt = false` to `supabase/config.toml`. Reject any request without the correct `x-cron-secret` header. Jobs are registry actions with caller `system`:
  - `cron_expiry_alerts`: the same logic as the alert loop at the end of `list_active_memberships`, for all branches
  - `cron_purge_signups`: calls `purgeExpiredSignups`
  - `cron_purge_idempotency`: deletes keys older than 48 hours
  - `cron_integrity_report`: see P0.8
- Put the schedules in `docs/ops/cron.sql` for the owner to run in the SQL editor. It is not a migration because it contains the project URL and secret. pg_cron uses UTC unless `cron.timezone` is set: expiry alerts at 06:00 IST = `30 0 * * *`; sign-up purge at 00:05 IST = `35 18 * * *`; key purge hourly; integrity report at 02:00 IST = `30 20 * * *`.
- Read paths: when `app_settings.pssai_cron` is `on`, `list_active_memberships` skips its alert loop and sign-up reads skip `purgeExpiredSignups`. When it is `off`, behaviour is exactly as today.

- *As built:* jobs live in `api/domains/system.ts` with callers `['system']`; the `api` router answers "Unknown action" for them, so only the `cron` function (secret checked in constant time; no secret set = every call refused) can run them. Each run goes through the same `runAction` as the api (`api/run.ts`) and writes an event with actor `system`. The alert loop moved unchanged into `remindExpiringMembers()` (lib.ts), used by both `list_active_memberships` (flag off) and `cron_expiry_alerts`. The flag is read by `featureOn()` (`_shared/flags.ts`). The sign-up purge is skipped only on the read (`list_signup_requests`); `public_signup_submit` keeps its purge, because resubmissions match on phone. `docs/ops/cron.sql` keeps the project URL and secret in Supabase Vault, so the schedules never contain the secret. Purges are tier T3 (records destroyed); the Appendix D T3 test now covers the actions people and agents can call.

Acceptance:
- [x] Each job runs once when triggered manually with the secret, and is refused without it — `tests/server/cron_test.ts` C1, C2 (against the real handler). On Supabase: owner step 5 of the deploy order, then `SELECT pss_run_cron_job('cron_integrity_report')`.
- [x] With the flag on, opening the Members page creates no alerts; the 06:00 job does — C3 (same reminders as the page made, no duplicates on a re-run, inactive branches skipped); sign-ups C4; key purge C5

## P0.8 Nightly integrity report (F10, closes G19) ✅

`cron_integrity_report` runs read-only checks and writes one `events` row with `action = 'integrity_report'` and the findings as its payload:

1. Memberships whose stored `end_date` or `due_date` differ from what `fix_membership_dates` would compute (compute only; no writes)
2. Food Passes with a negative balance
3. Bookings with `status = 'active'` that started more than 24 hours ago

Add an owner/admin T0 action `get_integrity_report` that returns the latest report. On the Dashboard, show a card to owner and admin when the report has any findings.

- *As built:* the report stores ids, dates and amounts only (no names or phone numbers), lists at most 100 rows per check and always the full counts. Check 1 was narrowed after the review: it lists end dates that match neither the months rule (`fix_membership_dates`) nor the custom-days rule (start + `plan_days` − 1), each plus hold days, and no longer compares due dates — payments and plan changes move those on purpose. A manual end-date change still appears there, so the card says "review it". The card also warns when the latest report is over 36 hours old (the scheduled jobs may have stopped). `get_integrity_report` returns the latest report. The card (`src/components/IntegrityReportCard.jsx`) shows on the branch Dashboard and on Combined Hall, only when a count is above zero.

Acceptance:
- [ ] On a staging copy, the counts match what the `fix_*` actions would change — the Food Pass count matches `fix_negative_food_pass_balances` (`cron_test.ts` I2). The membership count deliberately does **not** match `fix_membership_dates`, which also rewrites correct rows (F-3, shown in the same test); the staging-copy check waits for deploy and for the owner's decision on F-3.
- [x] The Dashboard card appears only for owner and admin — browser QA (mocked api): shows for owner with findings, on Combined Hall and at 390 px with no sideways scroll; hidden when clean or before the first report; staff never request it

## P0.9 Declare permission tiers (A8, part 1) ✅

- Give every registry action a tier using the rules in **Appendix D**.
- In Phase 0 tiers are only declared and written to `events.tier`. Staff and owner access still uses today's checks. Enforcement for `agent` and `student` callers starts in Phase 2.

Acceptance:
- [x] A test fails if any registry entry has no tier — `tests/registry/registry.test.ts`; every event row carries the action's tier (P0.5)
- [x] The T3 set equals the explicit list in Appendix D — same file (for actions people and agents can call; the two system purges are also T3)

## P0.10 Pre-deploy check (F9, closes G39) ✅

Add `scripts/predeploy.mjs` and the script `"predeploy": "node scripts/predeploy.mjs"`. It fails when:

- `DEV_MODE = true` appears in either file
- `README.md` contains `owner123` or `staff123`
- migration numbers are not contiguous from `001`, or a number repeats
- `npm run build` or `npm run test` fails

On success it prints the deploy order (R10). It runs manually before a deploy. (npm will also run it automatically before any `deploy` script added later.)

- *As built:* it also runs `npm run test:server` and refuses migration files not named `NNN_name.sql`. `--root <dir>` checks another checkout. The source checks are unit-tested in `tests/predeploy/predeploy.test.ts`.

Acceptance:
- [x] The script exits non-zero when `DEV_MODE` is flipped back to `true` in a scratch commit — scratch commit in a throw-away worktree: `✗ predeploy refused: DEV_MODE is true in src/lib/devMode.js`, exit code 1. On this branch it passes: build, 48 Vitest tests, 11 server suites, then prints the deploy order.

## Phase 0 deploy order

1. Owner confirms migrations `049`–`051` are applied
2. Migrations `052`, `053`, `054`
3. Owner enables `pg_cron` and `pg_net`; sets `CRON_SECRET` and `ALLOWED_ORIGINS`
4. `supabase functions deploy api` and `supabase functions deploy cron`
5. Owner runs `docs/ops/cron.sql`
6. Frontend
7. After the first clean night, owner sets `pssai_cron` to `on`

## Phase 0 exit gate

- [x] `npm run test` passes, including every Appendix A unit case (48 tests: A1–A33, registry and tiers, predeploy)
- [x] Every action is in the registry with a tier, and every mutating action writes an event with an actor (registry tests; `events_test.ts`; golden master: 95 events for 193 calls)
- [x] `npm run predeploy` refuses a deploy with `DEV_MODE` on (P0.10)
- [ ] Production on Supabase works with no change in behaviour (build plus browser QA notes) — waits for the owner's deploy (Phase 0 deploy order above); browser QA so far is against a mocked api

---

# PHASE 1 — Data brain (build level, read-only AI)

### Independent review of Phase 1 (2026-10-17)

Fixed (first on `pss-ai/p1-data-brain`; included in `pss-ai/all-phases`):

| # | Finding | Fix |
|---|---|---|
| 1 | Blocker: attendance edits and overtime exclusions were read from payload keys the app never sends (`hours`, `overtimeId`), so they could never be flagged; the synthetic data used the same wrong keys | Hours from `startTime`/`endTime`, `overtimeSessionId`, branch from the booking or overtime row; synthetic events now copy the real payloads; a test reads the TypeScript handlers and fails if the keys drift |
| 2 | Members who left kept their last score | Each publish removes the earlier run's rows for what it wrote (after the new rows are in) |
| 3 | Churn scored members far from their end date, outside what was validated | Only members ending in the next 28 days are scored |
| 4 | The budget comparison could count one member in several weeks | Nobody is contacted twice; hit rate and churners reached both reported |
| 5 | Holds taken after the prediction point leaked into features | Holds counted up to the point only |
| 6 | The first publish would flag every past week | Only the last 14 days can be flagged; baselines still use all history |
| 7 | Forecast publish deleted before inserting, and could leave an overlapping week | Insert first, then remove earlier runs of that kind |
| 8 | The dues collection rate measured the wrong thing | Share of what was owed after the first payment day that was paid later; grace-period renewals added to week 1 |
| 9 | Export paging by offset could skip or repeat rows, or stop early | Paged by key (`id > last`), stops on an empty page |
| 10 | Branch rankings sent every student id in the URL and hid errors | Filtered through the student join; errors returned; phone numbers removed |
| — | Nits | IST weeks for the flag cap; all-records baseline only as a fallback; `anomaly_flags` reference columns NOT NULL; PostgREST error text kept (never the key); ratings only within two days of the session; the switches are re-read after 10 minutes |

Decisions taken (owner may overrule): the hidden admin account's records are left out of anomaly flags, so it never appears on the owner's pages (R6); the discount/cashback confirm stays always on, with `pssai_discount_confirm_over` as its control (see P1.6).

**Branch:** `pss-ai/all-phases` · **Needs:** D3 (for P1.8) · **Students see:** an optional focus rating at checkout · **Nothing is written automatically by AI**

## P1.1 Focus pulse (I9) — migration 055 ✅

`055_focus_pulse.sql`: `focus_ratings (booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5), source TEXT NOT NULL DEFAULT 'desk' CHECK (source IN ('desk','portal')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())`, with RLS on.

- New action `record_focus_rating`: tier T1; callers staff, owner, admin (student from P2); upsert by `booking_id`.
- UI: after a member checkout in `BookingsPage`, show an optional row of 1–5 buttons ("How focused was today?") with a Skip button. It never blocks checkout. Walk-ins are not asked. Flag: `pssai_focus_pulse`.

- *As built:* the server also refuses ratings while `pssai_focus_pulse` is off, for walk-ins, for sessions not yet checked out, for sessions that started more than two days ago and for other branches. A second answer for the same session replaces the first (upsert). The app learns the switches from a new T0 read, `get_feature_flags` (`src/hooks/useFeatureFlags.js`, read once per page load). The prompt is `src/components/FocusPulsePrompt.jsx`.

Acceptance:
- [x] One rating per booking at most; Skip leaves no row; walk-ins never see the prompt — `tests/server/insights_test.ts` (P1.1 checks), primary key checked on Postgres (PGlite), browser QA (prompt after a member checkout, rating 4 sent once, Skip sends nothing, no prompt for walk-ins or with the switch off)

## P1.2 ML workspace (`ml/`) ✅

- A Python project managed with uv (`ml/pyproject.toml`), using pandas, scikit-learn and lifelines, with pytest and ruff (both already allowed in `.claude/settings.json`).
- `ml/export.py` reads with the Supabase service key from `ml/.env`. That file is gitignored and never committed (`.claude/settings.json` already denies reading `.env`). Export `bookings`, `memberships`, `transactions`, `focus_ratings`, `waivers` and `cashbacks` to `ml/data/` (gitignored) as Parquet.
- `ml/features.py` builds:
  - per student per day: arrival minute (IST), minutes used against `scheduled_hours`, number of sessions, weekend flag, food bills, focus rating
  - per membership: plan, `months_paid`, tenure, holds, days since last visit, past renewal kinds (early, grace, late), dues
- `ml/publish.py` upserts results into the tables from P1.3.
- Add `ml/.env` and `ml/data/` to `.gitignore`.
- *As built:* package `ml/pss_ml/` (export, features, fingerprint, churn, anomaly, forecast, publish, `cli.py`: `uv run pss-ml export | run [--publish]`), standard-library PostgREST client that pages past the 1,000-row cap. Exports also `students` (ids, branch, status), `staff` (display names), `branches`, `membership_discounts`, `membership_holds`, `food_bills` (no names/phones), `overtime_sessions` and the `events` rows of manual attendance edits and overtime exclusions; the export refuses any personal column. `ml/.gitignore` keeps `.env`, `data/`, `out/` and `.venv/` out of git; the example env file is `ml/env.example` (the root `.gitignore` hides `.env.*`). `pss_ml/synthetic.py` makes a hall with planted signals so everything runs and is tested without real data: `uv run pytest` (25 tests) and `uv run ruff check .` pass. Export pages by key (`id > last`). Steps for the owner/developer: `ml/README.md`.

## P1.3 Model output tables — migration 056

`056_model_outputs.sql`, every table with RLS on:

- `student_scores (student_id UUID REFERENCES students(id) ON DELETE CASCADE, model TEXT, version TEXT, score NUMERIC, reason TEXT, computed_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (student_id, model))`, plus an append-only `student_score_history` with the same columns and its own id
- `fingerprints (student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, version TEXT, vector REAL[], cluster TEXT, computed_at TIMESTAMPTZ DEFAULT now())`
- `anomaly_flags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), kind TEXT, ref_table TEXT, ref_id UUID, branch_id UUID, score NUMERIC, explanation TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ok','problem')), reviewed_by_staff_id UUID, created_at TIMESTAMPTZ DEFAULT now())`
- `forecasts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), kind TEXT, period_start DATE, value NUMERIC, low NUMERIC, high NUMERIC, computed_at TIMESTAMPTZ DEFAULT now())`
- `owner_briefs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), brief_date DATE NOT NULL UNIQUE, body TEXT NOT NULL, figures JSONB, created_at TIMESTAMPTZ DEFAULT now())`

New T0 reads (owner and admin): `get_student_scores`, `list_anomaly_flags`, `get_forecast`, `get_owner_brief`. New T1 action (owner and admin): `review_anomaly_flag`.

✅ *As built:* in `api/domains/insights.ts`, tested in `tests/server/insights_test.ts`. `anomaly_flags` also has a unique index on `(kind, ref_table, ref_id)`, so publishing the same week twice cannot duplicate a flag (each flag points at one record). `get_forecast` returns the weeks from the one containing today. `get_owner_brief` returns null until P1.8 writes briefs. All seven tables were created on Postgres (PGlite) with RLS on.

## P1.4 Focus Fingerprint (I1)

- Version 1: engineered features from P1.2, scaled, then PCA and k-means clusters. It is fast and easy to explain.
- Version 2, only if version 1 holds up: a small GRU encoder trained to predict the next day's minutes, with its hidden state used as the vector.
- Write `fingerprints` rows. The owner reviews the clusters and gives each one a plain-language label.

- *As built:* `pss_ml/fingerprint.py`; k from 3 to 6 by silhouette; each cluster gets a plain description from its centre (e.g. "C2 · high focus, comes most days") and `ml/reports/clusters-<date>.md` lists them for the owner, who renames them with `--labels`. A member with no visits in the window gets "new or away". Version 2 (GRU) not built — only if version 1 holds up.

Acceptance:
- [x] Every active member has a fingerprint and a cluster — `ml/tests/test_models.py` (synthetic data); on real data at the first `pss-ml run --publish`
- [ ] Cluster labels are approved by the owner — waits for the first real run

## P1.5 Churn model (I2)

- Label: a membership counts as churned when no new membership for that student starts within `MEMBERSHIP_GRACE_DAYS` (10) after its `end_date`.
- Prediction point: 21 days before `end_date` (configurable).
- Models: a Cox baseline (lifelines) and a gradient-boosting classifier at the prediction point. Keep the one that validates better.
- Reason codes come from the top contributing feature group: `attendance_drop`, `dues`, `short_tenure`, `holds`, `late_payer`, `other`.
- Validation is time-based: train on older months, test on the most recent two to three months. Report the concordance index and the hit rate at the owner's weekly contact budget (for example the top 20 per branch), compared with the baseline "everyone expiring in the next 7 days".

- *As built:* `pss_ml/churn.py`. Training rows are taken 7, 14, 21 and 28 days before the end date (days-to-end is a feature) so members can be scored on any day of their last four weeks; the headline concordance is at 21 days. Concordance is reported as AUC (equal to the c-index for a yes/no outcome). Budget comparison, per branch per week: the model contacts its top N of members ending in the next 28 days; the baseline contacts N members expiring in the next 7 days, soonest first; hit rate = contacted who then churned, churners counted once. Reasons are given only to members at 0.3 risk or more ("other" below). Too little history → the report says "Not scored" and nothing is published. After the review: a 10-day gap between training and test, holds counted only up to the point, nobody contacted twice in the comparison, and only members ending in the next 28 days are scored. On the synthetic hall: Cox 0.91, gradient boosting 0.91 (Cox kept); hit rate 36% vs 32% and 30 vs 19 churners reached at a budget of 8.

Acceptance:
- [ ] A validation report in `ml/reports/churn-<date>.md` shows the model beating the 7-day baseline at the same contact budget — the report is produced and the comparison is tested on synthetic data; the real report waits for the first export
- [ ] Scores and reasons for every active member are in `student_scores` — written by `pss-ml run --publish` (tested against a fake PostgREST); waits for the first real run

## P1.6 Anomaly detector (I23) and discount confirm (closes G14, G15) ✅ (built; gate below)

- Inputs: waivers, discounts and cashbacks, manual attendance edits (`add_attendance` / `update_attendance` events) and overtime exclusions (`set_overtime_excluded`).
- Method: baselines per staff member and per branch; robust z-scores or Isolation Forest; flag the top N per week. Explanations come from a fixed template, not from a language model.
- Owner page "Flags" (OwnerRoute) lists open flags; the owner marks each one ok or problem.
- G14: the server already rejects percentages over 100; keep that. Add a confirm dialog in the discount and cashback forms when a flat amount is above the fee due or above `app_settings.pssai_discount_confirm_over` (default ₹1,000).

- *As built:* `ml/pss_ml/anomaly.py` scores each record against the staff member's and the branch's medians, and against all records of its kind only when both have fewer than 5 others — leave-one-out robust z-score with a floor of 25% of the median on the spread, so a tight history does not turn small changes into alarms. Fixed cashbacks only (a percent has no amount until used). Attendance hours come from the entry's start and end time. Only records from the last 14 days can be flagged (at most 5 per IST week); the hidden admin account's records are left out. Event rows have numeric ids, so their flags use a stable uuid5 of the event id as `ref_id`. On three synthetic seeds it flags exactly the six planted records and nothing else (not the admin's planted ₹5,000 discount). Owner page: `src/pages/FlagsPage.jsx` ("It's fine" / "Problem"), link shown to owner/admin when `pssai_anomaly` is on. G14/G15: the confirm shows for a discount whose rupee amount is above `pssai_discount_confirm_over` (default ₹1,000, percent discounts included) or a flat discount above the fee due, and for a fixed cashback above the threshold. The confirm is always on (a safety check, not a feature); raising the threshold relaxes it.

Acceptance:
- [ ] The owner reviews two weeks of flags and agrees the false-alarm rate is acceptable — waits for real data

## P1.7 Cash-flow forecast (I31) and engagement score (closes G35, G36) ✅

- I31: expected income per week for the next 60 days = for each active membership, renewal amount × (1 − churn score) on its expected renewal date, plus dues × a collection rate learned from history. Write weekly rows to `forecasts` with low and high bands.
- Engagement score: new T0 action `get_engagement_ranking` built from fingerprints and churn scores. Keep `get_top_students` until the UI switches over.
- *As built:* `ml/pss_ml/forecast.py`. Members without a churn score count at 30% risk; members already in their grace period (not renewed yet) count in the current week at 50%; dues are spread over the next two weeks at the dues collection rate (of what was still owed after a membership's first payment day, the share paid later, over memberships that ended 30–180 days ago); other income is the average of the last 8 weeks. 90% band from the variance of each renewal (and of the weekly other income). Engagement = 0.3 use of booked hours + 0.3 visit days (6 a week = 1) + 0.15 focus + 0.25 (1 − churn score), with a short reason when under 0.5; published as `student_scores` model `engagement`, read by `get_engagement_ranking` (owner/admin, with the cluster). No screen shows the forecast or the ranking yet — the owner analyst (P1.8) and a later UI read them.

## P1.8 Owner analyst (A6, closes G34) — new `agent` edge function ✅

- New `supabase/functions/agent/index.ts` with `[functions.agent] verify_jwt = false` in `supabase/config.toml`. Secrets: `AI_API_KEY`, `AI_MODEL` (from D3).
- Auth: an owner or admin staff token, checked with `authStaff` from `_shared/auth.ts`.
- Tools: registry actions with tier T0 from this allow-list: `get_dashboard`, `get_revenue`, `list_transactions`, `get_daily_report`, `get_referral_stats`, `get_discounts_waivers`, `get_actionable_items`, `list_enquiries`, `get_student_profile`, `get_student_scores`, `list_anomaly_flags`, `get_forecast`, `get_integrity_report`. Add `list_active_memberships` only after `pssai_cron` is on, because it has a side effect until then.
- Tools run through the same registry with actor `{ type: 'agent', id: 'owner-analyst' }` and the owner's branch scope. Every run gets a `run_id`; every tool call writes an event.
- System prompt rules: answer only from tool results; give figures with dates and branch; say "I don't know" when data is missing; never claim to have changed anything.
- Daily brief: a `cron_owner_brief` job at 07:00 IST (`30 1 * * *` UTC) asks the analyst to write a brief from yesterday's figures and stores it in `owner_briefs`. The Dashboard shows it to owner and admin.
- UI: an `/analyst` chat page behind `OwnerRoute`.
- Evaluation: `tests/agents/analyst-eval.md` with 20 owner questions and expected figures computed by SQL.

- *As built:* `supabase/functions/agent/index.ts` (router) and `agent/analyst.ts`, with the shared AI layer in `_shared/ai.ts` (Claude client from `npm:@anthropic-ai/sdk@0.131.0`, model choice, cost estimate, monthly budget, run log, tool loop) for every later agent. Switch `pssai_analyst`; monthly cap `pssai_ai_budget_usd` (US dollars, default 10 — checked before each run against `agent_runs.cost_usd` of this IST month). Models (D3): questions go to `claude-haiku-5-5`; the page's "Deep answer" box uses `claude-sonnet-5-5`; secrets `AI_MODEL` / `AI_MODEL_HARD` replace them (the plan's single `AI_MODEL` became two). Migration `057_agent_runs` (moved up from the old 059): one row per run with model, who asked, token counts, model and tool calls and the estimated cost; no prompts or answers are stored. Tools: the allow-list above plus `list_branches` and `search_students_by_name` (T0 reads, so the analyst can name branches and find a student); each is declared with `agent` in its registry callers, and the analyst refuses any tool that is not a T0 read declared for agents. Tool input keys not in the tool's schema are dropped; a name search may contain only letters, digits, spaces, dots and hyphens (it goes into a PostgREST filter). The `events.actor_id` column is a UUID, so agent events carry `actor_type = 'agent'`, `actor_id = null` and the run's id as `run_id`; `agent_runs.agent` names the agent (`owner-analyst`, `owner-analyst:brief`). Phone numbers, emails, addresses and ID or secret fields are removed from every tool result before it reaches the model (R11), and long lists are shortened (about 12,000 characters per result). Branch names and ids are given in the system prompt. Loop: at most 8 model calls (10 for the brief) and about 100 seconds; parallel tool calls are answered together; a refusal, an AI outage or a cut-short answer is said plainly, never shown as an answer. The brief: pg_cron calls the `agent` function with the cron secret (`pss_run_agent_job('owner_brief')`, 07:00 IST in `docs/ops/cron.sql`); it is skipped when the switch is off, the key is missing, today's brief exists or the budget is used up, and is saved through the new agent-only action `save_owner_brief` (T1, callers `['agent']`; the api router now refuses actions with no human caller). UI: `src/pages/AnalystPage.jsx` at `/analyst` (OwnerRoute, nav link when the switch is on; the chat stays in the tab and the last 5 turns go back as plain text), `src/components/OwnerBriefCard.jsx` on both Dashboards. `src/lib/api.js` gained `agentApi()` (same token and error handling as `api()`). The pre-deploy check now also requires a `verify_jwt = false` entry for every function. Tests: `tests/server/agent_test.ts` (scripted Claude through `tests/server/fake-anthropic.ts`): access, switch, key, budget, the loop, errors, refusals and limits, no contact details in any request, the run log and events, and a run that calls every tool writes nothing but event and run rows. Evaluation: `tests/agents/analyst-eval.md`.

Acceptance:
- [ ] At least 18 of 20 eval answers match the SQL figures — the set is written; running it needs the owner's key and real data
- [x] No analyst run writes anything except event rows — checked by the server test that calls every tool (the eval sheet repeats the check on live data)

## Phase 1 exit gate

- [ ] The churn model beats the 7-day reminder on historical data (P1.5 report)
- [ ] The owner has reviewed two weeks of anomaly flags and accepts the false-alarm rate
- [ ] Owner analyst passes its evaluation

---

# PHASE 2 — Self-service portal and agents (spec level)

**Branch:** `pss-ai/all-phases` · **Needs:** D1, D2, D4, D6 · **Build level written 2026-10-21 (below), per A1**

### Build level (2026-10-21)

Everything here ships switched off. Switches (R9; a missing row means off): `pssai_portal` (student login and every `me_*` action), `pssai_upi_pay` (pay links and proofs), `pssai_proof_reading` (AI reads screenshots), `pssai_concierge` (A1), `pssai_collections` (A4), `pssai_auto_approve` (A3), `pssai_ai_messages` (AI-drafted messages for staff), `pssai_session_reminders`, `pssai_waitlist_offers`, `pssai_realtime`. **Shadow mode is the safe default:** agent replies are drafts unless `pssai_agent_shadow` is set to `off`.

Migrations, in build order: `058_student_auth` (credentials, setup codes with an attempt counter, sessions), `059_payment_proofs` (status adds `requested` before `submitted`; purpose adds `registration`; a proof belongs to a student **or** a sign-up request; `request` JSONB keeps what is being paid for; private bucket `payment-proofs`), `060_portal_notifications` (inbox with a de-duplication key, concierge chat messages, the A4 send list), `061_approvals`, `062_student_requests` (requests; planned resume date on holds; waitlist offer columns; a PIN hash and a keep-until on sign-up requests; private bucket `id-photos`).

**Student auth.** `_shared/student.ts`: PBKDF2-SHA256 (WebCrypto, 100,000 iterations, 16-byte salt per row) for PINs and setup codes; tokens signed with `STUDENT_JWT_SECRET` (`typ: 'student'`, `sub`, `sid` = session id, 30 days); `authStudent()` checks the signature, the type, the session (not revoked or expired) and the student. `authStaff()` refuses any token with `typ: 'student'`. The api router gets a third path: actions whose callers include `student` need a student token; a staff token is refused there and a student token is refused everywhere else. `me_login` answers the same "Phone number or PIN is wrong" for an unknown phone, no PIN yet or a wrong PIN (with the same hashing work), locks for 15 minutes after 5 wrong PINs (D6), and refuses all-same or straight-run PINs at setup. A setup code (`create_portal_setup_code`, staff T1) is 6 digits, valid 24 hours, dies after 5 wrong tries, and is never stored or logged in clear; setting a PIN revokes every older session.

**Portal actions** run with the student id from the token only. Reads: `me_profile`, `me_membership` (plan, days left, renewal kind, dues, locker, Food Pass, open payment requests, renewal quotes), `me_receipts`, `me_study_report` (with focus ratings), `me_notifications`, `me_plans`, `me_privacy`. Writes: `me_logout`, `me_update_contact` (emergency contact only), `me_mark_read`, `me_payment_request`, `me_submit_payment_proof`, `me_request_hold`, `me_resume`, `me_request` (plan change, refund, privacy download or deletion), `me_respond_offer`. A student action that needs staff code (a hold, a resume) runs that code with a "portal" scope limited to the student's branch; the event records actor `student`.

**Payments (P2.2).** Amounts always come from code: renewal = the same plan for 1, 2, 3 or 6 months (fee × months − multi-month discount − pending cashbacks + unbilled overtime, read-only, the same sums as `renew_membership`); dues = the membership's `fee_due`; locker = the locker's monthly fee; Food Pass = the student's chosen top-up (₹100–₹5,000). A reference `PSS-XXXXXXXX` goes in the UPI note. A proof needs a 12-digit UTR, a screenshot (JPEG/PNG/WebP up to 1.5 MB), or both. Deterministic checks are added next to the AI reading: a UTR already used on another proof, an amount or payee VPA that differs. On **Confirm** the owner's click re-quotes and refuses if the amount changed, then runs the existing action as the owner with payment mode `upi` (`renew_membership` with `expectedTotal`, `record_payment`, `topup_food_pass`, `renew_locker`; for a sign-up, `create_membership` from the sign-up details), and stores the new transaction ids. **Reject** needs a reason, shown to the student.

**Approvals (P2.3).** `run.ts` refuses to run a T3 action for an agent or student caller: it stores an `approvals` row and answers `202 { pending_approval }`. The owner's Approvals page lists payment proofs and requests; approving runs the action as the owner with the request recorded as `reason`. Holds (C1, D5): a student may put a **temporary** membership on hold for 1–7 days once per calendar month without approval; it resumes itself on the planned day (`cron_resume_holds`). Longer holds, permanent members (a hold frees their cabin), plan changes, refunds and privacy requests go to the queue.

**Agents (P2.4)** live in the `agent` function. A1 concierge: student token, Haiku 5.5, tools = the student's own `me_*` reads plus `me_request_hold` and `me_payment_request` (disabled in shadow mode), at most 30 messages per student per day, history read from the database, reply in the student's language (D4). Drafts wait on a staff "Chat replies" page (send as is, edit, or discard). A4 collections (`collections` job, 08:00 IST): ranking is code (churn score, days to expiry, dues), the AI only drafts the WhatsApp text (first names and amounts only, signed "Team Perfect Study Space", C6); each student gets a portal notice and a row on the owner's Send list page (WhatsApp button through `openWhatsApp()`). A3 onboarding: with `pssai_auto_approve` and `pssai_upi_pay` on, the sign-up page continues to a plan choice, a PIN, an optional ID photo (C3: the AI checks only that it is readable and the name matches; no ID numbers are kept) and UPI payment; the sign-up is kept until the owner decides; Confirm registers the student through `create_membership` (first free desk for a permanent seat) and turns the PIN on.

**P2.5.** AI-drafted welcome and study-report messages are a button in the staff forms (the text stays editable and is sent through `openWhatsApp()`). `cron_session_reminders` (every 5 minutes) writes one portal notice per session ending within 10 minutes. `cron_waitlist_offers` (every 15 minutes) offers each free permanent desk to the oldest waiting student who has portal access, for 24 hours (C2); an acceptance goes to the queue for the desk to complete; others are left to the desk as today. Live updates: after a successful change the function sends an empty "changed" broadcast on `branch:<id>` (Supabase Realtime REST); the four polling hooks re-fetch on it and keep a slow poll as a safety net.

Tests: server suites with a fake Supabase and a scripted Claude (portal isolation — every `me_*` action with another student's ids; token separation; approvals; payments; agents), the Appendix A part 2 integration cases against a real Postgres, agent test sets in `tests/agents/`, and browser QA of the portal at phone width.

The student portal arrives, payments move into it, and the first agents start. With no payment gateway, the owner confirms each UPI payment in one tap. Agents run in shadow mode for two weeks (flag `pssai_agent_shadow`): every reply is a draft until a person approves it.

## P2.1 Student portal, release R1 (SP1 to SP8)

**Where:** the existing student site. Extend `JoinApp.jsx` into a `PortalApp`:
- `/me/login`, `/me` (home), `/me/pay`, `/me/receipts`, `/me/report`, `/me/hold`, `/me/chat`, `/me/privacy`
- Keep `/:code` and `/join/:code` for sign-up. Put the `/me/*` routes before `/:code` (sign-up codes are 12 characters, so `me` never collides).
- Make it installable: a web app manifest and a small service worker served from the same site.

**Login (SP1), migration `058_student_auth`:**
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
| `me_notifications`, `me_mark_read` | T0 / T1 | Inbox from `060_portal_notifications` |

## P2.2 UPI pay links and payment proof check (closes G11, G13, G17, G18)

- The owner sets `app_settings` rows `upi_vpa` and `upi_payee_name`.
- `me_payment_request` returns `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<reference>&cu=INR` for renewal, dues, Food Pass top-up or locker renewal. The amount comes from the existing code, never from the client. On a computer, show the same link as a QR code (an npm QR package is fine).
- `059_payment_proofs`: `payment_proofs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID NOT NULL REFERENCES students(id), purpose TEXT NOT NULL CHECK (purpose IN ('renewal','dues','food_pass','locker')), amount_expected NUMERIC NOT NULL, reference TEXT NOT NULL UNIQUE, utr TEXT, image_path TEXT, ai_reading JSONB, status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','confirmed','rejected')), decided_by_staff_id UUID REFERENCES staff(id), decided_at TIMESTAMPTZ, reject_reason TEXT, transaction_ids UUID[], created_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Screenshots go in a private Storage bucket `payment-proofs`.
- After upload, the `agent` function reads the screenshot with the AI model and stores `{ amount, utr, paid_at, payee_vpa, confidence }` in `ai_reading`. It flags mismatches with the expected amount or VPA. **It never confirms anything.**
- The owner's approval queue shows each proof next to the AI reading. **Confirm** runs the existing action (`renew_membership`, `record_payment`, `topup_food_pass` or `renew_locker`) with payment mode `upi` and the owner as actor, then stores the resulting transaction ids. **Reject** needs a reason, which the student sees.
- Cash stays a staff/owner entry if D1 allows it.

## P2.3 Permission gate and approval queue (A8, part 2) — migration `061_approvals`

- `agent_runs` — built early, in `057_agent_runs` for P1.8 (see there).
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
| Migration `060_portal_notifications` | `portal_notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, action_url TEXT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())` | — |
| Migration `062_student_requests` | Holds, plan changes and refunds asked for by students are stored here and linked to `approvals` | — |

**Removed in Phase 2:** the browser polling hooks (after Realtime is verified); the sign-up claim lock (`claimSignup`, `release_signup_request`, `SIGNUP_CLAIM_MINUTES`) once auto-approval is on; the owner repair buttons for `fix_membership_dates` and `fix_negative_food_pass_balances`, once the nightly report has run clean for a few weeks. **`openWhatsApp()` stays.**

**Integration tests required before Phase 2 ships:** every Appendix A part 2 case, plus a portal isolation test (a student token can never read or change another student's data).

### Phase 2 as built (2026-10-21)

- **P2.1 Portal** ✅ — `_shared/student.ts`, `api/domains/portal.ts`, `api/portal-lib.ts`; UI in `src/portal/` (lazy-loaded for `/me`; `main.jsx` also loads it for `/me` on any address, for local use). Setup codes come from "🔐 Portal setup code" on the student profile (`src/components/PortalSetupButton.jsx`); the code is shown once, sent through `openWhatsApp()`, and the action is marked idempotent so a retry never stores the answer. The student token lives in `localStorage` (`pss_student_token`) and is the only token the portal sends (`portalApi()` in `src/lib/api.js`). Setting a PIN records `privacy_accepted_at`; the notice (`src/portal/PrivacyNotice.jsx`) is a draft the owner may edit and names the C5 grievance contact. `me_update_contact` changes only the emergency contact. Installable: `public/manifest.webmanifest` (scope `/me`) and `public/sw.js` (network first; caches only the portal page and built assets, never API calls). The study report subtracts pause minutes and shows focus ratings.
- **P2.2 UPI** ✅ — `api/payments-lib.ts`, `api/domains/payments.ts`, `_shared/proofReader.ts`. Settings `upi_vpa`, `upi_payee_name`. The UPI link keeps the VPA unencoded (some apps reject `%40`). Screenshots are checked by their first bytes (JPEG/PNG/WebP, 1.5 MB; the browser shrinks photos to JPEG first) and go to the private bucket; the owner opens them through a 2-minute signed link. Code checks on every proof: UTR used before, amount and payee from the AI reading, typed vs read UTR. Confirm claims the proof first (`requested|submitted → confirmed`, released on any failure), re-quotes, then runs the existing action as the owner; two confirms at once run once (tested on Postgres). A renewal paid when the price has since changed is refused, not charged.
- **P2.3 Approvals** ✅ — `run.ts` queues T3 actions from agent or student callers (`202 { pending_approval }`); `decide_approval` claims the row, runs the action as the owner with the request as its `reason`, and re-opens it if the action fails. Self-holds (C1): temporary plans only, 1–7 days, once a calendar month; they end through `cron_resume_holds` (hourly). Permanent members' holds always go to the owner (a hold frees the cabin); on the planned day the desk gets a `hold` alert to pick a cabin. Plan changes, refunds, privacy requests and waitlist acceptances are approved in the queue and finished by the desk in the staff app (they need staff choices).
- **P2.4 Agents** ✅ — A1 `agent/concierge.ts` + `api/domains/chat.ts` (Haiku 5.5; tools are the student's own `me_*` actions, declared with `agent` in the registry; 30 messages a day; the message is stored first so a failure leaves it for a person; staff page `src/pages/ChatRepliesPage.jsx`). With the assistant off, the portal chat still reaches the desk. A4 `agent/collections.ts` + `api/domains/outreach.ts` (08:00 IST job through the agent function; ranking = 0.45 churn + 0.35 urgency + 0.2 dues, 20 per branch, nobody twice within 3 days; drafts with an amount not given, an offer word or no sign-off fall back to the template; works without AI). A3 `api/domains/onboarding.ts` + `src/components/SignupPayment.jsx` (`public_signup_plans`, `public_signup_pay`, `public_signup_proof`; the sign-up is kept 3 days through `keep_until`; ID check on Sonnet 5.5 keeps no digits; Confirm runs `create_membership` with the first free desk for a permanent plan, then turns the PIN on and links the ID photo path).
- **P2.5** ✅ — `api/domains/notices.ts` (`cron_session_reminders` every 5 minutes, `cron_waitlist_offers` every 15), `agent/writer.ts` + `src/components/AiDraftButton.jsx` (AI drafts are shown for editing and refused if they add a number, drop a link or miss the sign-off), `_shared/live.ts` + `src/lib/live.js` + `src/hooks/useLiveSignal.js` (empty Realtime broadcast after each change; three polling hooks drop to a 5-minute safety net, the time-driven session warning keeps its 60-second timer; CSP allows `wss://*.supabase.co`). The "Removed in Phase 2" items wait for operation (they depend on Realtime and auto-approval being verified live).
- **Tests** — server suites `portal`, `payments`, `requests`, `concierge`, `collections`, `onboarding`, `notices`, `writer_live` (fake Supabase, scripted Claude); `npm run test:integration` (now Deno, real api function + real Supabase client) runs B1–B10 and the Phase 2 flows including the portal isolation test against Postgres 16 + PostgREST 12 — all pass; agent evaluation sets `tests/agents/analyst-eval.md` and `tests/agents/concierge-eval.md`; browser QA of the portal at phone width and of the owner pages.

### Independent review of P1.8 and Phase 2 (2026-10-23)

One independent reviewer read the whole range (`1670d8b..bb33ccf`). Isolation (every `me_*` action), the T3 gate, the renewal quote, claim-first Confirm and decide, the upsert targets, the event-log redaction and the service worker held up. All findings fixed, with a test each (server suites; the five that need a real database also in `tests/integration/review_p2_test.ts`):

| # | Finding | Fix |
|---|---|---|
| 1 | High: parallel PIN (and setup-code) guesses each read the same counter, so a burst got many checks for one counted try | Each try is counted with one conditional update before the PIN is checked; a try that loses the race is answered "wrong" without a check. 40 parallel guesses = 1 try |
| 2 | High: the sign-up Ref is printed for the desk, yet code + Ref + phone could set the portal PIN and send proofs | A 32-character pay key, given only to the browser that sent the form (hash kept, migration 067); resending the form once self-pay has started is refused |
| 3 | A returning student's phone on a new sign-up could take over their account at Confirm; an active member could pay for a registration | Active members are refused at the pay step; a returning student is registered but keeps their own PIN (the owner is told to send a setup code) |
| 4 | The lock-out answer (429) told which phones have accounts | Same answer and the same hashing for every failure; the text says logins pause after 5 wrong tries |
| 5 | Anyone could spend the AI budget with ID photos and screenshots | Only a proof's first screenshot is read by itself; at most 2 ID checks per sign-up; a daily cap for public-started reads (`pssai_public_ai_daily`, default 40); the owner's own Read is outside the cap |
| 6 | Payment requests were never reused on Postgres (jsonb key order) | Compared field by field |
| 7 | The chat page could drop the newest messages after 1,000 rows; the daily limit only held on one path | Newest first, branch filtered in SQL; the 30-a-day limit is in `me_chat_send` |
| 8 | The collections ranking stopped at 1,000 members and lost churn scores on long id lists | Paged reads; ids in chunks of 200; errors raised |
| 9 | An accepted waitlist offer didn't hold its desk, so the desk was offered again | Accepted offers waiting for the owner count as holding a desk |
| 10 | An accept that couldn't be queued left the offer stuck | Queued first, then marked accepted |
| 11 | An approved hold didn't re-check the membership | Same membership, active, not paused, not ended — else the approval stays open with a reason |
| 12 | One UPI payment (UTR) could confirm two proofs | Confirm refuses a UTR already confirmed; a unique index on confirmed UTRs (067) refuses a race |
| 13 | The desk and self-pay could both take money for one sign-up; the sign-up could be cleaned up under a waiting proof | The desk can't register or deny while a sent payment waits; a payment only asked for is cancelled when the desk takes over; sending a proof keeps the sign-up 3 more days |
| 14 | A crash during Confirm could leave a "confirmed" proof with no transaction | Clock margin on the lookup; the nightly report lists confirmed proofs with no transaction |
| 15 | Every public call and student change broadcast to every screen, and the broadcast was awaited | No signal for public callers; students only to their branch; sent after the answer (`EdgeRuntime.waitUntil`) |
| 16 | An older chat draft could be offered after a newer one was sent | Sending a reply discards older drafts |
| 17 | Chat text and emergency numbers were kept in the 400-day event log | Stored as their length only |
| 18 | ID photos and screenshots were never deleted | A denied or expired sign-up's photo is deleted; `cron_purge_images` deletes decided payments' screenshots after 180 days (`proof_image_keep_days`) |
| 19 | The screenshot was read before the proof was saved | Saved as sent first; the nightly report lists AI runs that never finished |
| 20 | The collections draft check missed "1500 rupees" and wrong dates | Every number in a draft must come from the facts |
| — | Nits | Portal scope `/me/`; the AI study summary counts a running session up to now |

Found while testing on Postgres: PostgREST 12.2 refuses an update or delete whose `.or()` filter names a column not in its `.select()` ("column … does not exist"). Three places did this — the new PIN count, the sign-up clean-up, and the sign-up form's own "send again" path from before Phase 2 (a re-sent form was answered "the desk is already processing your details"). Each now selects the columns its `.or()` uses, with a test on Postgres.

Decisions taken (owner may overrule): the daily public AI cap (40 reads), the 180-day screenshot retention, and the "length only" event log for chat text.

## Phase 2 exit gate

- [ ] Most renewals at the pilot branch are paid through the portal, with payments confirmed within the time agreed in D2
- [ ] Two weeks of shadow mode with replies passing the agreed accuracy bar on a real-chat test set
- [ ] No T3 action ran without owner approval (checked in `events` and `approvals`)
- [ ] The portal isolation test passes

---

# PHASE 3 — Owner impact engines (spec level)

**Branch:** `pss-ai/all-phases` · **Needs:** D5, D7, D8 · **Runs at one pilot branch against a control branch** · **Build level written 2026-10-21 (below), per A1**

### Build level (2026-10-21)

Written per A1 and built straight after. Everything ships switched off (R9; a missing row means off): `pssai_hour_release` (SP10 and selling released hours), `pssai_overbooking` (O1 predicted free hours), `pssai_yield_pricing` (I3), `pssai_enquiry_chat` (A2), `pssai_lead_tools` (I24 scores and AI duplicate suggestions), `pssai_referral_links`, `pssai_exam_radar` (I25), `pssai_winback` (I26), `pssai_next_exam` (O9, SP12), `pssai_paylater_advice` (O3), `pssai_exception_desk` (A7), `pssai_portal_r2` (SP9 waitlist, SP11 referral and cashback). Shadow mode (`pssai_agent_shadow`) also covers the enquiry chat. AI-drafted enquiry follow-ups use the Phase 2 switch `pssai_ai_messages`.

**Migrations** (renumbered into build order; Appendix B updated): `063_seat_releases` (released and predicted-free desk hours, and each resale with its credit), `064_yield_and_leads` (daily walk-in price per branch, enquiry scores, AI duplicate suggestions, the enquiry chat, the AI note on approvals), `065_referral_links` (links per channel, attributions, two more `referral_source` values: `whatsapp`, `other`), `066_exam_notices` (exam notices and `send_list.kind`).

**Seat hours (O1, SP10).** A permanent member may release hours of their cabin from the portal (`me_release_hours`: today to 7 days ahead, whole hours between 06:00 and 23:00, at least 2 hours, no overlaps, cancellable until sold). With `pssai_overbooking` on, the hourly job `cron_predict_releases` also offers hours a member is predicted not to use: for each permanent member with 14 days of history, not on hold and not yet in today, code takes the share of the last 28 days on which each hour was used, sells only `floor(expected free hours × 0.8)` (C7, 20% safety margin) as one contiguous window, and only hours used on at most a quarter of days. The walk-in modal lists the open releases that cover the chosen time; selling one goes through the existing `create_walkin` with a `releaseId`. The release is claimed first (`open → sold`, one conditional update, so a desk-hour is never sold twice), the unused parts of the window stay on sale as new releases, and the booking is linked to the cabin without changing its status (the cabin stays the member's). A member release earns D7 50% of the resale price as a pending fixed cashback, so the existing renewal code applies it (agents never calculate money; this is code). When the member arrives during a resale, check-in gives them the first free desk; if none is free, a predicted release earns one free day (one day of their plan price, as a pending cashback, C7); a member release earns nothing extra (they gave the hours away). Arriving while an unsold release covers now cancels it.

**Yield pricing (I3).** `cron_yield_prices` (00:05 IST) writes one row per branch per day: forecast occupancy = the average peak of simultaneous sessions on the same weekday over the last 4 weeks ÷ desks. ≥ 90% → +15%, ≥ 75% → +8%, ≤ 30% → −15%, ≤ 45% → −8%; a confirmed exam within 30 days adds 5%. The total stays inside the owner's floor and ceiling (`yield_floor_pct`, `yield_ceiling_pct`), never outside ±20% (C8); prices round to ₹5. With the switch on, `create_walkin` charges `fee_config` × that day's change; the walk-in modal shows the server's price (`quote_walkin`) and sends it back as `expectedAmount`, so a price that changed in between is refused, not charged. The owner can set a day's change by hand (`set_walkin_price_day`, T3).

**Enquiries (A2, I24, dedupe).** The enquiry chat is a page on the join site (`/ask`, C9); the public website links to it. The visitor picks a branch and gives a name and phone (consent shown), then chats. It runs in the `agent` function (public, `pssai_enquiry_chat`), rate-limited by chat, phone, a daily-salted hash of the IP (never the IP itself) and a global daily cap. Each chat is an enquiry (source `website_chat`; an open enquiry with the same phone and branch is reused) and every message is stored. The AI (Haiku 5.5) answers only from facts code gives it (branches, plans and prices from `fee_config`, free permanent seats, today's walk-in prices, the owner's `enquiry_facts` text) and says the team will help with anything else; in shadow mode the reply is a draft for staff and the visitor is told the team will reply on WhatsApp. Staff see the chat in the enquiry drawer (send a draft here or on WhatsApp, or discard). `cron_score_enquiries` (nightly) gives each open enquiry a 0–100 score from this hall's own conversion rate for its source (smoothed toward the overall rate), its age and its activity, with the reason in words. The nightly `enquiry_dedupe` agent job finds pairs that code thinks may be one person but that the page's same-phone grouping misses (similar names in the same branch within 90 days); the AI judges each pair from names, messages, sources and dates (never phone numbers), and staff merge through the existing merge dialog or dismiss. AI follow-up drafts come from the writer agent (`kind: enquiry_followup`).

**Referral links.** The owner makes a link per channel (C10: Instagram, Google, flex banner, friend, WhatsApp, other) and branch: `join.perfectstudyspace.in/r/<code>`, which opens that branch's current sign-up link with the channel filled in and the dropdown hidden; the same code works on `/ask`. Each sign-up or chat from a link is an attribution; `cron_referral_conversions` (nightly) marks those whose phone later got a membership. Rotating the sign-up link does not break printed referral links; switching a referral link off does.

**Exams (I25, O9).** The daily `exam_radar` agent job fetches the D8 pages listed in `exam_sources` (once a day, only when the site's robots.txt allows it, with a named user agent, up to 400 KB per page), and the AI lists the exam names and dates it finds. They arrive as suggestions the owner confirms or dismisses; a page that can't be read is reported so the owner enters dates by hand. Code matches exam names to students' "preparing for" text by exam family (e.g. TNPSC Group 4). The `exam_ladder` setting (C11; drafted: TNPSC Group 4 → Group 2 → Group 1, SSC CHSL → CGL, IBPS Clerk → PO, SBI Clerk → PO, TNUSRB PC → SI, RRB Group D → NTPC, UPSC Prelims → Mains) drives O9: when a member's plan ends within 10 days, or their exam date has just passed, `cron_next_exam` sends one portal notice (SP12) with a ready plan (their plan for 3 months, priced by `quoteRenewal`) and adds a Send list row.

**Win-back (I26).** The weekly `winback` agent job ranks past members (plan ended 20–365 days ago, no active plan, not contacted in 30 days) whose exam family has a confirmed exam 21–150 days away, or who left 25–40 days ago; at most 10 per branch. The offer is `winback_discount_pct` (at most 10%, C12) off one month if they rejoin within 14 days; the AI drafts the WhatsApp text (or the template is used) and the row goes on the Send list (`kind: winback`). Staff apply the discount at registration as today.

**Pay-later advice (O3).** `cron_paylater_scores` (nightly) writes `student_scores` model `paylater` (risk from past plans that ended unpaid, dues now, churn score and number of renewals). Staff see the advice in the renewal and payment forms when less than the full amount is paid: low risk → up to 50% for 15 days with the owner's OK (C13), medium → up to 25%, high → full payment. Advice only; nothing is blocked (R6).

**Exception desk (A7).** The `exception_desk` agent job (every 30 minutes) and an "AI suggestion" button on the Approvals page draft a recommendation (approve, deny or ask) with up to four reasons for each pending approval, from facts code collects (the request, the student's plan, dues, tenure, pay-later band, earlier decisions). It writes only `approvals.ai_note`; the owner decides.

**Portal R2.** `me_waitlist`, `me_join_waitlist`, `me_leave_waitlist` (SP9); `me_release_hours`, `me_cancel_release`, `me_releases` (SP10); `me_referral` (the student's own friend link and how many joined) and `me_cashbacks` (SP11); `me_next_exam` (SP12). Referral rewards: when a friend joins and `referral_reward_amount` is set, a `grant_cashback` for the referrer waits in the approval queue.

**AI cost per path** (Haiku 5.5 unless noted, inside the monthly cap): enquiry chat ≈ 2K tokens in and 200 out per message; duplicate check one call per branch per night; exam radar ≈ 6 pages × 8K tokens a day; win-back one call per branch a week; exception desk ≈ 1.5K tokens per approval.

Tests: server suites for each item (fake Supabase, scripted Claude, stubbed web pages), integration cases on real Postgres (two staff selling one release at once, release credits reaching a renewal, the referral attribution join), eval sets `tests/agents/enquiry-eval.md` and `tests/agents/exception-desk-eval.md`, and browser QA of the new pages.


| Item | What to build | Data and actions | Closes |
|---|---|---|---|
| O1 Seat-hour overbooking | Predict, per permanent member and hour, the chance they won't use their desk, from check-in history and declared absences (SP10). Offer the expected free hours minus a safety buffer to walk-ins. A member who arrives anyway gets a fallback seat or a credit. | Migration `063_overbooking` (resold hours, fallback credits). Walk-in sales go through the existing `create_walkin`. | — |
| I3 Yield pricing | Walk-in prices follow forecast occupancy and the exam calendar, within an owner floor and ceiling | Reads `fee_config`; never writes outside owner limits; price changes are T3 unless inside D5 limits | G33 |
| A2 Enquiry and sales agent | A chat on the public enquiry page (new public action `public_enquiry_chat`, rate-limited by IP and phone) that creates or updates the enquiry. Drafts follow-ups that the owner sends in one tap. | `create_enquiry`, `update_enquiry`, `add_enquiry_activity`, `add_enquiry_followup` | G22 |
| I24 Lead scorer | Ranks enquiries by chance of converting | `student_scores`-style table for enquiries, or a `score` column added in `060` | G25 |
| AI enquiry dedupe | The AI judges whether two enquiries are the same person; merges go through the existing merge flow | Existing merge logic in `EnquiriesPage` and its actions | G23 |
| Referral attribution | A tracked link per channel replaces the referral dropdown | Migration `065_referral_links` | G24 |
| I25 Exam-notification radar | The `cron` function fetches the exam pages chosen in D8, the AI extracts exam names and dates, and demand surges are predicted. If a site can't be read, the owner enters dates by hand. Respect each site's terms. | Migration `066_exam_notices` | — |
| I26 Win-back | Finds past members at the right point in their exam cycle and drafts a return offer for the owner to send | Portal notifications and the "Send list" page | — |
| O9 Next-exam plans | Suggests a ready plan for the next exam in the student's path, using an owner-maintained `exam_ladder` setting in `app_settings` | Portal notification (SP12) | — |
| O3 Pay-later advice | A risk score tells the owner whether to allow pay-later. No lending partner; the owner decides. | `student_scores` with model `paylater` | G16 |
| A7 Exception desk | Drafts a recommended decision, with reasons, for each pending approval | Reads `approvals`; writes only a draft note | — |
| Portal R2 | SP9 waitlist, SP10 Release my hours (migration `064_hour_release`, credit share from D7), SP11 referral and cashback, SP12 next-exam plans | `me_*` actions | — |

### Phase 3 as built (2026-10-23)

- **O1 / SP10 seat hours** ✅ — `api/domains/seats.ts`, `_shared/seats.ts`, migration 063. Portal page `/me/release` (`src/portal/PortalGrow.jsx`); the walk-in modal lists released cabins for the chosen time and sends a `releaseId`; check-in tells the desk when a member arrives during a resale (another desk, or a free day). The cabin stays `reserved` to its member throughout (only `current_booking_id` changes), so checkout never frees it. One sale per release is tested under real concurrency on Postgres (three desks at once → one sale).
- **I3 yield pricing** ✅ — `api/domains/pricing.ts`, `_shared/yield.ts`. `quote_walkin` feeds the modal (every option priced by the server, the reason shown); `create_walkin` refuses a stale `expectedAmount`. With the switch off the price is fee_config's exactly as before (golden master unchanged).
- **A2 enquiry chat** ✅ — `agent/enquiry.ts` + `api/domains/leads.ts`; page `/ask` on the join site (`src/pages/AskPage.jsx`). Limits: 20 messages per chat and 30 per phone a day, 40 per IP-hash an hour, 400 in all a day. A reply is shown only when every number in it is in the facts. Drafts and replies are handled in the enquiry drawer (`src/components/EnquiryAiPanels.jsx`). The visitor's name and phone never reach the event log.
- **I24 lead scores, AI dedupe** ✅ — `cron_score_enquiries`, `agent/dedupe.ts`; score badges and "Best leads first" on Enquiries; AI pairs open the existing merge dialog. AI follow-up drafts: writer `kind: enquiry_followup` (switch `pssai_ai_messages`).
- **Referral links** ✅ — `api/domains/referrals.ts`, migration 065; `/r/<code>` on the join site (`src/pages/ReferralLink.jsx`) opens the branch's current sign-up link with the channel set; the Growth page lists links with sign-ups, chats and joined. WhatsApp and Other were added to the "How did you hear about us?" list (C10).
- **I25 exam radar, O9 next exam, I26 win-back** ✅ — `agent/examRadar.ts` (robots.txt honoured, scripts stripped, unreadable pages reported), `api/domains/exams.ts`, `agent/winback.ts`; the Growth page's Exam calendar; `/me/next`; Send list rows labelled Win-back / Next exam. Default exam pages are in `_shared/exams.ts` — **check each URL before switching the radar on** (boards move their pages; JavaScript-only pages are reported for manual entry).
- **O3 pay-later advice, A7 exception desk** ✅ — advice under Partial / Pay Later in both renewal forms (`src/components/PaylaterAdvice.jsx`); AI suggestions on Approvals (job every 30 minutes, or "✨ AI suggestion"). Long digit runs are scrubbed from the facts the model sees.
- **Portal R2** ✅ — `/me/release`, `/me/waitlist`, `/me/refer` (friend link + cashbacks), `/me/next`, listed on More when switched on (`me_profile.features`).
- **Owner page** — `src/pages/GrowthPage.jsx` (`/growth`): walk-in prices (and the owner's own day), seat resales, referral links, exam calendar.
- **Tests** — server suites `seats`, `leads`, `exams`; Vitest `tests/units/phase3.test.ts` (21 cases: prices, prediction, exam families, robots.txt, scores, risk); integration `tests/integration/phase3_test.ts` on Postgres 16 + PostgREST 12; browser QA of every new page (29 checks, phone width for the portal and `/ask`); eval sets `tests/agents/enquiry-eval.md` and `tests/agents/exception-desk-eval.md`.
- Found while testing: the fake database follows relations only by naming convention, so queries that embed through `link_id`, `release_id` or `chat_id` name the column explicitly (`referral_links!link_id(...)`), which PostgREST accepts; `notifyStudent` now reports whether a notice was actually written (a repeat is skipped).

### Independent review of Phase 3 (2026-10-25)

One independent reviewer read the range `8bbe8a1..99a14f6`. Held up: one sale per release (one conditional open → sold update), the cabin stays reserved, prices clamped to ±20% and rounded to ₹5, unchanged prices with the switches off, `set_walkin_price_day` T3 and owner-only, referral rewards through Approvals, every `me_*` limited to the token's student, chat keys (160 bits, hash only), length-only chat events, numbers in replies checked against the facts, upsert targets and embeds. Fixed, each with a test (server suites; the Postgres-only ones in `tests/integration/phase4_test.ts` §6):

| # | Finding | Fix |
|---|---|---|
| 1 | High: a member coming back for a second session during a resale was booked into the cabin the walk-in was using; two check-ins at once could give two free days | Every arrival during a sold window is handled, not only the first; the outcome is claimed with one conditional update and the free day is granted only by the claim that wins |
| 2 | A release outlived the membership or cabin it was made for, and a sale never re-checked the cabin; a renewal (new membership row) let the same hours be released twice | A sale (and the list) needs an active permanent membership on that desk and no active booking in the cabin for those hours; releases are keyed on desk + student; a stale release is withdrawn |
| 3 | Decision: collisions ignored time | Taken: a collision only when the walk-in's sold hours overlap the member's session and have not ended; a walk-in past their sold hours is asked to move and the member keeps the cabin; the cabin is still linked at sale time. A walk-in's checkout unlinks the cabin only if the link is still theirs |
| 4 | A form that didn't send the shown price (an old screen, a failed quote) could charge the new price silently | With a price change today, `create_walkin` without `expectedAmount` is refused (409) with the current price; the walk-in form always asks for quotes and sends the shown price. Unchanged while yield pricing is off |
| 5 | Predictions and releases used only the current membership row (renewals reset history; an early renewal blocked releasing days still paid for; old holds missed) | `permanentSpan()` follows `renewed_from_membership_id` on the same cabin for history, eligibility, holds (`resumed_at` null or in the window) and the release-day check |
| 6 | Decision: renewals by existing members counted as referral joins; one join could reward several links | Taken: only a student with no membership before the link was used counts, and only the first link a phone came through is rewarded |
| 7 | Pay-later and lead scores read memberships, activities and chat messages unpaged (cut at 1,000) | Paged reads within each chunk |
| 8 | Decision: the public chat could be flooded (new chats, staff notices, AI cost) | Taken: a hidden field for scripts, at most 3 new chats an hour from one place, the IP taken from the proxy's own `X-Forwarded-For` entry (one shared bucket when none), and the chat's own daily AI cap (`pssai_enquiry_ai_daily`, default 150; past it messages are kept for the team) |
| 9 | Decision: win-back, dedupe and exam radar had no eval sets | Written: `tests/agents/winback-eval.md`, `dedupe-eval.md`, `exam-radar-eval.md` (20 cases each, pass bar 18) |
| 10 | The referrer got "your grant_cashback request was not approved" for something they never asked | Labelled "referral reward"; a denied system-queued reward sends no notice, an approved one thanks the referrer; the deny box says the student is not told |
| 11 | The IP hash could be reversed by trying every address | HMAC with the server secret and the date |
| 12 | The exam radar read whole pages and followed redirects without robots checks | Reads at most 400 KB; redirects followed by hand (3 at most), https only, robots.txt checked on each site |
| 13 | A crash after the release claim left it sold with no booking | The claim is put back on any failure before the booking exists |
| 14 | With both switches off a live resale double-seated the member; open releases waited forever | Arrivals are handled whatever the switches say; the hourly job withdraws open releases whose switch is off |
| 15 | "Back to automatic" for today left today at 0% | Today's automatic price is worked out at once |
| 16 | Decision: the exam +5% applied at every branch | Taken: only where at least 10% of the branch's active members prepare for that exam family |
| 17 | Decision: next-exam Send-list rows were dropped when the 08:00 collections job already had the student | Taken: that student waits a day, with no notice used up |
| 18 | UI gaps | Free-text reply in the website chat panel; the Exam calendar tab (and the Growth link) shows with next-exam, win-back or yield pricing too; a switched-off referral link says so; the release page no longer promises a seat; the calendar counts current members |
| 19 | Decision: seat credits are pending cashbacks, so closure pays them out like any cashback | **Left for the owner:** changing it would alter the money paths of `close_membership`/`delete_membership` (R1). Until then a D7 credit behaves like every other pending cashback |

The golden master was re-recorded once: two seeded desks no longer gain an always-null `current_booking_id` key at checkout (the walk-in unlink is now conditional); on Postgres the column is null either way.

## Phase 3 exit gate

- [ ] A measurable revenue gain at the pilot branch compared with the control branch over a full month
- [ ] Every overbooking collision was handled by the fallback, with no escalated complaint
- [ ] Released hours are resold and credited correctly, with zero double-bookings

---

# PHASE 4 — Self check-in at a pilot branch (spec level)

**Branch:** `pss-ai/all-phases` · **Needs:** D9, D10 · **Staff stay present as a fallback for four weeks**

| Item | What to build | Closes |
|---|---|---|
| Self check-in (SP13) | Migration `068_checkin_location`: add `latitude`, `longitude`, `checkin_key` to `branches`; a `checkin_records` table with the location result and consent. A printed QR poster encodes `https://join.perfectstudyspace.in/me/checkin?b=<branch>&k=<checkin_key>`. New action `me_check_in` (T1) checks the key and the phone's location against the D9 radius, then runs the same logic as `check_in_member` with the student as actor. Desk choice: permanent members get their own desk; others get one from seat matching. The owner can reprint with a new key. | G1 |
| Self checkout | New action `me_check_out` runs the same logic as `checkout_booking`, so overtime and Food Pass rules are unchanged | — |
| A5 Session watch | Reminds students in the portal before quota end, closes forgotten sessions, applies overtime by rule and flags manual edits. The "Correct checkout time" control becomes an exception path. Without sensors an early exit cannot be verified. | G4; G2 and G5 partly |
| I4 Seat matching | Replaces the first-free-desk choice in `create_walkin` with placement based on study profiles | G6 |
| O2 part 2 | The nightly check also compares self check-ins, billed sessions and confirmed payments | — |
| I20, I21 Food | Orders decrement stock automatically; demand is forecast; supplier orders are drafted for the owner | G29, G30 |
| I22 Complaint to ticket | Complaints in the portal (SP17) become tickets with type and priority | — |
| Photo-proof tasks | Housekeeping tasks are confirmed with a phone photo | G31 |
| Portal R3 | SP13 self check-in, SP14 live seats (counts only, no names), SP15 seat preferences, SP16 food ordering, SP17 report a problem | — |
| Config | `public/_headers` (Cloudflare Pages): change `Permissions-Policy` from `geolocation=()` to `geolocation=(self)` | — |

**Questions to settle with the owner while refining Phase 4:** answered as C14 (self checkout with a Food Pass shortfall is allowed; the amount stays as dues) and C15 (forgotten sessions close at 23:30 IST at the booked end time, no overtime).

### Build level (2026-10-25)

Every piece has its own switch, off by default (R9). The switches are global, but self check-in works only at a branch whose owner has saved its location and printed a poster, so turning it on and setting up Hopes alone is the pilot (A5). Students reach only `me_*` actions (S12); every money path runs through the existing staff action with a branch-limited portal scope (`portalScope`), as the self-hold already does.

| Switch | Turns on |
|---|---|
| `pssai_self_checkin` | `me_check_in`, `me_check_out`, the portal check-in page, the poster settings |
| `pssai_session_watch` | The 23:30 IST close of forgotten sessions and the review flags for corrected checkout times |
| `pssai_seat_matching` | A desk chosen from preferences and history for temporary members at self check-in; the suggested desk in the staff check-in and walk-in forms; seat preferences in the portal |
| `pssai_live_seats` | Free-seat counts in the portal |
| `pssai_food_orders` | Ordering food in the portal and the fulfilment queue |
| `pssai_food_stock` | Stock taken off linked inventory when food is billed; the demand forecast and supplier order drafts |
| `pssai_tickets` | "Report a problem" in the portal and the tickets page |
| `pssai_photo_tasks` | A photo needed before a housekeeping task can be ticked |

**Migrations** (append-only; Appendix B renumbered): `068_checkin_location` and `069_food_queue_and_tickets`.
- `068`: `branches.latitude`, `branches.longitude`, `branches.checkin_key`; `checkin_records` (student, branch, booking, `in`/`out`, result, distance and accuracy in metres only: raw coordinates are never stored); `checkin_consents` (student, consent version, time); `desks.tags` (window, power, quiet, AC); `seat_preferences` (student, up to 3 favourite desks, wanted tags).
- `069`: `food_orders` (the queue: placed → accepted → ready → delivered, or cancelled; items with the prices shown); `food_items.inventory_item_id` and `inventory_per_unit`; `inventory_items.supplier_phone`; `inventory_logs` action `sold`; `supplier_orders` (owner drafts); `tickets` (C16 categories, priority, status); `tasks.needs_photo`; `task_photos` and a private `task-photos` bucket.

**Self check-in (SP13).**
- `me_checkin_info` (T0): the student's open session, whether consent is still needed (with the D9 consent text) and the branch name for the poster's `b`.
- `me_check_in` (T1): checks the switch, the poster key (`k`), consent, then the phone's location: refused when the accuracy is worse than 100 m or the distance is more than 100 m (D9). Ten tries in ten minutes at most. Then it runs `check_in_member` unchanged, as the student, with a desk from seat matching for temporary members (switch on and a free floating desk; otherwise no desk, as staff check-in does today). Every try writes a `checkin_records` row. The coordinates are left out of the event log.
- `me_check_out` (T2): the student's own open member session. The server works out the overtime minutes from the clock, the same way the checkout form does (booked end, plus a break still in progress), and runs `checkout_booking` with Pay Later overtime, so overtime is billed at renewal or closure as today.
- **C14 in `checkout_booking`:** a new `foodAsDues` input, honoured only for student and system callers. With it, a Food Pass shortfall or a member's food bill older than 3 days no longer blocks the checkout: the bills stay unpaid (they are the dues) and the answer says how much. Every existing path is unchanged; staff calls never reach it (R1, R6).
- Owner: `get_checkin_settings` (T0), `set_branch_location` (T3) and `rotate_checkin_key` (T3: a new key, so old posters stop working). Branch settings show the poster with a QR code for `https://join.perfectstudyspace.in/me/checkin?b=<branch>&k=<key>`.
- `public/_headers`: `geolocation=(self)`.

**A5 Session watch.**
- `cron_session_reminders` tells students to check out in the portal when self check-in is on.
- `cron_close_forgotten_sessions` (23:30 IST): every open session whose booked end has passed is closed through `checkout_booking`. It is closed at the booked end, or when its break began if it is on a break, with no overtime (C15) and food as dues. The student is told in the portal, and each close is an `anomaly_flags` row (`session_auto_closed`) for the owner. Sessions booked past 23:30 are left alone until the next night.
- The same job flags (`checkout_corrected`) staff checkouts from the last day whose checkout time was moved more than 10 minutes back. This makes "Correct checkout time" an exception path.
- O2 part 2 (integrity report):
  - successful self check-ins with no session;
  - staff check-ins at branches that have a poster (the exit-gate item "every staff-only call is logged and explained");
  - paid walk-ins with no desk payment.

**I4 Seat matching and SP15.**
- `rankDesks()` (`_shared/seatmatch.ts`, pure) orders the free floating desks by:
  1. favourite desks;
  2. wanted tags;
  3. the desks the student used most in the last 60 days;
  4. the desk order.
- `suggest_desk` (T0, staff): the WalkInModal and the check-in form pre-select the suggested desk.
- `me_seat_prefs` (T0) and `me_set_seat_prefs` (T1) let the student pick desks and tags from their own branch.
- `set_desk_tags` (T1, owner).

**SP14 Live seats.** `me_live_seats` (T0): per active branch, free floating seats = floating desks minus open sessions not on a fixed cabin. Counts only, no names.

**I20/I21 Food (D10).**
- **Ordering.**
  - `me_food_menu` (T0) shows the menu.
  - `me_food_order` (T1) needs an open session and checks stock; the server computes the total.
  - `me_cancel_food_order` (T1) works only while the order is still placed.
- **Fulfilment.**
  - Anyone working the queue uses `list_food_orders` (T0, staff) and `update_food_order` (T1: accept, ready, cancel). That can be the kitchen person, an outside vendor's staff login or the owner restocking a vending shelf.
  - `deliver_food_order` (T2) claims the order once, then runs `create_food_bill` unchanged with the order's items. The Food Pass pays when it covers the bill; otherwise the fulfiller picks cash, UPI or the member's tab. If the price changed since the order, the delivery is refused rather than charged.
- **Stock.** With `pssai_food_stock` on, a bill takes `quantity × inventory_per_unit` off the linked inventory item and logs it as `sold`. `set_food_item_stock_link` (T1, owner) sets the link.
- **Forecast.** `forecastDemand()` (`_shared/fooddemand.ts`, pure) uses each weekday's average over the last 4 weeks, falling back to the daily average. `get_food_forecast` (T0, owner) shows it.
- **Supplier drafts.** `cron_supplier_drafts` (21:00 IST) writes one draft per branch covering 3 days of forecast use × 1.2, minus stock. The owner sends a draft by WhatsApp with `openWhatsApp()`; marking it received adds the stock through `add_inventory_item`. `list_supplier_orders` (T0) and `update_supplier_order` (T1) are owner-only.

**I22 Complaints to tickets (SP17).**
- `me_report_problem` (T1) takes a C16 category and details. At most 3 a day and 5 open per student.
- Priority comes from rules in code, not AI: urgent words (fire, smoke, shock, leak, injury, theft, harassment) make a ticket urgent; Wi-Fi and seat problems are high; the rest are normal.
- `me_tickets` (T0) is the student's own list; `list_tickets` (T0, staff) and `update_ticket` (T1) work the queue. The student is told when a ticket is resolved.
- The ticket text is stored in its table and logged as its length only.

**Photo-proof tasks (C17).**
- `create_task` takes `needsPhoto`. With the switch on, a daily task whose title is about cleaning (clean, sweep, mop, wash, dust, toilet, washroom, bin, garbage) needs a photo unless the owner unticks it.
- `upload_task_photo` (T1) stores the photo in the private bucket, one per task per day.
- `update_task_status` refuses "done" without that day's photo.
- `get_task_photo` (T0) gives a 5-minute link.
- `cron_purge_images` also removes task photos after `task_photo_keep_days` (default 30).

**Portal R3.**
- Home: the open session with Check out, and live seats.
- `/me/checkin`: the poster page, with consent first, then location.
- More: seat preferences, food, report a problem.
- `me_profile.features` tells the portal which of these are on.

### Phase 4 as built (2026-10-25)

✅ Every item in the table above is built, each behind its switch (all off). Server in `api/domains/{checkin,kitchen,tickets}.ts` and `_shared/{checkin,seatmatch,food,tickets}.ts`; changes to `checkout_booking` (the `foodAsDues` path only), `create_food_bill` (stock taken off after the bill, switch on only), `create_task` / `update_task_status` / the task lists (photos, switch on only), `cron_session_reminders` (wording) and `cron_purge_images` (task photos). UI: `src/portal/PortalSelf.jsx` (check-in page, home session card, live seats, seat preferences, food, report a problem), `src/pages/FoodQueuePage.jsx`, `src/pages/TicketsPage.jsx`, `src/components/SelfCheckinCard.jsx` (poster and desk tags on Branches), the suggested desk in the check-in and walk-in forms, photo proof on Actions, the two new flag kinds on Flags.

- A student who scans the poster while logged out logs in and comes back to the check-in page (only `/me/checkin?…` is remembered).
- `get_checkin_settings` returns a branch's open seats with their tags (the seat map is unchanged, so it still works before 068 is applied).
- The poster prints from the owner's screen (the site's CSP allows no inline script in the print window).
- `public/_headers` and `vercel.json` now allow `geolocation=(self)`; camera stays blocked (task photos use the phone's own camera through the file picker).
- Tests: `tests/server/checkin_test.ts` (49 checks) and `kitchen_test.ts`, `tests/units/phase4.test.ts`, `tests/integration/phase4_test.ts` (real Postgres: relation hints, the conflict target, array columns and their CHECKs, the partial unique index, the food queue and the 23:30 close end to end). Browser QA: 33 checks on the new screens.
- Found while testing: a checkout's real clock can add a minute (121 instead of 120 minutes of overtime) — the integration test allows both; a body field named `status` collided with the test harness, so the food and supplier answers say `orderStatus`.

## Phase 4 exit gate

- [ ] Four weeks at the pilot branch with staff present but not needed
- [ ] Every open session is closed automatically by the end of the day
- [ ] Every remaining staff-only action call is logged and explained
- [ ] Every member at the pilot branch checked in through the portal for four weeks

---

# PHASE 5 — Self-improving system and staff retirement (spec level)

**Branch:** `pss-ai/all-phases`

| Item | What to build |
|---|---|
| I7 Your own small model | **First check the AI provider's terms on training with its outputs; skip I7 if not allowed.** Fine-tune a small open model on logged agent runs (inputs, tool calls, outcomes, owner approvals). Route routine portal chats to it; keep the large model for hard cases. Compare both on the same test sets. |
| I8 Policy learner | Groups the owner's past approvals and denials and proposes new coded rules. A rule applies only after the owner signs it off. |
| I6 Digital twin | Simulates a policy change (for example a 7-day grace period) on real behaviour data before it goes live |
| O6 Weekly experiments | Small tests on offers, hours and menu; keeps the winners after owner review |
| O7 Space-yield optimiser | Occupancy heat-maps suggest which zones become premium cabins, group rooms or extra seats |
| I13, I10 | Study Wrapped card and exam coach in the portal |
| Portal R4 | SP18 focus profile, SP19 exam coach, SP20 Study Wrapped, SP21 study buddy (opt-in) |
| S1 Retire desk-staff modules | Migration `070_deprecate_staff_ops` marks tables deprecated; a later migration drops them after the data is archived. Remove: `markAttendanceIfNeeded` on every request; `staff_attendance` reads, `list_staff_attendance`, `end_staff_session` and the logout cut-off in `authStaff`; `assign_staff_override`, `clear_staff_override`; `list_branch_staff`, `get_staff_grid`; staff-to-staff `list_messages`, `send_message`, `MessagesPage`; `StaffPage`; `TasksPage` unless housekeeping still uses it. `create_staff` and `update_staff` shrink to owner, admin and kitchen/housekeeping accounts. Do this only after the staff modules sit unused for a full month. |

### Build level (2026-10-25)

I7 is skipped (D3). Everything else is code-only: no AI call is added in Phase 5, so nothing here spends from the AI budget. Every piece is off by default (R9). Settled rules hold:
- T3 still always goes to the owner (S9).
- The large discount/cashback confirm stays on (C24).
- Money is worked out only by the existing code (R1, R3).

| Switch | Turns on |
|---|---|
| `pssai_policy_learner` | I8: proposed rules from past decisions, the owner's sign-off, and signed hold rules applied |
| `pssai_digital_twin` | I6: "what if" simulations of a policy change on the last months' real data |
| `pssai_experiments` | O6: A/B tests on win-back offers, next-exam plans and the featured menu item (C20) |
| `pssai_space_yield` | O7: occupancy heat-map and suggestions per branch |
| `pssai_portal_r4` | SP18 focus profile, SP19 exam coach, SP20 Study Wrapped |
| `pssai_study_buddy` | SP21 study buddy, opt-in both ways (C20) |
| `pssai_retire_staff_ops` | S1: the desk-staff screens and checks retired (C18) |

**Migrations** (append-only; Appendix B):
- `070_deprecate_staff_ops`:
  - `COMMENT ON TABLE` marks `staff_attendance` (and the override columns) deprecated; nothing is dropped.
  - `staff.duty` (`desk`, `kitchen`, `housekeeping`; default `desk`), so the accounts C18 keeps can be told apart.
- `071_learning_and_buddies`:
  - `policy_rules` (scope, condition, outcome, support, status proposed → active → retired, who signed and when);
  - `experiments` and `experiment_exposures` (one variant per student per experiment, conversion time);
  - `study_buddies` (opt-in profile) and `study_buddy_matches`.

**I8 Policy learner.**
- `learnPolicies()` (`_shared/policy.ts`, pure) groups decided approvals from the last 180 days by kind, action and a bucket of the request:
  - hold days 1–7 / 8–14 / 15–31;
  - cashback ₹1–100 / 101–300 / over 300;
  - whether the student had dues.
- A group of at least 6 decisions that went the same way at least 90% of the time becomes a proposed rule, in words: "Holds of 8–14 days with no dues: you approved 9 of 9".
- `cron_policy_rules` (weekly) refreshes the proposals; `list_policy_rules` (T0) shows them; `decide_policy_rule` (T3, owner: it changes policy) signs or retires one.
- A signed rule:
  - shows on every matching approval card as "Matches your rule";
  - for student hold requests only (T1, never T3), `cron_apply_policy_rules` (every 15 minutes) approves a matching request through the same steps as the owner's Approve (`approveHold()`), with the rule in the reason;
  - never applies to T3 actions, refunds, plan changes or money (S9, R3).

**I6 Digital twin.** `simulate_policy` (T0, owner) answers "what if" from the last 180 days, using pure functions in `_shared/twin.ts`:
- the renewal grace days (today 10): renewals whose start date and charged days would change, the extra or lost ₹ (days × the plan's daily rate), and the check-ins that would have been refused;
- the overtime grace minutes (today 15): each logged overtime session re-priced with `overtimeCharge(…, grace)`, which equals `computeOvertimeCharge` at 15 (tested), and the ₹ difference;
- the self-hold limit (today 7 days, C1): past hold requests that would run by themselves or go to approval.

Nothing changes until the owner changes the real setting.

**O6 Experiments (C20).**
- `create_experiment`, `update_experiment` (T1, owner) and `list_experiments` (T0) manage them. Kinds:
  - `winback_offer`: two discounts, each at most 10% (C12);
  - `next_exam_offer`: 3 vs 6 months;
  - `menu_feature`: two food items shown first in the portal menu.
- Students get a variant by a stable hash. Every exposure is recorded when the job or the page uses it.
- `cron_experiments` (weekly):
  - marks conversions: a renewal or rejoin within 21 days, or an order of the item within 7 days;
  - ends experiments past their end date;
  - works out each variant's rate and a two-proportion test (`abResult()`, pure).
- The owner "keeps" the winner (`update_experiment` with `keep`). That writes the real setting: `winback_discount_pct`, `next_exam_months` or `featured_food_items`.

**O7 Space yield.**
- `get_space_yield` (T0, owner): for each weekday × hour over the last 8 weeks, the average open sessions not in a fixed cabin ÷ open seats, and the cabins' own use.
- `spaceSuggestions()` (pure) turns that into suggestions:
  - add seats when open seats are over 95% full for 6 or more hours a week;
  - convert seats to cabins when the permanent waitlist is long and open seats stay under 60% at peak;
  - an evening offer or a group room when whole blocks of hours stay under 25%.

**Portal R4.**
- `me_focus_profile` (SP18): focus ratings by time of day and weekday, and the best window; needs at least 5 ratings.
- `me_exam_coach` (SP19): the next confirmed exam of the student's family, days left, the last 14 days' study per day against the plan's hours, and fixed advice for far / near / last month.
- `me_wrapped` (SP20, a month): hours, days, longest streak, best day, favourite desk, average focus, and a percentile among the branch's members (counts only).
- SP21 study buddy:
  - `me_buddy`, `me_buddy_join` (window: morning, afternoon, evening, night), `me_buddy_leave`, `me_buddy_respond`;
  - `cron_buddy_matches` (weekly) pairs opted-in members of the same branch, exam family and window;
  - after both accept, each sees the other's first name and window only, never a phone number, and they meet at the hall.

**S1 Retire the desk-staff modules (C18).**
- `get_staff_module_usage` (T0, owner): calls to each retiring action in the last 30 days, so the owner sees a full month unused before switching.
- With `pssai_retire_staff_ops` on:
  - attendance is no longer marked on every request, and End Session no longer cuts staff off;
  - `list_staff_attendance`, `end_staff_session`, `assign_staff_override`, `clear_staff_override`, `get_staff_grid` and staff-to-staff `send_message` answer 410;
  - Messages, the staff attendance grid and the override controls are hidden;
  - `create_staff` / `update_staff` accept only owner, admin or a kitchen / housekeeping duty.
- Kept, because housekeeping still uses Actions:
  - `list_branch_staff`, which assigns tasks;
  - TasksPage;
  - `list_messages`, which carries system notices such as new enquiries and cross-branch visits.
- The tables are only marked (070); dropping them is a later migration after the data is archived.

## Phase 5 exit gate

- [ ] The small model handles most chats at the large model's accuracy on the test sets (or I7 is skipped by decision)
- [ ] Staff modules sat unused for a full month before the retirement migration
- [ ] Monthly active portal users meet a target set with the owner from the R1 baseline

---

# PHASE 6 — New student products (spec level)

**Branch:** `pss-ai/all-phases`

| Item | What to build |
|---|---|
| I33 Verified study certificate (SP22) | A record of real study hours, signed with an HMAC secret, with a public check page at `join.perfectstudyspace.in/verify/<id>` |
| I34 Parent digest (SP23) | A weekly read-only summary link that the student chooses to share; the student can revoke it |
| O10 One owner, every branch | One dashboard, one approval queue and one brief across all branches |

### Build level (2026-10-25)

| Switch | Turns on |
|---|---|
| `pssai_certificates` | I33/SP22: verified study certificates and the public check page |
| `pssai_parent_digest` | I34/SP23: the weekly parent summary link |
| `pssai_owner_overview` | O10: one page across every branch |

**Migration** `072_certificates_and_digests`:
- `study_certificates` (short id, student, branch, date range, hours, days, issued, signature, revoked);
- `parent_links` (student, hash of the link token, created, revoked, last viewed);
- `parent_digests` (the weekly snapshot per student and week).

**I33 certificate (C21).**
- `me_issue_certificate` (T1):
  - the student picks a range of up to 12 months, ending no later than today;
  - code counts completed sessions in it, minus breaks (hours and days);
  - the row is signed with HMAC-SHA256 under the `CERTIFICATE_SECRET` Supabase secret over the hall name, the student's name, the range, the hours and the days;
  - without the secret, issuing is refused;
  - at most 5 a month.
- `me_certificates` (T0) lists them; `me_revoke_certificate` (T1) withdraws one.
- `public_verify_certificate` (public, T0): `join.perfectstudyspace.in/verify/<id>` shows the hall name, the student's name, the hours, the dates and whether the signature checks.
- The portal's printable certificate carries the check link as a QR.

**I34 parent digest (C22).**
- `me_parent_link` (T1) makes or replaces the student's link (a 32-character token, only its hash kept); `me_revoke_parent_link` (T1).
- `cron_parent_digest` runs Sundays at 19:00 IST. It freezes each linked student's week:
  - hours per day;
  - days attended;
  - average focus;
  - when the plan ends.

  It holds no amounts, phone numbers or messages, and the student is told it is ready.
- `public_parent_digest` (public, T0): `join.perfectstudyspace.in/p/<token>` shows the latest week (and the 3 before it); a revoked link shows nothing.

**O10 One owner, every branch.**
- `get_owner_overview` (T0, owner), one row per branch plus totals:
  - checked in now and free seats;
  - today's and this month's collections (from transactions);
  - dues;
  - plans ending this week;
  - open approvals, open problem reports and open food orders.
- One Approvals queue and one brief already cover every branch; the page links to them.

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
| 057 | `057_agent_runs.sql` | P1 | Agent runs: tokens and estimated cost per run (moved here from the old 059 for P1.8) |
| 058 | `058_student_auth.sql` | P2 | Student PINs, setup codes, sessions |
| 059 | `059_payment_proofs.sql` | P2 | UPI payment proofs and owner decisions |
| 060 | `060_portal_notifications.sql` | P2 | Portal inbox |
| 061 | `061_approvals.sql` | P2 | Approval queue |
| 062 | `062_student_requests.sql` | P2 | Holds, plan changes, refunds asked for by students |
| 063 | `063_seat_releases.sql` | P3 | Released and predicted-free desk hours, resales and their credits (O1, SP10) |
| 064 | `064_yield_and_leads.sql` | P3 | Walk-in price days, enquiry scores, AI duplicate suggestions, the enquiry chat, the approvals AI note |
| 065 | `065_referral_links.sql` | P3 | Tracked referral links and attributions |
| 066 | `066_exam_notices.sql` | P3 | Exam notices; Send list kinds |
| 067 | `067_phase2_hardening.sql` | P2 review | Sign-up pay key; one confirmed proof per UTR |
| 068 | `068_checkin_location.sql` | P4 | Branch location, check-in key, check-in records and consents, desk tags, seat preferences |
| 069 | `069_food_queue_and_tickets.sql` | P4 | Food order queue, stock links, supplier drafts, tickets, task photos |
| 070 | `070_deprecate_staff_ops.sql` | P5 | Marks desk-staff tables deprecated; staff duty (desk, kitchen, housekeeping) |
| 071 | `071_learning_and_buddies.sql` | P5 | Policy rules, experiments and exposures, study buddies |
| 072 | `072_certificates_and_digests.sql` | P6 | Study certificates, parent links and weekly digests |

Numbers are indicative. Because phases ship in order, the migration owner may renumber unbuilt ones so files are applied in the order they ship; update this table in the same commit. *Renumbered on 2026-10-20 (P1.8), 2026-10-23 (Phase 3 and the Phase 2 review) and 2026-10-25 (Phase 4) into build order.*

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
| T2 | Money comes in, with amounts calculated by code: `record_payment`, `record_locker_payment`, `add_manual_payment`, `topup_food_pass`, `create_food_bill`, `collect_food_bill_shortfall`, `create_walkin`, `create_membership`, `renew_membership`, `renew_locker`, `add_locker`, `checkout_booking`, `deliver_food_order` (Phase 4: bills a portal food order through `create_food_bill`), payment requests and proofs | Allowed | Own payments only |
| T3 | Money goes out, records are destroyed or policy changes. Always the owner's approval queue for agents and students. | Approval only | Approval only |

**Explicit T3 list:** `delete_membership`, `close_membership`, `cancel_early_renewal`, `change_membership_plan`, `change_membership_cabin`, `transfer_student_branch`, `apply_loyalty_discount`, `grant_cashback`, `redeem_cashback_now`, `set_overtime_excluded`, `add_attendance`, `update_attendance`, `fix_membership_dates`, `fix_negative_food_pass_balances`, `update_fee_config`, `update_welcome_template`, `update_branch`, `add_desk`, `remove_desk`, `remove_locker`, `update_locker_due_date`, `update_locker_number`, `create_food_item`, `update_food_item`, `create_staff`, `update_staff`, `assign_staff_override`, `clear_staff_override`, `end_staff_session`, `delete_enquiries`, `rotate_signup_link`, `set_walkin_price_day` (Phase 3: the owner's own walk-in price for a day), `set_branch_location`, `rotate_checkin_key` (Phase 4: where self check-in is allowed, and the poster key).

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
