export function timeToMinutes(t) {
  if (!t) return 0
  const s = t.slice(0, 5)
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function addHoursToTime(start, hours) {
  const mins = timeToMinutes(start) + Math.round(Number(hours) * 60)
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatTime(t) {
  if (!t) return ''
  return t.slice(0, 5)
}

// Uses the device's local calendar date (not toISOString's UTC date) — the app is used
// in India, so this assumes the device clock is set to IST. Between IST midnight and
// UTC midnight (00:00–05:30 IST), toISOString() would still report yesterday's date.
export function todayISO() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function formatDateLabel(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Renders any date/date-time value (plain "YYYY-MM-DD" or a full ISO timestamp) as
// "DD-MM-YY" — the compact format used everywhere a date is shown in this app.
export function formatDate(value) {
  if (!value) return '—'
  const d = value.length <= 10 ? new Date(value + 'T12:00:00') : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`
}

// Same as formatDate but keeps the time-of-day alongside it, for timestamps where the
// time matters (activity logs, transactions, messages) — "DD-MM-YY, h:mm am/pm".
export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${formatDate(value)}, ${time}`
}

export function nowTimeStr() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function nowISO() {
  return new Date().toISOString()
}

// Convert a local HH:MM string (from <input type="time">) to a proper UTC ISO string.
// Without this, passing "16:41" to the server causes it to be treated as UTC,
// producing a 5h 30m shift for IST users.
export function localTimeStrToISO(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

export function formatCurrency(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`
}

export function paymentModeLabel(mode) {
  if (mode === 'upi') return 'UPI'
  if (mode === 'cash') return 'Cash'
  if (mode === 'other') return 'Other'
  return mode
}

// Fires a device-level notification for a toast raised anywhere in the app (session
// alerts, chat messages, etc.) — used so an alert is visible even if the app isn't the
// foreground/focused tab or screen. Two paths:
//  1. The Android app wraps the site in a plain WebView, which doesn't support the Web
//     Notification API at all — MainActivity.kt exposes window.PSSNotifications.show() as
//     a bridge to a real Android system-tray notification, so that's tried first.
//  2. A normal desktop/mobile browser falls back to the standard Notification API.
export function fireNativeNotification(title, body) {
  if (window.PSSNotifications?.show) {
    try {
      window.PSSNotifications.show(title, body)
      return
    } catch { /* fall through to the web Notification API below */ }
  }
  if (!('Notification' in window)) return
  const send = () => new Notification(title, { body, icon: '/pss-logo.png' })
  if (Notification.permission === 'granted') {
    send()
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') send() })
  }
}

// Opens a WhatsApp chat pre-filled with a message — same wa.me pattern used
// throughout the app's WhatsApp buttons.
export function openWhatsApp(phone, message) {
  let clean = (phone || '').replace(/\D/g, '')
  if (!clean) return
  // Numbers are stored as plain 10-digit Indian mobile numbers with no country code —
  // wa.me requires the full international number (no leading +), so default to +91.
  if (clean.length === 10) clean = `91${clean}`
  // noopener,noreferrer: the opened wa.me tab would otherwise keep a window.opener handle
  // back to this app (reverse tabnabbing) — low real risk since the destination is fixed,
  // not user-controlled, but a one-line close either way.
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(message || '')}`, '_blank', 'noopener,noreferrer')
}

export function monthName(date = new Date()) {
  return date.toLocaleString('en-US', { month: 'long' }).toUpperCase()
}

export function isOverdue(dateStr) {
  if (!dateStr || dateStr === '-') return false
  return dateStr < todayISO()
}

export function exportToCSV(filename, headers, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [headers.map(escape).join(',')]
  rows.forEach(r => lines.push(r.map(escape).join(',')))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

// What renew_membership will take off for pending cashbacks — mirrors the backend's
// settlePendingCashbacks: EVERY pending cashback applies (percent ones against `base`),
// and the sum is capped at `base`. Renewal forms must show exactly this, since a Full
// payment is recorded at the backend's total.
export function pendingCashbackTotal(cashbacks, base) {
  const raw = (cashbacks ?? []).reduce((sum, c) => sum + (c.cashback_type === 'percent'
    ? base * (Number(c.cashback_value) / 100)
    : Number(c.cashback_value)), 0)
  return Math.min(raw, base)
}

// How many days after a plan ends the student may still check in — mirrors MEMBERSHIP_GRACE_DAYS
// in the edge function (the check-in gate and renewal rules there must agree with it).
export const MEMBERSHIP_GRACE_DAYS = 10

// RSP R2 — mirrors renewalKind() and the start-date rules in renew_membership. The server decides
// and enforces; this only lets both renewal forms show the same thing up front.
//   early: on or before the end date → starts the day after the end date (fixed, same plan)
//   grace: up to MEMBERSHIP_GRACE_DAYS after → starts the day after the end date (fixed)
//   late:  after that → starts today; may be backdated, never before the day after the end date
export function renewalInfo(endDate) {
  const today = todayISO()
  const continuationStart = shiftDate(endDate, 1)
  if (today <= endDate) {
    return { kind: 'early', startDate: continuationStart, fixed: true, minStart: continuationStart, maxStart: continuationStart }
  }
  const daysSinceExpiry = Math.round((new Date(today + 'T12:00:00') - new Date(endDate + 'T12:00:00')) / 86_400_000)
  if (daysSinceExpiry <= MEMBERSHIP_GRACE_DAYS) {
    return { kind: 'grace', startDate: continuationStart, fixed: true, minStart: continuationStart, maxStart: continuationStart }
  }
  return { kind: 'late', startDate: today, fixed: false, minStart: continuationStart, maxStart: today }
}

// A membership whose period hasn't begun yet — i.e. an early renewal waiting for its start date.
export function isNotStartedYet(membership) {
  return !!membership?.start_date && membership.start_date > todayISO()
}

export function getMultiMonthDiscount(months) {
  if (months >= 6) return 15
  if (months >= 3) return 10
  if (months >= 2) return 5
  return 0
}

// Shared WhatsApp welcome-message template — used by both new membership registration
// and new walk-in registration, so there's a single reusable template (editable by
// owner/admin from the Membership page's "New Registration" tab) instead of each flow
// having its own hardcoded copy. The live value is server-side (app_settings.welcome_template,
// via the get_welcome_template/update_welcome_template actions) so every staff member's
// device sends the same message; this is only the local fallback used before that first
// fetch resolves or if it fails.
export const DEFAULT_WELCOME_TEMPLATE = `Hi {name}, welcome to Perfect Study Space! 🎉

Thanks for joining us — we're excited to have you with us. Please take a moment to fill out this form so we can complete your registration:

📝 Fill out the form here:
https://docs.google.com/forms/d/e/1FAIpQLSeolzoVIDAsOq35SZ0MbsJb1qBrBcInBG4VER6As5yc8A0oEA/viewform?usp=header

If you have any questions, feel free to reach out anytime. We're happy to help! 😊`

// How a student heard about us — shared by registration and the profile's Edit Details form.
// Values must match the students.referral_source CHECK constraint (024 migration).
export const REFERRAL_OPTIONS = [
  { value: 'google_search', label: 'Google Search' },
  { value: 'instagram', label: 'Social Media' },
  { value: 'word_of_mouth', label: 'Word of Mouth' },
  { value: 'flex', label: 'Flex (Banner/Hoarding)' },
  { value: 'ai_platform', label: 'Claude/ChatGPT/AI Platforms' },
]
