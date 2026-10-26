// Floating desks are claimed in one conditional step (PSS-AI Phase 4 review): two check-ins at the
// same moment can never both be given the same desk. The booking is linked once it exists; a desk
// claimed for a booking that was then not made is given back.
// deno-lint-ignore-file no-explicit-any
type Db = { from: (table: string) => any };

export async function claimFreeDesk(db: Db, deskId: string): Promise<boolean> {
  const { data } = await db.from("desks").update({ status: "occupied", current_booking_id: null }).eq("id", deskId).eq("status", "free").select("id");
  return !!data?.length;
}

export async function unclaimDesk(db: Db, deskId: string) {
  await db.from("desks").update({ status: "free" }).eq("id", deskId).eq("status", "occupied").is("current_booking_id", null);
}

/** Links a claimed desk to its booking, trying twice; a desk left unlinked shows in the nightly report. */
export async function linkDesk(db: Db, deskId: string, bookingId: string, extra: Record<string, unknown> = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await db.from("desks").update({ ...extra, current_booking_id: bookingId }).eq("id", deskId);
    if (!error) return true;
    console.error("desk link failed:", error.message, deskId, bookingId);
  }
  return false;
}
