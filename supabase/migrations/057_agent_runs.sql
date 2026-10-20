-- 057_agent_runs.sql  (PSS-AI P1.8, Appendix F rule 8)
-- One row per AI agent run: which agent, who asked, which model, how many tokens and the
-- estimated cost. Every tool call the run makes writes an events row with this id as run_id.
-- The monthly AI budget (app_settings pssai_ai_budget_usd) is checked against cost_usd.
-- Holds no prompts or answers: only counts, so nothing personal is kept here.

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ok', 'refused', 'cut_short', 'error')),
  model TEXT,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  cache_write_tokens INT NOT NULL DEFAULT 0,
  model_calls INT NOT NULL DEFAULT 0,
  tool_calls INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started ON agent_runs (agent, started_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.
