import { useState } from 'react'
import { api } from '../lib/api'
import { openWhatsApp } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI P2.1 SP1 — "Portal setup code": a one-time 6-digit code (24 hours) the student uses to
// set or reset their portal PIN. The code is shown once here and sent through WhatsApp; it is
// never stored in clear.
export default function PortalSetupButton({ studentId }) {
  const { portal } = useFeatureFlags()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!portal) return null

  const make = async () => {
    setBusy(true)
    setError('')
    try { setResult(await api('create_portal_setup_code', { studentId })) } catch (err) { setError(err.message); setResult({ failed: true }) } finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={make}>🔐 Portal setup code</button>
      {result && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="psc-title" onClick={() => setResult(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3 id="psc-title">Portal setup code</h3>
            {error ? <p className="error-msg" style={{ marginTop: '0.75rem' }}>{error}</p> : (
              <>
                <p className="mono" data-testid="portal-code" style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.2em', color: 'var(--accent)', margin: '0.75rem 0' }}>{result.code}</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Works for 24 hours, once. A new code replaces this one and ends the student&apos;s old logins when they set a new PIN.</p>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>Close</button>
              {!error && <button type="button" className="btn btn-primary" onClick={() => openWhatsApp(result.phone, result.message)}>Send on WhatsApp</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
