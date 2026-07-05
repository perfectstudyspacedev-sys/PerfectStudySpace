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

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
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
