-- 056_model_outputs.sql  (PSS-AI P1.3)
-- Results of the behaviour models that train on the developer's machine from a Supabase export
-- (S11) and are written back by ml/publish.py with the service key. The app only reads them,
-- except the owner's ok/problem verdict on an anomaly flag. Nothing here changes money.

-- Latest score per student per model (churn, engagement), plus every score ever published.
CREATE TABLE IF NOT EXISTS student_scores (
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  version TEXT,
  score NUMERIC,
  reason TEXT,
  computed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (student_id, model)
);

CREATE TABLE IF NOT EXISTS student_score_history (
  id BIGSERIAL PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  model TEXT,
  version TEXT,
  score NUMERIC,
  reason TEXT,
  computed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_score_history_student ON student_score_history (student_id, model, computed_at);

-- Focus Fingerprint (I1): one vector and cluster per student.
CREATE TABLE IF NOT EXISTS fingerprints (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  version TEXT,
  vector REAL[],
  cluster TEXT,
  computed_at TIMESTAMPTZ DEFAULT now()
);

-- Anomaly flags (I23) for the owner to mark ok or problem.
CREATE TABLE IF NOT EXISTS anomaly_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT,
  ref_table TEXT,
  ref_id UUID,
  branch_id UUID,
  score NUMERIC,
  explanation TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ok', 'problem')),
  reviewed_by_staff_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_status ON anomaly_flags (status, created_at DESC);
-- Re-publishing the same week must not duplicate a flag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_flags_ref ON anomaly_flags (kind, ref_table, ref_id);

-- Cash-flow forecast (I31): one row per kind and week, with a low/high band.
CREATE TABLE IF NOT EXISTS forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT,
  period_start DATE,
  value NUMERIC,
  low NUMERIC,
  high NUMERIC,
  computed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forecasts_kind_period ON forecasts (kind, period_start);

-- Daily owner brief, written by the owner analyst (P1.8).
CREATE TABLE IF NOT EXISTS owner_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date DATE NOT NULL UNIQUE,
  body TEXT NOT NULL,
  figures JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE student_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_briefs ENABLE ROW LEVEL SECURITY;
-- No policies: the edge functions and ml/publish.py use the service-role key.
