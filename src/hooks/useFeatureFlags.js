import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// PSS-AI R9 — which features the owner has switched on (app_settings pssai_* rows).
// Shared by every component and read again when a component mounts more than 10 minutes after the
// last read, so a desk tab left open picks up a change. Until the first answer arrives, and if the
// read fails, everything counts as off (the server checks the switches too).
const OFF = {
  focusPulse: false, anomaly: false, analyst: false, portal: false, upiPay: false, concierge: false,
  collections: false, autoApprove: false, aiMessages: false, realtime: false, discountConfirmOver: 1000,
  // Phase 3
  hourRelease: false, overbooking: false, yieldPricing: false, enquiryChat: false, leadTools: false, referralLinks: false,
  examRadar: false, winback: false, nextExam: false, paylaterAdvice: false, exceptionDesk: false, portalR2: false,
  // Phase 4
  selfCheckin: false, sessionWatch: false, seatMatching: false, liveSeats: false, foodOrders: false, foodStock: false, tickets: false, photoTasks: false,
  // Phase 5 and 6
  policyLearner: false, digitalTwin: false, experiments: false, spaceYield: false, portalR4: false, studyBuddy: false, retireStaffOps: false,
  certificates: false, parentDigest: false, ownerOverview: false,
}
const MAX_AGE_MS = 10 * 60 * 1000
let cached = null
let cachedAt = 0
let pending = null

function load() {
  pending ??= api('get_feature_flags')
    // `loaded` tells a screen the answer is in (until then everything reads as off), so a screen
    // that must not call a switched-off action (the retired staff screens, S1) can wait for it.
    .then((res) => { cached = { ...OFF, ...res, loaded: true }; cachedAt = Date.now(); return cached })
    .catch(() => cached ?? { ...OFF, loaded: true })
    .finally(() => { pending = null })
  return pending
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState(cached ?? OFF)
  useEffect(() => {
    if (cached && Date.now() - cachedAt < MAX_AGE_MS) return undefined
    let live = true
    load().then((f) => { if (live) setFlags(f) })
    return () => { live = false }
  }, [])
  return flags
}
