import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'
import { fireNativeNotification } from '../lib/utils'

const POLL_INTERVAL = 60_000
const SEEN_CAP = 500

function seenKey(staffId) { return `pss_task_seen:${staffId}` }

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

// Surfaces newly-assigned tasks in the notification bell — polls every task assigned to or
// by the current staff member (allBranches:true sidesteps branchId entirely; the server
// already scopes a non-owner to their own branch regardless of what's sent) and diffs
// against a per-staff "seen" set in localStorage. The first-ever check baselines every task
// that already exists without toasting — otherwise everyone's whole standing task list would
// fire as "new" the moment this shipped, or the first time a staff member logs in.
export function useTaskAlerts(currentStaffId) {
  const [toasts, setToasts] = useState([])
  const seen = useRef(null)
  const isFirstEverCheck = useRef(true)

  const check = useCallback(async () => {
    if (!currentStaffId) return
    try {
      if (!seen.current) {
        const persisted = loadSeen(currentStaffId)
        isFirstEverCheck.current = persisted === null
        seen.current = persisted ?? new Set()
      }

      const { tasks } = await api('list_tasks', { allBranches: true })
      const myTasks = (tasks ?? []).filter(t => t.assigned_to_staff_id === currentStaffId)

      if (isFirstEverCheck.current) {
        myTasks.forEach(t => seen.current.add(t.id))
        isFirstEverCheck.current = false
        saveSeen(currentStaffId, seen.current)
        return
      }

      const newToasts = []
      let sawUnseen = false
      for (const t of myTasks) {
        if (seen.current.has(t.id)) continue
        sawUnseen = true
        seen.current.add(t.id)
        // Self-assigned tasks (owner assigning to themselves) don't need a bell — they just
        // created it and already know.
        if (t.assigned_by_staff_id === currentStaffId) continue
        newToasts.push({
          id: `task:${t.id}`, level: 'task',
          message: `New task assigned: "${t.title}"`,
          createdAt: Date.now(),
        })
        fireNativeNotification('📋 New Task Assigned', t.title)
      }
      if (sawUnseen) saveSeen(currentStaffId, seen.current)
      if (newToasts.length) setToasts(prev => [...prev, ...newToasts])
    } catch { /* ignore network errors */ }
  }, [currentStaffId])

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
