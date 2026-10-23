// Action registry types and metadata (PSS-AI P0.4, P0.9). Metadata lives apart from the handlers
// so it can be loaded without the edge runtime (Vitest reads it in tests/registry).
// Tiers follow Appendix D of docs/plans/PSS-AI-execution-plan.md. In Phase 0 tiers and callers are
// declared and logged only; staff, owner and admin access still uses each handler's own checks (R6).
import type { adminClient, StaffRow } from "../_shared/auth.ts";
import type { StudentScope } from "../_shared/student.ts";

export type Caller = 'public' | 'staff' | 'owner' | 'admin' | 'agent' | 'student' | 'system';
export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

export interface Ctx {
  db: ReturnType<typeof adminClient>;
  req: Request;
  action: string;              // the action name, as the old handler saw it
  staff?: StaffRow;            // set for staff/owner/admin callers
  student?: StudentScope;      // set for student callers (P2.1): always the token's student
  actor: { type: Caller; id: string | null };
  runId?: string;              // agent runs (P1)
}

// A handler returns undefined only if the old block fell through; the router then answers
// "Unknown action", exactly as the old if-chain did.
// deno-lint-ignore no-explicit-any
export type Handler = (ctx: Ctx, payload: any) => Promise<Response | undefined>;

export interface ActionMeta {
  name: string;
  tier: Tier;
  callers: Caller[];
  mutating: boolean;           // false = read only
  idempotent: boolean;         // true = safe to retry without an idempotency key
}

export interface ActionDef<P = Record<string, unknown>> extends ActionMeta {
  validate?: (p: unknown) => P; // throw Error(message) → 400
  handler: Handler;
}

const STAFF: Caller[] = ["staff", "owner", "admin"];
const OWNER: Caller[] = ["owner", "admin"];
const ADMIN: Caller[] = ["admin"];
const PUBLIC: Caller[] = ["public"];
const SYSTEM: Caller[] = ["system"]; // scheduled jobs: cron function only (P0.7)
// P1.8: reads the owner analyst may call (agent/analyst.ts). Agents run with the owner's scope.
const STAFF_AGENT: Caller[] = [...STAFF, "agent"];
const OWNER_AGENT: Caller[] = [...OWNER, "agent"];
const AGENT: Caller[] = ["agent"];        // agent runs only: the api router refuses these
// P2.1: the student portal. Student tokens reach only these; staff tokens never do.
const STUDENT: Caller[] = ["student"];
// P2.4 A1: the student's own reads and requests the concierge may use for that student.
const STUDENT_AGENT: Caller[] = ["student", "agent"];

