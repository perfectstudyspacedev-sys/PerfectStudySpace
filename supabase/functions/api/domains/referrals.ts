// PSS-AI Phase 3 — referral attribution (closes G24) and SP11 (a student's own link and their
// cashbacks). The owner makes a link per channel (C10) and branch: join.perfectstudyspace.in/r/<code>
// opens that branch's current sign-up link with the channel filled in (so rotating the sign-up link
// never breaks a printed one). Each sign-up or enquiry chat from a link is an attribution; the
// nightly job marks those whose phone later got a membership. A student's friend link can earn
// them a reward, which waits in the owner's approval queue as grant_cashback (T3).
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { CODE_ALPHABET, fetchAllRows, randomCode } from "../lib.ts";
import { PORTAL_URL } from "./portal.ts";

export const CHANNELS = ["instagram", "google", "flex_banner", "friend", "whatsapp", "other"] as const;   // C10
// The "How did you hear about us?" value each channel stands for (students.referral_source).
export const CHANNEL_SOURCE: Record<string, string> = {
  instagram: "instagram", google: "google_search", flex_banner: "flex", friend: "word_of_mouth", whatsapp: "whatsapp", other: "other",
};
const CONVERT_WINDOW_DAYS = 120;
const isRefCode = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{8}$/.test(v);
const me = (ctx: Ctx) => ctx.student!;

/** The active link behind a code, if referral links are on. */
export async function activeLink(db: Ctx["db"], code: unknown) {
  if (!isRefCode(code) || !(await featureOn(db, "referral_links"))) return null;
  const { data } = await db.from("referral_links").select("id, code, channel, branch_id, referrer_student_id, is_active").eq("code", code).maybeSingle();
  return data?.is_active ? data : null;
}

/** Records that this phone came through the link (once per link and phone). */
export async function attributeReferral(db: Ctx["db"], code: unknown, branchId: string, phone: string, kind: "signup" | "enquiry", enquiryId?: string | null) {
  const link = await activeLink(db, code);
  if (!link || link.branch_id !== branchId || !/^\d{10}$/.test(phone)) return null;
  await db.from("referral_attributions").upsert({ link_id: link.id, branch_id: branchId, phone, kind }, { onConflict: "link_id,phone", ignoreDuplicates: true });
  if (enquiryId) await db.from("enquiries").update({ referral_link_id: link.id }).eq("id", enquiryId);
  return link;
}

