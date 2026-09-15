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
// this also covers cross-branch visit intimations and new website enquiries, since those
// are inserted as ordinary (tagged) messages. "Seen" message IDs persist to localStorage
// per staff account, so a message already viewed/dismissed doesn't come back at the next
// login, while messages that arrived while fully offline still surface.
//
// canSeeAllBranches (owner/admin) fetches every branch's channel at once instead of just
// the one currently open, so a system notice reaches them regardless of which branch is
// active — but ordinary team chat from a branch they're not currently viewing is noise,
// not a notification, so only tagged system notices (cross-branch, new enquiry) are
// allowed to toast from a branch other than the active one; see the skip check below.
export function useMessageAlerts(branchId, currentStaffId, canSeeAllBranches) {
  const [toasts, setToasts] = useState([])
  const seen = useRef(null)
  const isFirstEverCheck = useRef(true)

  const check = useCallback(async () => {
    if (!currentStaffId) return
    // A single-branch fetch has nothing to scope to without a branchId (e.g. Combined
    // Hall), but the all-branches fetch doesn't need one at all.
    if (!branchId && !canSeeAllBranches) return
    try {
      if (!seen.current) {
        const persisted = loadSeen(currentStaffId)
        isFirstEverCheck.current = persisted === null
        seen.current = persisted ?? new Set()
      }

      const [branchData, allData] = await Promise.all([
        canSeeAllBranches
          ? api('list_messages', { allBranches: true })
          : api('list_messages', { branchId, channel: 'branch' }),
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
        // Cross-branch check-in notices and new website enquiries are both inserted as
        // ordinary messages (see check_in_member and public_create_enquiry) but tagged so
        // they get their own icon/title instead of looking like an indistinguishable chat
        // message — neither has a real staff sender, so senderName would read "Staff" and
        // add nothing.
        const isCrossBranch = m.content.startsWith('[cross_branch]')
        const isNewEnquiry = m.content.startsWith('[new_enquiry]')
        // Owner/admin fetched every branch above — an untagged chat message from a branch
        // other than the one they actually have open is someone else's team chat, not
        // something meant for them right now. Marked seen already (above) so switching to
        // that branch later won't dredge it back up as "new". Exempt: tagged system
        // notices (the whole point of fetching every branch), and the all-staff channel
        // (m.branch_id null) — that one's already global by design, never branch-specific.
        if (canSeeAllBranches && !isCrossBranch && !isNewEnquiry && m.branch_id != null && m.branch_id !== branchId) continue
        const senderName = m.staff?.display_name || m.staff?.username || 'Staff'
        const tagLength = isCrossBranch ? '[cross_branch]'.length : isNewEnquiry ? '[new_enquiry]'.length : 0
        const displayContent = tagLength ? m.content.slice(tagLength).trim() : m.content
        const level = isCrossBranch ? 'cross_branch' : isNewEnquiry ? 'new_enquiry' : 'message'
        newToasts.push({
          id: `msg:${m.id}`, level,
          message: tagLength ? displayContent : `${senderName}: ${displayContent}`,
          createdAt: Date.parse(m.sent_at),
        })
        fireNativeNotification(
          isCrossBranch ? '🔄 Cross-Branch Visit' : isNewEnquiry ? '📝 New Enquiry' : `💬 ${senderName}`,
          displayContent,
        )
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
  }, [branchId, currentStaffId, canSeeAllBranches])

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
