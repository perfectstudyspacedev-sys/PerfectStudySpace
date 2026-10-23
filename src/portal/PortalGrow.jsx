import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { portalApi } from '../lib/api'
import { addDaysISO, fmtDate, fmtDateTime, istDate, rupees } from './portalUtils'

// PSS-AI Phase 3 — portal release 2: release my cabin's hours (SP10), the permanent-seat waitlist
// (SP9), my referral link and cashbacks (SP11), and the next exam's plan (SP12). Every amount
// comes from the server.

function useData(action) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => portalApi(action).then(setData).catch((e) => setError(e.message)), [action])
  useEffect(() => { load() }, [load])
  return { data, error, setError, load }
}
const Loading = ({ error }) => (error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>)

export function PortalRelease() {
  const { data, error, setError, load } = useData('me_releases')
  const today = istDate(Date.now())
  const [form, setForm] = useState({ date: addDaysISO(today, 1), fromHour: 9, toHour: 17 })
  const [msg, setMsg] = useState('')
  if (!data) return <Loading error={error} />
  if (!data.on) return <p>Releasing hours is not open yet.</p>
  if (!data.eligible) return <p>Releasing hours is for members with their own cabin.</p>
  const hours = Array.from({ length: data.hours.close - data.hours.open + 1 }, (_, i) => data.hours.open + i)
  const release = async (e) => {
    e.preventDefault(); setError(''); setMsg('')
    try { await portalApi('me_release_hours', { date: form.date, fromHour: Number(form.fromHour), toHour: Number(form.toHour) }); setMsg('Released. If a walk-in uses your cabin then, half of what they pay comes off your next renewal.'); load() } catch (err) { setError(err.message) }
  }
  const cancel = async (id) => { try { await portalApi('me_cancel_release', { releaseId: id }); load() } catch (err) { setError(err.message) } }
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Not coming in?</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Release your cabin's hours. If a walk-in uses it, you get half of what they pay as credit on your next renewal. Your cabin stays yours — come in anyway and you'll be seated.</p>
        <form onSubmit={release} style={{ display: 'grid', gap: '0.6rem' }}>
          <label>Day <input type="date" value={form.date} min={today} max={addDaysISO(today, data.hours.aheadDays)} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <label style={{ flex: 1 }}>From <select value={form.fromHour} onChange={(e) => setForm({ ...form, fromHour: e.target.value })}>{hours.slice(0, -1).map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
            <label style={{ flex: 1 }}>To <select value={form.toHour} onChange={(e) => setForm({ ...form, toHour: e.target.value })}>{hours.slice(1).map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
          </div>
          <button type="submit" className="btn btn-primary">Release these hours</button>
        </form>
        {msg && <p className="success-msg" role="status">{msg}</p>}
        {error && <p className="error-msg" role="alert">{error}</p>}
      </div>
      {data.creditTotal > 0 && <div className="card"><strong>Credits earned: {rupees(data.creditTotal)}</strong><p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.3rem 0 0' }}>Taken off your next renewal.</p></div>}
      {data.releases.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your releases</h3>
          <ul className="portal-list">
            {data.releases.map((r) => (
              <li key={r.id}>
                <span>{fmtDateTime(r.from)} – {fmtDateTime(r.to).split(', ').pop()}<span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{{ open: 'Waiting', sold: 'Used by a walk-in', cancelled: 'Cancelled', expired: 'Not used' }[r.status]}</span></span>
                {r.status === 'open' && <button type="button" className="btn btn-ghost" onClick={() => cancel(r.id)}>Cancel</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export function PortalWaitlist() {
  const { data, error, setError, load } = useData('me_waitlist')
  const [hours, setHours] = useState('')
  if (!data) return <Loading error={error} />
  if (!data.on) return <p>Joining the waitlist here is not open yet — please ask at the desk.</p>
  const join = async () => { setError(''); try { await portalApi('me_join_waitlist', hours ? { hoursPerDay: Number(hours) } : {}); load() } catch (e) { setError(e.message) } }
  const leave = async () => { setError(''); try { await portalApi('me_leave_waitlist'); load() } catch (e) { setError(e.message) } }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Your own cabin</h2>
      {data.hasPermanent ? <p>You already have your own cabin.</p> : data.waiting ? (
        <>
          <p>You're on the waitlist — <strong>number {data.waiting.position}</strong> in line{data.waiting.hoursPerDay ? ` for a ${data.waiting.hoursPerDay}-hour cabin` : ''}. When one frees up we'll tell you here, and you'll have 24 hours to say yes.</p>
          <button type="button" className="btn btn-ghost" onClick={leave}>Leave the waitlist</button>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)' }}>A cabin of your own, the same desk every day.</p>
          <label>Plan <select value={hours} onChange={(e) => setHours(e.target.value)}>
            <option value="">Any</option>
            {data.plans.map((p) => <option key={p.hoursPerDay} value={p.hoursPerDay}>{p.hoursPerDay} hours a day — {rupees(p.monthlyFee)} a month</option>)}
          </select></label>
          <button type="button" className="btn btn-primary" style={{ marginTop: '0.6rem' }} onClick={join}>Join the waitlist</button>
        </>
      )}
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  )
}

export function PortalRefer() {
  const { data: ref, error } = useData('me_referral')
  const { data: cb } = useData('me_cashbacks')
  const [copied, setCopied] = useState(false)
  if (!ref) return <Loading error={error} />
  const share = async () => {
    const text = `Join me at Perfect Study Space: ${ref.url}`
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(ref.url); setCopied(true) } } catch { /* cancelled */ }
  }
  return (
    <>
      {ref.on ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Bring a friend</h2>
          <p className="mono" style={{ wordBreak: 'break-all' }}>{ref.url}</p>
          <button type="button" className="btn btn-primary" onClick={share}>{copied ? 'Copied ✓' : 'Share my link'}</button>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.6rem' }}>
            {ref.joined} joined · {ref.waiting} signed up, not joined yet.{ref.reward ? ` When a friend joins, the owner can give you ${rupees(ref.reward)} off your renewal.` : ''}
          </p>
        </div>
      ) : <p>Referral links are not open yet.</p>}
      {cb?.on && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your cashbacks {cb.pendingFixed > 0 && <span style={{ color: '#4ade80' }}>· {rupees(cb.pendingFixed)} waiting</span>}</h3>
          {cb.cashbacks.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>None yet.</p> : (
            <ul className="portal-list">
              {cb.cashbacks.map((c) => (
                <li key={c.id}><span>{c.type === 'percent' ? `${c.value}%` : rupees(c.value)}{c.note ? ` — ${c.note}` : ''}<span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{c.status === 'pending' ? 'Comes off your next renewal' : `Used ${c.usedAt ? fmtDate(c.usedAt) : ''}`}</span></span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

export function PortalNext() {
  const { data, error } = useData('me_next_exam')
  if (!data) return <Loading error={error} />
  if (!data.on) return <p>Not open yet.</p>
  const o = data.offer
  if (!o) return <div className="card"><p>Tell the desk which exam you're preparing for, and we'll suggest your next step here.</p></div>
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>After {o.currentLabel}: {o.nextLabel}</h2>
      {o.examDate && <p>{o.nextLabel} is on <strong>{fmtDate(o.examDate)}</strong>{o.applyBy ? ` (apply by ${fmtDate(o.applyBy)})` : ''}.</p>}
      {o.plan ? (
        <>
          <p>Keep your seat for {o.plan.months} months: <strong>{rupees(o.plan.amount)}</strong> (multi-month discount included).</p>
          <Link className="btn btn-primary" to="/me/pay">Renew for {o.plan.months} months</Link>
        </>
      ) : <p style={{ color: 'var(--text-muted)' }}>Renew at the desk to keep your seat.</p>}
    </div>
  )
}
