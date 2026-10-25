import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { portalApi } from '../lib/api'
import { fmtDate, fmtDateTime, PURPOSE_LABEL, rupees } from './portalUtils'
import { HomeSession, LiveSeats } from './PortalSelf'

// PSS-AI P2.1 SP2 — the student's home: plan, days left, dues, renewal, open payments, offers.
export default function PortalHome() {
  const [data, setData] = useState(null)
  const [notes, setNotes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [m, n] = await Promise.all([portalApi('me_membership'), portalApi('me_notifications')])
      setData(m)
      setNotes((n.notifications ?? []).filter((x) => !x.read_at).slice(0, 3))
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const respond = async (accept) => {
    setBusy(true)
    try { await portalApi('me_respond_offer', { offerId: data.waitlistOffer.id, accept }); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (error && !data) return <p className="error-msg">{error}</p>
  if (!data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  const m = data.membership

  return (
    <>
      {error && <p className="error-msg" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <HomeSession />
      <LiveSeats />
      {data.waitlistOffer && (
        <div className="card" data-testid="waitlist-offer" style={{ borderColor: 'var(--accent)' }}>
          <h3>A permanent seat is free for you</h3>
          <p style={{ fontSize: '0.9rem', margin: '0.5rem 0' }}>Answer by {fmtDateTime(data.waitlistOffer.expiresAt)}. If you accept, the desk will contact you to finish it.</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => respond(true)}>Accept</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => respond(false)}>No thanks</button>
          </div>
        </div>
      )}

      <div className="card" data-testid="membership-card">
        {!m ? (
          <p>You have no active membership. Please visit the desk to join or renew.</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
              <h3 style={{ textTransform: 'capitalize' }}>{m.category} · {m.hoursPerDay}h a day</h3>
              {m.desk && <span className="badge">Cabin {m.desk}</span>}
            </div>
            <div className="portal-big" style={{ margin: '0.75rem 0' }}>
              {m.isPaused ? 'On hold' : m.notStarted ? `Starts ${fmtDate(m.startDate)}` : m.daysLeft > 0 ? `${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} left` : 'Ended'}
            </div>
            <dl className="portal-kv">
              <dt>Valid until</dt><dd>{fmtDate(m.endDate)}</dd>
              <dt>Monthly fee</dt><dd>{rupees(m.monthlyFee)}</dd>
              {m.feeDue > 0 && <><dt>Due now</dt><dd style={{ color: '#ff8a65', fontWeight: 700 }}>{rupees(m.feeDue)}</dd></>}
            </dl>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
              {m.feeDue > 0 && data.upiPay && <Link className="btn btn-primary" to="/me/pay?purpose=dues">Pay {rupees(m.feeDue)}</Link>}
              {data.renewalQuotes.length > 0 && <Link className="btn btn-primary" to="/me/pay?purpose=renewal">Renew from {rupees(data.renewalQuotes[0].amount)}</Link>}
              <Link className="btn btn-ghost" to="/me/hold">{m.isPaused ? 'Hold & resume' : 'Put on hold'}</Link>
            </div>
            {data.renewalBlockedBy && m.daysLeft <= 7 && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.6rem' }}>Renewal: {data.renewalBlockedBy}</p>}
          </>
        )}
      </div>

      {(data.locker || data.foodPass) && (
        <div className="card">
          <dl className="portal-kv">
            {data.locker && <><dt>Locker {data.locker.lockerNo}</dt><dd>until {fmtDate(data.locker.dueDate)}{data.locker.feeDue > 0 ? ` · ${rupees(data.locker.feeDue)} due` : ''}</dd></>}
            {data.foodPass && <><dt>Food Pass</dt><dd>{rupees(data.foodPass.balance)}</dd></>}
          </dl>
        </div>
      )}

      {data.openPayments.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: '0.5rem' }}>Payments in progress</h3>
          {data.openPayments.map((p) => (
            <div key={p.reference} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.88rem', padding: '0.3rem 0' }}>
              <span>{PURPOSE_LABEL[p.purpose]} · {rupees(p.amount)}</span>
              {p.status === 'submitted' ? <span style={{ color: 'var(--text-muted)' }}>Waiting for the owner</span> : <Link to={`/me/pay?ref=${p.reference}`}>Send proof</Link>}
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: '0.5rem' }}>New for you</h3>
          {notes.map((n) => (
            <div key={n.id} style={{ padding: '0.35rem 0', fontSize: '0.88rem' }}>
              <strong>{n.title}</strong>{n.body && <div style={{ color: 'var(--text-muted)' }}>{n.body}</div>}
            </div>
          ))}
          <Link to="/me/inbox" style={{ fontSize: '0.85rem' }}>All notices →</Link>
        </div>
      )}
    </>
  )
}
