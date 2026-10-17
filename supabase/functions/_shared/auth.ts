// Staff authentication shared by the edge functions: tokens, authStaff, role checks and the
// daily attendance mark. Moved unchanged from api/index.ts in PSS-AI P0.4.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, jwtVerify } from "https://esm.sh/jose@5";
import { todayISO } from "./dates.ts";

// A staff member's session token lasts 7 days, and the frontend keeps it in sessionStorage —
// which survives as long as the browser tab stays open (very common on an always-on
// front-desk computer). That means a staff member can be actively using the app all day
// without ever hitting the `login` action again, so attendance marked ONLY at login was
// silently never recording their presence on later days. This upsert (unique on
// staff_id+attendance_date, ignoreDuplicates) is cheap and idempotent, so it runs on every
// authenticated request rather than caching "already marked" in memory — an in-memory cache
// here would permanently mask a single failed attempt (e.g. a transient DB hiccup) for the
// rest of that day, which is worse than the negligible cost of a few extra no-op upserts.
export async function markAttendanceIfNeeded(db: ReturnType<typeof adminClient>, staffId: string, role: string, branchId: string | null) {
  if (role === "owner") return;
  const { error } = await db.from("staff_attendance").upsert(
    { staff_id: staffId, branch_id: branchId, attendance_date: todayISO() },
    { onConflict: "staff_id,attendance_date", ignoreDuplicates: true },
  );
  if (error) console.error("Failed to mark staff attendance:", error.message);
}

// No hardcoded fallback: a guessable default secret would let anyone forge staff JWTs
// (full account takeover). If the real secret isn't configured, fall back to a random
// value generated fresh per cold start — this fails safe (existing sessions/tokens just
// stop validating) instead of failing open with a publicly-known signing key.
export const JWT_SECRET = Deno.env.get("STAFF_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? (() => {
  console.error("STAFF_JWT_SECRET is not set — using an ephemeral per-instance secret. Set STAFF_JWT_SECRET in Supabase project secrets.");
  return crypto.randomUUID() + crypto.randomUUID();
})();

export async function signToken(payload: Record<string, unknown>) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as { sub: string; role: string; username: string };
}

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export type StaffRow = { id: string; username: string; role: string; display_name: string | null; branch_id: string | null; is_active: boolean; homeBranchId: string | null; isOverrideToday: boolean };

export async function authStaff(req: Request): Promise<StaffRow | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = await verifyToken(auth.slice(7));
    const db = adminClient();
    // Tolerate override_branch_id/override_date not existing yet (migration 029 not applied
    // to this environment) — fall back to a plain lookup instead of failing every request.
    let data: { id: string; username: string; role: string; display_name: string | null; branch_id: string | null; is_active: boolean; override_branch_id?: string | null; override_date?: string | null } | null = null;
    const withOverride = await db.from("staff")
      .select("id, username, role, display_name, branch_id, is_active, override_branch_id, override_date")
      .eq("id", payload.sub).single();
    if (withOverride.error) {
      const plain = await db.from("staff").select("id, username, role, display_name, branch_id, is_active").eq("id", payload.sub).single();
      data = plain.data;
    } else {
      data = withOverride.data;
    }
    if (!data?.is_active) return null;
    // Cuts off an already-open tab/device too, not just fresh logins — once "End Session"
    // has been recorded for today, every subsequent request from this staff member (any
    // token) is treated as unauthorized until tomorrow's attendance row resets it.
    if (data.role !== "owner") {
      const { data: att } = await db.from("staff_attendance").select("last_logout_at")
        .eq("staff_id", data.id).eq("attendance_date", todayISO()).maybeSingle();
      if (att?.last_logout_at) return null;
    }
    // A same-day branch override (covering an absent colleague) swaps in as the effective
    // branch_id for every requireBranch() check downstream — the staff member's actual
    // `branch_id` column (their permanent home branch) is untouched in the DB.
    const isOverrideToday = !!data.override_branch_id && data.override_date === todayISO();
    return {
      id: data.id, username: data.username, role: data.role, display_name: data.display_name,
      is_active: data.is_active,
      branch_id: isOverrideToday ? data.override_branch_id! : data.branch_id,
      homeBranchId: data.branch_id, isOverrideToday,
    };
  } catch { return null; }
}

export function isOwner(staff: StaffRow) { return staff.role === "owner"; }

// Outranks owner: can do everything owner can (every isOwnerOrAdmin(staff) gate below treats
// the two as equivalent), plus edit/delete rows owner cannot touch at all (see the
// *_admin_edit actions). Deliberately excluded from every owner-facing staff listing/count —
// list_staff, get_staff_grid, list_branch_staff, list_staff_attendance all add their own
// .neq("role", "admin") filter so this account never appears as a row owner can see or manage,
// independent of the access gate below (which controls what admin itself can call, not what
// owner can see).
export function isAdmin(staff: StaffRow) { return staff.role === "admin"; }

// Wherever the code checks isOwner() to gate an owner-only action, admin should pass too —
// admin outranks owner, not sits beside it. Every `isOwner(staff)` call site that gates a
// capability (30+ of them) was switched to this function so admin inherits all of them at
// once; isOwner itself stays untouched for the couple of spots that need to mean literally
// "the owner role", not "owner-or-admin".
export function isOwnerOrAdmin(staff: StaffRow) { return isOwner(staff) || isAdmin(staff); }

export function requireBranch(staff: StaffRow, branchId: string) {
  if (isOwnerOrAdmin(staff)) return true;
  return staff.branch_id === branchId;
}
