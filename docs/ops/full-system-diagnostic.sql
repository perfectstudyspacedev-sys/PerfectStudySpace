-- PERFECT STUDY SPACE: SINGLE DATABASE READINESS / RECENT-EVIDENCE REPORT
-- Snapshot: migrations 001-073, 44 feature switches, 5 controls, 27 schedules.
-- Repository: perfectstudyspacedev-sys/PerfectStudySpace; branch pss-ai/all-phases.
-- Cloudflare Pages project: perfectstudyspace.
-- Supabase SQL Editor -> intended project zripsszkprhtyccukrir -> role postgres -> Run all.
-- No placeholders, API keys, network calls, job execution or business-data writes.
-- Only a temporary report is created; COMMIT removes it. Rerunning is safe.
-- PASS means the named structural check passed, not that the whole feature works.
-- No credentials, function source, cron commands, event payloads or HTTP bodies are printed.
-- External/runtime checks are explicitly UNVERIFIED. Missing optional objects do not crash it.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
CREATE TEMP TABLE pss_diagnostic_report (
  section text, item text, status text, evidence text, next_step text
) ON COMMIT DROP;

DO $diagnostic$
DECLARE
  r record; x record; rel oid; proc oid; n bigint; m bigint;
  v text; missing text; details text; result_status text; flag_table boolean;
