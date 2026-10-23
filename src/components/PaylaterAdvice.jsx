import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI Phase 3, O3 — pay-later advice next to a Partial / Pay Later choice. Advice only (C13: up
// to 50% for 15 days, with the owner's OK); nothing is blocked.
export default function PaylaterAdvice({ studentId }) {
  const { paylaterAdvice } = useFeatureFlags()
  const [advice, setAdvice] = useState(null)
  useEffect(() => {
    if (!paylaterAdvice || !studentId) return undefined
    let live = true
    api('get_paylater_advice', { studentId }).then((r) => { if (live) setAdvice(r.advice ?? null) }).catch(() => {})
    return () => { live = false }
  }, [paylaterAdvice, studentId])
  if (!paylaterAdvice || !advice) return null
  const tone = { low: '#4ade80', medium: 'var(--accent)', high: '#ff8a65' }[advice.band]
  return (
    <p data-testid="paylater-advice" style={{ fontSize: '0.8rem', borderLeft: `3px solid ${tone}`, padding: '0.35rem 0.6rem', margin: '0 0 0.9rem', background: 'rgba(255,255,255,0.03)' }}>
      <strong style={{ color: tone }}>{advice.text}</strong>
      {advice.reasons && <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Why: {advice.reasons}</span>}
    </p>
  )
}
