// PSS-AI Phase 3 — enquiries: I24 lead scores (closes G25), AI duplicate suggestions (G23), and
// the A2 enquiry chat's storage and staff side (G22). Scores and duplicate candidates are code
// (_shared/leads.ts); the AI judges candidate pairs and answers chat visitors in the agent
// function, and writes only through the agent-only save_* actions here. Merging uses the existing
// merge dialog on the Enquiries page.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { OPEN_STATUSES, scoreEnquiry, sourceRates } from "../../_shared/leads.ts";
import { fetchAllRows } from "../lib.ts";
import { attributeReferral } from "./referrals.ts";

const CHUNK = 200;
const REUSE_DAYS = 60;          // a chat from the same phone reuses an open enquiry this recent
const cleanBody = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function inChunks<T>(ids: string[], read: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── I24: nightly lead scores ───
    cron_score_enquiries: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "lead_tools"))) return json({ skipped: "pssai_lead_tools is off" });
      const since = new Date(Date.now() - 365 * 86400e3).toISOString();
      const all = await fetchAllRows<any>(() => db.from("enquiries").select("id, branch_id, name, phone, source, status, created_at, score").gte("created_at", since).order("id"));
      const open = all.filter((e) => OPEN_STATUSES.includes(e.status ?? "new"));
      const ids = open.map((e) => e.id);
      const acts = await inChunks(ids, async (part) => (await db.from("enquiry_activities").select("enquiry_id").in("enquiry_id", part)).data ?? []);
      const fus = await inChunks(ids, async (part) => (await db.from("enquiry_followups").select("enquiry_id").in("enquiry_id", part).eq("done", false)).data ?? []);
      const chats = await inChunks(ids, async (part) => (await db.from("enquiry_chats").select("id, enquiry_id").in("enquiry_id", part)).data ?? []);
      const msgs = await inChunks(chats.map((c: any) => c.id), async (part) => (await db.from("enquiry_chat_messages").select("chat_id").in("chat_id", part).eq("role", "visitor")).data ?? []);
      const count = (rows: any[], key: string) => rows.reduce((m, r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1), new Map<string, number>());
      const actN = count(acts, "enquiry_id"), fuN = count(fus, "enquiry_id"), msgByChat = count(msgs, "chat_id");
      const chatN = new Map<string, number>();
      for (const c of chats as any[]) chatN.set(c.enquiry_id, (chatN.get(c.enquiry_id) ?? 0) + (msgByChat.get(c.id) ?? 0));
      // Each branch's own history decides its rates.
      const byBranch = new Map<string, any[]>();
      for (const e of all) byBranch.set(e.branch_id, [...(byBranch.get(e.branch_id) ?? []), e]);
      const now = new Date().toISOString();
      let scored = 0, cleared = 0;
      for (const [, list] of byBranch) {
        const rates = sourceRates(list);
        for (const e of list) {
          const s = scoreEnquiry(e, rates, { activities: actN.get(e.id) ?? 0, openFollowup: (fuN.get(e.id) ?? 0) > 0, chatMessages: chatN.get(e.id) ?? 0 });
          if (s) { await db.from("enquiries").update({ score: s.score, score_reason: s.reason, scored_at: now }).eq("id", e.id); scored++; }
          else if (e.score != null) { await db.from("enquiries").update({ score: null, score_reason: null, scored_at: now }).eq("id", e.id); cleared++; }
        }
      }
      return json({ ok: true, scored, cleared });
    },

    // ─── AI duplicate suggestions ───
    list_enquiry_dedupe: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!requireBranch(ctx.staff!, payload.branchId)) return err("Branch access denied", 403);
      const { data } = await db.from("enquiry_dedupe").select("id, enquiry_a, enquiry_b, verdict, confidence, reason, created_at")
        .eq("branch_id", payload.branchId).eq("status", "open").in("verdict", ["same", "unsure"]).order("confidence", { ascending: false }).limit(50);
      return json({ on: await featureOn(db, "lead_tools"), suggestions: data ?? [] });
    },

    update_enquiry_dedupe: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!["merged", "dismissed"].includes(payload.status)) return err("Mark it merged or not the same");
      const { data: row } = typeof payload.id === "string" ? await db.from("enquiry_dedupe").select("id, branch_id").eq("id", payload.id).maybeSingle() : { data: null };
      if (!row) return err("Not found", 404);
      if (!requireBranch(ctx.staff!, row.branch_id)) return err("Branch access denied", 403);
      await db.from("enquiry_dedupe").update({ status: payload.status, decided_by_staff_id: ctx.staff!.id }).eq("id", row.id);
      return json({ ok: true });
    },

    save_dedupe_suggestions: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      if (!Array.isArray(payload.rows) || payload.rows.length > 200) return err("Invalid list");
      let saved = 0;
      for (const r of payload.rows) {
        if (typeof r.a !== "string" || typeof r.b !== "string" || r.a === r.b || !["same", "different", "unsure"].includes(r.verdict)) continue;
        const [a, b] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
        const { data } = await ctx.db.from("enquiry_dedupe").upsert({
          branch_id: r.branchId, enquiry_a: a, enquiry_b: b, verdict: r.verdict,
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)), reason: String(r.reason ?? "").slice(0, 300), run_id: ctx.runId ?? null,
        }, { onConflict: "enquiry_a,enquiry_b", ignoreDuplicates: true }).select("id");
        if (data?.length) saved++;
      }
      return json({ ok: true, saved });
    },

    // ─── A2: the enquiry chat (writes by the agent function only) ───
    // The visitor's message: opens the chat (finding or creating the enquiry) when there is none yet.
    save_enquiry_chat: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      const message = cleanBody(payload.message);
      if (!message) return err("Write a message");
      let chatId = typeof payload.chatId === "string" ? payload.chatId : null;
      let enquiryId: string | null = null;
      if (!chatId) {
        const o = payload.open ?? {};
        const name = String(o.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
        const phone = String(o.phone ?? "").replace(/\D/g, "");
        if (name.length < 2 || !/^\d{10}$/.test(phone) || typeof o.branchId !== "string" || typeof o.keyHash !== "string") return err("Name, phone and branch are needed");
        const { data: branch } = await db.from("branches").select("id, name").eq("id", o.branchId).eq("is_active", true).maybeSingle();
        if (!branch) return err("Choose a branch");
        const { data: open } = await db.from("enquiries").select("id").eq("branch_id", branch.id).eq("phone", phone).in("status", OPEN_STATUSES)
          .gte("created_at", new Date(Date.now() - REUSE_DAYS * 86400e3).toISOString()).order("created_at", { ascending: false }).limit(1);
        enquiryId = open?.[0]?.id ?? null;
        if (!enquiryId) {
          const { data: enq, error } = await db.from("enquiries").insert({ branch_id: branch.id, name, phone, source: "website_chat", message: message.slice(0, 500), created_by_staff_id: null }).select("id").single();
          if (error || !enq) return err(error?.message ?? "Could not save", 500);
          enquiryId = enq.id;
          await db.from("messages").insert({ branch_id: branch.id, sender_staff_id: null, recipient_type: "staff", content: `[new_enquiry] ${name} (…${phone.slice(-4)}) started a chat on the website.` });
        }
        if (typeof o.refCode === "string") await attributeReferral(db, o.refCode, branch.id, phone, "enquiry", enquiryId);
        const { data: chat, error: cErr } = await db.from("enquiry_chats").insert({ enquiry_id: enquiryId, branch_id: branch.id, key_hash: o.keyHash, phone }).select("id").single();
        if (cErr || !chat) return err(cErr?.message ?? "Could not open the chat", 500);
        chatId = chat.id;
      } else {
        const { data: chat } = await db.from("enquiry_chats").select("enquiry_id").eq("id", chatId).maybeSingle();
        if (!chat) return err("Chat not found", 404);
        enquiryId = chat.enquiry_id;
      }
      const now = new Date().toISOString();
      const { data: msg, error } = await db.from("enquiry_chat_messages").insert({ chat_id: chatId, role: "visitor", body: message, status: "sent", ip_hash: typeof payload.ipHash === "string" ? payload.ipHash : null, sent_at: now }).select("id").single();
      if (error || !msg) return err(error?.message ?? "Could not save", 500);
      await db.from("enquiries").update({ updated_at: now }).eq("id", enquiryId);
      return json({ chatId, enquiryId, messageId: msg.id });
    },

    save_enquiry_chat_reply: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      if (ctx.actor.type !== "agent") return err("Agents only", 403);
      const reply = cleanBody(payload.reply, 2000);
      if (!reply || typeof payload.chatId !== "string") return err("Nothing to save");
      const status = payload.draft === false ? "sent" : "draft";
      const { data, error } = await ctx.db.from("enquiry_chat_messages").insert({
        chat_id: payload.chatId, role: "assistant", body: reply, status, run_id: ctx.runId ?? null, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
      }).select("id").single();
      if (error || !data) return err(error?.message ?? "Could not save", 500);
      if (payload.needsTeam === true) {
        // The assistant could not answer from its facts: a person should reply (shown in the drawer).
        const { data: chat } = await ctx.db.from("enquiry_chats").select("enquiry_id").eq("id", payload.chatId).maybeSingle();
        if (chat) await ctx.db.from("enquiry_activities").insert({ enquiry_id: chat.enquiry_id, type: "note", note: "Website chat: the assistant asked a person to reply" });
      }
      return json({ id: data.id, status });
    },

    // ─── Staff: the chat in the enquiry drawer ───
    list_enquiry_chat: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data: enq } = typeof payload.enquiryId === "string" ? await db.from("enquiries").select("id, branch_id, phone, name").eq("id", payload.enquiryId).maybeSingle() : { data: null };
      if (!enq) return err("Enquiry not found", 404);
      if (!requireBranch(ctx.staff!, enq.branch_id)) return err("Branch access denied", 403);
      const { data: chats } = await db.from("enquiry_chats").select("id, created_at").eq("enquiry_id", enq.id).order("created_at");
      const ids = (chats ?? []).map((c: any) => c.id);
      const { data: msgs } = ids.length
        ? await db.from("enquiry_chat_messages").select("id, chat_id, role, body, status, created_at, sent_at").in("chat_id", ids).neq("status", "discarded").order("created_at").limit(500)
        : { data: [] };
      return json({ chats: (chats ?? []).map((c: any) => ({ id: c.id, at: c.created_at, messages: (msgs ?? []).filter((m: any) => m.chat_id === c.id) })) });
    },

    send_enquiry_chat_reply: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const body = cleanBody(payload.body, 2000);
      if (!body) return err("Write the reply");
      const { data: chat } = typeof payload.chatId === "string" ? await db.from("enquiry_chats").select("id, branch_id, enquiry_id").eq("id", payload.chatId).maybeSingle() : { data: null };
      if (!chat) return err("Chat not found", 404);
      if (!requireBranch(staff, chat.branch_id)) return err("Branch access denied", 403);
      const now = new Date().toISOString();
      if (typeof payload.draftId === "string") {
        const { data } = await db.from("enquiry_chat_messages").update({ status: "sent", body, sent_by_staff_id: staff.id, sent_at: now })
          .eq("id", payload.draftId).eq("chat_id", chat.id).eq("status", "draft").select("id");
        if (!data?.length) return err("This draft was already sent or discarded", 409);
      } else {
        await db.from("enquiry_chat_messages").insert({ chat_id: chat.id, role: "staff", body, status: "sent", sent_by_staff_id: staff.id, sent_at: now });
      }
      await db.from("enquiry_chat_messages").update({ status: "discarded" }).eq("chat_id", chat.id).eq("status", "draft").lt("created_at", now);
      await db.from("enquiry_activities").insert({ enquiry_id: chat.enquiry_id, type: "note", note: `Replied in the website chat: ${body.slice(0, 200)}` });
      return json({ ok: true });
    },

    discard_enquiry_chat_draft: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data: m } = typeof payload.draftId === "string"
        ? await db.from("enquiry_chat_messages").select("id, status, enquiry_chats!chat_id(branch_id)").eq("id", payload.draftId).maybeSingle() : { data: null };
      if (!m || m.status !== "draft") return err("Draft not found", 404);
      if (!requireBranch(ctx.staff!, (m as any).enquiry_chats?.branch_id)) return err("Branch access denied", 403);
      await db.from("enquiry_chat_messages").update({ status: "discarded" }).eq("id", m.id).eq("status", "draft");
      return json({ ok: true });
    },
  };
}
