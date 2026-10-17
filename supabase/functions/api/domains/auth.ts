// Login, whoami and the website enquiry form. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { todayISO } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { markAttendanceIfNeeded, signToken } from "../../_shared/auth.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── PUBLIC ───
    login: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      // Stray leading/trailing whitespace (a common typo/autocomplete artifact) shouldn't
      // ever be the reason a valid login fails.
      const username = String(payload.username ?? "").trim();
      const password = String(payload.password ?? "").trim();
      if (!username || !password) return err("Username and password required");
      const { data, error } = await db.rpc("verify_staff_login", { p_username: username, p_password: password });
      if (error || !data?.length) return err("Invalid login credentials", 401);
      const row = data[0];

      // Once a staff member has ended their session for the day, they're locked out of
      // logging back in until tomorrow — mirrors clocking out at a physical front desk.
      // Owner is exempt (End Session isn't offered to them in the first place).
      if (row.role !== "owner") {
        const { data: att } = await db.from("staff_attendance").select("last_logout_at")
          .eq("staff_id", row.id).eq("attendance_date", todayISO()).maybeSingle();
        if (att?.last_logout_at) {
          return err("You've already ended your session for today — you can log in again tomorrow.", 403);
        }
      }

      const token = await signToken({ sub: row.id, role: row.role, username: row.username });

      // Auto-mark attendance on first login of the day (no-op if already marked) — owner is exempt
      await markAttendanceIfNeeded(db, row.id, row.role, row.branch_id);

      // If the owner reassigned this staff member to a different branch for today (covering
      // an absence), log them into that branch instead of their permanent home branch.
      let effectiveBranchId = row.branch_id;
      let effectiveBranchName = row.branch_name;
      let isOverrideToday = false;
      const { data: overrideRow } = await db.from("staff").select("override_branch_id, override_date").eq("id", row.id).single();
      if (overrideRow?.override_branch_id && overrideRow.override_date === todayISO()) {
        const { data: overrideBranch } = await db.from("branches").select("id, name").eq("id", overrideRow.override_branch_id).single();
        if (overrideBranch) {
          effectiveBranchId = overrideBranch.id;
          effectiveBranchName = overrideBranch.name;
          isOverrideToday = true;
        }
      }

      return json({
        token,
        staff: {
          id: row.id, username: row.username, role: row.role,
          displayName: row.display_name, branchId: effectiveBranchId, branchName: effectiveBranchName,
          homeBranchId: row.branch_id, isOverrideToday,
        },
      });
    },
    // Public (unauthenticated) endpoint for the marketing website's enquiry form. Guarded by a
    // shared secret only as a soft deterrent against casual bot/scraper spam — not real
    // security, since this is a static site and the secret is visible in its JS source. The
    // actual security boundary is unchanged: RLS on `enquiries` has zero policies, so the only
    // way in is this service-role adminClient() path, exactly like every other action.
    public_create_enquiry: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const expectedKey = Deno.env.get("PUBLIC_SITE_KEY");
      if (!expectedKey || payload.siteKey !== expectedKey) return err("Unauthorized", 401);

      const name = String(payload.name ?? "").trim();
      const phone = String(payload.phone ?? "").trim();
      const branchLabel = String(payload.branch ?? "").trim();
      const packageInterest = String(payload.packageInterest ?? "").trim();
      const message = String(payload.message ?? "").trim();

      if (!name) return err("Name is required");
      if (!phone) return err("Phone is required");

      // Website copy says "100ft Road"; the DB's seeded name is "100 Feet Road". Translate here
      // so the website never has to change its copy, and branches are looked up by name at
      // request time (never a hardcoded UUID) so this stays correct if the DB is reseeded.
      const BRANCH_ALIASES: Record<string, string> = { "100ft Road": "100 Feet Road" };
      const resolvedBranchName = BRANCH_ALIASES[branchLabel] ?? branchLabel;

      const { data: branch, error: branchError } = await db.from("branches")
        .select("id").eq("name", resolvedBranchName).maybeSingle();
      if (branchError || !branch) return err("Invalid branch");

      // No dedicated "package interest" column downstream — fold it into the free-text message,
      // prefixed so staff see it at a glance without losing whatever the visitor typed.
      let combinedMessage = packageInterest ? `Package interest: ${packageInterest}` : "";
      if (message) combinedMessage += (combinedMessage ? "\n\n" : "") + message;

      const { error: insertError } = await db.from("enquiries").insert({
        branch_id: branch.id,
        name,
        phone,
        source: "website_form",
        message: combinedMessage || null,
        created_by_staff_id: null,
      });
      if (insertError) return err(insertError.message);

      // Surface it to that branch's staff the same way as any other system-generated
      // notice — tagged so useMessageAlerts gives it its own icon/title instead of an
      // indistinguishable chat bubble, exactly like the [cross_branch] check-in notice
      // above. sender_staff_id is null: no staff member triggered this, the public
      // website form did, and the column allows null for that reason.
      await db.from("messages").insert({
        branch_id: branch.id, sender_staff_id: null, recipient_type: "staff",
        content: `[new_enquiry] ${name} (${phone}) enquired via the website${packageInterest ? ` — ${packageInterest}` : ""}.`,
      });

      return json({ ok: true });
    },
    // Lets the frontend re-sync a staff member's own profile (display name, branch
    // reassignment, etc.) without needing to log out and back in — polled periodically
    // so an owner's edit shows up in that staff member's already-open session promptly.
    // Also doubles as a lightweight "am I still allowed in" check: since it goes through
    // the same authStaff() gate above, a deactivated account or an ended-for-today
    // session gets a 401 here just like any other action.
    whoami: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { data: branch } = staff.branch_id
        ? await db.from("branches").select("name").eq("id", staff.branch_id).single()
        : { data: null };
      return json({
        staff: {
          id: staff.id, username: staff.username, role: staff.role,
          displayName: staff.display_name, branchId: staff.branch_id, branchName: branch?.name ?? null,
          homeBranchId: staff.homeBranchId, isOverrideToday: staff.isOverrideToday,
        },
      });
    },
  };
  return h;
}
