# Deploying PSS-AI Phase 0

Branch `pss-ai/p0-foundation`. Order matters (plan rule R10): **database → functions → website**.
The website must never go live before the functions — the new payment, checkout and renewal
forms send a header that only the new `api` function accepts.

Before you start, on your computer in the repo: `git checkout pss-ai/p0-foundation && npm ci && npm run predeploy`.
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

## 2. Database: migrations 052, 053, 054
Either `supabase db push` (asks before applying), or paste each file into the SQL editor in order:
`052_event_log.sql`, `053_actor_audit.sql`, `054_idempotency_keys.sql`. All three are additions only.

## 3. Secrets and extensions
- Database → Extensions: turn on **pg_cron** and **pg_net**.
- Edge Functions → Secrets:
  - `CRON_SECRET` — a long random value (e.g. `openssl rand -hex 32`). Keep a copy for step 5.
  - `ALLOWED_ORIGINS` — optional. Without it the built-in list is used:
    `https://perfect-study-space.pages.dev, https://join.perfectstudyspace.in, https://perfectstudyspace.in, https://www.perfectstudyspace.in, http://localhost:5173`.
    Set it only if the staff site is also opened from another address.

## 4. Functions
```bash
supabase functions deploy api
supabase functions deploy cron
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
- Database: the three migrations only add things and can stay. To stop the scheduled jobs: `SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'pss_%';`

# Deploying PSS-AI Phase 1

Branch `pss-ai/p1-data-brain` (it contains Phase 0). Only after Phase 0 is live and its exit gate is
ticked. Every Phase 1 feature starts switched off.

1. `npm run predeploy` on the branch → "✓ predeploy passed".
2. Database: `055_focus_pulse.sql`, `056_model_outputs.sql` (additions only).
3. Functions: `supabase functions deploy api` (the cron function is unchanged).
4. Website: merge into `main`; Cloudflare Pages rebuilds.
5. Nothing changes for staff until you switch features on (SQL editor):
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
6. Models, on your computer, once a week: see `ml/README.md` (`uv sync`, copy `ml/env.example` to
   `ml/.env` with the service-role key, `uv run pss-ml export`, `uv run pss-ml run`, read the reports,
   then `uv run pss-ml run --publish`). Approve or rename the cluster labels before using them.
7. Phase 1 exit gate (owner): the churn report beats the 7-day reminder on your data; two weeks of
   flags reviewed with an acceptable false-alarm rate; the owner analyst (P1.8) passes its evaluation
   — P1.8 waits for decision D3.
