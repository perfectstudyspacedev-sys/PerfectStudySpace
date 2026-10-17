import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// PSS-AI R9 — which Phase 1 features the owner has switched on (app_settings pssai_* rows).
// Read once per page load and shared by every component; until the answer arrives, and if the
// read fails, everything counts as off.
const OFF = { focusPulse: false, anomaly: false, discountConfirmOver: 1000 }
let cached = null
let pending = null

function load() {
  pending ??= api('get_feature_flags')
    .then((res) => (cached = { ...OFF, ...res }))
    .catch(() => { pending = null; return OFF })
  return pending
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState(cached ?? OFF)
  useEffect(() => {
    if (cached) return undefined
    let live = true
    load().then((f) => { if (live) setFlags(f) })
    return () => { live = false }
  }, [])
  return flags
}
