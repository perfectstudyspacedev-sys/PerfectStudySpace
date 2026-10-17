// The api edge function: one entry point for the staff app, the sign-up page and the public website.
// Since PSS-AI P0.4 this file is only the router; each action lives in domains/*.ts and is listed
// in registry.ts. The order is the same as the old if-chain: public actions run without a login,
// everything else needs a staff token (and marks the day's attendance) before the action runs.
import { withCors, err } from "../_shared/http.ts";
import { adminClient, authStaff, markAttendanceIfNeeded } from "../_shared/auth.ts";
import type { Caller, Ctx } from "./registry.ts";
import { REGISTRY } from "./actions.ts";

Deno.serve(async (req) => withCors(req, await handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null);

  try {
    const body = await req.json();
    const { action, ...payload } = body;
    const db = adminClient();
    const def = typeof action === "string" ? REGISTRY.get(action) : undefined;

    // ─── PUBLIC ───
    if (def && def.callers.includes("public")) {
      const ctx: Ctx = { db, req, action, actor: { type: "public", id: null } };
      return (await def.handler(ctx, payload)) ?? err(`Unknown action: ${action}`);
    }

    const staff = await authStaff(req);
    if (!staff) return err("Unauthorized", 401);
    await markAttendanceIfNeeded(db, staff.id, staff.role, staff.homeBranchId);

    if (!def) return err(`Unknown action: ${action}`);
    const ctx: Ctx = { db, req, action, staff, actor: { type: staff.role as Caller, id: staff.id } };
    return (await def.handler(ctx, payload)) ?? err(`Unknown action: ${action}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
}
