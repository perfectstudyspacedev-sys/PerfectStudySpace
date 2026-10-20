// HTTP helpers shared by the edge functions: CORS allow-list and JSON responses.
// Moved unchanged from api/index.ts in PSS-AI P0.4.

// CORS (P0.1): only these websites may call the api from a browser. The ALLOWED_ORIGINS secret
// (comma-separated) replaces the built-in list. The public website is on it because its enquiry
// form posts to public_create_enquiry. Server-to-server calls (no Origin header) are unaffected.
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://perfect-study-space.pages.dev",
  "https://join.perfectstudyspace.in",
  "https://perfectstudyspace.in",
  "https://www.perfectstudyspace.in",
  "http://localhost:5173",
];
export function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS")?.trim();
  const list = raw ? raw.split(",") : DEFAULT_ALLOWED_ORIGINS;
  return list.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
}
export function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Vary": "Origin",
  };
  // Echo the caller's origin only when it is on the list; anyone else gets no allow header.
  if (origin && allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
export function withCors(req: Request, res: Response): Response {
  for (const [k, v] of Object.entries(corsHeadersFor(req.headers.get("Origin")))) res.headers.set(k, v);
  return res;
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 400) {
  return json({ error: message }, status);
}

// Compares a secret in time that does not depend on where the strings differ (cron and agent jobs).
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
