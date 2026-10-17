// The cron edge function (PSS-AI P0.7): pg_cron calls it through pg_net with the CRON_SECRET
// header and a body { "job": "<name>" }. Jobs are registry actions whose callers include
// 'system'; they run with the same event log as every other action (actor: system).
// Server to server only: no CORS, no staff token.
import { err } from "../_shared/http.ts";
import { adminClient } from "../_shared/auth.ts";
import { REGISTRY } from "../api/actions.ts";
import { runAction } from "../api/run.ts";

Deno.serve(handleCron);

// Compares in time that does not depend on where the strings differ.
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

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
