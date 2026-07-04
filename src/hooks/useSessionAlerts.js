import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'

const POLL_INTERVAL = 60_000       // check every 60 s
const WARN_BEFORE_MS = 5 * 60_000  // warn 5 min before end

function fireBrowserNotification(title, body) {
  if (!('Notification' in window)) return
  const send = () => new Notification(title, { body, icon: '/favicon.ico' })
  if (Notification.permission === 'granted') {
    send()
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') send() })
  }
}

export function useSessionAlerts(branchId) {
  const [toasts, setToasts] = useState([])
  const fired = useRef(new Set())

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
          newToasts.push({ id: warnKey, level: 'warn', message: msg, studentName })
          fireBrowserNotification('⏰ Time Almost Up', msg)
        }

        // Session ended
        const endKey = `${bk.id}:end`
        if (!fired.current.has(endKey) && now >= endMs) {
          fired.current.add(endKey)
          const msg = `${studentName} — session has ended`
          newToasts.push({ id: endKey, level: 'end', message: msg, studentName })
          fireBrowserNotification('🔔 Session Ended', msg)
        }
      }

      if (newToasts.length) {
        setToasts(prev => [...prev, ...newToasts])
      }
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
