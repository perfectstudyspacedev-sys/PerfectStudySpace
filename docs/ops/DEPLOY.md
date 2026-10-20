# Deploying PSS-AI (Phases 0 and 1)

Branch `pss-ai/all-phases` — every phase is built on it. One deploy brings in Phase 0 and Phase 1
together; every Phase 1 feature stays switched off until you turn it on (part 2 below).
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

## 2. Database: migrations 052 to 057
Either `supabase db push` (asks before applying), or paste each file into the SQL editor in order:
`052_event_log.sql`, `053_actor_audit.sql`, `054_idempotency_keys.sql`, `055_focus_pulse.sql`,
`056_model_outputs.sql`, `057_agent_runs.sql`. All are additions only; 055–057 are Phase 1 tables
that nothing uses until you switch Phase 1 features on.

## 3. Secrets and extensions
- Database → Extensions: turn on **pg_cron** and **pg_net**.
- Edge Functions → Secrets:
  - `CRON_SECRET` — a long random value (e.g. `openssl rand -hex 32`). Keep a copy for step 5.
  - `ALLOWED_ORIGINS` — optional. Without it the built-in list is used:
    `https://perfect-study-space.pages.dev, https://join.perfectstudyspace.in, https://perfectstudyspace.in, https://www.perfectstudyspace.in, http://localhost:5173`.
    Set it only if the staff site is also opened from another address.
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
