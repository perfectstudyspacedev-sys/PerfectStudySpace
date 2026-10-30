-- Perfect Study Space: one-time AI testing setup.
-- Run as postgres in Supabase SQL Editor for project zripsszkprhtyccukrir.
-- Does not install business-schema migrations or create scheduled jobs.
-- After running, copy the returned CRON_SECRET into Edge Functions -> Secrets.

BEGIN;

DO $$
DECLARE
  missing_tables TEXT;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name)
    INTO missing_tables
  FROM (VALUES
    ('app_settings'), ('events'), ('agent_runs'), ('owner_briefs'),
    ('staff'), ('branches')
  ) AS required(name)
  WHERE to_regclass('public.' || name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION
      'Apply the project migrations first. Missing tables: %',
      missing_tables;
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault must be available before this setup.';
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  target_url TEXT := 'https://zripsszkprhtyccukrir.supabase.co';
  secret_id UUID;
  secret_value TEXT;
BEGIN
  SELECT id INTO secret_id
  FROM vault.secrets
  WHERE name = 'pss_project_url';

  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(target_url, 'pss_project_url');
  ELSE
    PERFORM vault.update_secret(secret_id, target_url);
  END IF;

  SELECT id, decrypted_secret INTO secret_id, secret_value
  FROM vault.decrypted_secrets
  WHERE name = 'pss_cron_secret';

  IF secret_id IS NULL
     OR secret_value IS NULL
     OR btrim(secret_value) = ''
     OR secret_value = 'YOUR_CRON_SECRET'
     OR secret_value = '<CRON_SECRET>' THEN

    secret_value :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');

    IF secret_id IS NULL THEN
      PERFORM vault.create_secret(secret_value, 'pss_cron_secret');
    ELSE
      PERFORM vault.update_secret(secret_id, secret_value);
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pss_run_agent_job(job TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'pss_project_url'
    ) || '/functions/v1/agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'pss_cron_secret'
      )
    ),
    body := jsonb_build_object('job', job),
    timeout_milliseconds := 150000
  );
$$;

CREATE OR REPLACE FUNCTION public.pss_run_cron_job(job TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'pss_project_url'
    ) || '/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'pss_cron_secret'
      )
    ),
    body := jsonb_build_object('job', job),
    timeout_milliseconds := 120000
  );
$$;

REVOKE ALL ON FUNCTION public.pss_run_agent_job(TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.pss_run_cron_job(TEXT)
FROM PUBLIC, anon, authenticated;

-- Enable the owner analyst and keep chat review on.
INSERT INTO public.app_settings (key, value)
VALUES
  ('pssai_analyst', 'on'),
  ('pssai_agent_shadow', 'on')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();

-- Preserve existing valid numeric settings.
-- Repair missing/invalid values left by the blanket all-off statement.
INSERT INTO public.app_settings AS settings (key, value)
VALUES
  ('pssai_ai_budget_usd', '10'),
  ('pssai_public_ai_daily', '40'),
  ('pssai_enquiry_ai_daily', '150'),
  ('pssai_discount_confirm_over', '1000')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now()
WHERE CASE
  WHEN btrim(settings.value) ~ '^[0-9]+([.][0-9]+)?$'
    THEN CASE
      WHEN settings.key = 'pssai_discount_confirm_over'
        THEN settings.value::numeric <= 0
      ELSE FALSE
    END
  ELSE TRUE
END;

COMMIT;

-- Copy this result into Edge Functions -> Secrets under name CRON_SECRET.
-- Do not post the value in chat or commit it to a file.
SELECT decrypted_secret AS cron_secret_for_edge_functions
FROM vault.decrypted_secrets
WHERE name = 'pss_cron_secret';

-- STOP HERE.
-- Complete Edge Function secret/deployment setup before the following tests.
--
-- RUN SEPARATELY:
-- SELECT public.pss_run_agent_job('owner_brief') AS request_id;
--
-- WAIT A FEW SECONDS, THEN RUN SEPARATELY:
-- SELECT id, created, status_code, content, error_msg
-- FROM net._http_response
-- ORDER BY created DESC, id DESC
-- LIMIT 10;
--
-- CHECK ACTUAL AI USAGE:
-- SELECT started_at, agent, model, status, model_calls,
--        tokens_in, tokens_out, cost_usd, error
-- FROM public.agent_runs
-- ORDER BY started_at DESC
-- LIMIT 10;