async function newLinkCode(db: Ctx["db"]) {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(8, CODE_ALPHABET);
    const { data } = await db.from("referral_links").select("id").eq("code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not make a link code — try again");
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Owner ───
    list_referral_links: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const links = await fetchAllRows<any>(() => db.from("referral_links").select("id, code, channel, branch_id, label, referrer_student_id, is_active, created_at, branches(name), students:referrer_student_id(name)").order("created_at").order("id"));
      const attrs = await fetchAllRows<any>(() => db.from("referral_attributions").select("id, link_id, kind, converted_at").order("id"));
      const stats = new Map<string, { signups: number; enquiries: number; joined: number }>();
      for (const a of attrs) {
        const s = stats.get(a.link_id) ?? { signups: 0, enquiries: 0, joined: 0 };
        if (a.kind === "signup") s.signups++; else s.enquiries++;
        if (a.converted_at) s.joined++;
        stats.set(a.link_id, s);
      }
      return json({
        on: await featureOn(db, "referral_links"), base: PORTAL_URL(), channels: CHANNELS,
        links: links.map((l) => ({
          id: l.id, code: l.code, url: `${PORTAL_URL()}/r/${l.code}`, channel: l.channel, branchId: l.branch_id, branch: l.branches?.name ?? null,
          label: l.label, referrer: l.students?.name ?? null, isActive: l.is_active, createdAt: l.created_at,
          ...(stats.get(l.id) ?? { signups: 0, enquiries: 0, joined: 0 }),
        })),
      });
    },

    create_referral_link: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      if (!CHANNELS.includes(payload.channel) || payload.channel === "friend") return err("Choose a channel (a friend link is made by the student in the portal)");
      if (!requireBranch(staff, payload.branchId)) return err("Branch access denied", 403);
      const label = typeof payload.label === "string" ? payload.label.trim().slice(0, 80) || null : null;
      const { data, error } = await db.from("referral_links").insert({
        code: await newLinkCode(db), channel: payload.channel, branch_id: payload.branchId, label, created_by_staff_id: staff.id,
      }).select("id, code").single();
      if (error || !data) return err(error?.message ?? "Could not save", 500);
      return json({ id: data.id, code: data.code, url: `${PORTAL_URL()}/r/${data.code}` });
    },

    update_referral_link: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const update: Record<string, unknown> = {};
      if (typeof payload.isActive === "boolean") update.is_active = payload.isActive;
      if (typeof payload.label === "string") update.label = payload.label.trim().slice(0, 80) || null;
      if (!Object.keys(update).length) return err("Nothing to change");
      const { data } = typeof payload.id === "string" ? await ctx.db.from("referral_links").update(update).eq("id", payload.id).select("id") : { data: null };
      if (!data?.length) return err("Link not found", 404);
      return json({ ok: true });
    },

    // ─── Public: what a /r/<code> link opens ───
    public_referral_info: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const link = await activeLink(db, payload.ref);
      if (!link) return err("This link is not active. Please ask the desk for the sign-up link.", 404);
      const { data: branch } = await db.from("branches").select("id, name, signup_code, is_active").eq("id", link.branch_id).maybeSingle();
      if (!branch?.is_active || !branch.signup_code) return err("Sign-ups for this branch are not open online yet — please visit the desk.", 404);
      return json({ code: branch.signup_code, branchId: branch.id, branchName: branch.name, channel: link.channel, referralSource: CHANNEL_SOURCE[link.channel], ref: link.code });
    },

    // ─── System: who joined (nightly) ───
    cron_referral_conversions: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "referral_links"))) return json({ skipped: "pssai_referral_links is off" });
      const since = new Date(Date.now() - CONVERT_WINDOW_DAYS * 86400e3).toISOString();
      const open = await fetchAllRows<any>(() => db.from("referral_attributions").select("id, link_id, branch_id, phone, created_at, referral_links!link_id(referrer_student_id)")
        .is("converted_student_id", null).gte("created_at", since).order("id"));
      const { data: setting } = await db.from("app_settings").select("value").eq("key", "referral_reward_amount").maybeSingle();
      const reward = Math.round(Number(setting?.value) || 0);
      let converted = 0, rewards = 0;
      for (const a of open) {
        const { data: s } = await db.from("students").select("id, name").eq("phone", a.phone).maybeSingle();
        if (!s) continue;
        // Phase 3 review: only a new joiner counts — someone who was already a member before the
        // link was used is renewing, not joining — and one join rewards one link: the first this
        // phone came through.
        const { data: before } = await db.from("memberships").select("id").eq("student_id", s.id).lt("created_at", a.created_at).limit(1);
        if (before?.length) continue;
        const { data: first } = await db.from("referral_attributions").select("id").eq("phone", a.phone).order("created_at").order("id").limit(1);
        if (first?.[0]?.id !== a.id) continue;
        const { data: mem } = await db.from("memberships").select("id, created_at").eq("student_id", s.id).gte("created_at", a.created_at).order("created_at").limit(1);
        if (!mem?.length) continue;
        const { data: done } = await db.from("referral_attributions").update({ converted_student_id: s.id, converted_at: mem[0].created_at })
          .eq("id", a.id).is("converted_student_id", null).select("id");
        if (!done?.length) continue;
        converted++;
        const referrer = a.referral_links?.referrer_student_id;
        if (!referrer || !(reward > 0) || referrer === s.id) continue;
        const { data: r } = await db.from("students").select("id, branch_id").eq("id", referrer).maybeSingle();
        if (!r) continue;
        // A reward is money going out: the owner approves it (T3, Appendix D).
        const { data: appr } = await db.from("approvals").insert({
          kind: "t3_action", action: "grant_cashback", requested_by_type: "system", student_id: r.id, branch_id: r.branch_id,
          payload: { studentId: r.id, branchId: r.branch_id, cashbackType: "fixed", cashbackValue: reward, notes: `Referral: ${String(s.name).split(" ")[0]} joined` },
        }).select("id").single();
        if (appr) { await db.from("referral_attributions").update({ reward_approval_id: appr.id }).eq("id", a.id); rewards++; }
      }
      return json({ ok: true, checked: open.length, converted, rewardsQueued: rewards });
    },

    // ─── Student (SP11) ───
    me_referral: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "portal_r2")) || !(await featureOn(db, "referral_links"))) return json({ on: false });
      if (!s.branch_id) return err("Ask the desk to set your branch first");
      let { data: link } = await db.from("referral_links").select("id, code, is_active").eq("referrer_student_id", s.id).maybeSingle();
      if (!link) {
        const { data, error } = await db.from("referral_links").insert({ code: await newLinkCode(db), channel: "friend", branch_id: s.branch_id, referrer_student_id: s.id, label: `Friend of ${s.name}`.slice(0, 80) }).select("id, code, is_active").single();
        if (error?.code === "23505") ({ data: link } = await db.from("referral_links").select("id, code, is_active").eq("referrer_student_id", s.id).maybeSingle());
        else if (error || !data) return err(error?.message ?? "Could not make your link", 500);
        else link = data;
      }
      const { data: attrs } = await db.from("referral_attributions").select("converted_at").eq("link_id", link!.id);
      const { data: setting } = await db.from("app_settings").select("value").eq("key", "referral_reward_amount").maybeSingle();
      return json({
        on: true, active: link!.is_active, url: `${PORTAL_URL()}/r/${link!.code}`,
        joined: (attrs ?? []).filter((a: any) => a.converted_at).length, waiting: (attrs ?? []).filter((a: any) => !a.converted_at).length,
        reward: Math.round(Number(setting?.value) || 0) || null,
      });
    },

    me_cashbacks: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "portal_r2"))) return json({ on: false, cashbacks: [] });
      const { data } = await db.from("cashbacks").select("id, cashback_type, cashback_value, status, notes, redeemed_amount, redeemed_at, created_at")
        .eq("student_id", me(ctx).id).order("created_at", { ascending: false }).limit(50);
      const rows: { id: string; type: string; value: number; status: string; note: string | null; usedAmount: number | null; usedAt: string | null; at: string }[] = (data ?? []).map((c: any) => ({ id: c.id, type: c.cashback_type, value: Number(c.cashback_value), status: c.status, note: c.notes, usedAmount: c.redeemed_amount == null ? null : Number(c.redeemed_amount), usedAt: c.redeemed_at, at: c.created_at }));
      return json({ on: true, cashbacks: rows, pendingFixed: rows.filter((c) => c.status === "pending" && c.type === "fixed").reduce((t, c) => t + c.value, 0) });
    },
  };
}
