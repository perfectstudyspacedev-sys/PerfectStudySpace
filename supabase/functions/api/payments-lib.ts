// Shared by the portal payments (domains/payments.ts) and A3 onboarding (domains/onboarding.ts):
// UPI pay links, payment requests and proof submission (PSS-AI P2.2). Amounts are always worked
// out by the caller from existing code; nothing here decides money.
// deno-lint-ignore-file no-explicit-any
import type { Ctx } from "./registry.ts";
import { featureOn } from "../_shared/flags.ts";
import { proofChecks, readScreenshot } from "../_shared/proofReader.ts";
import { publicAiAllowed } from "../_shared/ai.ts";
import { currentMembership, quoteRenewal, RENEWAL_MONTHS } from "./portal-lib.ts";

export const KEEP_SIGNUP_DAYS = 3;   // a sign-up with a payment waiting is kept this long (A3)
export const BUCKET = "payment-proofs";
export const MAX_IMAGE_BYTES = 1_572_864; // 1.5 MB
const FOOD_PASS_MIN = 100, FOOD_PASS_MAX = 5000;
export const OPEN = ["requested", "submitted"];
const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "PSS-" + [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

export async function upiSettings(db: Ctx["db"]) {
  const { data } = await db.from("app_settings").select("key, value").in("key", ["upi_vpa", "upi_payee_name"]);
  const v = new Map((data ?? []).map((r: any) => [r.key, String(r.value ?? "").trim()]));
  return { vpa: v.get("upi_vpa") || null, name: v.get("upi_payee_name") || "Perfect Study Space" };
}

// The UPI deep link (NPCI format). The VPA goes in as written: several UPI apps fail on an
// encoded "@". The payee name and note are percent-encoded.
export function upiLink(vpa: string, name: string, amount: number, reference: string) {
  const pa = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(vpa) ? vpa : encodeURIComponent(vpa);
  return `upi://pay?pa=${pa}&pn=${encodeURIComponent(name)}&am=${amount.toFixed(2)}&tn=${encodeURIComponent(reference)}&cu=INR`;
}

/** A decoded screenshot, checked by its first bytes (not just the declared type). */
export function decodeImage(image: any): { bytes: Uint8Array; mime: string; base64: string } | { error: string } {
  if (!image || typeof image.data !== "string") return { error: "Attach the screenshot again" };
  const base64 = image.data.replace(/^data:[^,]*,/, "");
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) return { error: "The screenshot is too large (1.5 MB at most)" };
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { return { error: "The screenshot could not be read" }; }
  if (bytes.length > MAX_IMAGE_BYTES) return { error: "The screenshot is too large (1.5 MB at most)" };
  const head = (n: number) => [...bytes.slice(0, n)];
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  const mime = head(3).join() === "255,216,255" ? "image/jpeg"
    : head(4).join() === "137,80,78,71" ? "image/png"
    : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" ? "image/webp" : null;
  if (!mime) return { error: "Send a JPG, PNG or WebP screenshot" };
  return { bytes, mime, base64 };
}

/** Works out what a payment request is for and how much it is. Money always comes from code. */
export async function priceRequest(db: Ctx["db"], student: { id: string; branch_id: string | null }, payload: any):
  Promise<{ purpose: string; amount: number; request: Record<string, unknown>; label: string } | { error: string }> {
  const purpose = payload.purpose;
  if (purpose === "renewal") {
    const months = Number(payload.months);
    if (!RENEWAL_MONTHS.includes(months)) return { error: "Choose 1, 2, 3 or 6 months" };
    const mem = await currentMembership(db, student.id);
    const q = await quoteRenewal(db, mem, months);
    if ("error" in q) return { error: q.error };
    return { purpose, amount: q.amount, request: { membershipId: mem.id, months }, label: `Renewal, ${months} month${months > 1 ? "s" : ""}` };
  }
  if (purpose === "dues") {
    const mem = await currentMembership(db, student.id);
    const due = Number(mem?.fee_due ?? 0);
    if (!mem || !(due > 0)) return { error: "There is nothing due on your membership" };
    return { purpose, amount: due, request: { membershipId: mem.id }, label: "Membership dues" };
  }
  if (purpose === "locker") {
    const { data: locker } = await db.from("lockers").select("id, locker_no, monthly_fee, fee_due").eq("student_id", student.id).eq("is_active", true).limit(1).maybeSingle();
    if (!locker) return { error: "You have no locker" };
    if (Number(locker.fee_due) > 0) return { error: `Your locker has ₹${Number(locker.fee_due)} pending — please clear it at the desk` };
    return { purpose, amount: Number(locker.monthly_fee) || 100, request: { lockerId: locker.id }, label: `Locker ${locker.locker_no}, one month` };
  }
  if (purpose === "food_pass") {
    const amount = Number(payload.amount);
    if (!Number.isInteger(amount) || amount < FOOD_PASS_MIN || amount > FOOD_PASS_MAX) return { error: `Top up between ₹${FOOD_PASS_MIN} and ₹${FOOD_PASS_MAX}` };
    const mem = await currentMembership(db, student.id);
    if (!mem) return { error: "A Food Pass needs an active membership" };
    return { purpose, amount, request: {}, label: "Food Pass top-up" };
  }
  return { error: "Choose what to pay for" };
}

