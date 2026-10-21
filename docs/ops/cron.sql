-- PSS-AI P0.7 — schedules for the cron edge function. Run once in the Supabase SQL editor,
-- AFTER `supabase functions deploy cron`. Not a migration: it handles the project secret.
--
-- Before running:
--   1. Database → Extensions: enable pg_cron and pg_net.
--   2. Edge Functions → Secrets: add CRON_SECRET (a long random value, e.g. `openssl rand -hex 32`).
--   3. Replace the two placeholders below. The values go into Supabase Vault (encrypted), so the
--      schedules themselves never contain the secret.
--
-- pg_cron runs in UTC. IST = UTC + 5:30.
-- Re-running this file is safe: Vault secrets are replaced and cron.schedule() updates a job
-- that already has the same name.

-- ── 1. Secrets (Vault) ──
DO $$
DECLARE
  v_url    TEXT := 'https://<PROJECT_REF>.supabase.co';
  v_secret TEXT := '<CRON_SECRET>';
  sid UUID;
BEGIN
  IF v_url LIKE '%<%' OR v_secret LIKE '%<%' THEN
    RAISE EXCEPTION 'Replace <PROJECT_REF> and <CRON_SECRET> first';
  END IF;
  SELECT id INTO sid FROM vault.secrets WHERE name = 'pss_project_url';
  IF sid IS NULL THEN PERFORM vault.create_secret(v_url, 'pss_project_url');
  ELSE PERFORM vault.update_secret(sid, v_url); END IF;
  SELECT id INTO sid FROM vault.secrets WHERE name = 'pss_cron_secret';
  IF sid IS NULL THEN PERFORM vault.create_secret(v_secret, 'pss_cron_secret');
  ELSE PERFORM vault.update_secret(sid, v_secret); END IF;
END $$;

-- ── 2. One helper that posts a job name to the cron function ──
CREATE OR REPLACE FUNCTION pss_run_cron_job(job TEXT) RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pss_project_url') || '/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pss_cron_secret')
    ),
    body := jsonb_build_object('job', job),
    timeout_milliseconds := 120000
  );
$$;
-- Only the scheduler (running as postgres) needs it; keep it off the public API.
REVOKE ALL ON FUNCTION pss_run_cron_job(TEXT) FROM PUBLIC, anon, authenticated;

-- P1.8: the same, for jobs of the agent function (the AI agents). Same secret.
CREATE OR REPLACE FUNCTION pss_run_agent_job(job TEXT) RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pss_project_url') || '/functions/v1/agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pss_cron_secret')
    ),
    body := jsonb_build_object('job', job),
    timeout_milliseconds := 150000
  );
$$;
REVOKE ALL ON FUNCTION pss_run_agent_job(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 3. Schedules ──
SELECT cron.schedule('pss_expiry_alerts',     '30 0 * * *',  $$SELECT pss_run_cron_job('cron_expiry_alerts')$$);     -- 06:00 IST
SELECT cron.schedule('pss_purge_signups',     '35 18 * * *', $$SELECT pss_run_cron_job('cron_purge_signups')$$);     -- 00:05 IST
SELECT cron.schedule('pss_purge_idempotency', '17 * * * *',  $$SELECT pss_run_cron_job('cron_purge_idempotency')$$); -- hourly
SELECT cron.schedule('pss_integrity_report',  '30 20 * * *', $$SELECT pss_run_cron_job('cron_integrity_report')$$);  -- 02:00 IST
-- P2 (does nothing until a student or the owner starts a hold with a planned end):
SELECT cron.schedule('pss_resume_holds',      '25 * * * *',  $$SELECT pss_run_cron_job('cron_resume_holds')$$);      -- hourly
-- P1.8 (needs `supabase functions deploy agent`; does nothing while pssai_analyst is off):
SELECT cron.schedule('pss_owner_brief',       '30 1 * * *',  $$SELECT pss_run_agent_job('owner_brief')$$);           -- 07:00 IST

-- ── 4. Check ──
-- Run one job now and look at the answer a few seconds later:
--   SELECT pss_run_cron_job('cron_integrity_report');
--   SELECT pss_run_agent_job('owner_brief');   -- answers {"skipped": …} when the analyst is off
--   SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Schedules and their last runs:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'pss_%';
--   SELECT jobid, status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- Each job also writes an events row (action = the job name, actor_type = 'system'):
--   SELECT occurred_at, action, ok, error FROM events WHERE actor_type = 'system' ORDER BY id DESC LIMIT 10;
--
-- After the first clean night, switch the app's own reminder loop off (P0.7):
--   INSERT INTO app_settings (key, value) VALUES ('pssai_cron', 'on')
--     ON CONFLICT (key) DO UPDATE SET value = 'on', updated_at = now();
-- To go back: the same with 'off'.
--
-- To remove everything:
--   SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'pss_%';
