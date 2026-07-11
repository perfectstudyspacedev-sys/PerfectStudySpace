import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'
import { fireNativeNotification } from '../lib/utils'

const POLL_INTERVAL = 30_000
const SEEN_CAP = 500

function seenKey(staffId) { return `pss_msg_seen:${staffId}` }

function loadSeen(staffId) {
  try {
    const raw = localStorage.getItem(seenKey(staffId))
    return raw ? new Set(JSON.parse(raw)) : null
  } catch { return null }
}

function saveSeen(staffId, set) {
  try {
    const arr = [...set].slice(-SEEN_CAP)
    localStorage.setItem(seenKey(staffId), JSON.stringify(arr))
  } catch { /* ignore storage errors */ }
}

function isToday(ts) {
  return new Date(ts).toDateString() === new Date().toDateString()
}


// Surfaces new chat messages (branch team + all-staff channels) in the notification bell —
// this also covers cross-branch visit intimations, since those are inserted as ordinary
// messages into the student's home branch channel. "Seen" message IDs persist to
// localStorage per staff account, so a message already viewed/dismissed doesn't come
// back at the next login, while messages that arrived while fully offline still surface.
export function useMessageAlerts(branchId, currentStaffId) {
  const [toasts, setToasts] = useState([])
  const seen = useRef(null)
  const isFirstEverCheck = useRef(true)

  const check = useCallback(async () => {
    if (!branchId || !currentStaffId) return
    try {
      if (!seen.current) {
        const persisted = loadSeen(currentStaffId)
        isFirstEverCheck.current = persisted === null
        seen.current = persisted ?? new Set()
      }

      const [branchData, allData] = await Promise.all([
        api('list_messages', { branchId, channel: 'branch' }),
        api('list_messages', { branchId, channel: 'all' }),
      ])
      const messages = [...(branchData.messages ?? []), ...(allData.messages ?? [])]

      // The very first check for a brand-new staff account just baselines what already
      // exists, so we don't dump the whole message history into the bell on first login.
      if (isFirstEverCheck.current) {
        messages.forEach(m => seen.current.add(m.id))
        isFirstEverCheck.current = false
        saveSeen(currentStaffId, seen.current)
        return
      }

      const newToasts = []
      let sawUnseen = false
      for (const m of messages) {
        if (seen.current.has(m.id)) continue
        sawUnseen = true
        seen.current.add(m.id)
        if (m.sender_staff_id === currentStaffId) continue
        // Don't surface messages that arrived on a previous day (e.g. staff was offline
        // for a while) — they're still marked seen above so they never resurface later.
        if (!isToday(m.sent_at)) continue
        const senderName = m.staff?.display_name || m.staff?.username || 'Staff'
        newToasts.push({
          id: `msg:${m.id}`, level: 'message',
          message: `${senderName}: ${m.content}`,
          createdAt: Date.parse(m.sent_at),
        })
        fireNativeNotification(`💬 ${senderName}`, m.content)
      }
      // Persist whenever anything new was marked seen — not just when it produced a toast —
      // otherwise a message from the current staff member (skipped from toasting) would be
      // re-evaluated as "new" again on the next reload since it never got saved.
      if (sawUnseen) saveSeen(currentStaffId, seen.current)
      // Also drop any toast left over from a previous day (e.g. the tab was left open
      // across midnight).
      setToasts(prev => {
        const kept = prev.filter(t => isToday(t.createdAt))
        if (!newToasts.length && kept.length === prev.length) return prev
        return [...kept, ...newToasts]
      })
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
