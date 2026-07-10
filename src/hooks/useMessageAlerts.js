import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'

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
        const senderName = m.staff?.display_name || m.staff?.username || 'Staff'
        newToasts.push({
          id: `msg:${m.id}`, level: 'message',
          message: `${senderName}: ${m.content}`,
        })
      }
      // Persist whenever anything new was marked seen — not just when it produced a toast —
      // otherwise a message from the current staff member (skipped from toasting) would be
      // re-evaluated as "new" again on the next reload since it never got saved.
      if (sawUnseen) saveSeen(currentStaffId, seen.current)
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
