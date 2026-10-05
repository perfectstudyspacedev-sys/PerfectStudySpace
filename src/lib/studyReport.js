// WhatsApp study-report message for a chosen period (Active Members → 💬).

// Longest period staff can pick — keep in sync with STUDY_REPORT_MAX_DAYS in the edge function.
export const STUDY_REPORT_MAX_DAYS = 60
// Pre-filled period: starts this many days ago and ends today (the same 21 days the report always covered).
export const STUDY_REPORT_DEFAULT_DAYS = 21

const pad = (n) => String(n).padStart(2, '0')
// DD/MM/YYYY, matching the study-report template's date format
const fmtDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
const fmtISO = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
// HH:MM:SS — hours are NOT capped at 24 since totals can span many days
export function fmtHMS(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`
}

// Days between two YYYY-MM-DD dates, inclusive (same day = 1).
export function inclusiveDays(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000) + 1
}

// Why this period can't be used, or '' when it is fine. `today` is a YYYY-MM-DD string.
export function validateStudyReportRange(from, to, today) {
  if (!from || !to) return 'Pick a start date and an end date'
  if (from > to) return 'The start date must be on or before the end date'
  if (to > today) return "The end date can't be in the future"
  if (inclusiveDays(from, to) > STUDY_REPORT_MAX_DAYS) return `Pick a period of at most ${STUDY_REPORT_MAX_DAYS} days`
  return ''
}

// bookings: [{ start_time, end_time, status }] already limited to the period by the server.
// A session still running counts up to `now`. Hours are summed per calendar day.
export function buildStudyReportMessage({ name, bookings, from, to, now = Date.now() }) {
  const byDay = new Map()
  for (const b of [...bookings].sort((a, c) => new Date(a.start_time) - new Date(c.start_time))) {
    const start = new Date(b.start_time)
    const end = (b.status === 'completed' && b.end_time) ? new Date(b.end_time) : new Date(now)
    const dayKey = fmtDate(start)
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + Math.max(0, end - start))
  }
  const days = [...byDay.entries()]
  if (!days.length) {
    return `Hi *${name}*...\n\nNo study attendance was recorded between *${fmtISO(from)}* and *${fmtISO(to)}* at Perfect Study Space.\n\n-Perfect Study Space`
  }
  const totalMs = days.reduce((sum, [, ms]) => sum + ms, 0)
  const avgHoursPerDay = (totalMs / 3_600_000) / days.length
  const lines = days.map(([day, ms]) => `${day} - ${fmtHMS(ms)} Hrs`).join('\n')
  return `Hi *${name}*...\n\n`
    + `Here is your study report from *${fmtISO(from)}* to *${fmtISO(to)}*\n\n`
    + `${lines}\n\n`
    + `Total Hours = *${fmtHMS(totalMs)} Hrs*\n\n`
    + `Average Hours/Day = *${avgHoursPerDay.toFixed(2)} Hrs*\n\n`
    + `-Perfect Study Space`
}
