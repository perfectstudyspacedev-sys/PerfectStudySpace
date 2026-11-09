-- PSS-AI schedules for the SELF-HOSTED "pss" stack (copy of docs/ops/cron.sql, adapted).
-- Not a migration. Run once inside pss-db as postgres, AFTER the functions are deployed
-- (deploy/vps-deploy.sh), passing the CRON_SECRET from ~/projects/pss/backend/functions.env as a
-- psql variable so it is never written into this file or a shell history:
--
--   read -rs CRON_SECRET    # paste the same value as CRON_SECRET in functions.env
--   docker exec -i pss-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v cron_secret="$CRON_SECRET" < docs/ops/cron-selfhosted.sql
--   unset CRON_SECRET
--
-- Differences from cron.sql:
--   * URL: the stack's internal gateway http://kong:8000, reached from pss-db over the stack's own
--     Docker network, so scheduled calls never leave the server.
--   * The secret comes from the psql variable cron_secret, not from a placeholder edited in here.
--   * EVERY job is created PAUSED (active = false) in the same transaction that creates it, so no
--     job can run before you decide. Re-running this file pauses every pss_ job again.
--   * Everything runs in ONE transaction: on any error nothing is kept.
--
-- pg_cron runs in UTC. IST = UTC + 5:30. Same 27 jobs, schedules and commands as cron.sql.

\if :{?cron_secret}
\else
  \echo 'Missing -v cron_secret=... (the CRON_SECRET from functions.env). Nothing was changed.'
  SELECT 1/0 AS cron_secret_missing;
\endif

BEGIN;

-- ── 0. Extensions (present in the supabase/postgres image; enabled in this database) ──
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ── 1. Secrets (Vault) ──
-- A short secret is refused (division by zero stops the file; nothing is kept).
SELECT 1/(length(:'cron_secret') >= 16)::int AS cron_secret_long_enough;

SELECT vault.update_secret(id, 'http://kong:8000') FROM vault.secrets WHERE name = 'pss_project_url';
SELECT vault.create_secret('http://kong:8000', 'pss_project_url')
  WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pss_project_url');
SELECT vault.update_secret(id, :'cron_secret') FROM vault.secrets WHERE name = 'pss_cron_secret';
SELECT vault.create_secret(:'cron_secret', 'pss_cron_secret')
  WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pss_cron_secret');

-- ── 2. Helpers that post a job name to the cron / agent function (same as cron.sql) ──
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
REVOKE ALL ON FUNCTION pss_run_cron_job(TEXT) FROM PUBLIC, anon, authenticated;

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

-- ── 3. Schedules: created, then paused at once (same transaction) ──
DO $$
DECLARE
  r record;
  id bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('pss_expiry_alerts',     '30 0 * * *',         'pss_run_cron_job',  'cron_expiry_alerts'),
    ('pss_purge_signups',     '35 18 * * *',        'pss_run_cron_job',  'cron_purge_signups'),
    ('pss_purge_idempotency', '17 * * * *',         'pss_run_cron_job',  'cron_purge_idempotency'),
    ('pss_integrity_report',  '30 20 * * *',        'pss_run_cron_job',  'cron_integrity_report'),
    ('pss_purge_images',      '30 21 * * *',        'pss_run_cron_job',  'cron_purge_images'),
    ('pss_resume_holds',      '25 * * * *',         'pss_run_cron_job',  'cron_resume_holds'),
    ('pss_session_reminders', '*/5 * * * *',        'pss_run_cron_job',  'cron_session_reminders'),
    ('pss_waitlist_offers',   '*/15 * * * *',       'pss_run_cron_job',  'cron_waitlist_offers'),
    ('pss_owner_brief',       '30 1 * * *',         'pss_run_agent_job', 'owner_brief'),
    ('pss_collections',       '30 2 * * *',         'pss_run_agent_job', 'collections'),
    ('pss_yield_prices',      '35 18 * * *',        'pss_run_cron_job',  'cron_yield_prices'),
    ('pss_predict_releases',  '35 * * * *',         'pss_run_cron_job',  'cron_predict_releases'),
    ('pss_score_enquiries',   '45 20 * * *',        'pss_run_cron_job',  'cron_score_enquiries'),
    ('pss_referrals',         '0 21 * * *',         'pss_run_cron_job',  'cron_referral_conversions'),
    ('pss_paylater_scores',   '15 21 * * *',        'pss_run_cron_job',  'cron_paylater_scores'),
    ('pss_next_exam',         '40 2 * * *',         'pss_run_cron_job',  'cron_next_exam'),
    ('pss_enquiry_dedupe',    '0 22 * * *',         'pss_run_agent_job', 'enquiry_dedupe'),
    ('pss_exam_radar',        '0 1 * * *',          'pss_run_agent_job', 'exam_radar'),
    ('pss_winback',           '30 3 * * 1',         'pss_run_agent_job', 'winback'),
    ('pss_exception_desk',    '*/30 * * * *',       'pss_run_agent_job', 'exception_desk'),
    ('pss_close_sessions',    '0 18 * * *',         'pss_run_cron_job',  'cron_close_forgotten_sessions'),
    ('pss_supplier_drafts',   '30 15 * * *',        'pss_run_cron_job',  'cron_supplier_drafts'),
    ('pss_policy_rules',      '50 20 * * 6',        'pss_run_cron_job',  'cron_policy_rules'),
    ('pss_apply_rules',       '7,22,37,52 * * * *', 'pss_run_cron_job',  'cron_apply_policy_rules'),
    ('pss_experiments',       '10 21 * * 0',        'pss_run_cron_job',  'cron_experiments'),
    ('pss_buddy_matches',     '0 3 * * 1',          'pss_run_cron_job',  'cron_buddy_matches'),
    ('pss_parent_digest',     '30 13 * * 0',        'pss_run_cron_job',  'cron_parent_digest')
  ) AS t(jobname, schedule, helper, job)
  LOOP
    id := cron.schedule(r.jobname, r.schedule, format('SELECT %s(%L)', r.helper, r.job));
    PERFORM cron.alter_job(job_id := id, active := false);
  END LOOP;
END $$;

-- ── 4. Check (before the commit): 27 jobs, none active ──
SELECT count(*) AS pss_jobs, count(*) FILTER (WHERE active) AS active_jobs
  FROM cron.job WHERE jobname LIKE 'pss\_%';

COMMIT;

-- Activating a job later is a separate decision (yours), one job at a time:
--   SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'pss_integrity_report'), active := true);
-- Removing everything:
--   SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'pss\_%';
