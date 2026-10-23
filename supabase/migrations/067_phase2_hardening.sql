-- 067_phase2_hardening.sql  (PSS-AI: fixes from the independent review of P1.8 and Phase 2)
-- 1. Self-pay on a sign-up needs a secret only the person who sent the form holds. The sign-up's
--    Ref is printed for the desk and is no secret, so it can no longer authorise setting a PIN or
--    sending a payment. Only the key's SHA-256 hash is kept.
-- 2. One UPI payment (one UTR) can confirm only one payment proof.

ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS pay_key_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_proofs_confirmed_utr ON payment_proofs (utr)
  WHERE status = 'confirmed' AND utr IS NOT NULL;
