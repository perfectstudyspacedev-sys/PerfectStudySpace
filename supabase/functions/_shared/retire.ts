// PSS-AI Phase 5, S1 / C18 — retiring the desk-staff modules. With pssai_retire_staff_ops on,
// attendance is no longer marked on every request, End Session no longer cuts staff off, and the
// actions below answer 410. The switch is read on every staff request, so it is cached for a
// minute per instance; switching it takes effect within that minute.
// deno-lint-ignore-file no-explicit-any
import { featureOn } from "./flags.ts";

export const RETIRING_ACTIONS = ["list_staff_attendance", "end_staff_session", "assign_staff_override", "clear_staff_override", "get_staff_grid", "send_message"];
export const STAFF_DUTIES = ["desk", "kitchen", "housekeeping"] as const;
/** Reads that load by themselves on the owner's Staff page: shown as views, not counted as use. */
export const PASSIVE_READS = new Set(["list_staff_attendance", "get_staff_grid"]);

/**
 * C18: once the desk-staff modules retire, a desk-duty staff account no longer signs in (no
 * attendance, no End Session lock-out to protect an unattended desk). Fails closed: an account
 * whose duty can't be read counts as desk.
 */
export async function retiredDeskAccount(db: { from: (table: string) => any }, staffId: string, role: string): Promise<boolean> {
  if (role !== "staff" || !(await staffOpsRetired(db))) return false;
  const { data } = await db.from("staff").select("duty").eq("id", staffId).maybeSingle();
  return (data?.duty ?? "desk") === "desk";
}

const TTL_MS = 60_000;
let cached: { at: number; on: boolean } | null = null;

export async function staffOpsRetired(db: { from: (table: string) => any }): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.on;
  const on = await featureOn(db, "retire_staff_ops");
  cached = { at: Date.now(), on };
  return on;
}

/** Tests switch the setting between calls; production never needs this. */
export function resetRetireCache() { cached = null; }
