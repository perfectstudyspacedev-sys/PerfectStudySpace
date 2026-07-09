-- 013_food_bill_settlement.sql  ·  Run this in Supabase SQL Editor
-- Food bills ordered mid-session are now recorded unpaid and settled (cash/upi chosen)
-- together with any overtime at final checkout, instead of asking for payment mode
-- at order time.

ALTER TABLE food_bills ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE food_bills ALTER COLUMN payment_mode DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_bills_booking_paid ON food_bills(booking_id, paid);
