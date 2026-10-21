import { useEffect, useRef } from 'react'
import { onLiveChange } from '../lib/live'
import { useFeatureFlags } from './useFeatureFlags'

// PSS-AI P2.5 — calls `onChange` when the server says something changed for this branch (or
// anywhere, for staff-wide lists). Returns whether live updates are on, so a polling hook can slow
// down to a safety-net interval instead of polling every 30–60 s.
export const SLOW_POLL_MS = 5 * 60_000

export function useLiveSignal(branchId, onChange) {
  const { realtime } = useFeatureFlags()
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(() => {
    if (!realtime) return undefined
    const names = branchId ? [`branch:${branchId}`, 'pss:all'] : ['pss:all']
    return onLiveChange(names, () => latest.current?.())
  }, [realtime, branchId])
  return realtime
}
