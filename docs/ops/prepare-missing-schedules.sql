-- PERFECT STUDY SPACE: install missing scheduler prerequisites and PAUSED schedules.
-- Confirmed project: zripsszkprhtyccukrir; run all as postgres in Supabase SQL Editor.
-- Reads the existing Vault project URL and cron secret; no placeholders or new secrets.
-- Creates only missing schedules. Every NEW job is PAUSED before transaction commit.
-- Existing schedules/settings/credentials/buckets/business records are preserved.
-- Does not call api/agent/cron, make HTTP requests, send messages or consume AI credits.
-- Activation follows function/secret validation and a deliberate per-feature test.

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('pss:prepare-missing-schedules'));

-- Supabase manages cron privileges. Avoid re-running extension setup when it is
-- already installed, and do not grant broad access to Supabase-managed tables.
DO $extension$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog';
  END IF;
END;
$extension$;

CREATE TEMP TABLE pss_schedule_setup_report (
  job_name text, outcome text, schedule_utc text, active boolean
) ON COMMIT DROP;

DO $setup$
DECLARE r record; existing_count bigint; valid_count bigint; job_id bigint; current_active boolean; current_schedule text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Vault is unavailable. No schedules were installed.';
  END IF;
  SELECT count(*) INTO valid_count FROM vault.decrypted_secrets
    WHERE name='pss_project_url' AND rtrim(decrypted_secret,'/')='https://zripsszkprhtyccukrir.supabase.co';
  IF valid_count<>1 OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='pss_project_url')<>1 THEN
    RAISE EXCEPTION 'Vault project URL must uniquely match zripsszkprhtyccukrir. No schedules were installed.';
  END IF;
  SELECT count(*) INTO valid_count FROM vault.decrypted_secrets
    WHERE name='pss_cron_secret' AND nullif(btrim(decrypted_secret),'') IS NOT NULL
      AND decrypted_secret NOT LIKE '%<%' AND decrypted_secret NOT LIKE '%YOUR_%';
  IF valid_count<>1 OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='pss_cron_secret')<>1 THEN
    RAISE EXCEPTION 'A unique, non-placeholder Vault cron secret is required. No schedules were installed.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE EXCEPTION 'pg_net is missing. Enable it first. No schedules were installed.';
  END IF;
  IF to_regprocedure('public.pss_run_cron_job(text)') IS NULL
     OR to_regprocedure('public.pss_run_agent_job(text)') IS NULL THEN
    RAISE EXCEPTION 'Existing job helpers are missing. Install the Vault-based job helpers first.';
  END IF;

  FOR r IN SELECT * FROM (VALUES
    ('pss_expiry_alerts', '30 0 * * *', 'pss_run_cron_job', 'cron_expiry_alerts'),
    ('pss_purge_signups', '35 18 * * *', 'pss_run_cron_job', 'cron_purge_signups'),
    ('pss_purge_idempotency', '17 * * * *', 'pss_run_cron_job', 'cron_purge_idempotency'),
    ('pss_integrity_report', '30 20 * * *', 'pss_run_cron_job', 'cron_integrity_report'),
    ('pss_purge_images', '30 21 * * *', 'pss_run_cron_job', 'cron_purge_images'),
    ('pss_resume_holds', '25 * * * *', 'pss_run_cron_job', 'cron_resume_holds'),
    ('pss_session_reminders', '*/5 * * * *', 'pss_run_cron_job', 'cron_session_reminders'),
    ('pss_waitlist_offers', '*/15 * * * *', 'pss_run_cron_job', 'cron_waitlist_offers'),
    ('pss_owner_brief', '30 1 * * *', 'pss_run_agent_job', 'owner_brief'),
    ('pss_collections', '30 2 * * *', 'pss_run_agent_job', 'collections'),
    ('pss_yield_prices', '35 18 * * *', 'pss_run_cron_job', 'cron_yield_prices'),
    ('pss_predict_releases', '35 * * * *', 'pss_run_cron_job', 'cron_predict_releases'),
    ('pss_score_enquiries', '45 20 * * *', 'pss_run_cron_job', 'cron_score_enquiries'),
    ('pss_referrals', '0 21 * * *', 'pss_run_cron_job', 'cron_referral_conversions'),
    ('pss_paylater_scores', '15 21 * * *', 'pss_run_cron_job', 'cron_paylater_scores'),
    ('pss_next_exam', '40 2 * * *', 'pss_run_cron_job', 'cron_next_exam'),
    ('pss_enquiry_dedupe', '0 22 * * *', 'pss_run_agent_job', 'enquiry_dedupe'),
    ('pss_exam_radar', '0 1 * * *', 'pss_run_agent_job', 'exam_radar'),
    ('pss_winback', '30 3 * * 1', 'pss_run_agent_job', 'winback'),
    ('pss_exception_desk', '*/30 * * * *', 'pss_run_agent_job', 'exception_desk'),
    ('pss_close_sessions', '0 18 * * *', 'pss_run_cron_job', 'cron_close_forgotten_sessions'),
    ('pss_supplier_drafts', '30 15 * * *', 'pss_run_cron_job', 'cron_supplier_drafts'),
    ('pss_policy_rules', '50 20 * * 6', 'pss_run_cron_job', 'cron_policy_rules'),
    ('pss_apply_rules', '7,22,37,52 * * * *', 'pss_run_cron_job', 'cron_apply_policy_rules'),
    ('pss_experiments', '10 21 * * 0', 'pss_run_cron_job', 'cron_experiments'),
    ('pss_buddy_matches', '0 3 * * 1', 'pss_run_cron_job', 'cron_buddy_matches'),
    ('pss_parent_digest', '30 13 * * 0', 'pss_run_cron_job', 'cron_parent_digest')
  ) AS expected(job_name,cadence,helper,action_name) LOOP
    SELECT count(*) INTO existing_count FROM cron.job WHERE jobname=r.job_name;
    IF existing_count>1 THEN
      RAISE EXCEPTION 'Duplicate schedule name %. Review duplicates before running this file.',r.job_name;
    ELSIF existing_count=1 THEN
      SELECT active,schedule INTO current_active,current_schedule FROM cron.job WHERE jobname=r.job_name;
      INSERT INTO pss_schedule_setup_report VALUES (r.job_name,'EXISTING_PRESERVED',current_schedule,current_active);
    ELSE
      job_id:=cron.schedule(r.job_name,r.cadence,format('SELECT public.%I(%L);',r.helper,r.action_name));
      PERFORM cron.alter_job(job_id,active:=false);
      INSERT INTO pss_schedule_setup_report VALUES (r.job_name,'CREATED_PAUSED',r.cadence,false);
    END IF;
  END LOOP;
END;
$setup$;

SELECT job_name,outcome,schedule_utc,active
FROM pss_schedule_setup_report ORDER BY job_name;
COMMIT;

-- EXPECTED for this report's initially missing pg_cron: 27 CREATED_PAUSED rows, active=false.
-- Re-run full-system-diagnostic.sql: pg_cron should pass; the 27 schedules should say OFF.
-- OFF here is deliberate preparation, not proof that automation is working.
-- Next: verify matching deployed api/agent/cron and backend CRON_SECRET; test jobs individually.
-- Do not blanket-activate all jobs just to make the diagnostic green.
