import { useState } from 'react'
import { agentApi } from '../lib/api'
import { openWhatsApp } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI P2.5 — "✨ AI draft": a personal welcome or study-report message drafted by AI from
// figures the app worked out. Shown for editing; sent through WhatsApp exactly like the standard
// message. Only while pssai_ai_messages is on.
export default function AiDraftButton({ kind, studentId, membershipId, enquiryId, dateFrom, dateTo, phone, style }) {
  const { aiMessages } = useFeatureFlags()
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!aiMessages) return null

  const make = async () => {
    setBusy(true); setError('')
    try {
      const r = await agentApi({ agent: 'writer', kind, ...(studentId ? { studentId } : {}), ...(membershipId ? { membershipId } : {}), ...(enquiryId ? { enquiryId } : {}), ...(dateFrom ? { dateFrom, dateTo } : {}) })
      setDraft(r.text)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost" style={style} disabled={busy} onClick={make}>{busy ? 'Drafting…' : '✨ AI draft'}</button>
      {error && <p className="error-msg" role="alert" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>{error}</p>}
      {draft != null && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ai-draft-title" onClick={() => setDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h3 id="ai-draft-title">AI draft — check before sending</h3>
            <textarea rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%', marginTop: '0.75rem' }} aria-label="Message" />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Close</button>
              <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={() => { openWhatsApp(phone, draft); setDraft(null) }}>💬 Send on WhatsApp</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
