import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatCurrency, formatDateTime } from '../lib/utils'

// PSS-AI P2.2–P2.3 — the owner's approval queue. Payments: UPI proofs from the portal with the
// code's checks and the AI's reading; Confirm runs the normal payment action (as you, by UPI).
// Requests: what students asked for (long holds, plan changes, refunds, privacy, permanent seats)
// and any T3 action an agent asked for. Nothing here runs until you press a button.
const PURPOSE = { renewal: 'Renewal', dues: 'Dues', food_pass: 'Food Pass top-up', locker: 'Locker renewal', registration: 'New registration' }
const KIND = { hold: 'Hold', plan_change: 'Plan change', refund: 'Refund', privacy_download: 'Copy of data', privacy_delete: 'Delete data', waitlist_accept: 'Permanent seat (waitlist)' }

function age(iso) {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
}

function ReasonBox({ label, onSubmit, onCancel, busy }) {
  const [text, setText] = useState('')
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <label style={{ fontSize: '0.8rem' }}>{label}
        <textarea rows={2} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} style={{ width: '100%', marginTop: '0.3rem' }} />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
        <button type="button" className="btn btn-danger" disabled={busy || text.trim().length < 3} onClick={() => onSubmit(text.trim())}>Send</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function ProofCard({ p, busy, onConfirm, onReject, onRead, onImage }) {
  const [rejecting, setRejecting] = useState(false)
  const r = p.ai_reading && !p.ai_reading.unread ? p.ai_reading : null
  return (
    <div className="card" data-testid="proof-card" style={{ marginBottom: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <strong>{p.name ?? 'Unknown'}</strong> <span style={{ color: 'var(--text-muted)' }}>· {p.phone} · {p.branch}</span>
          <div style={{ fontSize: '0.9rem', marginTop: '0.2rem' }}>{PURPOSE[p.purpose]}{p.request?.months ? `, ${p.request.months} month${p.request.months > 1 ? 's' : ''}` : ''} · <strong>{formatCurrency(p.amount_expected)}</strong></div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            <span className="mono">{p.reference}</span>{p.utr && <> · UTR <span className="mono">{p.utr}</span></>} · {p.status === 'submitted' ? `sent ${age(p.submitted_at)}` : `asked ${age(p.created_at)}, no proof yet`}
          </div>
        </div>
      </div>
      {p.checks?.length > 0 && (
        <ul data-testid="proof-checks" style={{ margin: '0.6rem 0 0', paddingLeft: '1.1rem', color: '#ff8a65', fontSize: '0.85rem' }}>
          {p.checks.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      {r && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          AI read: {r.amount != null ? formatCurrency(r.amount) : 'no amount'} · {r.status} · UTR {r.utr ?? '—'} · to {r.payee_vpa ?? '—'} · {r.confidence} confidence
        </p>
      )}
      {p.ai_reading?.unread && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>AI did not read it: {p.ai_reading.unread}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        {p.hasImage && <button type="button" className="btn btn-ghost" onClick={() => onImage(p)}>View screenshot</button>}
        {p.hasImage && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onRead(p)}>Read with AI</button>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onConfirm(p)}>Confirm {formatCurrency(p.amount_expected)}</button>
        {!rejecting && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>}
      </div>
      {rejecting && <ReasonBox label="Why? The student sees this." busy={busy} onCancel={() => setRejecting(false)} onSubmit={(reason) => onReject(p, reason)} />}
    </div>
  )
}

function RequestCard({ a, busy, onDecide }) {
  const [denying, setDenying] = useState(false)
  const details = a.kind === 't3_action'
    ? `${a.action} asked by ${a.requested_by_type}: ${JSON.stringify(a.payload)}`
    : [a.payload?.days && `${a.payload.days} days`, a.payload?.why, a.payload?.reason, a.payload?.text].filter(Boolean).join(' · ')
  return (
    <div className="card" data-testid="request-card" style={{ marginBottom: '0.9rem' }}>
      <strong>{a.kind === 't3_action' ? 'Agent action' : KIND[a.action] ?? a.action}</strong>
      {a.name && <span style={{ color: 'var(--text-muted)' }}> · {a.name} · {a.phone}{a.branch ? ` · ${a.branch}` : ''}</span>}
      <p style={{ fontSize: '0.88rem', marginTop: '0.35rem', wordBreak: 'break-word' }}>{details || '—'}</p>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatDateTime(a.created_at)}</p>
      {['plan_change', 'refund', 'privacy_download', 'privacy_delete', 'waitlist_accept'].includes(a.action) && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Approving tells the student it is being done — finish it in the student&apos;s profile.</p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide(a, 'approve')}>Approve</button>
        {!denying && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDenying(true)}>Deny</button>}
      </div>
      {denying && <ReasonBox label="Why? The student sees this." busy={busy} onCancel={() => setDenying(false)} onSubmit={(reason) => onDecide(a, 'deny', reason)} />}
    </div>
  )
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState('payments')
  const [proofs, setProofs] = useState([])
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [p, a] = await Promise.all([api('list_payment_proofs', { status: 'open' }), api('list_approvals', { status: 'pending' })])
      setProofs(p.proofs ?? [])
      setApprovals(a.approvals ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn, done) => {
    setBusy(true)
    setError('')
    setNotice('')
    try { await fn(); setNotice(done); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const confirmProof = (p) => {
    if (!window.confirm(`Confirm ${formatCurrency(p.amount_expected)} from ${p.name} (${PURPOSE[p.purpose]})? Check it in your bank app first — this records the payment.`)) return
    act(() => api('confirm_payment_proof', { proofId: p.id }), `Confirmed ${formatCurrency(p.amount_expected)} from ${p.name}.`)
  }
  const rejectProof = (p, reason) => act(() => api('reject_payment_proof', { proofId: p.id, reason }), `Rejected ${p.reference}.`)
  const readProof = (p) => act(() => api('read_payment_proof', { proofId: p.id }), 'Read again.')
  const openImage = async (p) => {
    try { const { url } = await api('get_payment_proof_image', { proofId: p.id }); window.open(url, '_blank', 'noopener,noreferrer') } catch (err) { setError(err.message) }
  }
  const decide = (a, decision, reason) => {
    if (decision === 'approve' && !window.confirm(`Approve this ${a.kind === 't3_action' ? `${a.action}` : (KIND[a.action] ?? a.action).toLowerCase()} request?`)) return
    act(() => api('decide_approval', { approvalId: a.id, decision, ...(reason ? { reason } : {}) }), decision === 'approve' ? 'Approved.' : 'Denied.')
  }

  const submitted = proofs.filter((p) => p.status === 'submitted')
  const waiting = proofs.filter((p) => p.status === 'requested')

  return (
    <>
      <div className="page-header">
        <h1>Approvals</h1>
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>
      <div className="chip-row" role="tablist" style={{ marginBottom: '1rem' }}>
        <button type="button" role="tab" aria-selected={tab === 'payments'} className={`chip${tab === 'payments' ? ' on' : ''}`} onClick={() => setTab('payments')}>Payments ({submitted.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={`chip${tab === 'requests' ? ' on' : ''}`} onClick={() => setTab('requests')}>Requests ({approvals.length})</button>
      </div>
      {notice && <p className="success-msg" role="status" style={{ marginBottom: '0.75rem' }}>{notice}</p>}
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {loading && !proofs.length && !approvals.length ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : tab === 'payments' ? (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
            Target: confirm within 2 hours between 8 am and 10 pm. Always check the money arrived in your bank app before confirming.
          </p>
          {submitted.length === 0 && <p>No payments waiting.</p>}
          {submitted.map((p) => <ProofCard key={p.id} p={p} busy={busy} onConfirm={confirmProof} onReject={rejectProof} onRead={readProof} onImage={openImage} />)}
          {waiting.length > 0 && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer' }}>Asked to pay, no proof yet ({waiting.length})</summary>
              <div style={{ marginTop: '0.75rem' }}>
                {waiting.map((p) => <ProofCard key={p.id} p={p} busy={busy} onConfirm={confirmProof} onReject={rejectProof} onRead={readProof} onImage={openImage} />)}
              </div>
            </details>
          )}
        </>
      ) : (
        <>
          {approvals.length === 0 && <p>No requests waiting.</p>}
          {approvals.map((a) => <RequestCard key={a.id} a={a} busy={busy} onDecide={decide} />)}
        </>
      )}
    </>
  )
}
