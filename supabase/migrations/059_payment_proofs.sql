-- 059_payment_proofs.sql  (PSS-AI P2.2, closes G11, G13, G17, G18)
-- UPI payments from the student portal (and, with A3, from the sign-up page). There is no payment
-- gateway: the portal shows a UPI pay link for an amount the code worked out, the student sends
-- the UTR and/or a screenshot, and the owner confirms or rejects it (D2). Confirming runs the
-- existing payment action (renew_membership, record_payment, topup_food_pass, renew_locker or
-- create_membership) with payment mode upi; transaction_ids keeps what it recorded.
-- A proof belongs to a student, or to a sign-up request until that sign-up is registered.

CREATE TABLE IF NOT EXISTS payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  signup_request_id UUID REFERENCES signup_requests(id) ON DELETE SET NULL,
  branch_id UUID NOT NULL REFERENCES branches(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('renewal', 'dues', 'food_pass', 'locker', 'registration')),
  -- What is being paid for (membership or locker id, months, plan for a sign-up); never money.
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  amount_expected NUMERIC(10,2) NOT NULL CHECK (amount_expected > 0),
  -- Goes in the UPI note, so the owner can match the bank entry: PSS-XXXXXXXX.
  reference TEXT NOT NULL UNIQUE,
  utr TEXT CHECK (utr IS NULL OR utr ~ '^[0-9]{12}$'),
  image_path TEXT,
  -- What the AI read from the screenshot ({ amount, utr, paid_at, payee_vpa, … }); it never confirms.
  ai_reading JSONB,
  -- Checks made by code when the proof arrives (UTR used before, amount or payee different).
  checks JSONB,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'submitted', 'confirmed', 'rejected', 'cancelled')),
  submitted_at TIMESTAMPTZ,
  decided_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  reject_reason TEXT,
  transaction_ids UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_status ON payment_proofs (status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_student ON payment_proofs (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_utr ON payment_proofs (utr) WHERE utr IS NOT NULL;

ALTER TABLE payment_proofs ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.

-- Screenshots: a private bucket (no public URLs); the owner sees them through short-lived signed
-- links made by the edge function.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-proofs', 'payment-proofs', false, 1572864, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
