// Self sign-up (public page and staff side). Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { SIGNUP_PENDING_LIMIT, claimSignup, isSignupLinkCode, newSignupLinkCode, newSignupRef, purgeExpiredSignups, signupBusyMessage, signupClaimCutoff, validateSignupFields } from "../lib.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── SSP: public self sign-up page (/join/<code>) ───
    // Unauthenticated, so these two can only *submit*: nothing here reads back any stored
    // student data, and the answer is the same whether or not the phone is already a member
    // (that is shown to staff instead), so the page can't be used to look people up.
    public_signup_info: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db, action } = ctx;
      const staff = ctx.staff!;
      const code = payload.code;
      const { data: signupBranch } = isSignupLinkCode(code)
        ? await db.from("branches").select("id, name").eq("signup_code", code).eq("is_active", true).maybeSingle()
        : { data: null };
      if (!signupBranch) return err("This sign-up link is no longer valid. Please ask the desk for the current link.", 404);
      if (action === "public_signup_info") return json({ branchName: signupBranch.name });

      // Hidden "website" field: people never see it, form-filling bots do. Pretend it worked.
      if (String(payload.website ?? "").trim()) return json({ ok: true, ref: newSignupRef() });
      const v = validateSignupFields(payload);
      if ("error" in v) return err(v.error);

      await purgeExpiredSignups(db);
      const fields = {
        name: v.name, phone: v.phone, emergency_contact: v.emergencyContact,
        course: v.course, referral_source: v.referralSource,
      };
      const busy = "The desk is already processing your details — please speak to them.";
      const updateExisting = async (): Promise<Response | null> => {
        const { data: existing } = await db.from("signup_requests").select("id, ref_code, claimed_by_staff_id, claimed_at")
          .eq("branch_id", signupBranch.id).eq("phone", v.phone).maybeSingle();
        if (!existing) return null;
        // A resubmission corrects the waiting entry (same Ref) — unless staff are on it.
        const cutoff = signupClaimCutoff();
        if (existing.claimed_by_staff_id && existing.claimed_at && Date.parse(existing.claimed_at) >= Date.parse(cutoff)) return err(busy, 409);
        const { data: updated } = await db.from("signup_requests")
          .update({ ...fields, claimed_by_staff_id: null, claimed_at: null })
          .eq("id", existing.id)
          .or(`claimed_by_staff_id.is.null,claimed_at.lt.${cutoff}`)
          .select("id");
        if (!updated?.length) return err(busy, 409);
        return json({ ok: true, ref: existing.ref_code, updated: true });
      };
      const resubmitted = await updateExisting();
      if (resubmitted) return resubmitted;

      const { count: pendingCount } = await db.from("signup_requests")
        .select("*", { count: "exact", head: true }).eq("branch_id", signupBranch.id);
      if ((pendingCount ?? 0) >= SIGNUP_PENDING_LIMIT) {
        return err("We can't take more sign-ups right now — please speak to the desk.", 429);
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const ref = newSignupRef();
        const { error: insErr } = await db.from("signup_requests").insert({ branch_id: signupBranch.id, ref_code: ref, ...fields });
        if (!insErr) {
          // Popup for that branch's staff and the owner, through the same tagged-message path
          // as website enquiries. Only the last 4 digits of the phone go into chat.
          await db.from("messages").insert({
            branch_id: signupBranch.id, sender_staff_id: null, recipient_type: "staff",
            content: `[new_signup] ${v.name} (…${v.phone.slice(-4)}) · Ref #${ref}`,
          });
          return json({ ok: true, ref });
        }
        if (insErr.code !== "23505") {
          console.error("signup_requests insert failed:", insErr.message);
          return err("Your details could not be saved — please try again or speak to the desk.", 500);
        }
        // Unique clash: the same phone sent twice at the same moment (update that one), or the
        // random Ref collided with another waiting sign-up (try a new Ref).
        const raced = await updateExisting();
        if (raced) return raced;
      }
      return err("Your details could not be saved — please try again or speak to the desk.", 500);
    },
    // ─── SSP: staff side of self sign-up ───
    list_signup_requests: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let q = db.from("signup_requests")
        .select("id, branch_id, ref_code, name, phone, emergency_contact, course, referral_source, claimed_by_staff_id, claimed_at, created_at, branches(name), staff:claimed_by_staff_id(display_name, username)")
        .order("created_at").order("id");
      if (allBranches && isOwnerOrAdmin(staff)) {
        // every branch (owner/admin oversee all of them)
      } else {
        const bid = branchId ?? staff.branch_id;
        if (!bid || !requireBranch(staff, bid)) return err("Branch access denied", 403);
        q = q.eq("branch_id", bid);
      }
      // The 00:05 cron job does this once pssai_cron is on.
      if (!(await featureOn(db, "cron"))) await purgeExpiredSignups(db);
      const { data, error } = await q;
      if (error) return err(error.message, 500);
      type SignupRow = { id: string; branch_id: string; ref_code: string; name: string; phone: string; emergency_contact: string; course: string | null; referral_source: string; claimed_by_staff_id: string | null; claimed_at: string | null; created_at: string; branches: { name: string } | null; staff: { display_name: string | null; username: string } | null };
      const list = (data ?? []) as unknown as SignupRow[];

      // A phone that already holds an active membership must be renewed, not registered
      // again (create_membership refuses it) — flag it so Approve is disabled up front.
      const phones = [...new Set(list.map((r) => r.phone))];
      const members = new Map<string, { studentId: string; name: string; endDate: string; branch: string | null }>();
      if (phones.length) {
        const { data: studs } = await db.from("students").select("id, name, phone").in("phone", phones);
        const ids = (studs ?? []).map((s: { id: string }) => s.id);
        if (ids.length) {
          const { data: live } = await db.from("memberships").select("student_id, end_date, branches(name)").in("student_id", ids).eq("is_active", true);
          for (const m of (live ?? []) as unknown as { student_id: string; end_date: string; branches: { name: string } | null }[]) {
            const s = (studs ?? []).find((x: { id: string }) => x.id === m.student_id) as { id: string; name: string; phone: string } | undefined;
            if (s) members.set(s.phone, { studentId: s.id, name: s.name, endDate: m.end_date, branch: m.branches?.name ?? null });
          }
        }
      }
      const cutoffMs = Date.parse(signupClaimCutoff());
      return json({
        requests: list.map((r) => {
          const claimActive = !!r.claimed_by_staff_id && !!r.claimed_at && Date.parse(r.claimed_at) >= cutoffMs;
          return {
            id: r.id, branchId: r.branch_id, branchName: r.branches?.name ?? null, ref: r.ref_code,
            name: r.name, phone: r.phone, emergencyContact: r.emergency_contact, course: r.course,
            referralSource: r.referral_source, createdAt: r.created_at,
            handledBy: claimActive ? (r.staff?.display_name || r.staff?.username || "another staff member") : null,
            handledByMe: claimActive && r.claimed_by_staff_id === staff.id,
            activeMember: members.get(r.phone) ?? null,
          };
        }),
      });
    },
    claim_signup_request: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db, action } = ctx;
      const staff = ctx.staff!;
      const { id } = payload;
      const { data: reqRow } = await db.from("signup_requests").select("id, branch_id").eq("id", id).maybeSingle();
      if (!reqRow) return err("This sign-up was already handled by someone else (or has expired).", 409);
      if (!requireBranch(staff, reqRow.branch_id)) return err("Branch access denied", 403);

      if (action === "release_signup_request") {
        await db.from("signup_requests").update({ claimed_by_staff_id: null, claimed_at: null })
          .eq("id", id).eq("claimed_by_staff_id", staff.id);
        return json({ ok: true });
      }
      if (action === "claim_signup_request") {
        const claimed = await claimSignup(db, id, staff.id);
        if (!claimed) return err(await signupBusyMessage(db, id), 409);
        return json({
          request: {
            id: claimed.id, branchId: claimed.branch_id, ref: claimed.ref_code, name: claimed.name, phone: claimed.phone,
            emergencyContact: claimed.emergency_contact, course: claimed.course, referralSource: claimed.referral_source,
          },
        });
      }
      // Deny: deleted at once — but only if nobody else is mid-registration with it.
      for (const narrow of [
        (q: any) => q.is("claimed_by_staff_id", null),
        (q: any) => q.eq("claimed_by_staff_id", staff.id),
        (q: any) => q.lt("claimed_at", signupClaimCutoff()),
      ]) {
        const { data: gone } = await narrow(db.from("signup_requests").delete().eq("id", id)).select("id");
        if (gone?.length) return json({ ok: true });
      }
      return err(await signupBusyMessage(db, id), 409);
    },
    // The branch's public sign-up link. Any staff member of the branch can copy it (they hand
    // it to students at the desk); only the owner/admin can create it or make a new one, which
    // instantly stops the old link working (X3).
    get_signup_link: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db, action } = ctx;
      const staff = ctx.staff!;
      const { branchId } = payload;
      if (!branchId || !requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const { data: br } = await db.from("branches").select("id, signup_code").eq("id", branchId).maybeSingle();
      if (!br) return err("Branch not found", 404);
      if (action === "get_signup_link" && (br.signup_code || !isOwnerOrAdmin(staff))) {
        return json({ code: br.signup_code ?? null });
      }
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = newSignupLinkCode();
        let upd = db.from("branches").update({ signup_code: code }).eq("id", branchId);
        // First-time creation only fills an empty slot, so two owners opening the page
        // together can't each mint a different link.
        if (action === "get_signup_link") upd = upd.is("signup_code", null);
        const { data: saved, error: upErr } = await upd.select("signup_code");
        if (upErr && upErr.code === "23505") continue;
        if (upErr) return err(upErr.message, 500);
        if (saved?.length) return json({ code: saved[0].signup_code });
        const { data: now } = await db.from("branches").select("signup_code").eq("id", branchId).single();
        return json({ code: now?.signup_code ?? null });
      }
      return err("Could not create a link — try again", 500);
    },
  };
  h.public_signup_submit = h.public_signup_info;
  h.release_signup_request = h.claim_signup_request;
  h.deny_signup_request = h.claim_signup_request;
  h.rotate_signup_link = h.get_signup_link;
  return h;
}
