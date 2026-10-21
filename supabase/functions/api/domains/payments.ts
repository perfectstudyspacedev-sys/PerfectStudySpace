// PSS-AI P2.2 — UPI pay links and payment proofs (closes G11, G13, G17, G18). No payment gateway:
// the student pays an amount the code worked out, sends the UTR and/or a screenshot, and the
// owner confirms (D2). Confirming runs the existing payment action as the owner with payment mode
// upi, so no money logic is new (R1, R3). The AI may read a screenshot; it never confirms.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { proofChecks, readScreenshot } from "../../_shared/proofReader.ts";
import { actionDef } from "../registry-ref.ts";
import { runNested } from "../run.ts";
import { quoteRenewal, renewalPayload } from "../portal-lib.ts";
import { BUCKET, createPaymentRequest, decodeImage, OPEN, priceRequest, submitProof, upiSettings } from "../payments-lib.ts";
import { registrationAction } from "./onboarding.ts";

const me = (ctx: Ctx) => ctx.student!;

// What confirming a proof runs: the existing action, as the owner, by UPI.
async function confirmAction(ctx: Ctx, proof: any): Promise<{ name: string; payload: any } | { error: string }> {
  const { db } = ctx;
  const req = proof.request ?? {};
  const amount = Number(proof.amount_expected);
  if (proof.purpose === "renewal") {
    const { data: mem } = await db.from("memberships").select("*").eq("id", req.membershipId).maybeSingle();
    if (!mem || mem.student_id !== proof.student_id) return { error: "The membership for this renewal no longer exists" };
    const q = await quoteRenewal(db, mem, Number(req.months));
    if ("error" in q) return { error: `This renewal can't run now: ${q.error}` };
    if (Math.abs(q.amount - amount) > 0.5) return { error: `The renewal now costs ₹${q.amount}, but ₹${amount} was paid. Reject with a note, or settle it at the desk.` };
    return { name: "renew_membership", payload: renewalPayload(mem, Number(req.months), amount) };
  }
  if (proof.purpose === "dues") {
    const { data: mem } = await db.from("memberships").select("id, student_id, fee_due").eq("id", req.membershipId).maybeSingle();
    if (!mem || mem.student_id !== proof.student_id) return { error: "The membership for these dues no longer exists" };
    if (Number(mem.fee_due) + 0.5 < amount) return { error: `Only ₹${Number(mem.fee_due)} is due now, but ₹${amount} was paid. Reject with a note, or settle it at the desk.` };
    return { name: "record_payment", payload: { membershipId: mem.id, amount, paymentMode: "upi" } };
  }
  if (proof.purpose === "locker") {
    const { data: locker } = await db.from("lockers").select("id, student_id, monthly_fee, is_active").eq("id", req.lockerId).maybeSingle();
    if (!locker || locker.student_id !== proof.student_id || !locker.is_active) return { error: "This locker is no longer active" };
    if (Math.abs((Number(locker.monthly_fee) || 100) - amount) > 0.5) return { error: `The locker fee is now ₹${Number(locker.monthly_fee)}, but ₹${amount} was paid` };
    return { name: "renew_locker", payload: { lockerId: locker.id, paymentMode: "upi" } };
  }
  if (proof.purpose === "food_pass") {
    const { data: s } = await db.from("students").select("branch_id").eq("id", proof.student_id).maybeSingle();
    if (!s) return { error: "Student not found" };
    return { name: "topup_food_pass", payload: { studentId: proof.student_id, branchId: s.branch_id, amount, paymentMode: "upi" } };
  }
  if (proof.purpose === "registration") {
    return await registrationAction(ctx, proof);
  }
  return { error: "Unknown payment purpose" };
}

