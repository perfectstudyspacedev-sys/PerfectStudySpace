-- 049_transaction_category_overtime.sql
-- checkout_booking (walk-in overtime, and member overtime paid now) and update_attendance
-- (recomputed walk-in overtime) write overtime charges to transactions with
-- category = 'overtime', and the Revenue page reports an Overtime bucket — but
-- transaction_category was created in
-- 001_initial.sql as ('desk','food','membership','locker','fine') and no migration ever
-- added 'overtime'. Postgres rejects an insert with a value outside the enum, and those
-- inserts don't check the returned error, so on any database built from these migrations
-- every overtime charge was silently dropped from the ledger (and from Revenue).
--
-- IF NOT EXISTS makes this a no-op on a database where the value was already added by hand.
-- Postgres enums can only gain values, never lose or reorder them, so this is additive and
-- safe to run on the live table. It does not backfill charges that were already lost; the
-- billed amounts for those still exist in overtime_sessions (billed_amount / billed_at).

ALTER TYPE transaction_category ADD VALUE IF NOT EXISTS 'overtime';
