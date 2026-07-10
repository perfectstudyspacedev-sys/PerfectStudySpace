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

// Opens a WhatsApp chat pre-filled with a message — same wa.me pattern used
// throughout the app's WhatsApp buttons.
export function openWhatsApp(phone, message) {
  let clean = (phone || '').replace(/\D/g, '')
  if (!clean) return
  // Numbers are stored as plain 10-digit Indian mobile numbers with no country code —
  // wa.me requires the full international number (no leading +), so default to +91.
  if (clean.length === 10) clean = `91${clean}`
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(message || '')}`, '_blank')
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

export function getMultiMonthDiscount(months) {
  if (months >= 6) return 15
  if (months >= 3) return 10
  if (months >= 2) return 5
  return 0
}

// Shared WhatsApp welcome-message template — used by both new membership registration
// and new walk-in registration, so there's a single reusable template (editable from the
// Membership page's "New Registration" tab) instead of each flow having its own hardcoded
// copy. Persisted in localStorage so an edit is picked up by every future send, not just
// the current form session.
const WELCOME_TEMPLATE_KEY = 'pss_welcome_template'
export const DEFAULT_WELCOME_TEMPLATE = 'Hi {name}, welcome to Perfect Study Space! 🎉 Thanks for joining us — '
  + "we're excited to have you with us. If you have any questions, feel free to reach out anytime."

export function getWelcomeTemplate() {
  return localStorage.getItem(WELCOME_TEMPLATE_KEY) || DEFAULT_WELCOME_TEMPLATE
}

export function saveWelcomeTemplate(text) {
  localStorage.setItem(WELCOME_TEMPLATE_KEY, text)
}
