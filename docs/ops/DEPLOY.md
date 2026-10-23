# Deploying PSS-AI

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
- Database → Extensions: turn on **pg_cron** and **pg_net**.
- Edge Functions → Secrets:
  - `CRON_SECRET` — a long random value (e.g. `openssl rand -hex 32`). Keep a copy for step 5.
  - `ALLOWED_ORIGINS` — optional. Without it the built-in list is used:
    `https://perfect-study-space.pages.dev, https://join.perfectstudyspace.in, https://perfectstudyspace.in, https://www.perfectstudyspace.in, http://localhost:5173`.
    Set it only if the staff site is also opened from another address.
  - `STUDENT_JWT_SECRET` — another long random value (like `CRON_SECRET`, but different). It signs
    student portal logins. Without it students are logged out whenever the function restarts.
  - `AI_API_KEY` — your Claude API key (from the Claude Console), for the owner analyst. It lives only
    here; never put it in the website's settings or in a chat. Without it the analyst says it is not set
    up and nothing else changes. Optional: `AI_MODEL` (default `claude-haiku-5-5`) and `AI_MODEL_HARD`
    (default `claude-sonnet-5-5`, used for "Deep answer").

## 4. Functions
```bash
supabase functions deploy api
supabase functions deploy cron
supabase functions deploy agent
```

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
4. **Lead tools** — `pssai_lead_tools` = `on`: nightly lead scores and AI duplicate suggestions on
   the Enquiries page. AI follow-up drafts use the Phase 2 switch `pssai_ai_messages`.
5. **Enquiry chat (A2)** — write `enquiry_facts` first (hours, AC, Wi-Fi, address, anything you want
   it to say), then `pssai_enquiry_chat` = `on` and link `https://join.perfectstudyspace.in/ask`
   from the website. Shadow mode first: replies are drafts in the enquiry drawer. Run
   `tests/agents/enquiry-eval.md` (18/20) before `pssai_agent_shadow` = `off`.
6. **Referral links** — `pssai_referral_links` = `on`; make one link per place on **Growth →
   Referral links** (print the flex-banner one as a QR). For students' own links also switch on
   `pssai_portal_r2`; set `referral_reward_amount` (e.g. `100`) if a friend joining should earn a
   reward — each one waits in Approvals for you.
7. **Exam radar (I25)** — check each page in `exam_sources` (or the defaults in
   `supabase/functions/_shared/exams.ts`) opens in a browser and lists notifications; then
   `pssai_exam_radar` = `on`. Suggestions wait on **Growth → Exam calendar**; add an exam by hand
   when a page can't be read. Edit `exam_ladder` if your students' exam paths differ (C11).
8. **Next-exam plans (O9) and win-back (I26)** — `pssai_next_exam` = `on`, `pssai_winback` = `on`
   (optional `winback_discount_pct`, at most 10, C12). Both add rows to the **Send list**.
9. **Pay-later advice (O3)** and **exception desk (A7)** — `pssai_paylater_advice` = `on` (advice
   under Partial / Pay Later), `pssai_exception_desk` = `on` (AI suggestions on Approvals; run
   `tests/agents/exception-desk-eval.md` first). Both only advise; you decide.
10. **Portal release 2** — `pssai_portal_r2` = `on`: waitlist, referral and cashbacks pages.

Phase 3 exit gate (you): a month at Hopes against Ram Nagar shows more revenue; every "member arrived
anyway" was handled (another desk or a free day) with no complaint; no hour was sold twice
(`SELECT release_id, count(*) FROM seat_resales GROUP BY 1 HAVING count(*) > 1` is empty).

Rollback: set the switch back to `off`. Credits already given stay as pending cashbacks; prices
return to fee_config at once.
