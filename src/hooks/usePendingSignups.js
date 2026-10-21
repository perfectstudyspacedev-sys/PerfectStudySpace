import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { SLOW_POLL_MS, useLiveSignal } from './useLiveSignal'

const POLL_INTERVAL = 30_000

// SSP — pending self sign-ups waiting at the desk. Polled by the Shell (Membership tab badge)
// and handed to the Membership page through the Outlet context, so there is one poller.
// Staff see their branch; owner/admin see every branch (A4). Refreshes at once when a
// [new_signup] message arrives or a page changes one (the 'pss:signups-changed' event).
export function usePendingSignups(branchId, isOwner, enabled) {
  const [requests, setRequests] = useState([])
  const [error, setError] = useState('')
  const reqId = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled || (!isOwner && !branchId)) { setRequests([]); return }
    const id = ++reqId.current
    try {
      const data = await api('list_signup_requests', isOwner ? { allBranches: true } : { branchId })
      if (id === reqId.current) { setRequests(data.requests ?? []); setError('') }
    } catch (e) {
      if (id === reqId.current) setError(e.message || 'Could not load sign-ups')
    }
  }, [branchId, isOwner, enabled])

  // P2.5: with live updates on, re-fetch on the server's signal and poll only as a safety net.
  const live = useLiveSignal(branchId, refresh)
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, live ? Math.max(POLL_INTERVAL, SLOW_POLL_MS) : POLL_INTERVAL)
    const onChange = () => refresh()
    window.addEventListener('pss:signups-changed', onChange)
    return () => { clearInterval(t); window.removeEventListener('pss:signups-changed', onChange) }
  }, [refresh, live])

  return { requests, error, refresh }
}
