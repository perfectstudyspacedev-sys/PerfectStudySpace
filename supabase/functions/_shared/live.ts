// PSS-AI P2.5 live updates (G28): after a successful change the function sends an empty "changed"
// signal on Supabase Realtime Broadcast (REST endpoint), on branch:<id> when the branch is known,
// else on pss:all. No row data is sent — the staff app re-fetches through api() on the signal.
// Off unless pssai_realtime is on (read at most once a minute per function instance).
import { featureOn } from "./flags.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };
let cached = { on: false, at: 0 };

export async function broadcastChange(db: Db, branchId: string | null | undefined) {
  if (Date.now() - cached.at > 60_000) cached = { on: await featureOn(db, "realtime").catch(() => false), at: Date.now() };
  if (!cached.on) return;
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: branchId ? `branch:${branchId}` : "pss:all", event: "changed", payload: {} }] }),
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* a missed signal only means the next slow poll picks it up */ }
}

/** Tests only. */
export function resetLiveCache() { cached = { on: false, at: 0 }; }
