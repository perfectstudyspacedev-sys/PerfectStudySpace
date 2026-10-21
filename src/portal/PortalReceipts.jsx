import { useEffect, useState } from 'react'
import { portalApi } from '../lib/api'
import { fmtDate, PURPOSE_LABEL, rupees } from './portalUtils'

// PSS-AI P2.1 SP4 — what the student paid (and what was paid back), plus portal UPI payments.
const CATEGORY = { membership: 'Membership', locker: 'Locker', food: 'Food', food_pass: 'Food Pass', walkin: 'Walk-in', overtime: 'Overtime', overstay: 'Overstay', other: 'Other' }

export default function PortalReceipts() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { portalApi('me_receipts').then(setData).catch((err) => setError(err.message)) }, [])
  if (!data) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  return (
    <>
      <h2 style={{ marginBottom: '0.75rem' }}>Receipts</h2>
      {data.upiPayments.filter((u) => u.status === 'rejected').map((u) => (
        <div key={u.reference} className="card" style={{ borderColor: 'rgba(255,120,80,0.5)' }}>
          <strong>{PURPOSE_LABEL[u.purpose]} {rupees(u.amount)} — not accepted</strong>
          <p style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>{u.rejectReason}</p>
        </div>
      ))}
      <div className="card">
        {data.receipts.length === 0 ? <p>No payments yet.</p> : (
          <ul className="portal-list">
            {data.receipts.map((r) => (
              <li key={r.id}>
                <span>{fmtDate(r.date)} · {CATEGORY[r.category] ?? r.category}<span style={{ color: 'var(--text-muted)' }}> · {String(r.mode ?? '').toUpperCase()}</span></span>
                <strong>{rupees(r.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
      {data.payouts.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: '0.5rem' }}>Paid back to you</h3>
          <ul className="portal-list">
            {data.payouts.map((p) => <li key={p.id}><span>{fmtDate(p.date)} · {p.type.replace(/_/g, ' ')}</span><strong>{rupees(p.amount)}</strong></li>)}
          </ul>
        </div>
      )}
    </>
  )
}
