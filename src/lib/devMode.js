// Temporary dev-mode switch, code-level only (no UI toggle) — flip DEV_MODE and redeploy
// to turn its gated behaviors on/off. Currently controls:
//   1. Letting staff (not just owner) see the Students spreadsheet view.
// The matching switch for "allow joining the permanent waitlist even with vacant seats"
// lives server-side in supabase/functions/api/index.ts (has its own DEV_MODE constant,
// since that check happens in the edge function, not here).
export const DEV_MODE = true