/** Same request, field by field: Postgres returns jsonb keys in its own order, not the one written. */
export function sameRequest(a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  const x = a ?? {};
  const keys = new Set([...Object.keys(x), ...Object.keys(b)]);
  for (const k of keys) if (String(x[k] ?? "") !== String(b[k] ?? "")) return false;
  return true;
}

/** Creates (or reuses, within a day) a payment request and returns the pay link. */
export async function createPaymentRequest(db: Ctx["db"], owner: { student_id?: string | null; signup_request_id?: string | null; branch_id: string },
  priced: { purpose: string; amount: number; request: Record<string, unknown>; label: string }) {
  const upi = await upiSettings(db);
  if (!upi.vpa) return { error: "UPI payments are not set up yet — please pay at the desk", status: 503 };
  let q = db.from("payment_proofs").select("id, reference, amount_expected, request").eq("purpose", priced.purpose).eq("status", "requested")
    .gte("created_at", new Date(Date.now() - 24 * 3600e3).toISOString());
  q = owner.student_id ? q.eq("student_id", owner.student_id) : q.eq("signup_request_id", owner.signup_request_id);
  const { data: open } = await q;
  let row = (open ?? []).find((p: any) => Number(p.amount_expected) === priced.amount && sameRequest(p.request, priced.request));
  for (let attempt = 0; !row && attempt < 3; attempt++) {
    const { data, error } = await db.from("payment_proofs").insert({
      student_id: owner.student_id ?? null, signup_request_id: owner.signup_request_id ?? null, branch_id: owner.branch_id,
      purpose: priced.purpose, request: priced.request, amount_expected: priced.amount, reference: newReference(), status: "requested",
    }).select("id, reference, amount_expected").single();
    if (!error) row = data;
    else if (error.code !== "23505") return { error: error.message, status: 500 };
  }
  if (!row) return { error: "Could not create the payment — try again", status: 500 };
  return {
    reference: row.reference, amount: priced.amount, label: priced.label,
    upiLink: upiLink(upi.vpa, upi.name, priced.amount, row.reference), vpa: upi.vpa, payeeName: upi.name,
  };
}

/** Stores the UTR and/or screenshot of a requested payment and runs the checks (and the AI read). */
export async function submitProof(db: Ctx["db"], proof: any, payload: any, readerStudentId: string | null) {
  const utr = payload.utr != null && String(payload.utr).trim() !== "" ? String(payload.utr).replace(/\s/g, "") : null;
  if (utr !== null && !/^\d{12}$/.test(utr)) return { error: "The UTR (UPI reference) is 12 digits" };
  let image: { bytes: Uint8Array; mime: string; base64: string } | null = null;
  if (payload.image) {
    const decoded = decodeImage(payload.image);
    if ("error" in decoded) return { error: decoded.error };
    image = decoded;
  }
  if (!utr && !image && !proof.utr && !proof.image_path) return { error: "Send the 12-digit UTR, a screenshot of the payment, or both" };
  let imagePath = proof.image_path;
  if (image) {
    imagePath = `${proof.student_id ?? `signup-${proof.signup_request_id}`}/${proof.id}.${image.mime.split("/")[1]}`;
    const { error } = await db.storage.from(BUCKET).upload(imagePath, image.bytes, { contentType: image.mime, upsert: true });
    if (error) return { error: `Could not save the screenshot: ${error.message}`, status: 500 };
  }
  // Saved as submitted first, so a slow or failed AI read never loses the proof.
  const upi = await upiSettings(db);
  const typedUtr = utr ?? proof.utr;
  // A new screenshot replaces the old reading. Only a proof's first screenshot is read by itself;
  // the owner can read a replacement (read_payment_proof), so resending can't spend the budget.
  const firstImage = !!image && !proof.image_path && !proof.ai_reading;
  const reading0 = image ? null : (proof.ai_reading?.unread ? null : proof.ai_reading ?? null);
  const update: Record<string, unknown> = {
    utr: typedUtr, image_path: imagePath, status: "submitted", submitted_at: new Date().toISOString(),
    ...(image ? { ai_reading: null } : {}),
  };
  const checks = await proofChecks(db, { id: proof.id, amount_expected: proof.amount_expected, utr: typedUtr }, reading0, upi.vpa);
  if (image && !firstImage) checks.push("A new screenshot was sent — press Read to check it");
  update.checks = checks;
  const { error } = await db.from("payment_proofs").update(update).eq("id", proof.id).in("status", OPEN);
  if (error) return { error: error.message, status: 500 };
  if (proof.purpose === "registration" && proof.signup_request_id) {
    // The sign-up is kept while its payment waits for the owner.
    await db.from("signup_requests").update({ keep_until: new Date(Date.now() + KEEP_SIGNUP_DAYS * 86400e3).toISOString() }).eq("id", proof.signup_request_id);
  }
  if (image && firstImage && (await featureOn(db, "proof_reading"))) {
    const r = (await publicAiAllowed(db)) ? await readScreenshot(db, readerStudentId, image) : { reading: null, note: "today's limit for automatic reads is reached" };
    const after = await proofChecks(db, { id: proof.id, amount_expected: proof.amount_expected, utr: typedUtr }, r.reading, upi.vpa);
    update.checks = after;
    await db.from("payment_proofs").update({ ai_reading: r.reading ?? { unread: r.note }, checks: after }).eq("id", proof.id).eq("status", "submitted");
  }
  return { ok: true, submitted: true, checks: update.checks };
}

