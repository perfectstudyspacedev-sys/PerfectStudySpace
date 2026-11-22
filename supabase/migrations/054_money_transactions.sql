-- 054_money_transactions.sql
-- Five money actions, each as ONE database transaction: record_payment,
-- record_locker_payment, topup_food_pass, create_food_bill, apply_loyalty_discount.
--
-- Before, the api did each step as its own request (read the balance, write the
-- new balance, write the ledger row, resolve alerts ...). Two problems:
--   * a failure half way left half the change: e.g. a split payment whose cash +
--     UPI did not add up lowered fee_due, THEN failed, with no ledger row; a food
--     bill with one item out of stock had already taken stock off the items before it;
--   * two requests at the same moment both read the old balance, and one change
--     was lost (two cashiers collecting on one membership, two top-ups of one pass).
-- Now the row being changed is locked (SELECT ... FOR UPDATE) for the length of
-- the function, every check runs on the locked values, and any error undoes all of
-- it. Same rules, same messages, same rows as the api wrote before; amounts are
-- exact numerics instead of JavaScript floats (equal to the paisa).
--
-- Append-only: new functions only, no table, column, row or policy changed. Safe
-- to run twice. Applied to the cloud by hand in the SQL editor after 052 and 053
-- and BEFORE the matching api is deployed; the api falls back to its old steps
-- while these functions are missing.
--
-- Errors meant for staff are raised with SQLSTATE P0001; the api shows the message.