// name, tier, callers, mutating, idempotent
export const ACTION_META: ActionMeta[] = ([
  ["add_attendance", "T3", STAFF, true, false],
  ["add_desk", "T3", OWNER, true, false],
  ["add_enquiry_activity", "T1", STAFF, true, false],
  ["add_enquiry_followup", "T1", STAFF, true, false],
  ["add_exam_notice", "T1", OWNER, true, false],
  ["add_inventory_item", "T2", OWNER, true, false],
  ["add_locker", "T2", STAFF, true, false],
  ["add_manual_payment", "T2", STAFF, true, false],
  ["apply_loyalty_discount", "T3", STAFF, true, false],
  ["assign_staff_override", "T3", OWNER, true, false],
  ["avail_inventory_item", "T2", STAFF, true, false],
  ["cancel_early_renewal", "T3", STAFF, true, false],
  ["change_membership_cabin", "T3", STAFF, true, false],
  ["change_membership_plan", "T3", STAFF, true, false],
  ["check_in_member", "T1", STAFF, true, false],
  ["checkout_booking", "T2", STAFF, true, false],
  ["claim_signup_request", "T1", STAFF, true, false],
  ["clear_staff_override", "T3", OWNER, true, false],
  ["confirm_payment_proof", "T2", OWNER, true, false],
  ["close_membership", "T3", STAFF, true, false],
  ["collect_food_bill_shortfall", "T2", STAFF, true, false],
  ["create_enquiry", "T1", STAFF, true, false],
  ["create_food_bill", "T2", STAFF, true, false],
  ["create_food_item", "T3", OWNER, true, false],
  ["create_membership", "T2", STAFF, true, false],
  // Idempotent on purpose: its answer holds the code, which must never be stored with a retry key.
  ["create_portal_setup_code", "T1", STAFF, true, true],
  ["create_referral_link", "T1", OWNER, true, false],
  ["create_staff", "T3", OWNER, true, false],
  ["create_task", "T1", STAFF, true, false],
  ["create_walkin", "T2", STAFF, true, false],
  ["cron_expiry_alerts", "T1", SYSTEM, true, true],
  ["cron_integrity_report", "T0", SYSTEM, false, true],
  ["cron_next_exam", "T1", SYSTEM, true, true],
  ["cron_paylater_scores", "T1", SYSTEM, true, true],
  ["cron_predict_releases", "T1", SYSTEM, true, true],
  ["cron_referral_conversions", "T1", SYSTEM, true, true],
  ["cron_resume_holds", "T1", SYSTEM, true, true],
  ["cron_purge_idempotency", "T3", SYSTEM, true, true],
  ["cron_purge_images", "T3", SYSTEM, true, true],
  ["cron_purge_signups", "T3", SYSTEM, true, true],
  ["cron_score_enquiries", "T1", SYSTEM, true, true],
  ["cron_yield_prices", "T1", SYSTEM, true, true],
  ["decide_approval", "T1", OWNER, true, false],
  ["discard_chat_draft", "T1", STAFF, true, false],
  ["cron_session_reminders", "T1", SYSTEM, true, true],
  ["cron_waitlist_offers", "T1", SYSTEM, true, true],
  ["delete_enquiries", "T3", STAFF, true, false],
  ["delete_membership", "T3", STAFF, true, false],
  ["deny_signup_request", "T1", STAFF, true, false],
  ["discard_enquiry_chat_draft", "T1", STAFF, true, false],
  ["end_staff_session", "T3", STAFF, true, false],
  ["fix_membership_dates", "T3", OWNER, true, false],
  ["fix_negative_food_pass_balances", "T3", OWNER, true, false],
  ["get_actionable_items", "T0", STAFF_AGENT, false, true],
  ["get_combined_hall", "T0", OWNER, false, true],
  ["get_combined_pending", "T0", OWNER, false, true],
  ["get_combined_seatmap", "T0", OWNER, false, true],
  ["get_daily_report", "T0", STAFF_AGENT, false, true],
  ["get_dashboard", "T0", STAFF_AGENT, false, true],
  ["get_discounts_waivers", "T0", STAFF_AGENT, false, true],
  ["get_engagement_ranking", "T0", OWNER, false, true],
  ["get_feature_flags", "T0", STAFF, false, true],
  ["get_food_pass", "T0", STAFF, false, true],
  ["get_forecast", "T0", OWNER_AGENT, false, true],
  ["get_integrity_report", "T0", OWNER_AGENT, false, true],
  ["get_locker_removal_summary", "T0", STAFF, false, true],
  ["get_locker_status", "T0", STAFF, false, true],
  ["get_membership_closure_summary", "T0", STAFF, false, true],
  ["get_membership_delete_summary", "T0", STAFF, false, true],
  ["get_my_tasks_today", "T0", STAFF, false, true],
  ["get_owner_brief", "T0", OWNER, false, true],
  ["get_paylater_advice", "T0", STAFF, false, true],
  ["get_payment_proof_image", "T0", OWNER, false, true],
  ["get_permanent_waitlist", "T0", STAFF, false, true],
  ["get_recent_activity", "T0", STAFF, false, true],
  ["get_referral_stats", "T0", STAFF_AGENT, false, true],
  ["get_revenue", "T0", STAFF_AGENT, false, true],
  ["get_seat_map", "T0", STAFF, false, true],
  ["get_signup_link", "T0", STAFF, false, true],
  ["get_staff_grid", "T0", OWNER, false, true],
  ["get_student_profile", "T0", STAFF_AGENT, false, true],
  ["get_student_scores", "T0", OWNER_AGENT, false, true],
  ["get_student_study_report", "T0", STAFF, false, true],
  ["get_task_completion_report", "T0", STAFF, false, true],
  ["get_top_students", "T0", STAFF, false, true],
  ["get_welcome_template", "T0", STAFF, false, true],
  ["grant_cashback", "T3", STAFF, true, false],
  ["join_permanent_waitlist", "T1", STAFF, true, false],
  ["list_active_memberships", "T0", STAFF, false, true],
  ["list_alerts", "T0", STAFF, false, true],
  ["list_anomaly_flags", "T0", OWNER_AGENT, false, true],
  ["list_approvals", "T0", OWNER, false, true],
  ["list_branch_staff", "T0", STAFF, false, true],
  ["list_branches", "T0", STAFF_AGENT, false, true],
  ["list_cashbacks", "T0", STAFF, false, true],
  ["list_chat_threads", "T0", STAFF, false, true],
  ["list_enquiries", "T0", STAFF_AGENT, false, true],
  ["list_enquiry_activities", "T0", STAFF, false, true],
  ["list_enquiry_chat", "T0", STAFF, false, true],
  ["list_enquiry_dedupe", "T0", STAFF, false, true],
  ["list_enquiry_followups", "T0", STAFF, false, true],
  ["list_exam_notices", "T0", STAFF, false, true],
  ["list_fee_config", "T0", STAFF, false, true],
  ["list_food_bills", "T0", STAFF, false, true],
  ["list_food_items", "T0", STAFF, false, true],
  ["list_incomplete_tasks", "T0", STAFF, false, true],
  ["list_inventory_items", "T0", STAFF, false, true],
  ["list_inventory_log", "T0", STAFF, false, true],
  ["list_lockers", "T0", STAFF, false, true],
  ["list_messages", "T0", STAFF, false, true],
  ["list_open_enquiry_followups", "T0", STAFF, false, true],
  ["list_payment_proofs", "T0", OWNER, false, true],
  ["list_referral_links", "T0", OWNER, false, true],
  ["list_resellable_desks", "T0", STAFF, false, true],
  ["list_seat_resales", "T0", OWNER, false, true],
  ["list_send_list", "T0", OWNER, false, true],
  ["list_signup_requests", "T0", STAFF, false, true],
  ["list_staff", "T0", OWNER, false, true],
  ["list_staff_attendance", "T0", OWNER, false, true],
  ["list_students", "T0", STAFF, false, true],
  ["list_tasks", "T0", STAFF, false, true],
  ["list_today_bookings", "T0", STAFF, false, true],
  ["list_transactions", "T0", STAFF_AGENT, false, true],
  ["list_transfer_branches", "T0", STAFF, false, true],
  ["list_transfer_desks", "T0", STAFF, false, true],
  ["list_walkin_prices", "T0", OWNER, false, true],
  ["login", "T1", PUBLIC, true, true],
  ["lookup_student", "T0", STAFF, false, true],
  ["me_cancel_release", "T1", STUDENT, true, false],
  ["me_cashbacks", "T0", STUDENT, false, true],
  ["me_chat_history", "T0", STUDENT, false, true],
  ["me_chat_send", "T1", STUDENT, true, false],
  ["me_join_waitlist", "T1", STUDENT, true, false],
  ["me_leave_waitlist", "T1", STUDENT, true, false],
  ["me_login", "T1", PUBLIC, true, true],
  ["me_logout", "T1", STUDENT, true, true],
  ["me_mark_read", "T1", STUDENT, true, true],
  ["me_membership", "T0", STUDENT_AGENT, false, true],
  ["me_next_exam", "T0", STUDENT, false, true],
  ["me_notifications", "T0", STUDENT_AGENT, false, true],
  ["me_payment_request", "T2", STUDENT_AGENT, true, false],
  ["me_plans", "T0", STUDENT_AGENT, false, true],
  ["me_privacy", "T0", STUDENT, false, true],
  ["me_profile", "T0", STUDENT_AGENT, false, true],
  ["me_receipts", "T0", STUDENT_AGENT, false, true],
  ["me_referral", "T1", STUDENT, true, false],
  ["me_release_hours", "T1", STUDENT, true, false],
  ["me_releases", "T0", STUDENT, false, true],
  ["me_request", "T1", STUDENT, true, false],
  ["me_request_hold", "T1", STUDENT_AGENT, true, false],
  ["me_respond_offer", "T1", STUDENT, true, false],
  ["me_resume", "T1", STUDENT, true, false],
  ["me_set_pin", "T1", PUBLIC, true, true],
  ["me_study_report", "T0", STUDENT_AGENT, false, true],
  ["me_submit_payment_proof", "T2", STUDENT, true, false],
  ["me_update_contact", "T1", STUDENT, true, false],
  ["me_waitlist", "T0", STUDENT, false, true],
  ["pause_membership", "T1", STAFF, true, false],
  ["pause_session", "T1", STAFF, true, false],
  ["public_create_enquiry", "T1", PUBLIC, true, true],
  ["public_referral_info", "T0", PUBLIC, false, true],
  ["public_signup_info", "T0", PUBLIC, false, true],
  ["public_signup_pay", "T1", PUBLIC, true, true],
  ["public_signup_plans", "T0", PUBLIC, false, true],
  ["public_signup_proof", "T1", PUBLIC, true, true],
  ["public_signup_submit", "T1", PUBLIC, true, true],
  ["quote_walkin", "T0", STAFF, false, true],
  ["read_payment_proof", "T1", OWNER, true, false],
  ["record_focus_rating", "T1", STAFF, true, false],
  ["record_locker_payment", "T2", STAFF, true, false],
  ["record_payment", "T2", STAFF, true, false],
  ["redeem_cashback_now", "T3", STAFF, true, false],
  ["reject_payment_proof", "T1", OWNER, true, false],
  ["release_signup_request", "T1", STAFF, true, false],
  ["remove_desk", "T3", OWNER, true, false],
  ["remove_from_waitlist", "T1", STAFF, true, false],
  ["remove_locker", "T3", STAFF, true, false],
  ["renew_locker", "T2", STAFF, true, false],
  ["renew_membership", "T2", STAFF, true, false],
  ["resolve_alert", "T1", STAFF, true, false],
  ["resume_membership", "T1", STAFF, true, false],
  ["resume_session", "T1", STAFF, true, false],
  ["review_anomaly_flag", "T1", OWNER, true, false],
  ["review_exam_notice", "T1", OWNER, true, false],
  ["rotate_signup_link", "T3", OWNER, true, false],
  ["save_approval_note", "T1", AGENT, true, true],
  ["save_chat_reply", "T1", AGENT, true, true],
  ["save_dedupe_suggestions", "T1", AGENT, true, true],
  ["save_enquiry_chat", "T1", AGENT, true, true],
  ["save_enquiry_chat_reply", "T1", AGENT, true, true],
  ["save_exam_notices", "T1", AGENT, true, true],
  ["save_owner_brief", "T1", AGENT, true, true],
  ["save_send_list", "T1", AGENT, true, true],
  ["search_students_by_name", "T0", STAFF_AGENT, false, true],
  ["send_chat_reply", "T1", STAFF, true, false],
  ["send_enquiry_chat_reply", "T1", STAFF, true, false],
  ["send_message", "T1", STAFF, true, false],
  ["set_overtime_excluded", "T3", STAFF, true, false],
  ["set_walkin_price_day", "T3", OWNER, true, false],
  ["topup_food_pass", "T2", STAFF, true, false],
  ["transfer_student_branch", "T3", STAFF, true, false],
  ["update_attendance", "T3", STAFF, true, false],
  ["update_branch", "T3", OWNER, true, false],
  ["update_enquiry", "T1", STAFF, true, false],
  ["update_enquiry_dedupe", "T1", STAFF, true, false],
  ["update_enquiry_followup", "T1", STAFF, true, false],
  ["update_fee_config", "T3", OWNER, true, false],
  ["update_food_item", "T3", OWNER, true, false],
  ["update_locker_due_date", "T3", STAFF, true, false],
  ["update_locker_number", "T3", STAFF, true, false],
  ["update_referral_link", "T1", OWNER, true, false],
  ["update_send_list_item", "T1", OWNER, true, false],
  ["update_staff", "T3", OWNER, true, false],
  ["update_student_details", "T1", STAFF, true, false],
  ["update_task_status", "T1", STAFF, true, false],
  ["update_welcome_template", "T3", OWNER, true, false],
  ["whoami", "T0", STAFF, false, true],
] as [string, Tier, Caller[], boolean, boolean][]).map(([name, tier, callers, mutating, idempotent]) => ({ name, tier, callers, mutating, idempotent }));
