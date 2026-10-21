import { useEffect, useState } from 'react'
import { portalApi } from '../lib/api'
import PrivacyNotice from './PrivacyNotice'
import { fmtDate } from './portalUtils'

// PSS-AI P2.1 SP8 — who runs the hall, the grievance contact (C5), what the student agreed to,
// and requests for a copy or deletion of their data (handled by the owner).
const KIND = { privacy_download: 'Copy of my data', privacy_delete: 'Delete my data' }

export default function PortalPrivacy() {
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => portalApi('me_privacy').then(setData).catch((err) => setError(err.message))
  useEffect(() => { load() }, [])
  const ask = async (kind) => {
    const details = kind === 'privacy_delete' ? window.prompt('Tell the owner what to delete (or "everything"):') : ''
    if (kind === 'privacy_delete' && (!details || details.trim().length < 3)) return
    setBusy(true); setError(''); setMsg('')
    try { const r = await portalApi('me_request', { kind, details }); setMsg(r.message); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  if (!data) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  return (
    <>
      <h2 style={{ marginBottom: '0.75rem' }}>Privacy</h2>
      {msg && <p className="success-msg" role="status" style={{ marginBottom: '0.75rem' }}>{msg}</p>}
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <div className="card"><PrivacyNotice businessName={data.businessName} grievance={data.grievance} /></div>
      <div className="card">
        {data.privacyAcceptedAt && <p style={{ fontSize: '0.85rem' }}>You accepted this notice on {fmtDate(data.privacyAcceptedAt)}.</p>}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => ask('privacy_download')}>Ask for a copy of my data</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => ask('privacy_delete')}>Ask to delete my data</button>
        </div>
        {data.requests.length > 0 && (
          <ul className="portal-list" style={{ marginTop: '0.75rem' }}>
            {data.requests.map((r) => <li key={r.id}><span>{KIND[r.kind]} · {fmtDate(r.created_at)}</span><span>{r.status}</span></li>)}
          </ul>
        )}
      </div>
    </>
  )
}
