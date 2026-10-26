-- 071_learning_and_buddies.sql  (PSS-AI Phase 5: I8 policy learner, O6 experiments, SP21 study buddy)

-- I8: rules proposed from the owner's own past decisions. A rule does anything only after the owner
-- signs it (status active); only student hold requests are ever decided by a rule (never T3).
CREATE TABLE IF NOT EXISTS policy_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (char_length(scope) BETWEEN 3 AND 80),      -- e.g. student_request:hold
  bucket TEXT NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 80),    -- e.g. days:8-14|dues:no
  outcome TEXT NOT NULL CHECK (outcome IN ('approve', 'deny')),
  support INT NOT NULL CHECK (support >= 0),
  agreement NUMERIC NOT NULL CHECK (agreement >= 0 AND agreement <= 1),
  description TEXT NOT NULL CHECK (char_length(description) <= 300),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'retired', 'dismissed')),
  decided_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  applied_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One rule per scope and bucket that is still in play (the weekly job refreshes it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_rules_live ON policy_rules (scope, bucket) WHERE status IN ('proposed', 'active');
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS policy_rule_id UUID REFERENCES policy_rules(id) ON DELETE SET NULL;

-- O6 (C20): small A/B tests; each student sees one variant of an experiment.
CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('winback_offer', 'next_exam_offer', 'menu_feature')),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  -- [{ key: 'A'|'B', label, value }]
  variants JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'ended', 'kept', 'dropped')),
  started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  winner TEXT,
  result JSONB,
  created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one running experiment of each kind per branch (null = every branch).
CREATE UNIQUE INDEX IF NOT EXISTS idx_experiments_running ON experiments (kind, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'running';
CREATE TABLE IF NOT EXISTS experiment_exposures (
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  exposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at TIMESTAMPTZ,
  PRIMARY KEY (experiment_id, student_id)
);

-- SP21 (C20): opt-in study buddies. Matched only when both opt in and both accept; then each sees
-- the other's first name and study window, never a phone number.
CREATE TABLE IF NOT EXISTS study_buddies (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  exam_family TEXT,
  study_window TEXT NOT NULL CHECK (study_window IN ('morning', 'afternoon', 'evening', 'night')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS study_buddy_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_a UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_b UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  a_answer TEXT CHECK (a_answer IS NULL OR a_answer IN ('yes', 'no')),
  b_answer TEXT CHECK (b_answer IS NULL OR b_answer IN ('yes', 'no')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'connected', 'declined', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_buddy_pair CHECK (student_a < student_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_buddy_pair ON study_buddy_matches (student_a, student_b);

ALTER TABLE policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_buddies ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_buddy_matches ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
