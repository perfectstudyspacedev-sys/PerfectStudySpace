// Runs one registry action for a caller: idempotency key (P0.6), actor stamping and the event log
// (P0.5). Used by the api router and the cron function.
import { err } from "../_shared/http.ts";
import { actorDb, eventRow, writeEvent } from "../_shared/audit.ts";
import { claimKey, finishKey, MAX_KEY_LENGTH, requestHash } from "../_shared/idempotency.ts";
import type { ActionDef, Ctx } from "./registry.ts";

// Actions that are not safe to repeat (mutating, not idempotent) honour an Idempotency-Key: the
// first request runs and its answer is stored; a retry with the same key and the same request
// gets that answer back without running again. Without a key nothing changes.
// deno-lint-ignore no-explicit-any
export async function runOnce(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
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
export async function runAction(def: ActionDef, ctx: Ctx, payload: any): Promise<Response> {
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
