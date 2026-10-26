// Student portal notices (PSS-AI P2, migration 060). A job that can run twice passes a dedupeKey,
// so one event gives one notice (portal_notifications is unique on student_id + dedupe_key).
// deno-lint-ignore-file no-explicit-any
type Db = { from: (table: string) => any };

export interface Notice { kind: string; title: string; body?: string | null; actionUrl?: string | null; dedupeKey?: string | null }

/** Adds a notice to a student's portal inbox. Never throws: a notice is a courtesy. */
export async function notifyStudent(db: Db, studentId: string, n: Notice): Promise<boolean> {
  const row = { student_id: studentId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 2000) ?? null, action_url: n.actionUrl ?? null, dedupe_key: n.dedupeKey ?? null };
  try {
    // True only when a notice was written: with a dedupe key, a repeat is skipped and answers false.
    const { data, error } = n.dedupeKey
      ? await db.from("portal_notifications").upsert(row, { onConflict: "student_id,dedupe_key", ignoreDuplicates: true }).select("id")
      : await db.from("portal_notifications").insert(row).select("id");
    if (error) { console.error("portal notice failed:", error.message, n.kind); return false; }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error("portal notice failed:", e instanceof Error ? e.message : e, n.kind);
    return false;
  }
}

/**
 * Tells a branch's desk something needs a person now (PSS-AI Phase 4 review): a staff message
 * tagged [desk_alert], which the staff app's message alerts show as a toast. Never throws.
 */
export async function alertDesk(db: Db, branchId: string, text: string): Promise<void> {
  try {
    const { error } = await db.from("messages").insert({ branch_id: branchId, sender_staff_id: null, recipient_type: "staff", content: `[desk_alert] ${text}`.slice(0, 1000) });
    if (error) console.error("desk alert failed:", error.message);
  } catch (e) {
    console.error("desk alert failed:", e instanceof Error ? e.message : e);
  }
}
