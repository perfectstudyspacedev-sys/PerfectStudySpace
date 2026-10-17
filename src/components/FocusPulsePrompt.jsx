import { useState } from 'react'
import { api } from '../lib/api'

// PSS-AI P1.1 — optional "How focused was today?" after a member's checkout. The checkout is
// already done; answering or skipping only closes this. Skip saves nothing.
export default function FocusPulsePrompt({ bookingId, studentName, onClose }) {
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')

  const rate = async (rating) => {
    setSaving(rating)
    setError('')
    try {
      await api('record_focus_rating', { bookingId, rating })
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 380 }} role="dialog" aria-modal="true" aria-labelledby="focus-pulse-title"
        data-testid="focus-pulse" onClick={(e) => e.stopPropagation()}>
        <h2 id="focus-pulse-title">How focused was today?</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.4rem 0 1rem' }}>
          {studentName ? `Ask ${studentName} — ` : ''}1 = hardly, 5 = fully. Optional.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', marginBottom: '1rem' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className="btn btn-ghost" aria-label={`Focus ${n} of 5`}
              disabled={saving !== null} onClick={() => rate(n)}
              style={{ flex: 1, minWidth: 0, fontSize: '1.05rem', fontWeight: 700, padding: '0.6rem 0' }}>
              {saving === n ? '…' : n}
            </button>
          ))}
        </div>
        {error && <p className="error-msg">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving !== null}>Skip</button>
        </div>
      </div>
    </div>
  )
}
