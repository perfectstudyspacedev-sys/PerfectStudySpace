-- 035_custom_plan_weekend_hours.sql
-- Supports a "Custom" plan option (alongside the fixed hour/fee packages) where staff enter
-- a negotiated amount and separate weekday/weekend hour allotments directly, instead of
-- picking from fee_config's fixed tiers. hours_per_day continues to mean "weekday hours" for
-- every membership; hours_per_day_weekend is only ever set for a custom plan and is what
-- marks a membership as custom (non-null = custom pricing/hours, bypassing fee_config).

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS hours_per_day_weekend INT;
