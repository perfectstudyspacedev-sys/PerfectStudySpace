// The cron edge function (PSS-AI P0.7): pg_cron calls it through pg_net with the CRON_SECRET
// header and a body { "job": "<name>" }. Jobs are registry actions whose callers include
// 'system'; they run with the same event log as every other action (actor: system).
// Server to server only: no CORS, no staff token.
import { err, sameSecret } from "../_shared/http.ts";
import { adminClient } from "../_shared/auth.ts";
import { REGISTRY } from "../api/actions.ts";
import { runAction } from "../api/run.ts";

Deno.serve(handleCron);

async function handleCron(req: Request): Promise<Response> {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret) return err("CRON_SECRET is not set", 500);
  if (req.method !== "POST" || !sameSecret(req.headers.get("x-cron-secret") ?? "", secret)) return err("Unauthorized", 401);
  try {
    const body = await req.json().catch(() => ({}));
    const job = body?.job;
    const def = typeof job === "string" ? REGISTRY.get(job) : undefined;
    if (!def || !def.callers.includes("system")) return err(`Unknown job: ${job}`);
    return await runAction(def, { db: adminClient(), req, action: job, actor: { type: "system", id: null } }, {});
  } catch (e) {
    return err(e instanceof Error ? e.message : "Server error", 500);
  }
}
