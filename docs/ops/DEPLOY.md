# Deploying PSS-AI

For the current manual deployment, start with [MANUAL-RELEASE-2026-10-30.md](MANUAL-RELEASE-2026-10-30.md).

Confirmed source: [perfectstudyspacedev-sys/PerfectStudySpace, branch pss-ai/all-phases](https://github.com/perfectstudyspacedev-sys/PerfectStudySpace/tree/pss-ai/all-phases).
Confirmed backend: `zripsszkprhtyccukrir`. Cloudflare Pages project: `perfectstudyspace`.
The local Supabase configuration now targets that backend. Verify the Cloudflare deployment branch
and build environment against these details; the local workspace has no Git metadata.

Read-only SQL readiness report: [full-system-diagnostic.sql](full-system-diagnostic.sql).
Run the complete file as postgres in the confirmed project's SQL Editor. It changes no business
data and does not execute jobs or AI. Read the result's scope/status notes before treating it as a test result.
See [DATABASE-DIAGNOSTIC.md](DATABASE-DIAGNOSTIC.md) for result meanings and local validation.
The first user-run report is interpreted in [LIVE-READINESS-2026-10-29.md](LIVE-READINESS-2026-10-29.md).
For its missing pg_cron/schedules, [prepare-missing-schedules.sql](prepare-missing-schedules.sql)
installs missing jobs paused, preserving existing configuration; activate per job after live checks.

**AI provider update:** Ollama Cloud → Gemini → Claude is now implemented. Apply migration 073
before deploying the functions, configure backend provider keys, and follow
[AI-PROVIDERS.md](AI-PROVIDERS.md) for supported tasks, model overrides and tests. Older Claude-only
setup instructions below remain valid when only AI_API_KEY is configured.

Branch `pss-ai/all-phases` — every phase is built on it. One deploy brings in every phase built
so far; every new feature stays switched off until you turn it on (parts 2 and 3 below).
Order matters (plan rule R10): **database → functions → website**.
The website must never go live before the functions — the new payment, checkout and renewal
forms send a header that only the new `api` function accepts.

Before you start, on your computer in the repo: `git checkout pss-ai/all-phases && npm ci && npm run predeploy`.
It must end with "✓ predeploy passed".

## 1. Check that 049–051 are already applied
Supabase dashboard → SQL editor:
```sql
SELECT 'overtime' = ANY (enum_range(NULL::transaction_category)::text[]) AS m049,
       to_regclass('public.waivers') IS NOT NULL AS m050,
       to_regclass('public.signup_requests') IS NOT NULL AS m051,
       to_regclass('public.events') IS NOT NULL AS m052_already;
```
`m049`, `m050` and `m051` must all be `true` (they come from the RSP/SSP work already on `main`).
If one is `false`, apply that file first. `m052_already` should be `false`.

## 2. Database: migrations 052 onwards
Either `supabase db push` (asks before applying), or paste each file into the SQL editor in number
order, from `052_event_log.sql` to the newest file in `supabase/migrations/`. All are additions
only. Phase 1 and 2 tables are unused until you switch their features on. `059` and `062` also
create two **private** Storage buckets, `payment-proofs` and `id-photos` (no public links).

## 3. Secrets and extensions
For the complete current names, values and optional settings, use [SUPABASE-SECRETS.md](SUPABASE-SECRETS.md).

- Database → Extensions: turn on **pg_cron** and **pg_net**.
- Edge Functions → Secrets:
  - `STAFF_JWT_SECRET` — a long random value. It signs staff logins. The live project may already
    have it as `JWT_SECRET` (either name works); a **new** project must have it, or every function
    restart logs the staff out.
  - `CRON_SECRET` — a long random value (e.g. `openssl rand -hex 32`). Keep a copy for step 5.
  - `PORTAL_URL` — the student site's address (default `https://join.perfectstudyspace.in`). Set it
    when this project serves another student site, so setup codes, check-in posters, certificates and
    family links point there.
  - `ALLOWED_ORIGINS` — optional. Without it the built-in list is used:
    `https://perfect-study-space.pages.dev, https://join.perfectstudyspace.in, https://perfectstudyspace.in, https://www.perfectstudyspace.in, http://localhost:5173`.
    Set it only if the staff site is also opened from another address.
  - `STUDENT_JWT_SECRET` — another long random value (like `CRON_SECRET`, but different). It signs
    student portal logins. Without it students are logged out whenever the function restarts.
  - `AI_API_KEY` — your Claude API key (from the Claude Console), for the owner analyst. It lives only
    here; never put it in the website's settings or in a chat. Without it the analyst says it is not set
    up and nothing else changes. Optional: `AI_MODEL` (default `claude-haiku-5-5`) and `AI_MODEL_HARD`
    (default `claude-sonnet-5-5`, used for "Deep answer").
  - `CERTIFICATE_SECRET` — Phase 6 only: another long random value (at least 16 characters, e.g.
    `openssl rand -hex 32`). It signs study certificates; without it no certificate is issued and
    none checks. Changing it later makes every certificate issued before stop checking — keep it.

## 4. Functions
From the repo root, naming the project every time (the repo's `config.toml` and a previous
`supabase link` may point at another project):
```bash
supabase functions deploy api   --project-ref <PROJECT_REF> --no-verify-jwt
supabase functions deploy cron  --project-ref <PROJECT_REF> --no-verify-jwt
supabase functions deploy agent --project-ref <PROJECT_REF> --no-verify-jwt
```
`PUBLIC_SITE_KEY` (optional) is only for the marketing website's enquiry form.

## 5. Schedules
Open `docs/ops/cron.sql`, replace `<PROJECT_REF>` and `<CRON_SECRET>`, run it in the SQL editor.
Then check one job:
```sql
SELECT pss_run_cron_job('cron_integrity_report');
SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 3;  -- expect 200
```

## 6. Website
Merge the branch into `main` (pull request on GitHub). Cloudflare Pages rebuilds both sites.
Smoke test: log in, open the Dashboard, check one student in and out, record a small payment.

## 7. After the first clean night
- Owner/admin Dashboard: no "Nightly data check" warning, or only real findings.
- Then switch the app's own reminder loop off:
  ```sql
  INSERT INTO app_settings (key, value) VALUES ('pssai_cron', 'on')
    ON CONFLICT (key) DO UPDATE SET value = 'on', updated_at = now();
  ```

## Also
- Seeded accounts: if `owner`/`staff` still use their first passwords, change them now (the README no longer shows them).
- Event log retention (your decision): `SELECT purge_events(INTERVAL '400 days');` removes older events; nothing deletes automatically.
- Do **not** run `fix_membership_dates` on live data until finding F-3 in the plan is fixed.

## Rolling back
- Website: redeploy the previous Cloudflare Pages build.
- Functions: from a checkout of `main`, run `supabase functions deploy api` (the cron function can stay; without its schedules it does nothing). Roll the website back first.
- Database: the migrations only add things and can stay. To stop the scheduled jobs: `SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'pss_%';`

# Part 2 — switching Phase 1 on

Only after the Phase 0 checks above have passed for a few days (Phase 0 exit gate). The Phase 1
tables and code are already live from the deploy above; nothing changes for staff until you switch
a feature on.

1. Switches (SQL editor):
   ```sql
   -- the optional "How focused was today?" after a member's checkout
   INSERT INTO app_settings (key, value) VALUES ('pssai_focus_pulse', 'on')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   -- the owner's Flags page (after the first ML publish)
   INSERT INTO app_settings (key, value) VALUES ('pssai_anomaly', 'on')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   -- optional: the amount above which a discount or cashback asks for a second confirm (default 1000)
   INSERT INTO app_settings (key, value) VALUES ('pssai_discount_confirm_over', '1000')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```
   Staff see a switch after their next page reload. To switch off, set the value to `off`.
2. Models, on your computer, once a week: see `ml/README.md` (`uv sync`, copy `ml/env.example` to
   `ml/.env` with the service-role key, `uv run pss-ml export`, `uv run pss-ml run`, read the reports,
   then `uv run pss-ml run --publish`). Approve or rename the cluster labels before using them.
3. Owner analyst (P1.8) — needs the `AI_API_KEY` secret (step 3) and the `agent` function (step 4):
   ```sql
   -- monthly AI spend cap in US dollars (default 10 when this row is missing)
   INSERT INTO app_settings (key, value) VALUES ('pssai_ai_budget_usd', '10')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   INSERT INTO app_settings (key, value) VALUES ('pssai_analyst', 'on')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```
   Then run the evaluation in `tests/agents/analyst-eval.md` (20 questions, well under $1). The
   07:00 brief starts the next morning (schedule `pss_owner_brief` in `docs/ops/cron.sql`) and shows
   on the Dashboard. Spend so far: `SELECT sum(cost_usd) FROM agent_runs WHERE started_at >= date_trunc('month', now());`
4. Phase 1 exit gate (owner): the churn report beats the 7-day reminder on your data; two weeks of
   flags reviewed with an acceptable false-alarm rate; the owner analyst passes its evaluation (18/20).

# Part 3 — switching Phase 2 on (student portal, UPI payments, agents)

Only after Phase 1's checks. Everything below is off until you switch it on; switch on in this
order and live with each step for a few days. Every switch is an `app_settings` row (SQL editor):

```sql
INSERT INTO app_settings (key, value) VALUES ('<key>', '<value>')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

1. **Business details** (shown on the portal's Privacy page, C5): `business_legal_name`,
   `grievance_contact_name`, `grievance_contact_phone`, `grievance_contact_email`.
2. **Student portal** — `pssai_portal` = `on`. Staff then see "🔐 Portal setup code" on each
   student's profile: it makes a 6-digit code (24 hours, once) and sends it on WhatsApp. The
   student opens `https://join.perfectstudyspace.in/me/setup`, enters phone + code + a PIN. Start
   with a few students at the pilot branch (Hopes, A5). A forgotten PIN: send a new code (D6).
   Owner staff also get an **Approvals** link; every member of staff gets **Chat replies**.
3. **UPI payments** — `upi_vpa` = your UPI ID (e.g. `perfectstudyspace@okaxis`), `upi_payee_name`
   = the name on it, then `pssai_upi_pay` = `on`. Students pay in the portal; you confirm each one on
   **Approvals** after checking your bank app (D2: within 2 hours, 08:00–22:00). Optional:
   `pssai_proof_reading` = `on` lets the AI read screenshots (Claude Sonnet 5.5; needs
   `AI_API_KEY`); it never confirms anything.
4. **Holds** — nothing to switch: with the portal on, students can hold a temporary plan for up to
   7 days once a month; longer holds and permanent seats come to Approvals. Schedule
   `pss_resume_holds` (in `docs/ops/cron.sql`) ends planned holds.
5. **Chat assistant (A1)** — `pssai_concierge` = `on`. It starts in **shadow mode**: every reply is
   a draft on Chat replies that staff send, edit or discard. After at least two weeks, run
   `tests/agents/concierge-eval.md` (pass bar 18/20, C4); only then set `pssai_agent_shadow` =
   `off` to let replies go straight to students. Setting it back to anything else returns to
   shadow mode at once.
6. **Reminders (A4)** — `pssai_collections` = `on` (schedule `pss_collections`, 08:00 IST). Each
   morning **Send list** shows who to remind, why, and a drafted WhatsApp message. Works without AI.
7. **Sign-up payment (A3)** — `pssai_auto_approve` = `on` (needs `pssai_upi_pay`). New students can
   choose a plan, a PIN and pay on the sign-up page; you confirm on Approvals and the registration
   completes itself. The desk's Approve/Register still works as before.
8. **Optional** — `pssai_session_reminders` (portal notice 10 minutes before a session ends),
   `pssai_waitlist_offers` (free permanent seats offered for 24 hours, C2), `pssai_ai_messages`
   ("✨ AI draft" on the welcome and study-report messages), `pssai_realtime` (live updates instead
   of fast polling; needs the new CSP in `public/_headers`, already in this deploy).

Limits you may change (defaults in brackets): `pssai_public_ai_daily` — AI reads that students and
sign-ups can start each day, ID photos and payment screenshots together (40); `proof_image_keep_days`
— how long payment screenshots are kept after the payment, at least 30 (180).

Schedules: re-run `docs/ops/cron.sql` (it is safe to run again) to add `pss_resume_holds`,
`pss_session_reminders`, `pss_waitlist_offers`, `pss_collections` and `pss_purge_images`.

Phase 2 exit gate (you): most renewals at Hopes paid in the portal and confirmed within 2 hours;
two weeks of shadow-mode chat passing 18/20; no T3 action ran without your approval
(`SELECT action, actor_type FROM events WHERE tier = 'T3' AND actor_type IN ('agent','student')`
must be empty); the portal isolation test passes (`npm run test:integration` against a local copy).

Rollback: set the switch back to `off`. Payments already confirmed stay recorded as normal UPI
transactions.

# Part 4 — switching Phase 3 on (growth tools)

Only after Phase 2 has run for a while. Each switch is an `app_settings` row (same SQL as Part 3);
switch one on, watch it for a few days, then the next. Pilot branch: Hopes; compare with Ram Nagar
(A5). Re-run `docs/ops/cron.sql` to add the Phase 3 schedules (they do nothing while switched off).

1. **Walk-in prices (I3)** — optional limits first: `yield_floor_pct` (e.g. `-10`) and
   `yield_ceiling_pct` (e.g. `15`); never beyond ±20% (C8). Then `pssai_yield_pricing` = `on`. Each
   night (00:05) the day's change is set per branch; see and override it on **Growth → Walk-in
   prices**. The walk-in screen always shows the price that will be charged.
2. **Release my hours (SP10)** — `pssai_hour_release` = `on` (needs the portal). Members with their
   own cabin release hours in the portal; the walk-in screen offers those cabins; the member gets
   50% of the walk-in price as credit on their next renewal (D7).
3. **Predicted free hours (O1)** — `pssai_overbooking` = `on` after a few weeks of check-in history.
   Hours a member almost never uses are offered with a 20% safety margin (C7); if they come anyway
   they get another desk, or one free day as credit. Watch **Growth → Seat resales** ("member
   arrived anyway") — it should stay rare.
4. **Lead tools** — run `tests/agents/dedupe-eval.md` (18/20), then `pssai_lead_tools` = `on`:
   nightly lead scores and AI duplicate suggestions on the Enquiries page. AI follow-up drafts use the Phase 2 switch `pssai_ai_messages`.
5. **Enquiry chat (A2)** — write `enquiry_facts` first (hours, AC, Wi-Fi, address, anything you want
   it to say), then `pssai_enquiry_chat` = `on` and link `https://join.perfectstudyspace.in/ask`
   from the website. Shadow mode first: replies are drafts in the enquiry drawer. Run
   `tests/agents/enquiry-eval.md` (18/20) before `pssai_agent_shadow` = `off`. Limits: at most 3
   new chats an hour from one place, and `pssai_enquiry_ai_daily` AI replies a day (150); past it
   messages are kept and the team replies. After deploying, send two chats from two phones on
   different networks and check `enquiry_chat_messages.ip_hash` differs between them — if every
   row has the same value, the platform is not passing the visitor's address and the per-place
   limit applies to everyone together (tell the developer).
6. **Referral links** — `pssai_referral_links` = `on`; make one link per place on **Growth →
   Referral links** (print the flex-banner one as a QR). For students' own links also switch on
   `pssai_portal_r2`; set `referral_reward_amount` (e.g. `100`) if a friend joining should earn a
   reward — each one waits in Approvals for you.
7. **Exam radar (I25)** — check each page in `exam_sources` (or the defaults in
   `supabase/functions/_shared/exams.ts`) opens in a browser and lists notifications; then
   `pssai_exam_radar` = `on`. Suggestions wait on **Growth → Exam calendar**; add an exam by hand
   when a page can't be read. Edit `exam_ladder` if your students' exam paths differ (C11). Run
   `tests/agents/exam-radar-eval.md` (18/20) first.
8. **Next-exam plans (O9) and win-back (I26)** — `pssai_next_exam` = `on`, `pssai_winback` = `on`
   (optional `winback_discount_pct`, at most 10, C12; not set means 10). Both add rows to the
   **Send list**. Run `tests/agents/winback-eval.md` (18/20) before win-back.
9. **Pay-later advice (O3)** and **exception desk (A7)** — `pssai_paylater_advice` = `on` (advice
   under Partial / Pay Later), `pssai_exception_desk` = `on` (AI suggestions on Approvals; run
   `tests/agents/exception-desk-eval.md` first). Both only advise; you decide.
10. **Portal release 2** — `pssai_portal_r2` = `on`: waitlist, referral and cashbacks pages.

Phase 3 exit gate (you): a month at Hopes against Ram Nagar shows more revenue; every "member arrived
anyway" was handled (another desk or a free day) with no complaint; no hour was sold twice
(`SELECT release_id, count(*) FROM seat_resales GROUP BY 1 HAVING count(*) > 1` is empty).

Rollback: set the switch back to `off`. Credits already given stay as pending cashbacks (like any
cashback, they are paid out if the membership is closed — your decision, review item 19); prices
return to fee_config at once. Hours already sold stay sold and a member arriving is still seated
elsewhere; open releases are withdrawn within the hour.

# Part 5 — switching Phase 4 on (self check-in pilot at Hopes)

Only after Phases 2–3 have run for a while. Deploy order as always: migrations `068` and `069` →
`supabase functions deploy api cron` → the website (the new `_headers` and `vercel.json` allow the
browser's location for the site itself). Re-run `docs/ops/cron.sql` to add `pss_close_sessions`
(23:30 IST) and `pss_supplier_drafts` (21:00 IST); both do nothing while switched off. Keep the desk
staffed for the four weeks of the pilot. Every switch below is an `app_settings` row, as in Part 3.

1. **Set up the poster at Hopes** — **Branches** → Hopes → *Self check-in*: stand inside the hall,
   press "Use this device's location" (or type it from a map), **Save location**, then **Make the
   check-in poster** and **Print poster**. Put it where students come in. Ram Nagar stays without
   a poster, so self check-in works at Hopes only. "New poster" makes the old one stop working.
2. **Self check-in and checkout** — `pssai_self_checkin` = `on`. Students scan the poster, read the
   location notice once (D9), and check in within 100 m of the hall. They check out on the portal's
   home page (only at a branch with a poster — elsewhere the desk checks out): overtime is added
   to their next renewal as at the desk; food that would need paying (a Food Pass short, a bill
   over 3 days old) stays as dues (C14). Staff check-in still works. When a cabin member's cabin is
   in use, the desk gets a "Needs the desk" alert.
3. **Session watch** — `pssai_session_watch` = `on`. At 23:30 every session past its booked end is
   closed at that end (or when its break began) with no overtime (C15) and the student is asked to
   check out next time. Sessions booked past 23:30 are left alone. **Flags** lists each one, and
   any staff checkout whose time was changed by hand to more than 10 minutes earlier. The nightly check (Dashboard card) also
   lists staff check-ins at Hopes, so each can be explained (exit gate).
4. **Seat matching** — tag desks on **Branches** (window, power, quiet, AC), then
   `pssai_seat_matching` = `on`. Self check-in seats a member at their favourite or best-matching
   free desk; the desk's check-in and walk-in forms offer the same desk. Students choose under
   More → *Where you like to sit*.
5. **Live seats** — `pssai_live_seats` = `on`: free seats per branch on the portal's home page
   (counts only).
6. **Food ordering** — `pssai_food_orders` = `on`. Students order from the portal while checked in;
   whoever makes the food works **Food orders** (accept, ready, delivered). Delivery bills it as at
   the counter: a student with money on a Food Pass pays from it only (never cash or UPI as well;
   a shortfall is collected at checkout), anyone else on the tab, cash or UPI. A price changed
   since the order is refused — cancel it and the student orders again. Orders still open at 23:30
   are cancelled (nothing is charged).
7. **Stock and supplier orders** — on **Food orders → Stock & suppliers**, link each menu item to
   the stock it uses (and the supplier's phone), then `pssai_food_stock` = `on`. Bills take stock
   off; each night a supplier draft covers 3 days of expected use; press each supplier's WhatsApp
   button, **Mark as sent**, and later mark it received (correcting what actually came).
8. **Report a problem** — `pssai_tickets` = `on`. Reports arrive on **Problems**, urgent first
   (fire, smoke, leaks, theft…); an urgent one also pops up as "Needs the desk". Marking one fixed
   tells the student.
9. **Photo-proof cleaning** — `pssai_photo_tasks` = `on`, then on **Actions** press *Ask for
   photos on existing daily cleaning tasks* (tasks made before the switch don't ask otherwise).
   Daily cleaning tasks need a photo before they can be ticked (C17), a missed day needs that day's
   photo; the owner opens it from the task and can turn the photo on or off per task. Photos are
   removed after `task_photo_keep_days` (30).

Phase 4 exit gate (you): four weeks at Hopes with staff present but not needed; every open session
closed by the end of the day (`SELECT count(*) FROM bookings WHERE status = 'active' AND start_time
< now() - interval '1 day'` stays 0); every staff check-in at Hopes explained; every member at
Hopes checked in through the portal.

Rollback: set the switch back to `off`. Sessions already closed stay closed; food left as dues stays
on the student's tab and is settled at the desk or at closure as before.

# Part 6 — switching Phase 5 on (the self-improving system)

Deploy order as always: migrations `070` and `071` → `supabase functions deploy api cron` → the
website. Re-run `docs/ops/cron.sql` to add `pss_policy_rules` (Sundays 02:20 IST),
`pss_apply_rules` (every 15 minutes), `pss_experiments` (Mondays 02:40 IST) and
`pss_buddy_matches` (Mondays 08:30 IST); each does nothing while its switch is off. Nothing here
changes a price or a rule by itself: the owner signs, keeps or changes each one.

1. **Rules from your own decisions (I8)** — `pssai_policy_learner` = `on`. Each Sunday your decided
   approvals of the last 180 days are grouped; a group of 6 or more decided the same way 9 times in
   10 becomes a proposal on **Learning → Rules**, in words. Sign, dismiss (never proposed again) or
   later retire. Hold rules tell apart plans with and without dues. A signed rule shows on matching
   **Approvals** cards ("Matches your rule"). Only a signed *approve* rule for student **hold**
   requests decides by itself (every 15 minutes, through the same steps as your Approve, the rule
   named as the reason), and at most once per student in 30 days — a second hold waits for you;
   refunds, plan changes, cashbacks and every T3 action always wait for you.
2. **What if (I6)** — `pssai_digital_twin` = `on`. **Learning → What if** tries a different renewal
   grace, overtime grace or self-hold limit on the last 180 days. It changes nothing.
3. **Experiments (O6, C20)** — `pssai_experiments` = `on`. **Learning → Experiments**: a win-back
   offer (two discounts, each at most 10%), a next-exam plan length (1, 2, 3 or 6 months) or the
   featured menu item at one branch. Each student always sees the same variant. A winner is named
   only with 20 students per variant and p < 0.1. **Keep** sets the real setting
   (`winback_discount_pct`, `next_exam_months` or the branch's featured item); **Drop** changes nothing.
4. **Space use (O7)** — `pssai_space_yield` = `on`. **Learning → Space use** (choose a branch):
   open-seat use by weekday and hour over 8 weeks, cabin use, and suggestions.
5. **Portal pages (SP18–SP20)** — `pssai_portal_r4` = `on`: under More, *Exam coach*, *When you
   focus best* (needs 5 focus ratings) and *Your month (Wrapped)*.
6. **Study buddy (SP21)** — `pssai_study_buddy` = `on`. Members opt in with their study window;
   on Mondays members of the same branch, exam and window are paired; first names show only after
   both say yes, never phone numbers.
7. **Retiring the desk-staff screens (S1, C18)** — last, and only when **Staff → "Desk-staff
   screens: use in the last 30 days"** has said *Unused for a month* (opening the Staff page
   yourself doesn't count). First set every remaining staff account's **Duty** to kitchen or
   housekeeping, or deactivate it: the card lists the desk accounts, and **desk-duty accounts can no
   longer sign in once this is on**. Then `pssai_retire_staff_ops` = `on`: attendance is no longer
   marked, End Session and its lock-out go,
   the attendance list, branch-cover board and staff Messages are hidden (system notices still pop
   up), and new staff accounts are kitchen or housekeeping only (set each account's **Duty** on
   **Staff**). Tasks on **Actions** stay. The tables are only marked (migration 070); dropping them
   is a later migration after the data is archived.

Phase 5 exit gate (you): the small model handles most chats at the large model's accuracy on the
test sets (or I7 skipped); staff modules unused for a full month before step 7; monthly active
portal users meet the target set with you.

Rollback: set the switch back to `off`. A signed rule stops applying when its switch is off or the
rule is retired; a kept experiment's setting stays (change it back by hand); retiring the staff
screens is undone by switching it off (attendance is marked again from the next request).

# Part 7 — switching Phase 6 on (certificates, family summary, every branch)

Deploy order: migration `072` → set the `CERTIFICATE_SECRET` secret (section 3) →
`supabase functions deploy api cron` → the website. Re-run `docs/ops/cron.sql` to add
`pss_parent_digest` (Sundays 19:00 IST).

1. **Study certificates (I33, C21)** — `pssai_certificates` = `on`. Under More → *Study
   certificates* a student picks dates (up to 12 months, at most 5 a month) and gets a certificate
   of their completed study hours, signed with `CERTIFICATE_SECRET`, printable with a QR code.
   Anyone can check it at `join.perfectstudyspace.in/verify/<number>`: the hall, the name, the
   hours and dates, and whether it checks. The student can withdraw one.
2. **Weekly family summary (I34, C22)** — `pssai_parent_digest` = `on`. Under More → *Weekly
   summary for your family* a student makes a link (shown once; only its hash is kept) and shares
   it. Every Sunday at 19:00 the week is frozen: hours per day, days attended, average focus and
   when the plan ends — no amounts, phone numbers or messages. A new link stops the old one; the
   student can stop it any time.
3. **Every branch on one page (O10)** — `pssai_owner_overview` = `on`: **Every branch** shows each
   branch's check-ins, free seats, today's and this month's collections, dues, plans ending, open
   approvals, problems and food orders, with totals.

Phase 6 exit gate (you): review how many students use certificates and family links, and keep what
is used.

Rollback: set the switch back to `off`. With certificates off the check page answers "not found";
with the family summary off the links show nothing (they work again when switched back on unless
the student stopped them).

# Stuck desks

The nightly check (Dashboard card) lists `desks_occupied_without_session`: a floating desk marked
occupied with nobody checked in (a save that failed half-way, or older data). Checkout can't free it,
so free it in Supabase → SQL editor, after checking nobody is sitting there:

```sql
UPDATE desks SET status = 'free', current_booking_id = NULL
WHERE id = '<desk_id from the report>' AND seat_type = 'floating' AND status = 'occupied';
```

