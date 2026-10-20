// Loads the REAL agent edge function (after harness.ts has loaded the api function) with the fake
// Claude client from fake-anthropic.ts. Import determinism.ts and harness.ts first.
// deno-lint-ignore-file no-explicit-any
// Imported (not just listed first) so the api function is loaded before Deno.serve is replaced
// below: modules with top-level await can otherwise run side by side.
import "./determinism.ts";
import "./harness.ts";
export { fakeAi, reply, text, toolUse, APIError } from "./fake-anthropic.ts";

Deno.env.set("CRON_SECRET", "cron-test-secret");
let agentHandler: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, "serve", { value: (h: any) => { agentHandler = h; return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {}, addr: {} }; }, configurable: true, writable: true });
await import(new URL("../../supabase/functions/agent/index.ts", import.meta.url).href);
if (!agentHandler) throw new Error("agent handler not captured");

/** Posts to the agent function: a staff token, or the cron secret for a job. */
export async function agent(body: any, opts: { token?: string; cronSecret?: string; origin?: string } = {}) {
  const res = await agentHandler!(new Request("http://fn.local/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cronSecret !== undefined ? { "x-cron-secret": opts.cronSecret } : {}),
      ...(opts.origin ? { Origin: opts.origin } : {}),
    },
    body: JSON.stringify(body),
  }));
  return { status: res.status, headers: res.headers, ...(await res.json()) };
}
