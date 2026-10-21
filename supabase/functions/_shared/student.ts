// Student portal authentication (PSS-AI P2.1, SP1, D6): PIN and setup-code hashing, student
// tokens and authStudent(). Student tokens are signed with their own secret and carry
// typ 'student'; authStaff() refuses them and authStudent() refuses staff tokens, so neither
// can ever be used for the other's actions.
import { SignJWT, jwtVerify } from "https://esm.sh/jose@5";
import type { StaffRow } from "./auth.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

// Same fail-safe as the staff secret: without the real secret, tokens only live as long as this
// function instance (students log in again) instead of being signed with a guessable key.
const STUDENT_JWT_SECRET = Deno.env.get("STUDENT_JWT_SECRET") ?? (() => {
  console.error("STUDENT_JWT_SECRET is not set — using an ephemeral per-instance secret. Set it in Supabase project secrets.");
  return crypto.randomUUID() + crypto.randomUUID();
})();
const secretKey = () => new TextEncoder().encode(STUDENT_JWT_SECRET);

export const SESSION_DAYS = 30;
export const PIN_MAX_TRIES = 5;          // D6
export const PIN_LOCK_MINUTES = 15;      // D6
export const SETUP_CODE_HOURS = 24;
export const SETUP_CODE_MAX_TRIES = 5;

// ── PBKDF2 hashes: "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>" ──
const ITERATIONS = 100_000;
const DUMMY_SALT = new Uint8Array(16);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await derive(secret, salt, ITERATIONS))}`;
}

/** Checks a PIN or code against its stored hash. With no hash it still does the same work, so
 * "no such account" takes as long as "wrong PIN". */
export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  const parts = stored?.split("$") ?? [];
  const iterations = Number(parts[1]);
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) {
    await derive(secret, DUMMY_SALT, ITERATIONS);
    return false;
  }
  let salt: Uint8Array, expected: Uint8Array;
  try { salt = fromB64(parts[2]); expected = fromB64(parts[3]); }
  catch { await derive(secret, DUMMY_SALT, ITERATIONS); return false; }
  const actual = await derive(secret, salt, iterations);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Why a PIN can't be used, or null: 6 digits, not all the same, not a straight run. */
export function pinProblem(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return "The PIN must be exactly 6 digits";
  if (/^(\d)\1{5}$/.test(pin)) return "Choose a PIN that is not one digit repeated";
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return "Choose a PIN that is not a straight run like 123456";
  return null;
}

/** A uniformly random 6-digit code. */
export function newSetupCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4_294_000_000) return String(buf[0] % 1_000_000).padStart(6, "0");
  }
}

// ── Tokens and sessions ──
export interface StudentScope { id: string; name: string; phone: string; branch_id: string | null; sessionId: string }

/** Opens a 30-day session and returns its token. */
export async function openSession(db: Db, studentId: string): Promise<string> {
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  const { data, error } = await db.from("student_sessions")
    .insert({ student_id: studentId, expires_at: expires.toISOString() }).select("id").single();
  if (error || !data?.id) throw new Error(`Could not start a session: ${error?.message ?? "no id"}`);
  return await new SignJWT({ typ: "student", sid: data.id })
    .setProtectedHeader({ alg: "HS256" }).setSubject(studentId)
    .setIssuedAt().setExpirationTime(Math.floor(expires.getTime() / 1000)).sign(secretKey());
}

/** Ends every open session of a student (PIN changed or reset). */
export async function revokeSessions(db: Db, studentId: string) {
  await db.from("student_sessions").update({ revoked_at: new Date().toISOString() })
    .eq("student_id", studentId).is("revoked_at", null);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The student behind a portal request, or null. Staff tokens never pass. */
export async function authStudent(req: Request, db: Db): Promise<StudentScope | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), secretKey(), { algorithms: ["HS256"] });
    const sub = payload.sub, sid = payload.sid;
    if (payload.typ !== "student" || typeof sub !== "string" || !UUID.test(sub) || typeof sid !== "string" || !UUID.test(sid)) return null;
    const [{ data: session }, { data: student }] = await Promise.all([
      db.from("student_sessions").select("student_id, expires_at, revoked_at").eq("id", sid).maybeSingle(),
      db.from("students").select("id, name, phone, branch_id").eq("id", sub).maybeSingle(),
    ]);
    if (!session || session.student_id !== sub || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) return null;
    if (!student) return null;
    return { id: student.id, name: student.name, phone: student.phone, branch_id: student.branch_id, sessionId: sid };
  } catch {
    return null;
  }
}

/** A staff scope limited to one branch, for running a staff action (hold, resume) on a
 * student's behalf. It records no staff id; the event's actor is the student or the system. */
export function portalScope(branchId: string): StaffRow {
  return {
    id: null as unknown as string, username: "portal", role: "staff", display_name: "Student portal",
    branch_id: branchId, is_active: true, homeBranchId: branchId, isOverrideToday: false,
  };
}