-- ₹ amounts the way the api printed them (1500, 99.5; not 1500.00).
CREATE OR REPLACE FUNCTION public.money_fmt(n numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ SELECT trim_scale(n)::text $$;

CREATE OR REPLACE FUNCTION public.money_fail(msg text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = msg; END $$;

-- Ledger rows for one payment (the api's insertPaymentTransactions): nothing for a
-- zero amount; "split" becomes one cash row and one UPI row, which must add up.
CREATE OR REPLACE FUNCTION public.money_ledger(
  p_student uuid, p_branch uuid, p_membership uuid, p_category text, p_notes text, p_staff uuid,
  p_mode text, p_amount numeric, p_cash numeric, p_upi numeric)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE c numeric; u numeric;
BEGIN
  IF NOT (coalesce(p_amount, 0) > 0) THEN RETURN; END IF;
  IF p_mode = 'split' THEN
    c := round(coalesce(p_cash, 0), 2);
    u := round(coalesce(p_upi, 0), 2);
    IF round((c + u) * 100) <> round(p_amount * 100) THEN
      PERFORM money_fail('Cash + UPI amounts must add up to the total');
    END IF;
    IF c > 0 THEN
      INSERT INTO transactions (student_id, branch_id, membership_id, category, amount, payment_mode, notes, created_by_staff_id)
      VALUES (p_student, p_branch, p_membership, p_category::transaction_category, c, 'cash', p_notes, p_staff);
    END IF;
    IF u > 0 THEN
      INSERT INTO transactions (student_id, branch_id, membership_id, category, amount, payment_mode, notes, created_by_staff_id)
      VALUES (p_student, p_branch, p_membership, p_category::transaction_category, u, 'upi', p_notes, p_staff);
    END IF;
  ELSE
    INSERT INTO transactions (student_id, branch_id, membership_id, category, amount, payment_mode, notes, created_by_staff_id)
    VALUES (p_student, p_branch, p_membership, p_category::transaction_category, p_amount,
            coalesce(p_mode, 'cash')::payment_mode, p_notes, p_staff);
  END IF;
END $$;

-- record_payment: pay (part of) a membership's pending fee.
CREATE OR REPLACE FUNCTION public.money_record_payment(
  p_membership uuid, p_branch uuid, p_staff uuid, p_amount numeric, p_mode text, p_cash numeric, p_upi numeric)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE m memberships; due numeric; new_due numeric;
BEGIN
  SELECT * INTO m FROM memberships WHERE id = p_membership FOR UPDATE;
  IF NOT FOUND THEN PERFORM money_fail('Membership not found'); END IF;
  IF m.branch_id IS DISTINCT FROM p_branch THEN PERFORM money_fail('Branch access denied'); END IF;
  IF NOT (coalesce(p_amount, 0) > 0) THEN PERFORM money_fail('Payment amount must be greater than 0'); END IF;
  due := coalesce(m.fee_due, 0);
  IF due <= 0 THEN PERFORM money_fail('This membership has no pending dues — nothing to collect.'); END IF;
  IF p_amount > due THEN
    PERFORM money_fail(format('Payment exceeds the pending due of ₹%s — collect at most that amount.', money_fmt(due)));
  END IF;
  new_due := greatest(due - p_amount, 0);
  -- The due date moves on a month only once the balance is fully cleared.
  UPDATE memberships
     SET fee_due = new_due,
         due_date = CASE WHEN new_due = 0 THEN (m.due_date + interval '1 month')::date ELSE m.due_date END,
         total_paid = m.total_paid + p_amount
   WHERE id = p_membership;
  PERFORM money_ledger(m.student_id, m.branch_id, p_membership, 'membership', NULL, p_staff, p_mode, p_amount, p_cash, p_upi);
  IF new_due = 0 THEN
    UPDATE alerts SET status = 'resolved'
     WHERE student_id = m.student_id AND alert_type = 'payment_due' AND status = 'pending';
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- record_locker_payment: pay (part of) a locker's pending fee.
CREATE OR REPLACE FUNCTION public.money_record_locker_payment(
  p_locker uuid, p_branch uuid, p_staff uuid, p_amount numeric, p_mode text, p_cash numeric, p_upi numeric)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE l lockers; due numeric;
BEGIN
  SELECT * INTO l FROM lockers WHERE id = p_locker FOR UPDATE;
  IF NOT FOUND THEN PERFORM money_fail('Locker not found'); END IF;
  IF l.branch_id IS DISTINCT FROM p_branch THEN PERFORM money_fail('Branch access denied'); END IF;
  IF NOT (coalesce(p_amount, 0) > 0) THEN PERFORM money_fail('Payment amount must be greater than 0'); END IF;
  due := coalesce(l.fee_due, 0);
  IF due <= 0 THEN PERFORM money_fail('This locker has no pending dues — nothing to collect.'); END IF;
  IF p_amount > due THEN
    PERFORM money_fail(format('Payment exceeds the pending due of ₹%s — collect at most that amount.', money_fmt(due)));
  END IF;
  UPDATE lockers SET fee_due = greatest(due - p_amount, 0), amount_paid = l.amount_paid + p_amount
   WHERE id = p_locker;
  PERFORM money_ledger(l.student_id, l.branch_id, NULL, 'locker', 'Locker pending payment', p_staff, p_mode, p_amount, p_cash, p_upi);
  RETURN jsonb_build_object('ok', true);
END $$;

-- topup_food_pass: money onto a student's prepaid Food Pass (made on the first top-up).
CREATE OR REPLACE FUNCTION public.money_topup_food_pass(
  p_student uuid, p_branch uuid, p_staff uuid, p_amount numeric, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE bal numeric;
BEGIN
  IF NOT (coalesce(p_amount, 0) > 0) THEN PERFORM money_fail('Top-up amount must be greater than 0'); END IF;
  -- One top-up of a student at a time (the pass row may not exist yet, so the student is locked).
  PERFORM 1 FROM students WHERE id = p_student FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE student_id = p_student AND is_active) THEN
    PERFORM money_fail('Food Pass is only available to students with an active membership');
  END IF;
  INSERT INTO food_passes (student_id, branch_id, balance) VALUES (p_student, p_branch, p_amount)
  ON CONFLICT (student_id) DO UPDATE SET balance = food_passes.balance + EXCLUDED.balance, updated_at = now()
  RETURNING balance INTO bal;
  INSERT INTO transactions (student_id, branch_id, category, amount, payment_mode, notes, created_by_staff_id)
  VALUES (p_student, p_branch, 'food', p_amount, coalesce(p_mode, 'cash')::payment_mode, 'Food Pass top-up', p_staff);
  RETURN jsonb_build_object('ok', true, 'balance', bal);
END $$;

-- create_food_bill: a food order. Stock comes off counted items; a Food Pass holder
-- pays from the pass (never below zero: if it does not cover the order the bill stays
-- unpaid for checkout); otherwise paid now with a payment mode, or left unpaid.
CREATE OR REPLACE FUNCTION public.money_create_food_bill(
  p_branch uuid, p_staff uuid, p_student uuid, p_student_name text, p_student_phone text, p_booking uuid,
  p_items jsonb, p_mode text, p_discount_type text, p_discount_value numeric, p_discount_amount numeric,
  p_skip_pass boolean)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  it jsonb; fi food_items; qty int; subtotal numeric := 0; lines jsonb := '[]'::jsonb;
  disc numeric; total numeric; pass food_passes; from_pass boolean := false; covers boolean := false;
  new_bal numeric; is_paid boolean; bill uuid;
BEGIN
  -- Lock the ordered items in one fixed order, so two bills never wait on each other.
  PERFORM 1 FROM food_items
   WHERE id::text IN (SELECT e->>'foodItemId' FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e)
   ORDER BY id FOR UPDATE;
  FOR it IN SELECT e FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e LOOP
    SELECT * INTO fi FROM food_items WHERE id::text = it->>'foodItemId';
    IF NOT FOUND THEN CONTINUE; END IF;   -- an item no longer on the menu is skipped, as before
    qty := coalesce(nullif((it->>'quantity')::numeric, 0), 1)::int;
    IF fi.quantity IS NOT NULL AND qty > fi.quantity THEN
      PERFORM money_fail(format('Only %s of %s available', fi.quantity, fi.name));
    END IF;
    subtotal := subtotal + fi.price * qty;
    lines := lines || jsonb_build_object('food_item_id', fi.id, 'name', fi.name, 'price', fi.price, 'quantity', qty);
    IF fi.quantity IS NOT NULL THEN UPDATE food_items SET quantity = fi.quantity - qty WHERE id = fi.id; END IF;
  END LOOP;

  disc := least(greatest(coalesce(p_discount_amount, 0), 0), subtotal);
  total := subtotal - disc;

  IF p_student IS NOT NULL AND NOT coalesce(p_skip_pass, false) THEN
    SELECT * INTO pass FROM food_passes WHERE student_id = p_student FOR UPDATE;
    IF FOUND THEN
      from_pass := true;
      covers := pass.balance >= total;
      IF covers THEN
        new_bal := pass.balance - total;
        UPDATE food_passes SET balance = new_bal, updated_at = now() WHERE id = pass.id;
      ELSE
        new_bal := pass.balance;
      END IF;
    END IF;
  END IF;
  is_paid := (from_pass AND covers) OR (NOT from_pass AND p_mode IS NOT NULL);

  INSERT INTO food_bills (branch_id, student_id, booking_id, student_name, student_phone, subtotal,
                          discount_type, discount_value, discount_amount, total, payment_mode, paid, created_by_staff_id)
  VALUES (p_branch, p_student, p_booking, p_student_name, p_student_phone, subtotal,
          p_discount_type, coalesce(p_discount_value, 0), disc, total,
          (CASE WHEN covers THEN 'other' WHEN is_paid THEN p_mode END)::payment_mode, is_paid, p_staff)
  RETURNING id INTO bill;

  INSERT INTO food_bill_items (food_bill_id, food_item_id, name, price, quantity)
  SELECT bill, (l->>'food_item_id')::uuid, l->>'name', (l->>'price')::numeric, (l->>'quantity')::int
    FROM jsonb_array_elements(lines) WITH ORDINALITY AS x(l, n) ORDER BY n;

  IF is_paid AND NOT from_pass THEN
    INSERT INTO transactions (student_id, branch_id, food_bill_id, category, amount, payment_mode, created_by_staff_id)
    VALUES (p_student, p_branch, bill, 'food', total, p_mode::payment_mode, p_staff);
  END IF;

  RETURN jsonb_build_object(
    'bill', jsonb_build_object('id', bill, 'total', total, 'subtotal', subtotal, 'discountAmount', disc,
                               'items', lines, 'paid', is_paid, 'paidFromPass', from_pass),
    'foodPassBalance', new_bal,
    'foodPassShortfall', CASE WHEN from_pass AND NOT covers THEN round(total - new_bal, 2) END);
END $$;

-- apply_loyalty_discount: owner-only % or fixed ₹ off a membership's pending fee; any
-- part larger than what is owed is banked as a fixed cashback.
CREATE OR REPLACE FUNCTION public.money_apply_loyalty_discount(
  p_membership uuid, p_branch uuid, p_staff uuid, p_type text, p_value numeric, p_remarks text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE m memberships; fee numeric; base numeric; raw numeric; applied numeric; banked numeric; new_due numeric;
BEGIN
  SELECT * INTO m FROM memberships WHERE id = p_membership FOR UPDATE;
  IF NOT FOUND THEN PERFORM money_fail('Membership not found'); END IF;
  IF m.branch_id IS DISTINCT FROM p_branch THEN PERFORM money_fail('Branch access denied'); END IF;
  fee := m.fee_due;
  base := CASE WHEN fee > 0 THEN fee ELSE m.monthly_fee * m.months_paid END;
  raw := CASE WHEN p_type = 'percent' THEN base * (p_value / 100) ELSE p_value END;
  applied := least(raw, fee);
  banked := greatest(raw - fee, 0);
  new_due := fee - applied;
  UPDATE memberships SET fee_due = new_due WHERE id = p_membership;
  INSERT INTO membership_discounts (membership_id, student_id, branch_id, discount_type, discount_value,
                                    discount_amount, remarks, applied_by_staff_id)
  VALUES (p_membership, m.student_id, m.branch_id, p_type, p_value, applied, p_remarks, p_staff);
  IF banked > 0 THEN
    -- Month label as the api wrote it (English month name, UTC calendar).
    INSERT INTO cashbacks (student_id, branch_id, month_label, cashback_type, cashback_value, notes, granted_by_staff_id)
    VALUES (m.student_id, m.branch_id, to_char(now() AT TIME ZONE 'UTC', 'FMMonth YYYY'), 'fixed', banked,
            'Banked from a discount that exceeded the pending fee' || CASE WHEN p_remarks IS NOT NULL THEN ' — ' || p_remarks ELSE '' END,
            p_staff);
  END IF;
  IF new_due = 0 THEN
    UPDATE alerts SET status = 'resolved'
     WHERE student_id = m.student_id AND alert_type = 'payment_due' AND status = 'pending';
  END IF;
  RETURN jsonb_build_object('ok', true, 'discountAmount', applied, 'newFeeDue', new_due,
                            'bankedAsCashback', banked, 'cashbackBankedNote', NULL);
END $$;

-- Only the api (service_role) may call these.
REVOKE ALL ON FUNCTION public.money_fmt(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_fail(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_ledger(uuid, uuid, uuid, text, text, uuid, text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_record_payment(uuid, uuid, uuid, numeric, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_record_locker_payment(uuid, uuid, uuid, numeric, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_topup_food_pass(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_create_food_bill(uuid, uuid, uuid, text, text, uuid, jsonb, text, text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_apply_loyalty_discount(uuid, uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.money_fmt(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_fail(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_ledger(uuid, uuid, uuid, text, text, uuid, text, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_record_payment(uuid, uuid, uuid, numeric, text, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_record_locker_payment(uuid, uuid, uuid, numeric, text, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_topup_food_pass(uuid, uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_create_food_bill(uuid, uuid, uuid, text, text, uuid, jsonb, text, text, numeric, numeric, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_apply_loyalty_discount(uuid, uuid, uuid, text, numeric, text) TO service_role;
