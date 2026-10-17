// Idempotency keys (PSS-AI P0.6): a retried request with the same Idempotency-Key header gets the
// stored answer instead of running a money action twice. Table: migration 054.
// deno-lint-ignore-file no-explicit-any
import { json, err } from "./http.ts";

type DB = { from: (table: string) => any };
const IN_PROGRESS = 0;
// A claim older than this belongs to a request that died without answering; a retry takes it over.
// Longer than the longest an edge function may run (400 s on paid plans), so a slow first try is
// never run a second time.
export const STALE_CLAIM_MS = 15 * 60 * 1000;
export const MAX_KEY_LENGTH = 200;

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as any)[k])]));
  return v;
}

/** HMAC-SHA-256 (hex) of the action and its payload, independent of key order. Keyed with a
 *  server secret, so a stored hash of a payload holding a password cannot be guessed offline. */
export async function requestHash(action: string, payload: unknown, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify([action, stable(payload)])));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Claim =
  | { kind: "run"; key: string }   // this request owns the key: run the action, then finish()
  | { kind: "answer"; res: Response } // replay, still running, or key misuse: send this as is
  | { kind: "skip" };               // no idempotency (table unavailable): run as before

/** Claims `key` for this request, or returns the answer a retry should get. */
export async function claimKey(db: DB, key: string, action: string, actorId: string | null, hash: string): Promise<Claim> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await db.from("idempotency_keys").insert({ key, action, actor_id: actorId, request_hash: hash, status: IN_PROGRESS, response: {} });
    if (!error) return { kind: "run", key };
    if (error.code !== "23505") {
      // e.g. migration 054 not applied yet: behave exactly as before rather than refuse writes
      console.error("idempotency claim failed:", error.message, action);
      return { kind: "skip" };
    }
    const { data: row } = await db.from("idempotency_keys")
      .select("action, actor_id, request_hash, status, response, created_at").eq("key", key).maybeSingle();
    if (!row) continue; // removed in between (a 5xx released it): claim again
    if (row.action !== action || row.actor_id !== actorId || row.request_hash !== hash) {
      return { kind: "answer", res: err("This was already submitted with different details. Refresh to check what was saved, then try again.", 422) };
    }
    if (row.status !== IN_PROGRESS) {
      const res = json(row.response, row.status);
      res.headers.set("Idempotent-Replayed", "true");
      return { kind: "answer", res };
    }
    if (Date.now() - new Date(row.created_at).getTime() < STALE_CLAIM_MS) {
      return { kind: "answer", res: err("This request is still being processed — please wait a moment and check before trying again", 409) };
    }
    await db.from("idempotency_keys").delete().eq("key", key).eq("status", IN_PROGRESS);
  }
  return { kind: "answer", res: err("This request is still being processed — please wait a moment and check before trying again", 409) };
}

/** Stores the answer for later retries (2xx and 4xx), or releases the key after a 5xx. */
export async function finishKey(db: DB, key: string, res: Response) {
  try {
    if (res.status >= 500) {
      await db.from("idempotency_keys").delete().eq("key", key);
      return;
    }
    const body = await res.clone().json();
    const { error } = await db.from("idempotency_keys").update({ status: res.status, response: body }).eq("key", key);
    if (error) console.error("idempotency store failed:", error.message);
  } catch (e) {
    console.error("idempotency store failed:", e instanceof Error ? e.message : e);
    await db.from("idempotency_keys").delete().eq("key", key);
  }
}