const PURPOSE_LABEL: Record<string, string> = { renewal: "renewal", dues: "dues", food_pass: "Food Pass top-up", locker: "locker renewal", registration: "registration" };

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student ───
    me_payment_request: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "upi_pay"))) return err("Paying in the portal is not open yet — please pay at the desk", 403);
      const s = me(ctx);
      if (!s.branch_id) return err("Your branch is not set — please ask at the desk");
      const priced = await priceRequest(db, s, payload);
      if ("error" in priced) return err(priced.error);
      const r = await createPaymentRequest(db, { student_id: s.id, branch_id: s.branch_id }, priced);
      if ("error" in r) return err(r.error!, r.status);
      return json(r);
    },

    me_submit_payment_proof: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "upi_pay"))) return err("Paying in the portal is not open yet — please pay at the desk", 403);
      const { data: proof } = typeof payload.reference === "string"
        ? await db.from("payment_proofs").select("*").eq("reference", payload.reference).eq("student_id", me(ctx).id).maybeSingle()
        : { data: null };
      if (!proof) return err("Payment not found", 404);
      if (!OPEN.includes(proof.status)) return err(`This payment is already ${proof.status}`);
      const r = await submitProof(db, proof, payload, me(ctx).id);
      if ("error" in r) return err(r.error!, (r as any).status);
      return json(r);
    },

    // ─── Owner (approval queue) ───
    list_payment_proofs: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const status = payload.status ?? "open";
      const statuses = status === "open" ? OPEN : [status];
      if (!statuses.every((x: string) => ["requested", "submitted", "confirmed", "rejected", "cancelled"].includes(x))) return err("Invalid status");
      const { data, error } = await ctx.db.from("payment_proofs")
        .select("id, student_id, signup_request_id, branch_id, purpose, request, amount_expected, reference, utr, image_path, ai_reading, checks, status, submitted_at, decided_at, reject_reason, transaction_ids, created_at, students(name, phone), signup_requests(name, phone), branches(name)")
        .in("status", statuses).order("status", { ascending: false }).order("submitted_at").order("created_at").limit(200);
      if (error) return err(error.message, 500);
      return json({
        proofs: (data ?? []).map((p: any) => ({
          ...p, amount_expected: Number(p.amount_expected), hasImage: !!p.image_path, image_path: undefined,
          name: p.students?.name ?? p.signup_requests?.name ?? null, phone: p.students?.phone ?? p.signup_requests?.phone ?? null,
          branch: p.branches?.name ?? null, students: undefined, signup_requests: undefined, branches: undefined,
        })),
      });
    },

    get_payment_proof_image: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const { data: p } = typeof payload.proofId === "string" ? await ctx.db.from("payment_proofs").select("image_path").eq("id", payload.proofId).maybeSingle() : { data: null };
      if (!p?.image_path) return err("No screenshot", 404);
      const { data, error } = await ctx.db.storage.from(BUCKET).createSignedUrl(p.image_path, 120);
      if (error || !data?.signedUrl) return err(error?.message ?? "Could not open the screenshot", 500);
      return json({ url: data.signedUrl });
    },

    read_payment_proof: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const { data: p } = typeof payload.proofId === "string" ? await db.from("payment_proofs").select("*").eq("id", payload.proofId).maybeSingle() : { data: null };
      if (!p?.image_path) return err("No screenshot to read", 404);
      const { data: blob, error } = await db.storage.from(BUCKET).download(p.image_path);
      if (error || !blob) return err(error?.message ?? "Could not load the screenshot", 500);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
      const decoded = decodeImage({ data: btoa(bin) });
      if ("error" in decoded) return err(decoded.error);
      const r = await readScreenshot(db, p.student_id, decoded);
      if (!r.reading) return err(`Not read: ${r.note}`, 503);
      const upi = await upiSettings(db);
      const checks = await proofChecks(db, p, r.reading, upi.vpa);
      await db.from("payment_proofs").update({ ai_reading: r.reading, checks }).eq("id", p.id);
      return json({ reading: r.reading, checks });
    },

    confirm_payment_proof: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Only the owner confirms payments", 403);
      if (typeof payload.proofId !== "string") return err("Payment not found", 404);
      const { data: before } = await db.from("payment_proofs").select("*").eq("id", payload.proofId).maybeSingle();
      if (!before) return err("Payment not found", 404);
      if (!OPEN.includes(before.status)) return err(`This payment is already ${before.status}`, 409);
      // Claim it first, so a second click (or a second owner) can never run the payment twice.
      const startedAt = new Date().toISOString();
      const { data: claimed } = await db.from("payment_proofs")
        .update({ status: "confirmed", decided_by_staff_id: staff.id, decided_at: startedAt })
        .eq("id", before.id).eq("status", before.status).select("id");
      if (!claimed?.length) return err("Someone else is deciding this payment — refresh", 409);
      const release = () => db.from("payment_proofs").update({ status: before.status, decided_by_staff_id: null, decided_at: null }).eq("id", before.id);

      const plan = await confirmAction(ctx, before);
      if ("error" in plan) { await release(); return err(plan.error, 409); }
      const ran = await runNested(actionDef(plan.name), ctx, {}, plan.payload);
      if (!ran.ok) { await release(); return err(`Not confirmed — ${plan.name} said: ${ran.body?.error ?? `HTTP ${ran.status}`}`, ran.status >= 500 ? 500 : 409); }
      const studentId = before.student_id ?? ran.body?.studentId ?? null;
      const { data: tx } = studentId
        ? await db.from("transactions").select("id").eq("student_id", studentId).eq("payment_mode", "upi").gte("created_at", startedAt)
        : { data: [] };
      await db.from("payment_proofs").update({ transaction_ids: (tx ?? []).map((t: any) => t.id), student_id: studentId }).eq("id", before.id);
      if (studentId) await notifyStudent(db, studentId, { kind: "payment_confirmed", title: `Payment ₹${Number(before.amount_expected)} confirmed`, body: `Your ${PURPOSE_LABEL[before.purpose]} payment (${before.reference}) is confirmed. Thank you!`, actionUrl: "/me/receipts", dedupeKey: `proof:${before.id}` });
      return json({ ok: true, action: plan.name, result: ran.body });
    },

    reject_payment_proof: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Only the owner decides payments", 403);
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 3) return err("Write a reason — the student will see it");
      const { data } = typeof payload.proofId === "string"
        ? await db.from("payment_proofs").update({ status: "rejected", reject_reason: reason.slice(0, 500), decided_by_staff_id: staff.id, decided_at: new Date().toISOString() })
          .eq("id", payload.proofId).in("status", OPEN).select("id, student_id, reference, amount_expected")
        : { data: null };
      const p = data?.[0];
      if (!p) return err("This payment is already decided, or does not exist", 409);
      if (p.student_id) await notifyStudent(db, p.student_id, { kind: "payment_rejected", title: `Payment ${p.reference} not accepted`, body: reason.slice(0, 500), actionUrl: "/me/pay", dedupeKey: `proof:${p.id}` });
      return json({ ok: true });
    },
  };
}
