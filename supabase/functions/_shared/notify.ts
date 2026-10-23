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