BEGIN
  INSERT INTO pss_diagnostic_report VALUES
    ('00 Test scope','What this report proves','INFO',
     'Database structure/configuration plus bounded recent evidence only. No live feature is executed.',
     'Use the feature checklist for browser, authorization, concurrency and AI accuracy tests.');

  -- 1. Every surviving application table and column declared in migrations 001-073.
  FOR r IN SELECT * FROM (VALUES
    ('branches', 'id name desk_count shift_config is_active created_at locker_capacity signup_code latitude longitude checkin_key', '001'),
    ('staff', 'id username password_hash role display_name branch_id is_active created_at updated_at override_branch_id override_date duty', '001'),
    ('students', 'id s_no name phone course aadhaar_photo_url photo_url status branch_id total_visits total_hours_studied loyalty_tag created_at updated_at emergency_contact referral_source', '001'),
    ('desks', 'id branch_id label seat_type status assigned_student_id current_booking_id sort_order created_at tags', '001'),
    ('fee_config', 'id config_type hours_per_day max_hours fee cabin_type sort_order', '001'),
    ('memberships', 'id student_id branch_id category seat_type desk_id cabin_no month hours_per_day timings start_date end_date due_date months_paid discount_percent monthly_fee total_paid fee_due is_active payment_mode created_by_staff_id created_at is_paused paused_at hold_days hours_per_day_weekend renewed_from_membership_id plan_amount plan_days actor_type actor_id run_id', '001'),
    ('bookings', 'id student_id branch_id desk_id membership_id shift_name booking_type start_time end_time hours timings_slot amount status payment_mode created_by_staff_id created_at is_paused paused_at total_pause_minutes scheduled_hours actor_type actor_id run_id', '001'),
    ('lockers', 'id branch_id student_id locker_no monthly_fee locker_due_date deposit_amount deposit_returned is_active created_at amount_paid fee_due', '001'),
    ('food_items', 'id branch_id name price quantity is_active created_at inventory_item_id inventory_per_unit', '001'),
    ('food_bills', 'id branch_id student_id booking_id student_name student_phone subtotal discount_type discount_value discount_amount total payment_mode created_by_staff_id created_at paid actor_type actor_id run_id', '001'),
    ('food_bill_items', 'id food_bill_id food_item_id name price quantity', '001'),
    ('transactions', 'id student_id branch_id booking_id membership_id food_bill_id locker_id category amount payment_mode notes created_by_staff_id created_at actor_type actor_id run_id', '001'),
    ('alerts', 'id student_id branch_id alert_type due_date message status created_at', '001'),
    ('messages', 'id branch_id sender_staff_id recipient_type recipient_student_id recipient_staff_id content sent_at read_at', '001'),
    ('overtime_sessions', 'id booking_id student_id membership_id branch_id overtime_minutes session_date created_at billed_at billed_amount excluded', '004'),
    ('membership_holds', 'id membership_id student_id branch_id paused_at resumed_at days_paused created_at planned_resume_date requested_by_student', '006'),
    ('staff_attendance', 'id staff_id branch_id attendance_date first_login_at last_logout_at', '007'),
    ('tasks', 'id branch_id assigned_by_staff_id assigned_to_staff_id title description status due_date created_at completed_at repeat_interval needs_photo', '007'),
    ('task_completions', 'id task_id completion_date completed_at', '011'),
    ('enquiries', 'id branch_id name phone email source message notes status converted_student_id created_by_staff_id created_at updated_at actor_type actor_id run_id score score_reason scored_at referral_link_id', '014'),
    ('enquiry_activities', 'id enquiry_id type note created_at', '014'),
    ('enquiry_followups', 'id enquiry_id branch_id due_at note done created_at', '014'),
    ('membership_discounts', 'id membership_id student_id branch_id discount_type discount_value discount_amount remarks applied_by_staff_id created_at', '017'),
    ('cashbacks', 'id student_id branch_id month_label cashback_type cashback_value status redeemed_membership_id redeemed_amount redeemed_at notes granted_by_staff_id created_at', '019'),
    ('permanent_waitlist', 'id branch_id name phone hours_per_day notes status created_by_staff_id created_at fulfilled_at actor_type actor_id run_id student_id offered_at offer_expires_at offer_status', '020'),
    ('food_passes', 'id student_id branch_id balance created_at updated_at', '021'),
    ('payouts', 'id student_id branch_id payout_type amount notes created_by_staff_id created_at actor_type actor_id run_id', '023'),
    ('membership_plan_changes', 'id membership_id student_id branch_id old_category old_hours_per_day old_monthly_fee new_category new_hours_per_day new_monthly_fee prorated_amount changed_by_staff_id created_at', '026'),
    ('membership_edits', 'id membership_id student_id branch_id edit_type old_value new_value changed_by_staff_id created_at', '032'),
    ('inventory_items', 'id branch_id name quantity created_at supplier_phone', '045'),
    ('inventory_logs', 'id inventory_item_id branch_id action quantity created_by_staff_id created_at actor_type actor_id run_id', '046'),
    ('app_settings', 'key value updated_by_staff_id updated_at', '048'),
    ('waivers', 'id branch_id student_id membership_id waiver_type amount reason related_id created_by_staff_id created_at actor_type actor_id run_id', '050'),
    ('signup_requests', 'id branch_id ref_code name phone emergency_contact course referral_source claimed_by_staff_id claimed_at created_at pin_hash keep_until id_photo_path id_check pay_key_hash', '051'),
    ('events', 'id occurred_at action tier actor_type actor_id run_id branch_id student_id ok error payload reason', '052'),
    ('idempotency_keys', 'key action actor_id request_hash status response created_at', '054'),
    ('focus_ratings', 'booking_id student_id rating source created_at', '055'),
    ('student_scores', 'student_id model version score reason computed_at', '056'),
    ('student_score_history', 'id student_id model version score reason computed_at', '056'),
    ('fingerprints', 'student_id version vector cluster computed_at', '056'),
    ('anomaly_flags', 'id kind ref_table ref_id branch_id score explanation status reviewed_by_staff_id created_at', '056'),
    ('forecasts', 'id kind period_start value low high computed_at', '056'),
    ('owner_briefs', 'id brief_date body figures created_at', '056'),
    ('agent_runs', 'id agent started_at finished_at status model staff_id student_id tokens_in tokens_out cache_read_tokens cache_write_tokens model_calls tool_calls cost_usd error provider_attempts', '057'),
    ('student_credentials', 'student_id pin_hash failed_attempts locked_until pin_set_at privacy_accepted_at', '058'),
    ('student_setup_codes', 'student_id code_hash expires_at attempts created_by_staff_id created_at', '058'),
    ('student_sessions', 'id student_id created_at expires_at revoked_at', '058'),
    ('payment_proofs', 'id student_id signup_request_id branch_id purpose request amount_expected reference utr image_path ai_reading checks status submitted_at decided_by_staff_id decided_at reject_reason transaction_ids created_at', '059'),
    ('portal_notifications', 'id student_id kind title body action_url dedupe_key read_at created_at', '060'),
    ('portal_chat_messages', 'id student_id role body status reply_to run_id sent_by_staff_id created_at sent_at', '060'),
    ('send_list', 'id list_date branch_id student_id reason amount message status run_id handled_by_staff_id handled_at created_at kind', '060'),
    ('approvals', 'id kind action payload requested_by_type requested_by_id run_id student_id branch_id status decided_by_staff_id decided_at reason result created_at ai_note ai_note_at policy_rule_id', '061'),
    ('student_requests', 'id student_id branch_id kind details status approval_id created_at decided_at', '062'),
    ('seat_releases', 'id membership_id student_id branch_id desk_id starts_at ends_at source probability status parent_id created_at closed_at', '063'),
    ('seat_resales', 'id release_id booking_id branch_id desk_id member_student_id amount credit_amount credit_cashback_id collision collision_at collision_cashback_id created_at', '063'),
    ('walkin_price_days', 'branch_id price_date change_pct occupancy reason source set_by_staff_id computed_at', '064'),
    ('enquiry_dedupe', 'id branch_id enquiry_a enquiry_b verdict confidence reason status run_id decided_by_staff_id created_at', '064'),
    ('enquiry_chats', 'id enquiry_id branch_id key_hash phone created_at', '064'),
    ('enquiry_chat_messages', 'id chat_id role body status ip_hash run_id sent_by_staff_id created_at sent_at', '064'),
    ('referral_links', 'id code channel branch_id label referrer_student_id is_active created_by_staff_id created_at', '065'),
    ('referral_attributions', 'id link_id branch_id phone kind converted_student_id converted_at reward_approval_id created_at', '065'),
    ('exam_notices', 'id source exam_name exam_family notified_on apply_by exam_date url status run_id created_by_staff_id reviewed_by_staff_id reviewed_at created_at', '066'),
    ('checkin_records', 'id student_id branch_id booking_id kind result distance_m accuracy_m detail created_at', '068'),
    ('checkin_consents', 'student_id version consented_at', '068'),
    ('seat_preferences', 'student_id desk_ids tags updated_at', '068'),
    ('food_orders', 'id branch_id student_id booking_id items total note status food_bill_id cancel_reason handled_by_staff_id created_at updated_at', '069'),
    ('supplier_orders', 'id branch_id items status decided_by_staff_id decided_at created_at updated_at', '069'),
    ('tickets', 'id branch_id student_id category priority details desk_label status resolution handled_by_staff_id created_at updated_at resolved_at', '069'),
    ('task_photos', 'id task_id completion_date photo_path uploaded_by_staff_id created_at', '069'),
    ('policy_rules', 'id scope bucket outcome support agreement description status decided_by_staff_id decided_at applied_count created_at updated_at', '071'),
    ('experiments', 'id kind name branch_id variants status started_at ends_at winner result created_by_staff_id decided_by_staff_id decided_at created_at', '071'),
    ('experiment_exposures', 'experiment_id student_id variant exposed_at converted_at', '071'),
    ('study_buddies', 'student_id branch_id exam_family study_window active created_at', '071'),
    ('study_buddy_matches', 'id student_a student_b a_answer b_answer status created_at', '071'),
    ('study_certificates', 'id student_id branch_id hall_name student_name date_from date_to hours days signature issued_at revoked_at', '072'),
    ('parent_links', 'id student_id token_hash created_at revoked_at last_viewed_at', '072'),
    ('parent_digests', 'student_id week_start summary created_at', '072')
  ) AS expected(table_name, columns_expected, introduced_in) LOOP
    rel := to_regclass(format('public.%I',r.table_name));
    IF rel IS NULL THEN
      INSERT INTO pss_diagnostic_report VALUES ('01 Schema',r.table_name,'FAIL',
        'Table missing; introduced in migration '||r.introduced_in,
        'Apply missing migrations in order through 073; do not recreate tables by hand.');
      CONTINUE;
    END IF;
    SELECT string_agg(c, ', ' ORDER BY c) INTO missing
      FROM unnest(string_to_array(r.columns_expected,' ')) AS cols(c)
      WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=rel AND a.attname=c AND a.attnum>0 AND NOT a.attisdropped);
    SELECT format('RLS=%s; primary_key=%s; policies=%s',c.relrowsecurity,
      EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=rel AND k.contype='p'),
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid=rel)) INTO details
      FROM pg_class c WHERE c.oid=rel;
    INSERT INTO pss_diagnostic_report
      SELECT '01 Schema',r.table_name,
        CASE WHEN missing IS NOT NULL OR NOT c.relrowsecurity OR
          NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=rel AND k.contype='p')
          THEN 'FAIL' ELSE 'PASS' END,
        CASE WHEN missing IS NULL THEN 'Expected column names present. ' ELSE 'Missing columns: '||missing||'. ' END||details,
        CASE WHEN missing IS NOT NULL THEN 'Apply missing migrations in order through 073.'
          WHEN NOT c.relrowsecurity THEN 'RLS is disabled: review grants and enable RLS through a reviewed migration. Migration 004 omits it for overtime_sessions.'
          WHEN NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=rel AND k.contype='p') THEN 'Restore the expected primary key using the owning migration.'
          ELSE 'Catalog check only: data types, defaults, constraint definitions and business behavior still need integration tests.' END
      FROM pg_class c WHERE c.oid=rel;
    IF EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=rel) THEN
      INSERT INTO pss_diagnostic_report VALUES ('02 Access',r.table_name||' policies','WARN',
        'Direct-access RLS policies exist; this app normally uses service-role Edge Functions.',
        'Review policies in Supabase. Presence of RLS alone does not prove access is restricted.');
    END IF;
  END LOOP;

  -- 2. Existing constraints and indexes: catalog health, without exercising writes.
  SELECT count(*) INTO n FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname='public' AND NOT i.indisvalid;
  INSERT INTO pss_diagnostic_report VALUES ('01 Schema','Invalid public indexes',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END,n||' invalid index(es).','Repair invalid indexes before rollout.');
  SELECT count(*) INTO n FROM pg_constraint c JOIN pg_namespace s ON s.oid=c.connamespace
    WHERE s.nspname='public' AND NOT c.convalidated;
  INSERT INTO pss_diagnostic_report VALUES ('01 Schema','Unvalidated public constraints',
    CASE WHEN n=0 THEN 'PASS' ELSE 'WARN' END,n||' unvalidated constraint(s).','Review before validating against existing data.');
  FOR r IN SELECT * FROM (VALUES
    ('idx_payment_proofs_confirmed_utr'),('staff_username_lower_key'),
    ('idx_lockers_branch_locker_active'),('idx_anomaly_flags_ref'),
    ('idx_supplier_orders_draft'),('idx_parent_links_live')
  ) AS critical(index_name) LOOP
    SELECT i.indisvalid AND i.indisunique INTO flag_table
      FROM pg_index i WHERE i.indexrelid=to_regclass('public.'||r.index_name);
    INSERT INTO pss_diagnostic_report VALUES ('01 Schema',r.index_name,
      CASE WHEN coalesce(flag_table,false) THEN 'PASS' ELSE 'FAIL' END,
      'Required unique index valid='||coalesce(flag_table,false),
      'Missing or invalid: inspect the migration that defines this index; SQL does not test races.');
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('events','events_no_update_delete'),('events','events_no_truncate'),
    ('lockers','trg_release_orphaned_locker')
  ) AS expected(table_name,trigger_name) LOOP
    SELECT count(*) INTO n FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public.'||r.table_name) AND t.tgname=r.trigger_name
        AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal;
    INSERT INTO pss_diagnostic_report VALUES ('01 Schema',r.trigger_name,
      CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END,'Enabled expected trigger count='||n,
      'Presence only; test append-only audit and locker cleanup with staging integration tests.');
  END LOOP;

  -- 3. SQL helpers are distinct from the api/agent/cron Edge Functions.
  FOREACH v IN ARRAY ARRAY['public.hash_staff_password(text)','public.verify_staff_login(text,text)',
    'public.release_orphaned_locker()','public.events_append_only()','public.purge_events(interval)',
    'public.pss_run_agent_job(text)','public.pss_run_cron_job(text)'] LOOP
    proc := to_regprocedure(v);
    INSERT INTO pss_diagnostic_report VALUES ('03 SQL functions',v,
      CASE WHEN proc IS NULL THEN 'FAIL' ELSE 'PASS' END,
      CASE WHEN proc IS NULL THEN 'Exact signature missing.' ELSE 'Exact signature exists; function not executed.' END,
      CASE WHEN v LIKE '%pss_run_%' THEN 'Install docs/ops/cron.sql with real Vault configuration if missing.'
        ELSE 'Apply the owning migration if missing; existence does not prove its result.' END);
    IF proc IS NOT NULL AND (v LIKE '%pss_run_%' OR v LIKE '%purge_events%') THEN
      SELECT count(*) INTO n FROM pg_roles roles WHERE roles.rolname IN ('anon','authenticated')
        AND has_function_privilege(roles.oid,proc,'EXECUTE');
      INSERT INTO pss_diagnostic_report VALUES ('02 Access',v,
        CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END,n||' browser roles can execute privileged helper.',
        'Expected EXECUTE revoked from PUBLIC, anon and authenticated.');
    END IF;
  END LOOP;

  -- 4. All 44 switches. OFF is an intentional state, not a successful feature test.
  flag_table := to_regclass('public.app_settings') IS NOT NULL;
  FOR r IN SELECT * FROM (VALUES
    ('pssai_cron', 'Scheduled housekeeping'),
    ('pssai_portal', 'Student portal and PIN login'),
    ('pssai_focus_pulse', 'Focus rating after staff checkout'),
    ('pssai_anomaly', 'Owner anomaly flags'),
    ('pssai_analyst', 'Owner AI analyst and morning brief'),
    ('pssai_upi_pay', 'Portal UPI payment and owner confirmation'),
    ('pssai_proof_reading', 'Automatic AI reading of payment screenshots'),
    ('pssai_auto_approve', 'Signup plan, PIN, ID and UPI onboarding'),
    ('pssai_concierge', 'Student AI chat assistant'),
    ('pssai_collections', 'Renewal and dues reminder send list'),
    ('pssai_ai_messages', 'AI welcome and study-report drafts'),
    ('pssai_realtime', 'Live refresh across staff tabs'),
    ('pssai_session_reminders', 'Session ending notice'),
    ('pssai_waitlist_offers', 'Permanent-seat offers'),
    ('pssai_portal_r2', 'Portal waitlist and cashback pages'),
    ('pssai_hour_release', 'Member releases cabin hours for resale'),
    ('pssai_overbooking', 'Predict unused cabin hours'),
    ('pssai_yield_pricing', 'Daily walk-in price changes'),
    ('pssai_enquiry_chat', 'Public enquiry assistant'),
    ('pssai_lead_tools', 'Lead scores and duplicate suggestions'),
    ('pssai_referral_links', 'Campaign and friend referral tracking'),
    ('pssai_exam_radar', 'Import public exam notice suggestions'),
    ('pssai_winback', 'Past-member offers'),
    ('pssai_next_exam', 'Next exam and follow-on plan'),
    ('pssai_paylater_advice', 'Pay-later risk advice'),
    ('pssai_exception_desk', 'AI recommendation on an approval'),
    ('pssai_self_checkin', 'QR and location self-check-in/out'),
    ('pssai_session_watch', 'Close forgotten sessions and flag corrections'),
    ('pssai_seat_matching', 'Preferred/best-fit seat suggestions'),
    ('pssai_live_seats', 'Portal free-seat counts'),
    ('pssai_food_orders', 'Student food ordering and kitchen queue'),
    ('pssai_food_stock', 'Stock use, demand and supplier drafts'),
    ('pssai_tickets', 'Student problem reports'),
    ('pssai_photo_tasks', 'Photo required for cleaning-task completion'),
    ('pssai_policy_learner', 'Learn owner rules and apply signed hold rules'),
    ('pssai_digital_twin', 'What-if simulations'),
    ('pssai_experiments', 'Owner A/B experiments'),
    ('pssai_space_yield', 'Space-use heatmap and suggestions'),
    ('pssai_portal_r4', 'Exam coach, focus profile and monthly Wrapped'),
    ('pssai_study_buddy', 'Opt-in study buddy matching'),
    ('pssai_retire_staff_ops', 'Retire desk-staff attendance/cover/messages'),
    ('pssai_certificates', 'Signed printable study certificates'),
    ('pssai_parent_digest', 'Revocable weekly family summary'),
    ('pssai_owner_overview', 'All-branch owner dashboard')
  ) AS expected(setting_key,label) LOOP
    BEGIN
      v := NULL;
      IF flag_table THEN EXECUTE 'SELECT value FROM public.app_settings WHERE key=$1' INTO v USING r.setting_key; END IF;
      INSERT INTO pss_diagnostic_report VALUES ('04 Features',r.setting_key,
        CASE WHEN NOT flag_table THEN 'BLOCKED' WHEN v='on' THEN 'ON_UNVERIFIED'
          WHEN v='off' OR v IS NULL THEN 'OFF' ELSE 'FAIL' END,
        r.label||': '||CASE WHEN v IS NULL THEN 'missing row; effective default is off'
          WHEN v='on' THEN 'enabled' WHEN v='off' THEN 'disabled' ELSE 'invalid on/off value (not displayed)' END,
        'An enabled flag does not prove dependencies or behavior. Test this feature in docs/PSSAI-FEATURE-TESTING.md.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('04 Features',r.setting_key,'BLOCKED',
        'Could not inspect setting; SQLSTATE='||SQLSTATE,'Check table schema and SQL Editor role.');
    END;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('pssai_ai_budget_usd','10'),('pssai_public_ai_daily','40'),
    ('pssai_enquiry_ai_daily','150'),('pssai_discount_confirm_over','1000'),('pssai_agent_shadow','on')
  ) AS controls(setting_key,default_value) LOOP
    BEGIN
      v := NULL;
      IF flag_table THEN EXECUTE 'SELECT value FROM public.app_settings WHERE key=$1' INTO v USING r.setting_key; END IF;
      result_status := 'PASS'; details := 'Value='||coalesce(v,'missing; default '||r.default_value);
      IF NOT flag_table THEN result_status := 'BLOCKED';
      ELSIF r.setting_key='pssai_agent_shadow' THEN
        IF v='off' THEN result_status:='WARN'; details:='Shadow review is OFF: chat may reply/act directly within permissions.';
        ELSIF v IS NOT NULL AND v<>'on' THEN result_status:='WARN'; details:='Invalid shadow value; application keeps review on.'; END IF;
      ELSIF v IS NULL THEN result_status:='WARN';
      ELSIF btrim(v) !~ '^[0-9]+([.][0-9]+)?$' THEN
        result_status:='FAIL'; details:='Invalid numeric control (not displayed); blanket off SQL may have overwritten it.';
      ELSIF v::numeric=0 THEN
        result_status:=CASE WHEN r.setting_key='pssai_discount_confirm_over' THEN 'FAIL' ELSE 'WARN' END;
        details:='Value=0: AI budget/quota blocks calls; discount threshold must be positive.';
      END IF;
      INSERT INTO pss_diagnostic_report VALUES ('05 Controls',r.setting_key,result_status,details,
        'Restore deliberately; do not blanket-set all pssai_ keys to on/off. Missing controls use code defaults.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('05 Controls',r.setting_key,'BLOCKED',
        'Could not inspect control; SQLSTATE='||SQLSTATE,'Check schema and SQL Editor role.');
    END;
  END LOOP;

  -- 5. Scheduler extensions and Vault metadata; secret values never leave the database.
  FOREACH v IN ARRAY ARRAY['pg_cron','pg_net','pgcrypto'] LOOP
    SELECT count(*) INTO n FROM pg_extension WHERE extname=v;
    INSERT INTO pss_diagnostic_report VALUES ('06 Jobs setup',v,
      CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END,'Installed='||(n>0),
      'Enable the extension in Supabase if missing; this script installs nothing.');
  END LOOP;
  FOREACH v IN ARRAY ARRAY['pss_project_url','pss_cron_secret'] LOOP
    BEGIN
      IF to_regclass('vault.decrypted_secrets') IS NULL THEN
        INSERT INTO pss_diagnostic_report VALUES ('06 Jobs setup',v,'BLOCKED','Vault view unavailable.',
          'Set up Vault and job helpers. Edge Function secrets are separate.'); CONTINUE;
      END IF;
      EXECUTE $q$SELECT count(*),count(*) FILTER (WHERE decrypted_secret IS NOT NULL AND btrim(decrypted_secret)<>''
        AND decrypted_secret NOT LIKE '%<%' AND decrypted_secret NOT LIKE '%YOUR_%')
        FROM vault.decrypted_secrets WHERE name=$1$q$ INTO n,m USING v;
      IF v='pss_project_url' THEN
        EXECUTE $q$SELECT count(*) FROM vault.decrypted_secrets WHERE name=$1
          AND rtrim(decrypted_secret,'/')='https://zripsszkprhtyccukrir.supabase.co'$q$ INTO m USING v;
      END IF;
      INSERT INTO pss_diagnostic_report VALUES ('06 Jobs setup',v,
        CASE WHEN n=1 AND m=1 THEN 'PASS' ELSE 'FAIL' END,
        'Exactly one valid value='||(n=1 AND m=1)||'; secret not displayed.',
        'Project URL must match zripsszkprhtyccukrir. Vault cron secret must also match Edge CRON_SECRET; SQL cannot verify that match.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('06 Jobs setup',v,'BLOCKED',
        'Vault check unavailable; SQLSTATE='||SQLSTATE,'Run as postgres; do not share secret values.');
    END;
  END LOOP;

  -- 6. All 27 schedules: existence, active flag and expected destination/action/cadence.
  FOR r IN SELECT * FROM (VALUES
    ('pss_expiry_alerts', '30 0 * * *', 'pss_run_cron_job', 'cron_expiry_alerts'),
    ('pss_purge_signups', '35 18 * * *', 'pss_run_cron_job', 'cron_purge_signups'),
    ('pss_purge_idempotency', '17 * * * *', 'pss_run_cron_job', 'cron_purge_idempotency'),
    ('pss_integrity_report', '30 20 * * *', 'pss_run_cron_job', 'cron_integrity_report'),
    ('pss_purge_images', '30 21 * * *', 'pss_run_cron_job', 'cron_purge_images'),
    ('pss_resume_holds', '25 * * * *', 'pss_run_cron_job', 'cron_resume_holds'),
    ('pss_session_reminders', '*/5 * * * *', 'pss_run_cron_job', 'cron_session_reminders'),
    ('pss_waitlist_offers', '*/15 * * * *', 'pss_run_cron_job', 'cron_waitlist_offers'),
    ('pss_owner_brief', '30 1 * * *', 'pss_run_agent_job', 'owner_brief'),
    ('pss_collections', '30 2 * * *', 'pss_run_agent_job', 'collections'),
    ('pss_yield_prices', '35 18 * * *', 'pss_run_cron_job', 'cron_yield_prices'),
    ('pss_predict_releases', '35 * * * *', 'pss_run_cron_job', 'cron_predict_releases'),
    ('pss_score_enquiries', '45 20 * * *', 'pss_run_cron_job', 'cron_score_enquiries'),
    ('pss_referrals', '0 21 * * *', 'pss_run_cron_job', 'cron_referral_conversions'),
    ('pss_paylater_scores', '15 21 * * *', 'pss_run_cron_job', 'cron_paylater_scores'),
    ('pss_next_exam', '40 2 * * *', 'pss_run_cron_job', 'cron_next_exam'),
    ('pss_enquiry_dedupe', '0 22 * * *', 'pss_run_agent_job', 'enquiry_dedupe'),
    ('pss_exam_radar', '0 1 * * *', 'pss_run_agent_job', 'exam_radar'),
    ('pss_winback', '30 3 * * 1', 'pss_run_agent_job', 'winback'),
    ('pss_exception_desk', '*/30 * * * *', 'pss_run_agent_job', 'exception_desk'),
    ('pss_close_sessions', '0 18 * * *', 'pss_run_cron_job', 'cron_close_forgotten_sessions'),
    ('pss_supplier_drafts', '30 15 * * *', 'pss_run_cron_job', 'cron_supplier_drafts'),
    ('pss_policy_rules', '50 20 * * 6', 'pss_run_cron_job', 'cron_policy_rules'),
    ('pss_apply_rules', '7,22,37,52 * * * *', 'pss_run_cron_job', 'cron_apply_policy_rules'),
    ('pss_experiments', '10 21 * * 0', 'pss_run_cron_job', 'cron_experiments'),
    ('pss_buddy_matches', '0 3 * * 1', 'pss_run_cron_job', 'cron_buddy_matches'),
    ('pss_parent_digest', '30 13 * * 0', 'pss_run_cron_job', 'cron_parent_digest')
  ) AS expected(job_name,cadence,helper,action_name) LOOP
    BEGIN
      IF to_regclass('cron.job') IS NULL THEN
        INSERT INTO pss_diagnostic_report VALUES ('07 Schedules',r.job_name,'BLOCKED','cron.job unavailable.',
          'Enable pg_cron and install schedules.'); CONTINUE;
      END IF;
      EXECUTE 'SELECT count(*) FROM cron.job WHERE jobname=$1' INTO n USING r.job_name;
      IF n<>1 THEN
        INSERT INTO pss_diagnostic_report VALUES ('07 Schedules',r.job_name,'FAIL','Matching schedules='||n,
          'Install the expected schedule once; inspect duplicate names.'); CONTINUE;
      END IF;
      EXECUTE 'SELECT active,schedule,command FROM cron.job WHERE jobname=$1 LIMIT 1' INTO x USING r.job_name;
      result_status:=CASE WHEN NOT coalesce(x.active,false) THEN 'OFF'
        WHEN position(r.helper||'(' IN x.command)=0 OR position(quote_literal(r.action_name) IN x.command)=0 THEN 'WARN'
        WHEN x.schedule<>r.cadence THEN 'WARN' ELSE 'PASS' END;
      INSERT INTO pss_diagnostic_report VALUES ('07 Schedules',r.job_name,result_status,
        'Active='||coalesce(x.active,false)||'; schedule='||x.schedule||'; expected='||r.cadence||' (UTC); command not displayed.',
        'PASS checks schedule configuration only; a successful cron SQL run may only enqueue HTTP. Inspect HTTP and application evidence.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('07 Schedules',r.job_name,'BLOCKED',
        'Schedule check unavailable; SQLSTATE='||SQLSTATE,'Check pg_cron schema/version and permissions.');
    END;
  END LOOP;

  -- 7. Three current private buckets; student-photos is a legacy setup reference.
  FOREACH v IN ARRAY ARRAY['student-photos','payment-proofs','id-photos','task-photos'] LOOP
    BEGIN
      IF to_regclass('storage.buckets') IS NULL THEN
        INSERT INTO pss_diagnostic_report VALUES ('08 Storage',v,'BLOCKED','Storage catalog unavailable.','Inspect Supabase Storage.'); CONTINUE;
      END IF;
      EXECUTE 'SELECT count(*) FROM storage.buckets WHERE id=$1' INTO n USING v;
      flag_table:=false;
      IF n>0 THEN EXECUTE 'SELECT public FROM storage.buckets WHERE id=$1' INTO flag_table USING v; END IF;
      INSERT INTO pss_diagnostic_report VALUES ('08 Storage',v,
        CASE WHEN v='student-photos' AND n=0 THEN 'WARN'
          WHEN n=0 THEN 'FAIL' WHEN v<>'student-photos' AND flag_table THEN 'FAIL' ELSE 'PASS' END,
        'Present='||(n>0)||'; public='||coalesce(flag_table,false),
        CASE WHEN v='student-photos' THEN 'Legacy bucket in older setup notes; current source does not use it. Verify any historical integrations before creating or changing it.'
          ELSE 'Must be private. Test upload and short-lived signed viewing links from the app.' END);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('08 Storage',v,'BLOCKED',
        'Bucket check unavailable; SQLSTATE='||SQLSTATE,'Check Storage schema and permissions.');
    END;
  END LOOP;

  -- 8. Bounded observations, aggregate counts/timestamps only, without personal records.
  FOR r IN SELECT * FROM (VALUES
    ('Active owner account', 'SELECT count(*) FROM public.staff WHERE is_active AND role::text=''owner'''),
    ('Active branches', 'SELECT count(*) FROM public.branches WHERE is_active'),
    ('Student portal PINs configured', 'SELECT count(*) FROM public.student_credentials'),
    ('Branch signup links configured', 'SELECT count(*) FROM public.branches WHERE signup_code IS NOT NULL'),
    ('Self-check-in branch setup', 'SELECT count(*) FROM public.branches WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND nullif(checkin_key,'''') IS NOT NULL')
  ) AS probes(label,sql_text) LOOP
    BEGIN
      EXECUTE r.sql_text INTO n;
      INSERT INTO pss_diagnostic_report VALUES ('09 Prerequisites',r.label,
        CASE WHEN n>0 THEN 'PRESENT_UNVERIFIED' ELSE 'NO_DATA' END,'Matching records='||n,
        'Data exists does not mean login, signup, location or authorization works; check the corresponding app flow.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('09 Prerequisites',r.label,'BLOCKED',
        'Prerequisite check unavailable; SQLSTATE='||SQLSTATE,'Inspect missing schema/permissions reported above.');
    END;
  END LOOP;

  BEGIN
    FOR x IN EXECUTE $q$SELECT agent,status,model,started_at,model_calls FROM public.agent_runs ORDER BY started_at DESC LIMIT 12$q$ LOOP
      INSERT INTO pss_diagnostic_report VALUES ('10 AI recent evidence',x.agent,
        CASE WHEN x.status='error' THEN 'FAIL' WHEN x.status IN ('refused','cut_short') THEN 'WARN'
          WHEN x.status='running' AND x.started_at<now()-interval '10 minutes' THEN 'WARN' ELSE 'OBSERVED' END,
        format('status=%s; model=%s; calls=%s; at=%s',x.status,x.model,x.model_calls,x.started_at),
        'Historical outcome only. Old success does not prove current deployment or model availability; refusals may be expected.');
    END LOOP;
    IF NOT FOUND THEN INSERT INTO pss_diagnostic_report VALUES ('10 AI recent evidence','Agent runs','NO_DATA',
      'No recorded AI runs.','Configure backend provider secrets and make an owner Analyst test request.'); END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pss_diagnostic_report VALUES ('10 AI recent evidence','Agent runs','BLOCKED',
      'Run inspection unavailable; SQLSTATE='||SQLSTATE,'Apply migration 057 and inspect schema/permissions.');
  END;
  FOREACH v IN ARRAY ARRAY['ollama','gemini','claude'] LOOP
    BEGIN
      EXECUTE $q$SELECT count(*) FILTER(WHERE a->>'status'='ok'),count(*) FILTER(WHERE a->>'status'='error')
        FROM (SELECT provider_attempts FROM public.agent_runs ORDER BY started_at DESC LIMIT 100) runs
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(provider_attempts)='array'
          THEN provider_attempts ELSE '[]'::jsonb END) a WHERE a->>'provider'=$1$q$ INTO n,m USING v;
      INSERT INTO pss_diagnostic_report VALUES ('10 AI recent evidence',v||' provider (last 100 runs)',
        CASE WHEN n+m=0 THEN 'NO_DATA' ELSE 'OBSERVED' END,'Successful attempts='||n||'; failed attempts='||m,
        'Historical traces only; Edge secrets, present model access, preference and fallback require live provider tests.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('10 AI recent evidence',v||' provider','BLOCKED',
        'Provider trace unavailable; SQLSTATE='||SQLSTATE,'Apply migration 073 and deploy the provider-aware functions.');
    END;
  END LOOP;

  BEGIN
    FOR x IN EXECUTE $q$SELECT action,ok,occurred_at FROM public.events WHERE actor_type='system'
      ORDER BY occurred_at DESC LIMIT 12$q$ LOOP
      INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence',x.action,
        CASE WHEN x.ok THEN 'OBSERVED' ELSE 'FAIL' END,'Action ok='||x.ok||'; at='||x.occurred_at,
        'An ok action can still be skipped/no-op. Confirm the expected output and eligibility in the app.');
    END LOOP;
    IF NOT FOUND THEN INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','System events','NO_DATA',
      'No recorded system events.','Verify schedules and cron function deployment.'); END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','System events','BLOCKED',
      'Event inspection unavailable; SQLSTATE='||SQLSTATE,'Apply migration 052 and inspect schema/permissions.');
  END;
  BEGIN
    FOR x IN EXECUTE $q$SELECT j.jobname,d.status,d.start_time FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid=d.jobid WHERE left(j.jobname,4)='pss_'
      ORDER BY d.start_time DESC LIMIT 12$q$ LOOP
      INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence',x.jobname||' scheduler',
        CASE WHEN x.status='failed' THEN 'FAIL' ELSE 'OBSERVED' END,'Scheduler status='||x.status||'; at='||x.start_time,
        'Succeeded here means scheduler SQL completed, not that Edge/AI/business processing succeeded.');
    END LOOP;
    IF NOT FOUND THEN INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','Scheduler history','NO_DATA',
      'No matching recorded scheduler runs.','History may be empty/disabled; wait for a scheduled run and check Edge logs.'); END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','Scheduler history','BLOCKED',
      'History unavailable; SQLSTATE='||SQLSTATE,'Inspect pg_cron and permissions.');
  END;
  BEGIN
    FOR x IN EXECUTE $q$SELECT id,created,status_code,timed_out,(error_msg IS NOT NULL) AS has_error
      FROM net._http_response ORDER BY created DESC LIMIT 12$q$ LOOP
      INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','HTTP request '||x.id,
        CASE WHEN coalesce(x.timed_out,false) OR x.has_error OR x.status_code>=400 THEN 'WARN' ELSE 'OBSERVED' END,
        'HTTP='||coalesce(x.status_code::text,'none')||'; at='||x.created,
        'pg_net-wide history, not necessarily this app. Bodies omitted; HTTP 200 may mean skipped. Responses may expire.');
    END LOOP;
    IF NOT FOUND THEN INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','HTTP history','NO_DATA',
      'No retained pg_net responses.','Not proof of failure: responses expire; inspect scheduled runs and Edge logs.'); END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pss_diagnostic_report VALUES ('11 Job recent evidence','HTTP history','BLOCKED',
      'HTTP history unavailable; SQLSTATE='||SQLSTATE,'Inspect pg_net and permissions.');
  END;
  FOR r IN SELECT * FROM (VALUES ('student_scores','computed_at'),('fingerprints','computed_at'),
    ('forecasts','computed_at'),('owner_briefs','created_at'),('focus_ratings','created_at')) AS outputs(table_name,time_column) LOOP
    BEGIN
      EXECUTE format('SELECT max(%I)::text FROM public.%I',r.time_column,r.table_name) INTO v;
      INSERT INTO pss_diagnostic_report VALUES ('12 Output evidence',r.table_name,
        CASE WHEN v IS NULL THEN 'NO_DATA' ELSE 'PRESENT_UNVERIFIED' END,'Latest timestamp='||coalesce(v,'none'),
        'Confirm freshness, qualifying history and accuracy; no rows can be a valid no-eligible-data outcome.');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pss_diagnostic_report VALUES ('12 Output evidence',r.table_name,'BLOCKED',
        'Output inspection unavailable; SQLSTATE='||SQLSTATE,'Inspect missing schema/permissions.');
    END;
  END LOOP;

  -- Honest boundaries: deliberately no false all-features-pass claim.
  FOREACH v IN ARRAY ARRAY['api / agent / cron deployed versions and gateway authorization',
    'OLLAMA_API_KEY / GEMINI_API_KEY / AI_API_KEY and current model access',
    'Frontend build, CORS, GitHub-to-Cloudflare deployment and signup routing',
    'Staff/student login, branch isolation and owner approval enforcement',
    'Payment confirmation, duplicate UTR handling, Food Pass and seat concurrency',
    'Storage uploads and signed URLs; realtime broadcast and UI refresh',
    'AI answer/extraction accuracy, refusal handling and provider fallback',
    'Long-running shadow/pilot measurements and manual approval fulfillment'] LOOP
    INSERT INTO pss_diagnostic_report VALUES ('13 Requires live testing',v,'UNVERIFIED',
      'SQL catalog/history inspection cannot prove this runtime behavior.',
      'Follow docs/PSSAI-FEATURE-TESTING.md and docs/ops/AI-PROVIDERS.md using staging test accounts.');
  END LOOP;
END;
$diagnostic$;

-- A single result table. Summary first, then every check grouped by section.
SELECT section,item,status,evidence,next_step FROM (
  SELECT '00 Summary'::text AS section,'Database readiness / observation counts'::text AS item,
    CASE WHEN count(*) FILTER (WHERE status='FAIL')>0 THEN 'ACTION_REQUIRED'
      ELSE 'REVIEW_REQUIRED' END::text AS status,
    format('FAIL=%s; BLOCKED=%s; WARN=%s; OFF=%s; ON_UNVERIFIED=%s; PASS=%s',
      count(*) FILTER(WHERE status='FAIL'),count(*) FILTER(WHERE status='BLOCKED'),
      count(*) FILTER(WHERE status='WARN'),count(*) FILTER(WHERE status='OFF'),
      count(*) FILTER(WHERE status='ON_UNVERIFIED'),count(*) FILTER(WHERE status='PASS')) AS evidence,
    'No ALL_WORKING verdict: resolve findings, then perform live feature tests. Counts can include intentional states and historical failures.'::text AS next_step
  FROM pss_diagnostic_report
  UNION ALL SELECT section,item,status,evidence,next_step FROM pss_diagnostic_report
) report ORDER BY section,item,evidence;
COMMIT;
