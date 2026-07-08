-- 020_permanent_waitlist.sql
-- Waitlist for permanent membership seekers when a branch has no free desk left.
-- "Full" is defined as zero desks with status='free' at that branch — any free desk can
-- become a permanent cabin, so once none are free, new permanent sign-ups queue here on a
-- first-come basis instead of being turned away outright.

CREATE TABLE permanent_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  hours_per_day INT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'fulfilled', 'cancelled')),
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX idx_permanent_waitlist_branch_status ON permanent_waitlist(branch_id, status, created_at);

ALTER TABLE permanent_waitlist ENABLE ROW LEVEL SECURITY;
-- No policies — access only via the edge function's service-role client.
