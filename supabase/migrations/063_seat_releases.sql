-- 063_seat_releases.sql  (PSS-AI Phase 3: O1 seat-hour overbooking, SP10 release my hours)
-- Hours of a permanent member's cabin that may be sold to a walk-in: released by the member in
-- the portal (SP10), or predicted free from their check-in history (O1, 20% safety margin, C7).
-- A release is sold whole (open → sold, one conditional update, so an hour is never sold twice);
-- the unsold parts of its window go back on sale as new releases. Each resale records the walk-in
-- booking, the member's credit (D7: 50% of the resale price for a member release, as a pending
-- fixed cashback) and what happened if the member arrived anyway (another desk, or one free day).

CREATE TABLE IF NOT EXISTS seat_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  desk_id UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('member', 'predicted')),
  -- O1: the estimated chance the member does not come in this window.
  probability NUMERIC CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled', 'expired')),
  -- The release this one was split from when part of it was sold.
  parent_id UUID REFERENCES seat_releases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT seat_releases_window CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_seat_releases_open ON seat_releases (branch_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_seat_releases_membership ON seat_releases (membership_id, starts_at);

CREATE TABLE IF NOT EXISTS seat_resales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL UNIQUE REFERENCES seat_releases(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  desk_id UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  member_student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  credit_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  credit_cashback_id UUID REFERENCES cashbacks(id) ON DELETE SET NULL,
  -- The member arrived during the resale: given another desk, one free day (predicted release
  -- with no free desk) or neither (they had released the hours themselves).
  collision TEXT CHECK (collision IS NULL OR collision IN ('fallback_desk', 'free_day', 'no_desk')),
  collision_at TIMESTAMPTZ,
  collision_cashback_id UUID REFERENCES cashbacks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seat_resales_member ON seat_resales (member_student_id, created_at DESC);

ALTER TABLE seat_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE seat_resales ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
