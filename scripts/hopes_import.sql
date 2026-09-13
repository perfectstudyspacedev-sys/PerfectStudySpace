-- Hopes branch student import — generated 2026-09-10
-- 52 students (28 permanent, 24 temporary)
-- Imported PAY LATER: total_paid = 0, fee_due = full fee, so every student lands on the
-- Dashboard as Pending until staff records the real payment. No transaction rows are
-- created — that money was collected before the app existed and would skew Revenue.
-- Re-runnable: a student whose phone already exists at Hopes is skipped.

BEGIN;
DO $$
DECLARE
  v_branch UUID;
  v_student UUID;
  v_desk UUID;
  v_sno INT;
  v_skipped INT := 0;
  v_added INT := 0;
BEGIN
  SELECT id INTO v_branch FROM branches WHERE name = 'Hopes';
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Hopes branch not found'; END IF;
  SELECT COALESCE(MAX(s_no), 0) INTO v_sno FROM students WHERE branch_id = v_branch;

  -- Sathya sri (permanent, 12h, cabin 2)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9943799423' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Sathya sri', '9943799423', 'CA', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '2';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '2', 'Sathya sri'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '2', 'SEPTEMBER',
        12, '8:00-20:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Rajkumar (permanent, 12h, cabin 5)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8940733265' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Rajkumar', '8940733265', 'SSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '5';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '5', 'Rajkumar'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '5', 'SEPTEMBER',
        12, '9:00-9:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '5', '2026-10-01', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Aarif (permanent, 12h, cabin 8)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8825685694' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Aarif', '8825685694', 'Neet pg', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '8';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '8', 'Aarif'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '8', 'SEPTEMBER',
        12, '8:00-8:00', '2026-09-07', '2026-10-06', '2026-10-07', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '8', '2026-10-06', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Tamil kumaran (permanent, 12h, cabin 12)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8072570289' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Tamil kumaran', '8072570289', 'Neet pg', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '12';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '12', 'Tamil kumaran'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '12', 'AUGUST',
        12, '10:00-22:00', '2026-08-27', '2026-09-26', '2026-09-27', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Bavitha (permanent, 12h, cabin 13)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6382223675' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Bavitha', '6382223675', 'NEET pg', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '13';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '13', 'Bavitha'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '13', 'SEPTEMBER',
        12, '9:00-9:00', '2026-09-09', '2026-10-08', '2026-10-09', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Yamuna (permanent, 12h, cabin 19)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9025322704' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Yamuna', '9025322704', 'General studies', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '19';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '19', 'Yamuna'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '19', 'SEPTEMBER',
        12, '9:00-2:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Sathish Kumar T (permanent, 12h, cabin 21)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9600661188' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Sathish Kumar T', '9600661188', 'Ca', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '21';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '21', 'Sathish Kumar T'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '21', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-09', '2026-10-08', '2026-10-09', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '32', '2026-10-08', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Dhiyanesh (permanent, 12h, cabin 22)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9025868740' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Dhiyanesh', '9025868740', 'Ca', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '22';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '22', 'Dhiyanesh'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '22', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-07', '2026-10-06', '2026-10-07', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Kishore Kumar (permanent, 12h, cabin 23)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6379937781' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Kishore Kumar', '6379937781', 'FMGE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '23';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '23', 'Kishore Kumar'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '23', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-06', '2026-11-05', '2026-11-06', 2, 2100,
        0, 4200, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Adith (permanent, 12h, cabin 25)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8807059999' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Adith', '8807059999', 'Work', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '25';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '25', 'Adith'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '25', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-07', '2026-10-06', '2026-10-07', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '33', '2026-10-02', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Naren (permanent, 12h, cabin 27)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9787970665' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Naren', '9787970665', 'FMGE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '27';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '27', 'Naren'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '27', 'AUGUST',
        12, '9:00-21:00', '2026-08-12', '2026-09-11', '2026-09-12', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Pradeep CA (permanent, 12h, cabin 29)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7538883312' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Pradeep CA', '7538883312', 'Ca', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '29';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '29', 'Pradeep CA'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '29', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Mithun U (permanent, 12h, cabin 32)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8754070298' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Mithun U', '8754070298', 'Cisa', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '32';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '32', 'Mithun U'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '32', 'SEPTEMBER',
        12, '9:00-9:00', '2026-09-04', '2026-10-03', '2026-10-04', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Sathish (permanent, 12h, cabin 36)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7094871854' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Sathish', '7094871854', 'FMGE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '36';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '36', 'Sathish'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '36', 'AUGUST',
        12, '8:00-10:00', '2026-08-27', '2026-09-26', '2026-09-27', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '36', '2026-09-26', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Sreenivasan (permanent, 14h, cabin 38)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8220697620' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Sreenivasan', '8220697620', 'GATE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '38';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '38', 'Sreenivasan'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '38', 'SEPTEMBER',
        14, '9:00-11:00', '2026-09-07', '2026-10-06', '2026-10-07', 1, 2300,
        0, 2300, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '38', '2026-10-06', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Vishak (permanent, 12h, cabin 41)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7356146946' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Vishak', '7356146946', 'FMGE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '41';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '41', 'Vishak'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '41', 'SEPTEMBER',
        12, '7:00-19:00', '2026-09-09', '2026-10-08', '2026-10-09', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '41', '2026-10-08', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Pradeep (permanent, 12h, cabin 42)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8524002152' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Pradeep', '8524002152', 'BANKING', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '42';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '42', 'Pradeep'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '42', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '29', '2026-10-01', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Karthick B (permanent, 12h, cabin 43)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9789674302' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Karthick B', '9789674302', 'FMGE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '43';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '43', 'Karthick B'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '43', 'SEPTEMBER',
        12, '9:00-9:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Nandini (permanent, 12h, cabin 44)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6379571859' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Nandini', '6379571859', 'Neet pg', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '44';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '44', 'Nandini'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '44', 'SEPTEMBER',
        12, '6:00-6:00', '2026-09-05', '2026-10-04', '2026-10-05', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Harini (permanent, 12h, cabin 54)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9488923891' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Harini', '9488923891', 'UPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '54';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '54', 'Harini'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '54', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-09', '2026-10-08', '2026-10-09', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Niranjani (permanent, 12h, cabin 55)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7373777585' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Niranjani', '7373777585', 'Banking', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '55';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '55', 'Niranjani'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '55', 'SEPTEMBER',
        12, '8:00-8:00', '2026-09-08', '2026-10-07', '2026-10-08', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Manikandan (permanent, 12h, cabin 56)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6379405017' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Manikandan', '6379405017', 'NEET PG', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '56';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '56', 'Manikandan'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '56', 'SEPTEMBER',
        12, '8:00-20:00', '2026-09-08', '2026-10-07', '2026-10-08', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Pranav (Jee) (permanent, 12h, cabin 60)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9751811144' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Pranav (Jee)', '9751811144', 'Intern', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '60';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '60', 'Pranav (Jee)'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '60', 'AUGUST',
        12, '8:00-20:00', '2026-08-11', '2026-09-10', '2026-09-11', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Srinija (permanent, 12h, cabin 61)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6374638502' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Srinija', '6374638502', 'Ca', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '61';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '61', 'Srinija'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '61', 'JUNE',
        12, '9:00-21:00', '2026-06-08', '2026-09-07', '2026-09-08', 3, 2100,
        0, 6300, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Thennarasu (permanent, 12h, cabin 62)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7708647466' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Thennarasu', '7708647466', 'CAT', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '62';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '62', 'Thennarasu'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '62', 'AUGUST',
        12, '12:00-12:00', '2026-08-25', '2026-09-24', '2026-09-25', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Vishanth Murugan (permanent, 24h, cabin 64)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8248600994' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Vishanth Murugan', '8248600994', 'Jee', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '64';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '64', 'Vishanth Murugan'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '64', 'SEPTEMBER',
        24, '24 hours', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2500,
        0, 2500, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '64', '2026-10-01', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Kishor K (permanent, 12h, cabin 67)
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9489317166' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Kishor K', '9489317166', 'TNPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '67';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '67', 'Kishor K'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '67', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-08', '2026-10-07', '2026-10-08', 1, 2100,
        0, 2100, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '67', '2026-10-07', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Shamile (permanent, 12h, cabin 70)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9655973955' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Shamile', '9655973955', 'TNPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    SELECT id INTO v_desk FROM desks WHERE branch_id = v_branch AND label = '70';
    IF v_desk IS NULL THEN RAISE EXCEPTION 'Cabin % not found at Hopes (student %)', '70', 'Shamile'; END IF;
    UPDATE desks SET status = 'occupied', seat_type = 'fixed', assigned_student_id = v_student WHERE id = v_desk;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'permanent', 'fixed', v_desk, '70', 'SEPTEMBER',
        12, '9:00-21:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 2100,
        0, 2100, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Subramania raj (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9952150833' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Subramania raj', '9952150833', 'UPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        8, '10:00-4:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 1500,
        0, 1500, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Vaishnavi (temporary, 6h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6382642263' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Vaishnavi', '6382642263', 'SSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        6, '10:00-4:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 1250,
        0, 1250, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '45', '2026-10-01', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Anandh (temporary, 3h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7092991250' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Anandh', '7092991250', 'ISRO', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        3, '9:00-12:00', '2026-09-02', '2026-10-01', '2026-10-02', 1, 650,
        0, 650, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Jishnu (temporary, 6h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8848482916' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Jishnu', '8848482916', 'CMA', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        6, 'M-2 E-4', '2026-09-05', '2026-10-04', '2026-10-05', 1, 1250,
        0, 1250, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Akhilesh (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9444525150' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Akhilesh', '9444525150', 'GATE', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        8, '10:00-6:00', '2026-08-10', '2026-09-09', '2026-09-10', 1, 1500,
        0, 1500, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Balaji (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9032806146' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Balaji', '9032806146', 'CA', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        8, '10:00-6:00', '2026-08-11', '2026-09-10', '2026-09-11', 1, 1500,
        0, 1500, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '75', '2026-09-10', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Red JK (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9790564236' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Red JK', '9790564236', 'Civil services', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        8, 'M-4 E-4', '2026-08-11', '2026-09-10', '2026-09-11', 1, 1500,
        0, 1500, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '71', '2026-09-10', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Karthick rahul (temporary, 3h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7604832313' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Karthick rahul', '7604832313', 'WORK', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        3, '7:00-10:00', '2026-08-13', '2026-09-12', '2026-09-13', 1, 650,
        0, 650, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Vishnu ram (temporary, 4h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9134535353' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Vishnu ram', '9134535353', 'Work', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'JANUARY',
        4, '9:00-1:00', '2027-01-03', '2027-02-02', '2027-02-03', 1, 800,
        0, 800, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Manojkumar (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8144448699' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Manojkumar', '8144448699', 'CA INTER', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        8, 'M-4, E-4', '2026-09-15', '2026-10-14', '2026-10-15', 1, 1500,
        0, 1500, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '74', '2026-08-14', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Kesavan (temporary, 6h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7373938337' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Kesavan', '7373938337', 'Pharmacist', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        6, '10:00-4:00', '2026-08-17', '2026-09-16', '2026-09-17', 1, 1250,
        0, 1250, true, NULL);
    INSERT INTO lockers (branch_id, student_id, locker_no, locker_due_date, fee_due, amount_paid, is_active)
      VALUES (v_branch, v_student, '73', '2026-09-12', 100, 0, true)
      ON CONFLICT (branch_id, locker_no) DO UPDATE
        SET student_id = EXCLUDED.student_id, locker_due_date = EXCLUDED.locker_due_date,
            fee_due = EXCLUDED.fee_due, is_active = true;
    v_added := v_added + 1;
  END IF;

  -- Raja S (temporary, 3h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8778973174' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Raja S', '8778973174', 'Banking', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        3, '3:00-6:00', '2026-08-19', '2026-09-18', '2026-09-19', 1, 650,
        0, 650, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Raja gopika (temporary, 3h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7708079072' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Raja gopika', '7708079072', 'Placements', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        3, 'M-2 E-3', '2026-08-24', '2026-09-23', '2026-09-24', 1, 650,
        0, 650, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Dhamodharan (temporary, 2h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9500890759' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Dhamodharan', '9500890759', 'TNPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        2, '6:00-8:00', '2026-08-24', '2026-09-23', '2026-09-24', 1, 500,
        0, 500, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Harish kumar (temporary, 3h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6281353939' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Harish kumar', '6281353939', 'MBBS', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        3, '9:00-12:00', '2026-08-24', '2026-09-23', '2026-09-24', 1, 650,
        0, 650, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Ramalingam (temporary, 3h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9043261705' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Ramalingam', '9043261705', 'Learning', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        3, '8:30-11:30', '2026-08-24', '2026-09-23', '2026-09-24', 1, 650,
        0, 650, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Dhivya Varshini (temporary, 6h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9080450641' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Dhivya Varshini', '9080450641', 'UPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        6, '9:00-3:00', '2026-08-25', '2026-09-24', '2026-09-25', 1, 1250,
        0, 1250, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Vishnu S (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8870266802' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Vishnu S', '8870266802', 'NEET pg', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'JULY',
        8, '10:00-6:00', '2026-07-27', '2026-08-26', '2026-08-27', 1, 1500,
        0, 1500, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Saran (temporary, 5h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '6369483491' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Saran', '6369483491', 'UPSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        5, '5:00-10:00', '2026-08-28', '2026-09-27', '2026-09-28', 1, 1000,
        0, 1000, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Sudarshan (temporary, 6h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7305972924' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Sudarshan', '7305972924', 'Cat', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        6, '2:00-7:00', '2026-09-01', '2026-09-30', '2026-10-01', 1, 1250,
        0, 1250, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Arun Kumar (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '8668094541' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Arun Kumar', '8668094541', 'SSC', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        8, 'M-2 E-6', '2026-09-08', '2026-10-07', '2026-10-08', 1, 1500,
        0, 1500, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Dharshan (temporary, 6h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7418597587' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Dharshan', '7418597587', 'MBBS', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        6, 'M-2 E-4', '2026-09-08', '2026-10-07', '2026-10-08', 1, 1250,
        0, 1250, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Priyanka (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '7548882025' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Priyanka', '7548882025', 'Banking', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'SEPTEMBER',
        8, '10:00-6:00', '2026-09-08', '2026-10-07', '2026-10-08', 1, 1500,
        0, 1500, true, NULL);
    v_added := v_added + 1;
  END IF;

  -- Harish (temporary, 8h)  [start derived]
  IF EXISTS (SELECT 1 FROM students WHERE phone = '9092044356' AND branch_id = v_branch) THEN
    v_skipped := v_skipped + 1;
  ELSE
    v_sno := v_sno + 1;
    INSERT INTO students (s_no, name, phone, course, branch_id, status)
      VALUES (v_sno, 'Harish', '9092044356', 'BANKING', v_branch, 'pending')
      RETURNING id INTO v_student;
    v_desk := NULL;
    INSERT INTO memberships (student_id, branch_id, category, seat_type, desk_id, cabin_no, month,
      hours_per_day, timings, start_date, end_date, due_date, months_paid, monthly_fee,
      total_paid, fee_due, is_active, payment_mode)
      VALUES (v_student, v_branch, 'temporary', 'floating', v_desk, NULL, 'AUGUST',
        8, '10:00-6:00', '2026-08-22', '2026-09-21', '2026-09-22', 1, 1500,
        0, 1500, true, NULL);
    v_added := v_added + 1;
  END IF;

  RAISE NOTICE 'Hopes import: % added, % skipped (already present)', v_added, v_skipped;
END $$;
COMMIT;