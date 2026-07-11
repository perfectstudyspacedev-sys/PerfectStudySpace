import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'
import { fireNativeNotification } from '../lib/utils'

const POLL_INTERVAL = 60_000       // check every 60 s
const WARN_BEFORE_MS = 5 * 60_000  // warn 5 min before end
const FIRED_KEY = 'pss_session_alerts_fired'
const FIRED_CAP = 500

function loadFired() {
  try {
    const raw = localStorage.getItem(FIRED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function saveFired(set) {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify([...set].slice(-FIRED_CAP))) } catch { /* ignore */ }
}

function isToday(ts) {
  return new Date(ts).toDateString() === new Date().toDateString()
}

export function useSessionAlerts(branchId) {
  const [toasts, setToasts] = useState([])
  // Persisted across reloads/logins — once a session's warn/end alert has fired (and been
  // dismissed), it must not pop back up just because the page was refreshed and this ref
  // reset to empty.
  const fired = useRef(loadFired())

  const check = useCallback(async () => {
    if (!branchId) return
    try {
      const data = await api('list_today_bookings', { branchId })
      const bookings = data.bookings ?? []
      const now = Date.now()
      const newToasts = []

      for (const bk of bookings) {
        if (!bk?.id || !bk?.start_time || !bk?.hours) continue
        if (bk.is_paused) continue // skip paused sessions

        const totalPauseMs = (bk.total_pause_minutes ?? 0) * 60_000
        const endMs = new Date(bk.end_time ?? bk.start_time).getTime() + totalPauseMs
        const studentName = bk.students?.name || bk.student_name || 'Student'

        // 5-minute warning
        const warnKey = `${bk.id}:warn`
        if (!fired.current.has(warnKey) && now >= endMs - WARN_BEFORE_MS && now < endMs) {
          fired.current.add(warnKey)
          const msg = `${studentName} — session ends in 5 minutes`
          newToasts.push({ id: warnKey, level: 'warn', message: msg, studentName, createdAt: now })
          fireNativeNotification('⏰ Time Almost Up', msg)
        }

        // Session ended
        const endKey = `${bk.id}:end`
        if (!fired.current.has(endKey) && now >= endMs) {
          fired.current.add(endKey)
          const msg = `${studentName} — session has ended`
          newToasts.push({ id: endKey, level: 'end', message: msg, studentName, createdAt: now })
          fireNativeNotification('🔔 Session Ended', msg)
        }
      }

      // Drop any toast left over from a previous day (e.g. the tab was left open across
      // midnight) whenever this poll finds something new to add or prune.
      setToasts(prev => {
        const kept = prev.filter(t => isToday(t.createdAt))
        if (!newToasts.length && kept.length === prev.length) return prev
        return [...kept, ...newToasts]
      })
      if (newToasts.length) saveFired(fired.current)
    } catch { /* ignore network errors */ }
  }, [branchId])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [check])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const dismissAll = useCallback(() => setToasts([]), [])

  return { toasts, dismiss, dismissAll }
}
