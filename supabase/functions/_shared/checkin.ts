// PSS-AI Phase 4, SP13 and A5 — self check-in and the session watch. Pure code.
// The location check (D9) keeps only the distance and the accuracy; the coordinates themselves are
// used here and dropped. Self checkout works out overtime minutes exactly as the staff checkout
// form does (BookingsPage CheckoutModal): the booked end, plus a break still in progress.

export const CHECKIN_RADIUS_M = 100;      // D9
export const MAX_ACCURACY_M = 100;        // a fix rougher than this cannot tell 100 m apart
export const CHECKIN_TRIES = 10;          // tries per student in CHECKIN_TRY_WINDOW_MIN
export const CHECKIN_TRY_WINDOW_MIN = 10;
export const CONSENT_VERSION = "2026-10-25";
export const CONSENT_TEXT =
  "To check you in, this page reads your phone's location once and checks that you are within " +
  `${CHECKIN_RADIUS_M} metres of the hall. We keep only how far you were and how exact the reading was — ` +
  "never where you are. We read it only when you tap Check in. You can always check in at the desk instead.";
export const FORGOTTEN_CLOSE_IST = "23:30"; // C15
export const CORRECTION_FLAG_MIN = 10;      // a staff checkout moved back more than this is flagged

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validCoords(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export type LocationVerdict =
  | { ok: true; distance: number; accuracy: number }
  | { ok: false; result: "no_location" | "low_accuracy" | "too_far"; distance: number | null; accuracy: number | null; message: string };

/** Whether a phone's reading puts the student at the branch (D9). */
export function locationVerdict(branch: { lat: number; lng: number }, phone: { lat: unknown; lng: unknown; accuracy: unknown }): LocationVerdict {
  if (!validCoords(phone.lat, phone.lng)) {
    return { ok: false, result: "no_location", distance: null, accuracy: null, message: "We couldn't read your location. Allow location for this page and try again, or check in at the desk." };
  }
  const accuracy = typeof phone.accuracy === "number" && Number.isFinite(phone.accuracy) && phone.accuracy >= 0 ? Math.round(phone.accuracy) : null;
  const distance = Math.round(distanceMetres(branch, { lat: phone.lat as number, lng: phone.lng as number }));
  if (accuracy == null || accuracy > MAX_ACCURACY_M) {
    return { ok: false, result: "low_accuracy", distance, accuracy, message: `Your location is too rough${accuracy != null ? ` (±${accuracy} m)` : ""}. Step near a window, wait a few seconds and try again — or check in at the desk.` };
  }
  if (distance > CHECKIN_RADIUS_M) {
    return { ok: false, result: "too_far", distance, accuracy, message: `You seem to be about ${distance} m from the hall. Check in when you are inside — or at the desk.` };
  }
  return { ok: true, distance, accuracy };
}

/** Overtime minutes at `nowMs`, as the staff checkout form works them out. */
export function overtimeMinutesAt(booking: { end_time: string; is_paused?: boolean | null; paused_at?: string | null }, nowMs: number): number {
  const ongoingBreakMs = booking.is_paused && booking.paused_at ? Math.max(nowMs - Date.parse(booking.paused_at), 0) : 0;
  const endMs = Date.parse(booking.end_time) + ongoingBreakMs;
  return Math.ceil(Math.max(nowMs - endMs, 0) / 60_000);
}

/** C15: where a forgotten session is closed — its booked end, or when its break began; never
 * before it started. Null while the booked end is still ahead (the session is not forgotten). */
export function forgottenSessionEnd(booking: { start_time: string; end_time: string | null; is_paused?: boolean | null; paused_at?: string | null }, nowMs: number): string | null {
  const start = Date.parse(booking.start_time);
  const end = booking.end_time ? Date.parse(booking.end_time) : start;
  const pausedAt = booking.is_paused && booking.paused_at ? Date.parse(booking.paused_at) : null;
  const at = pausedAt != null ? Math.min(pausedAt, end) : end;
  if (pausedAt == null && end > nowMs) return null;
  return new Date(Math.min(Math.max(at, start), nowMs)).toISOString();
}

/** A new check-in key for a poster: 16 random bytes, base64url. */
export function newCheckinKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time comparison of two short strings. */
export function sameKey(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
