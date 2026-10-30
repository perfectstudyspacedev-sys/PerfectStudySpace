-- AI provider preference: Ollama Cloud -> Gemini -> Claude.
-- Model calls keep the existing run, event, budget and approval rules.
-- Store only bounded routing outcomes, never prompts, response bodies, images or API keys.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS provider_attempts JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.agent_runs.provider_attempts IS
  'Provider/model attempts in execution order: ok/error/skipped, fixed reason and optional HTTP status. No prompt, image, response body or credential.';
