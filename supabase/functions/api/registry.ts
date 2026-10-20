// Action registry types and metadata (PSS-AI P0.4, P0.9). Metadata lives apart from the handlers
// so it can be loaded without the edge runtime (Vitest reads it in tests/registry).
// Tiers follow Appendix D of docs/plans/PSS-AI-execution-plan.md. In Phase 0 tiers and callers are
// declared and logged only; staff, owner and admin access still uses each handler's own checks (R6).
import type { adminClient, StaffRow } from "../_shared/auth.ts";

export type Caller = 'public' | 'staff' | 'owner' | 'admin' | 'agent' | 'student' | 'system';
export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

export interface Ctx {
  db: ReturnType<typeof adminClient>;
  req: Request;
  action: string;              // the action name, as the old handler saw it
  staff?: StaffRow;            // set for staff/owner/admin callers
  student?: { id: string };    // set for student callers (P2)
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

// name, tier, callers, mutating, idempotent
export const ACTION_META: ActionMeta[] = ([
  ["add_attendance", "T3", STAFF, true, false],
  ["add_desk", "T3", OWNER, true, false],
  ["add_enquiry_activity", "T1", STAFF, true, false],
  ["add_enquiry_followup", "T1", STAFF, true, false],
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
  ["close_membership", "T3", STAFF, true, false],
  ["collect_food_bill_shortfall", "T2", STAFF, true, false],
  ["create_enquiry", "T1", STAFF, true, false],
  ["create_food_bill", "T2", STAFF, true, false],
  ["create_food_item", "T3", OWNER, true, false],
  ["create_membership", "T2", STAFF, true, false],
  ["create_staff", "T3", OWNER, true, false],
  ["create_task", "T1", STAFF, true, false],
  ["create_walkin", "T2", STAFF, true, false],
  ["cron_expiry_alerts", "T1", SYSTEM, true, true],
  ["cron_integrity_report", "T0", SYSTEM, false, true],
  ["cron_purge_idempotency", "T3", SYSTEM, true, true],
  ["cron_purge_signups", "T3", SYSTEM, true, true],
  ["delete_enquiries", "T3", STAFF, true, false],
  ["delete_membership", "T3", STAFF, true, false],
  ["deny_signup_request", "T1", STAFF, true, false],
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
  ["list_branch_staff", "T0", STAFF, false, true],
  ["list_branches", "T0", STAFF_AGENT, false, true],
  ["list_cashbacks", "T0", STAFF, false, true],
  ["list_enquiries", "T0", STAFF_AGENT, false, true],
  ["list_enquiry_activities", "T0", STAFF, false, true],
  ["list_enquiry_followups", "T0", STAFF, false, true],
  ["list_fee_config", "T0", STAFF, false, true],
  ["list_food_bills", "T0", STAFF, false, true],
  ["list_food_items", "T0", STAFF, false, true],
  ["list_incomplete_tasks", "T0", STAFF, false, true],
  ["list_inventory_items", "T0", STAFF, false, true],
  ["list_inventory_log", "T0", STAFF, false, true],
  ["list_lockers", "T0", STAFF, false, true],
  ["list_messages", "T0", STAFF, false, true],
  ["list_open_enquiry_followups", "T0", STAFF, false, true],
  ["list_signup_requests", "T0", STAFF, false, true],
  ["list_staff", "T0", OWNER, false, true],
  ["list_staff_attendance", "T0", OWNER, false, true],
  ["list_students", "T0", STAFF, false, true],
  ["list_tasks", "T0", STAFF, false, true],
  ["list_today_bookings", "T0", STAFF, false, true],
  ["list_transactions", "T0", STAFF_AGENT, false, true],
  ["list_transfer_branches", "T0", STAFF, false, true],
  ["list_transfer_desks", "T0", STAFF, false, true],
  ["login", "T1", PUBLIC, true, true],
  ["lookup_student", "T0", STAFF, false, true],
  ["pause_membership", "T1", STAFF, true, false],
  ["pause_session", "T1", STAFF, true, false],
  ["public_create_enquiry", "T1", PUBLIC, true, true],
  ["public_signup_info", "T0", PUBLIC, false, true],
  ["public_signup_submit", "T1", PUBLIC, true, true],
  ["record_focus_rating", "T1", STAFF, true, false],
  ["record_locker_payment", "T2", STAFF, true, false],
  ["record_payment", "T2", STAFF, true, false],
  ["redeem_cashback_now", "T3", STAFF, true, false],
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
  ["rotate_signup_link", "T3", OWNER, true, false],
  ["save_owner_brief", "T1", AGENT, true, true],
  ["search_students_by_name", "T0", STAFF_AGENT, false, true],
  ["send_message", "T1", STAFF, true, false],
  ["set_overtime_excluded", "T3", STAFF, true, false],
  ["topup_food_pass", "T2", STAFF, true, false],
  ["transfer_student_branch", "T3", STAFF, true, false],
  ["update_attendance", "T3", STAFF, true, false],
  ["update_branch", "T3", OWNER, true, false],
  ["update_enquiry", "T1", STAFF, true, false],
  ["update_enquiry_followup", "T1", STAFF, true, false],
  ["update_fee_config", "T3", OWNER, true, false],
  ["update_food_item", "T3", OWNER, true, false],
  ["update_locker_due_date", "T3", STAFF, true, false],
  ["update_locker_number", "T3", STAFF, true, false],
  ["update_staff", "T3", OWNER, true, false],
  ["update_student_details", "T1", STAFF, true, false],
  ["update_task_status", "T1", STAFF, true, false],
  ["update_welcome_template", "T3", OWNER, true, false],
  ["whoami", "T0", STAFF, false, true],
] as [string, Tier, Caller[], boolean, boolean][]).map(([name, tier, callers, mutating, idempotent]) => ({ name, tier, callers, mutating, idempotent }));
