import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'

const POLL_INTERVAL = 30_000

// Surfaces new chat messages (branch team + all-staff channels) in the notification bell —
// this also covers cross-branch visit intimations, since those are inserted as ordinary
// messages into the student's home branch channel.
export function useMessageAlerts(branchId, currentStaffId) {
  const [toasts, setToasts] = useState([])
  const seen = useRef(new Set())
  const isFirstCheck = useRef(true)

  const check = useCallback(async () => {
    if (!branchId) return
    try {
      const [branchData, allData] = await Promise.all([
        api('list_messages', { branchId, channel: 'branch' }),
        api('list_messages', { branchId, channel: 'all' }),
      ])
      const messages = [...(branchData.messages ?? []), ...(allData.messages ?? [])]

      // The first poll after page load just baselines what already exists, so we don't
      // dump the whole message history into the bell the instant the app opens.
      if (isFirstCheck.current) {
        messages.forEach(m => seen.current.add(m.id))
        isFirstCheck.current = false
        return
      }

      const newToasts = []
      for (const m of messages) {
        if (seen.current.has(m.id)) continue
        seen.current.add(m.id)
        if (m.sender_staff_id === currentStaffId) continue
        const senderName = m.staff?.display_name || m.staff?.username || 'Staff'
        newToasts.push({
          id: `msg:${m.id}`, level: 'message',
          message: `${senderName}: ${m.content}`,
        })
      }
      if (newToasts.length) setToasts(prev => [...prev, ...newToasts])
    } catch { /* ignore network errors */ }
  }, [branchId, currentStaffId])

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
