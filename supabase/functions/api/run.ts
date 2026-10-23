// Runs one registry action for a caller: idempotency key (P0.6), actor stamping and the event log
// (P0.5). Used by the api router and the cron function.
import { err, json } from "../_shared/http.ts";
import { actorColumnsAvailable, actorDb, eventRow, writeEvent } from "../_shared/audit.ts";
import { JWT_SECRET } from "../_shared/auth.ts";
import { claimKey, finishKey, MAX_KEY_LENGTH, requestHash } from "../_shared/idempotency.ts";
import { broadcastChange } from "../_shared/live.ts";
import type { ActionDef, Ctx } from "./registry.ts";

// Actions that are not safe to repeat (mutating, not idempotent) honour an Idempotency-Key: the
// first request runs and its answer is stored; a retry with the same key and the same request
// gets that answer back without running again. Without a key nothing changes.
// deno-lint-ignore no-explicit-any
export async function runOnce(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
  const key = ctx.req.headers.get("Idempotency-Key")?.trim();
  if (!key || !def.mutating || def.idempotent) return await runAction(def, ctx, payload);
  if (key.length > MAX_KEY_LENGTH) return err("Invalid Idempotency-Key");
  const claim = await claimKey(ctx.db, key, def.name, ctx.actor.id, await requestHash(def.name, payload, JWT_SECRET));
  if (claim.kind === "answer") return claim.res;
  const res = await runAction(def, ctx, payload);
  if (claim.kind === "run") await finishKey(ctx.db, key, res);
  return res;
}

// Runs one action and logs it: every mutating action (success or failure), and reads only for
// agent and student callers. The handler gets a client that stamps the caller on audited inserts;
// the event itself is written with the plain client.
// deno-lint-ignore no-explicit-any
export async function runAction(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
  let res: Response;
  // P2.3 (S9): a T3 action asked for by an agent or a student never runs here. It waits in the
  // owner's approval queue; the owner's approval runs it with the owner as actor.
  if ((ctx.actor.type === "agent" || ctx.actor.type === "student") && def.tier === "T3") {
    res = await queueForApproval(def, ctx, payload);
    await writeEvent(ctx.db, await eventRow(def, ctx.actor, ctx.runId, payload, res));
    return res;
  }
  try {
    const stamp = await actorColumnsAvailable(ctx.db);
    const handlerCtx: Ctx = { ...ctx, db: stamp ? actorDb(ctx.db, ctx.actor, ctx.runId) : ctx.db };
    res = (await def.handler(handlerCtx, payload)) ?? err(`Unknown action: ${ctx.action}`);
  } catch (e) {
    res = err(e instanceof Error ? e.message : "Server error", 500);
  }
  if (def.mutating || ctx.actor.type === "agent" || ctx.actor.type === "student") {
    await writeEvent(ctx.db, await eventRow(def, ctx.actor, ctx.runId, payload, res));
  }
  // P2.5: tell open staff screens something changed (only with pssai_realtime on). Never for public
  // callers (anyone could make every screen re-fetch), and a student's change only reaches their
  // own branch. In the edge runtime the signal is sent after the answer (waitUntil), so it never
  // slows the request; elsewhere (tests) it is awaited.
  if (def.mutating && res.status < 400 && ctx.actor.type !== "public") {
    const branchId = typeof payload?.branchId === "string" ? payload.branchId : ctx.staff?.branch_id ?? ctx.student?.branch_id ?? null;
    if (branchId || ctx.actor.type !== "student") {
      const sending = broadcastChange(ctx.db, branchId).catch(() => {});
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(sending);
      else await sending;
    }
  }
  return res;
}

async function queueForApproval(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
  const kept = JSON.stringify(payload ?? {}).length <= 8192 ? payload : { truncated: true };
  const { data, error } = await ctx.db.from("approvals").insert({
    kind: "t3_action", action: def.name, payload: kept, requested_by_type: ctx.actor.type, requested_by_id: ctx.actor.id,
    run_id: ctx.runId ?? null, student_id: ctx.student?.id ?? null, branch_id: ctx.student?.branch_id ?? null,
  }).select("id").single();
  if (error || !data) return err(`Could not queue this for approval: ${error?.message ?? "no id"}`, 500);
  return json({ pending_approval: data.id, message: "This needs the owner's approval. You will be told when it is decided." }, 202);
}

/** Runs another registry action inside a request, as the given scope (the owner approving, or a
 * branch-limited portal scope for a student's own hold). It goes through runAction, so it has its
 * own event and the T3 gate still applies to agent and student actors. */
export async function runNested(def: ActionDef, ctx: Ctx, scope: { staff?: Ctx["staff"]; actor?: Ctx["actor"] }, payload: any) {
  const res = await runAction(def, { ...ctx, action: def.name, staff: scope.staff ?? ctx.staff, actor: scope.actor ?? ctx.actor }, payload);
  const body = await res.clone().json().catch(() => ({}));
  return { status: res.status, ok: res.status < 400, body };
}
