// Small helpers for the student portal (PSS-AI P2.1).

export const rupees = (n) => `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

// The IST calendar date of an instant, as YYYY-MM-DD.
export function istDate(ms) {
  return new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10)
}

export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Study minutes per IST day from the portal's study report rows (pauses taken off). */
export function minutesByDay(bookings, from, to, now = Date.now()) {
  const days = []
  for (let d = from; d <= to; d = addDaysISO(d, 1)) days.push({ date: d, minutes: 0, focus: [] })
  const byDate = new Map(days.map((d) => [d.date, d]))
  for (const b of bookings) {
    const start = new Date(b.start_time).getTime()
    const end = b.end_time ? Math.min(new Date(b.end_time).getTime(), b.status === 'active' ? now : Infinity) : now
    const minutes = Math.max(0, Math.round((end - start) / 60000) - Number(b.pauseMinutes ?? 0))
    const day = byDate.get(istDate(start))
    if (!day) continue
    day.minutes += minutes
    if (b.focus) day.focus.push(b.focus)
  }
  return days
}

export const hoursText = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

/** Shrinks a photo to a JPEG under the server's 1.5 MB limit; returns { data: base64 } . */
export async function shrinkImage(file, maxSide = 1600) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= 1_400_000) {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      return { data, size: blob.size }
    }
  }
  throw new Error('This picture is too large — try a screenshot instead of a photo')
}

export const PURPOSE_LABEL = { renewal: 'Renewal', dues: 'Dues', food_pass: 'Food Pass', locker: 'Locker', registration: 'Registration' }

/** Where to go after logging in: the check-in poster page that sent the student here, else home.
 * Only portal paths are followed. */
export function nextPortalPath() {
  let next = null
  try { next = sessionStorage.getItem('pss_portal_next'); sessionStorage.removeItem('pss_portal_next') } catch { /* ignore */ }
  return typeof next === 'string' && next.startsWith('/me/checkin?') ? next : '/me'
}
