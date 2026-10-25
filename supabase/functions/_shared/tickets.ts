// PSS-AI Phase 4, I22/SP17 and C17 — complaint priority and photo-proof tasks. Pure code, no AI:
// the student's text is untrusted and only matched against fixed word lists.

export const TICKET_CATEGORIES = ["cleanliness", "noise", "wifi", "seat", "food", "other"] as const; // C16
export type TicketCategory = typeof TICKET_CATEGORIES[number];
export const TICKETS_PER_DAY = 3;
export const OPEN_TICKETS_MAX = 5;

const URGENT = /\b(fire|smoke|burning|spark|shock|electric(?:al)? shock|leak(?:ing)?|flood(?:ing)?|injur(?:y|ed)|hurt|bleeding|faint(?:ed)?|theft|stolen|steal|harass(?:ed|ment|ing)?|unsafe|gas)\b/i;
const HIGH_CATEGORIES = new Set<TicketCategory>(["wifi", "seat"]);

export function ticketPriority(category: TicketCategory, details: string): "urgent" | "high" | "normal" {
  if (URGENT.test(details)) return "urgent";
  return HIGH_CATEGORIES.has(category) ? "high" : "normal";
}

// C17: all daily cleaning tasks need a photo.
const CLEANING = /\b(clean(?:ing)?|sweep(?:ing)?|mop(?:ping)?|wash(?:ing)?|dust(?:ing)?|toilets?|washrooms?|restrooms?|bathrooms?|bins?|garbage|trash|dustbins?|sanitis(?:e|ing)|sanitiz(?:e|ing))\b/i;
export function needsPhotoByDefault(task: { title: string; repeatInterval?: string | null }): boolean {
  return (task.repeatInterval ?? "none") === "daily" && CLEANING.test(task.title ?? "");
}
export const TASK_PHOTO_KEEP_DAYS = 30;
