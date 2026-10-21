// PSS-AI P2.5 — scheduled portal notices. Session-end reminders (G3): one notice per session
// ending within 10 minutes. Waitlist offers (G10, C2): each free permanent desk is offered to the
// oldest waiting person who has portal access, for 24 hours; an acceptance goes to the owner's
// queue for the desk to complete. People without portal access are left to the desk as today.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { json } from "../../_shared/http.ts";
import { featureOn } from "../../_shared/flags.ts";
import { notifyStudent } from "../../_shared/notify.ts";

export const REMINDER_MINUTES = 10;
export const OFFER_HOURS = 24; // C2

async function portalStudents(db: Ctx["db"], ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { data } = await db.from("student_credentials").select("student_id").in("student_id", ids);
  return new Set((data ?? []).map((r: any) => r.student_id));
}

export function handlers(): Record<string, Handler> {
  return {
    cron_session_reminders: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "session_reminders"))) return json({ skipped: "pssai_session_reminders is off" });
      const now = Date.now();
      const { data: sessions } = await db.from("bookings").select("id, student_id, end_time, desks!desk_id(label)")
        .eq("status", "active").eq("is_paused", false).gte("end_time", new Date(now).toISOString()).lte("end_time", new Date(now + REMINDER_MINUTES * 60e3).toISOString()).limit(500);
      const withPortal = await portalStudents(db, [...new Set((sessions ?? []).map((s: any) => s.student_id))]);
      let sent = 0;
      for (const s of sessions ?? []) {
        if (!withPortal.has(s.student_id)) continue;
        const mins = Math.max(1, Math.round((new Date(s.end_time).getTime() - now) / 60e3));
        if (await notifyStudent(db, s.student_id, { kind: "session_end", title: `Your session ends in ${mins} minute${mins === 1 ? "" : "s"}`, body: "Please check out at the desk on time — overtime is charged after the grace period.", dedupeKey: `session-end:${s.id}` })) sent++;
      }
      return json({ ok: true, sessions: (sessions ?? []).length, sent });
    },

    cron_waitlist_offers: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "waitlist_offers"))) return json({ skipped: "pssai_waitlist_offers is off" });
      const nowIso = new Date().toISOString();
      const { data: expired } = await db.from("permanent_waitlist").update({ offer_status: "expired" })
        .eq("offer_status", "offered").lt("offer_expires_at", nowIso).select("id");
      const { data: waiting } = await db.from("permanent_waitlist").select("id, branch_id, name, phone, hours_per_day, offer_status, offer_expires_at, created_at")
        .eq("status", "waiting").order("created_at").limit(1000);
      let offered = 0;
      const branches = [...new Set((waiting ?? []).map((w: any) => w.branch_id))];
      for (const branchId of branches) {
        const { count: free } = await db.from("desks").select("*", { count: "exact", head: true }).eq("branch_id", branchId).eq("status", "free");
        const queue = (waiting ?? []).filter((w: any) => w.branch_id === branchId);
        const open = queue.filter((w: any) => w.offer_status === "offered" && w.offer_expires_at > nowIso).length;
        let slots = (free ?? 0) - open;
        for (const w of queue) {
          if (slots <= 0) break;
          if (w.offer_status) continue; // offered, accepted, declined or expired: not offered again by the job
          const { data: s } = await db.from("students").select("id").eq("phone", w.phone).maybeSingle();
          if (!s || !(await portalStudents(db, [s.id])).has(s.id)) continue;
          const expires = new Date(Date.now() + OFFER_HOURS * 3600e3).toISOString();
          const { data: claimed } = await db.from("permanent_waitlist").update({ student_id: s.id, offered_at: nowIso, offer_expires_at: expires, offer_status: "offered" })
            .eq("id", w.id).is("offer_status", null).select("id");
          if (!claimed?.length) continue;
          await notifyStudent(db, s.id, { kind: "waitlist_offer", title: "A permanent seat is free for you", body: `Accept within ${OFFER_HOURS} hours on your portal home page; the desk will then finish it with you.`, actionUrl: "/me", dedupeKey: `waitlist:${w.id}` });
          offered++; slots--;
        }
      }
      return json({ ok: true, offered, expired: (expired ?? []).length });
    },
  };
}
