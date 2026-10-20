// The api edge function: one entry point for the staff app, the sign-up page and the public website.
// Since PSS-AI P0.4 this file is only the router; each action lives in domains/*.ts and is listed
// in registry.ts. The order is the same as the old if-chain: public actions run without a login,
// everything else needs a staff token (and marks the day's attendance) before the action runs.
// Since P0.5 every mutating action also writes one row to the events log, and inserts into the
// audited tables are stamped with the caller (see _shared/audit.ts). Since P0.6 a retried
// mutating action with the same Idempotency-Key header gets the stored answer (_shared/idempotency.ts).
// The run itself (logging, actor stamping, keys) is in run.ts, shared with the cron function.
import { withCors, err } from "../_shared/http.ts";
import { adminClient, authStaff, markAttendanceIfNeeded } from "../_shared/auth.ts";
import type { Caller } from "./registry.ts";
import { REGISTRY } from "./actions.ts";
import { runOnce } from "./run.ts";

const ROUTED: Caller[] = ["public", "staff", "owner", "admin"];

Deno.serve(async (req) => withCors(req, await handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null);

  try {
    const body = await req.json();
    const { action, ...payload } = body;
    const db = adminClient();
    const found = typeof action === "string" ? REGISTRY.get(action) : undefined;
    // Only actions a person may call: system jobs run through the cron function and agent-only
    // actions (P1.8) through the agent function, never through here.
    const def = found && found.callers.some((c) => ROUTED.includes(c)) ? found : undefined;

    // ─── PUBLIC ───
    if (def && def.callers.includes("public")) {
      return await runOnce(def, { db, req, action, actor: { type: "public", id: null } }, payload);
    }

    const staff = await authStaff(req);
    if (!staff) return err("Unauthorized", 401);
    await markAttendanceIfNeeded(db, staff.id, staff.role, staff.homeBranchId);

    if (!def) return err(`Unknown action: ${action}`);
    return await runOnce(def, { db, req, action, staff, actor: { type: staff.role as Caller, id: staff.id } }, payload);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
}
