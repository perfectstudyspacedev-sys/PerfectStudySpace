// The api edge function: one entry point for the staff app, the sign-up page and the public website.
// Since PSS-AI P0.4 this file is only the router; each action lives in domains/*.ts and is listed
// in registry.ts. The order is the same as the old if-chain: public actions run without a login,
// everything else needs a staff token (and marks the day's attendance) before the action runs.
// Since P0.5 every mutating action also writes one row to the events log, and inserts into the
// audited tables are stamped with the caller (see _shared/audit.ts). Since P0.6 a retried
// mutating action with the same Idempotency-Key header gets the stored answer (_shared/idempotency.ts).
import { withCors, err } from "../_shared/http.ts";
import { adminClient, authStaff, markAttendanceIfNeeded } from "../_shared/auth.ts";
import { actorDb, eventRow, writeEvent } from "../_shared/audit.ts";
import { claimKey, finishKey, MAX_KEY_LENGTH, requestHash } from "../_shared/idempotency.ts";
import type { ActionDef, Caller, Ctx } from "./registry.ts";
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

// Actions that are not safe to repeat (mutating, not idempotent) honour an Idempotency-Key: the
// first request runs and its answer is stored; a retry with the same key and the same request
// gets that answer back without running again. Without a key nothing changes.
// deno-lint-ignore no-explicit-any
async function runOnce(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
  const key = ctx.req.headers.get("Idempotency-Key")?.trim();
  if (!key || !def.mutating || def.idempotent) return await runAction(def, ctx, payload);
  if (key.length > MAX_KEY_LENGTH) return err("Invalid Idempotency-Key");
  const claim = await claimKey(ctx.db, key, def.name, ctx.actor.id, await requestHash(def.name, payload));
  if (claim.kind === "answer") return claim.res;
  const res = await runAction(def, ctx, payload);
  if (claim.kind === "run") await finishKey(ctx.db, key, res);
  return res;
}

// Runs one action and logs it: every mutating action (success or failure), and reads only for
// agent and student callers. The handler gets a client that stamps the caller on audited inserts;
// the event itself is written with the plain client.
// deno-lint-ignore no-explicit-any
async function runAction(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
  let res: Response;
  try {
    const handlerCtx: Ctx = { ...ctx, db: actorDb(ctx.db, ctx.actor, ctx.runId) };
    res = (await def.handler(handlerCtx, payload)) ?? err(`Unknown action: ${ctx.action}`);
  } catch (e) {
    res = err(e instanceof Error ? e.message : "Server error", 500);
  }
  if (def.mutating || ctx.actor.type === "agent" || ctx.actor.type === "student") {
    await writeEvent(ctx.db, await eventRow(def, ctx.actor, ctx.runId, payload, res));
  }
  return res;
}
