-- 061_approvals.sql  (PSS-AI P2.3, A8 part 2, S9)
-- The owner's approval queue. A T3 action asked for by an agent or a student is never run
-- directly: it waits here until the owner approves it (then it runs with the owner as actor and
-- this request recorded as the reason) or denies it with a reason. Student requests (long holds,
-- plan changes, refunds, privacy requests, waitlist acceptances) wait here too.

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('t3_action', 'payment', 'student_request')),
  action TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by_type TEXT NOT NULL,
  requested_by_id UUID,
  run_id UUID,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  decided_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  reason TEXT,
  -- What running the approved action answered.
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status, created_at);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.
