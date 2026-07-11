-- 031_membership_refund_payout.sql
-- Allows a "membership_refund" payout — the prorated unused-days refund handed back to a
-- student when their membership is deleted (see delete_membership in the edge function).

ALTER TABLE payouts DROP CONSTRAINT payouts_payout_type_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_payout_type_check
  CHECK (payout_type IN ('cashback', 'locker_deposit', 'food_pass_refund', 'membership_refund'));
