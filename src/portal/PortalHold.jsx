import { useEffect, useState } from 'react'
import { portalApi } from '../lib/api'
import { fmtDate } from './portalUtils'

// PSS-AI P2.1 SP6 — holds (C1: a temporary plan may pause 1–7 days once a month at once; longer
// holds and permanent seats go to the owner) and other requests to the owner (D5).
const REQUESTS = [['plan_change', 'Change my plan'], ['refund', 'Ask for a refund']]

export default function PortalHold() {
  const [info, setInfo] = useState(null)
  const [days, setDays] = useState(3)
  const [reason, setReason] = useState('')
  const [req, setReq] = useState({ kind: 'plan_change', details: '' })
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => portalApi('me_membership').then(setInfo).catch((err) => setError(err.message))
  useEffect(() => { load() }, [])

  const run = async (fn) => {
    setBusy(true); setError(''); setMsg('')
    try { await fn(); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const hold = () => run(async () => {
    const r = await portalApi('me_request_hold', { days: Number(days), reason })
    setMsg(r.pending_approval ? r.message : `Your hold has started. It ends by itself on ${fmtDate(r.resumesOn)}; the days are added to your end date.`)
  })
  const resume = () => run(async () => {
    const r = await portalApi('me_resume')
    setMsg(`Welcome back! Your membership now ends on ${fmtDate(r.newEndDate)}.`)
  })
  const ask = (e) => { e.preventDefault(); run(async () => { const r = await portalApi('me_request', req); setMsg(r.message); setReq((x) => ({ ...x, details: '' })) }) }

  if (!info) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  const m = info.membership
  const needsOwner = !info.selfHold.canSelfHold || Number(days) > info.selfHold.maxDays

  return (
    <>
      <h2 style={{ marginBottom: '0.75rem' }}>Hold & requests</h2>
      {msg && <p className="success-msg" role="status" style={{ marginBottom: '0.75rem' }}>{msg}</p>}
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <div className="card">
        {!m ? <p>You have no active membership.</p> : m.isPaused ? (
          <>
            <h3>Your membership is on hold</h3>
            {m.category === 'temporary'
              ? <button type="button" className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={busy} onClick={resume}>I&apos;m back — resume now</button>
              : <p style={{ marginTop: '0.5rem' }}>Please ask the desk to resume it, so a cabin can be picked for you.</p>}
          </>
        ) : (
          <>
            <h3>Put my membership on hold</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.4rem 0 0.75rem' }}>
              The days you are away are added to your end date. {info.selfHold.canSelfHold ? 'Up to 7 days start at once (once a month).' : 'This one goes to the owner for approval.'}
            </p>
            <div className="form-group">
              <label htmlFor="hold-days">How many days?</label>
              <select id="hold-days" value={days} onChange={(e) => setDays(e.target.value)}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="hold-reason">Reason (optional)</label>
              <input id="hold-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={hold}>{needsOwner ? 'Ask the owner' : 'Start hold'}</button>
          </>
        )}
      </div>
      <form className="card" onSubmit={ask}>
        <h3 style={{ marginBottom: '0.6rem' }}>Ask the owner</h3>
        <div className="form-group">
          <label htmlFor="req-kind">About</label>
          <select id="req-kind" value={req.kind} onChange={(e) => setReq((r) => ({ ...r, kind: e.target.value }))}>
            {REQUESTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="req-details">Details</label>
          <textarea id="req-details" rows={3} maxLength={500} value={req.details} onChange={(e) => setReq((r) => ({ ...r, details: e.target.value }))} />
        </div>
        <button type="submit" className="btn btn-ghost" disabled={busy || req.details.trim().length < 3}>Send request</button>
      </form>
    </>
  )
}
