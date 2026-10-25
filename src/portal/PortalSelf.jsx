import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { portalApi } from '../lib/api'
import { fmtDateTime, rupees } from './portalUtils'

// PSS-AI Phase 4 — portal release 3: self check-in and checkout (SP13), live seats (SP14), seat
// preferences (SP15), food ordering (SP16) and report a problem (SP17). Each part shows only when
// the owner has switched it on; every amount and every rule is the server's.
const Loading = ({ error }) => (error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>)
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '')

/** Reads the phone's location once (D9: only when the student taps Check in). */
function readLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone cannot share its location — please check in at the desk'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location is blocked for this page. Allow it in your browser settings, or check in at the desk.' : 'We could not read your location — step near a window and try again, or check in at the desk.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

function CheckoutResult({ r }) {
  return (
    <p className="success-msg" role="status">
      Checked out. Thanks for studying with us!
      {r.overtimeMinutes > 15 && ` You stayed ${r.overtimeMinutes} minutes past your time${r.overtimeCharge ? ` — ${rupees(r.overtimeCharge)} overtime is added to your next renewal` : ''}.`}
      {r.foodDue > 0 && ` ${rupees(r.foodDue)} of food is still due — please pay at the desk or top up your Food Pass.`}
    </p>
  )
}

/** The open session with its Check out button (home page and the check-in page). */
export function SelfSession({ info, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  if (done) return <div className="card" data-testid="self-session"><CheckoutResult r={done} /></div>
  if (!info?.session) return null
  const s = info.session
  const out = async () => {
    setBusy(true); setError('')
    try { const r = await portalApi('me_check_out'); setDone(r); onChange?.() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card" data-testid="self-session">
      <h3 style={{ marginTop: 0 }}>You're checked in{s.branch ? ` at ${s.branch}` : ''}</h3>
      <p style={{ margin: '0.3rem 0' }}>{s.desk ? <>Desk <strong>{s.desk}</strong> · </> : null}since {hm(s.start)} · until <strong>{hm(s.end)}</strong>{s.paused ? ' · on a break' : ''}</p>
      {info.on && <button type="button" className="btn btn-primary" disabled={busy} onClick={out}>{busy ? 'Checking out…' : 'Check out'}</button>}
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  )
}

/** Home: the open session (when self check-in is on). */
export function HomeSession() {
  const [info, setInfo] = useState(null)
  const load = useCallback(() => portalApi('me_checkin_info').then(setInfo).catch(() => setInfo(null)), [])
  useEffect(() => { load() }, [load])
  if (!info?.on) return null
  return <SelfSession info={info} />
}

/** Home: free seats at each branch now (counts only). */
export function LiveSeats() {
  const [data, setData] = useState(null)
  useEffect(() => { portalApi('me_live_seats').then(setData).catch(() => setData(null)) }, [])
  if (!data?.on || !data.branches?.length) return null
  return (
    <div className="card" data-testid="live-seats">
      <h3 style={{ marginTop: 0 }}>Seats free now</h3>
      <ul className="portal-list">
        {data.branches.map((b) => (
          <li key={b.id}><span>{b.name}</span><strong style={{ color: b.free > 0 ? '#4ade80' : 'var(--text-muted)' }}>{b.free} of {b.total}</strong></li>
        ))}
      </ul>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.4rem 0 0' }}>As of {hm(data.at)}. Own cabins are not counted.</p>
    </div>
  )
}

/** /me/checkin?b=<branch>&k=<key> — the page the QR poster opens. */
export function PortalCheckin() {
  const [params] = useSearchParams()
  const branchId = params.get('b'), key = params.get('k')
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const load = useCallback(() => portalApi('me_checkin_info', branchId ? { branchId } : {}).then(setInfo).catch((e) => setError(e.message)), [branchId])
  useEffect(() => { load() }, [load])
  if (!info) return <Loading error={error} />
  if (!info.on) return <div className="card"><p>Self check-in is not open yet — please check in at the desk.</p></div>
  if (result) {
    return (
      <div className="card" data-testid="checkin-done">
        <h2 style={{ marginTop: 0 }}>You're in{result.branch ? ` at ${result.branch}` : ''} ✓</h2>
        {result.deskLabel ? <p>Your desk: <strong style={{ fontSize: '1.3rem' }}>{result.deskLabel}</strong>{result.deskReason ? ` (${result.deskReason})` : ''}</p> : <p>Take any free seat.</p>}
        <p>Until <strong>{hm(result.endTime)}</strong> today. Check out on the home page when you leave.</p>
        {result.collision && <p className="error-msg">{result.collision.message}</p>}
        {result.expiredMembership && <p className="error-msg">Your plan has ended — please renew soon.</p>}
        <Link className="btn btn-ghost" to="/me">Home</Link>
      </div>
    )
  }
  if (info.session) return <SelfSession info={info} onChange={load} />
  if (!branchId || !key) return <div className="card"><p>To check in, scan the QR poster at the hall with your phone's camera.</p></div>
  if (info.branch && !info.branch.ready) return <div className="card"><p>Self check-in isn't set up at this branch yet — please check in at the desk.</p></div>
  const go = async () => {
    setBusy(true); setError('')
    try {
      const where = await readLocation()
      const r = await portalApi('me_check_in', { branchId, key, ...where, ...(info.consentNeeded ? { consent: info.consentVersion } : {}) })
      setResult(r)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card" data-testid="checkin-card">
      <h2 style={{ marginTop: 0 }}>Check in{info.branch ? ` at ${info.branch.name}` : ''}</h2>
      {info.consentNeeded && (
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.6rem 0.75rem', margin: '0.5rem 0 0.75rem' }}>
          <p style={{ fontSize: '0.85rem', margin: 0 }}>{info.consentText}</p>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree
          </label>
        </div>
      )}
      <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={busy || (info.consentNeeded && !agree)} onClick={go}>{busy ? 'Checking…' : 'Check in'}</button>
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  )
}

const TAG_LABEL = { window: 'Near a window', power: 'Power socket', quiet: 'Quiet corner', ac: 'Near the AC' }
export function PortalSeatPrefs() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [desks, setDesks] = useState([])
  const [tags, setTags] = useState([])
  useEffect(() => {
    portalApi('me_seat_prefs').then((r) => { setData(r); setDesks(r.prefs?.deskIds ?? []); setTags(r.prefs?.tags ?? []) }).catch((e) => setError(e.message))
  }, [])
  if (!data) return <Loading error={error} />
  if (!data.on) return <p>Seat preferences are not open yet.</p>
  const toggleDesk = (id) => setDesks((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= data.maxFavourites ? d : [...d, id]))
  const toggleTag = (t) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))
  const save = async () => {
    setError(''); setMsg('')
    try { await portalApi('me_set_seat_prefs', { deskIds: desks, tags }); setMsg('Saved. When you check in yourself we seat you by these, if one is free.') } catch (e) { setError(e.message) }
  }
  return (
    <div className="card" data-testid="seat-prefs">
      <h2 style={{ marginTop: 0 }}>Where you like to sit</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Pick up to {data.maxFavourites} favourite desks, in order.</p>
      <div className="chip-row" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {data.desks.map((d) => {
          const i = desks.indexOf(d.id)
          return <button key={d.id} type="button" className={`chip${i >= 0 ? ' on' : ''}`} aria-pressed={i >= 0} onClick={() => toggleDesk(d.id)}>{i >= 0 ? `${i + 1}. ` : ''}{d.label}</button>
        })}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 0.4rem' }}>Or any desk that has:</p>
      <div className="chip-row" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {data.tags.map((t) => <button key={t} type="button" className={`chip${tags.includes(t) ? ' on' : ''}`} aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>{TAG_LABEL[t] ?? t}</button>)}
      </div>
      <button type="button" className="btn btn-primary" onClick={save}>Save</button>
      {msg && <p className="success-msg" role="status">{msg}</p>}
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  )
}

const ORDER_STATUS = { placed: 'Ordered', accepted: 'Being made', ready: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' }
export function PortalFood() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [cart, setCart] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => portalApi('me_food_menu').then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!data) return <Loading error={error} />
  if (!data.on) return <p>Ordering here is not open yet — please order at the counter.</p>
  const lines = Object.entries(cart).filter(([, q]) => q > 0)
  const total = lines.reduce((t, [id, q]) => t + (data.items.find((i) => i.id === id)?.price ?? 0) * q, 0)
  const step = (id, d) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(10, (c[id] ?? 0) + d)) }))
  const order = async () => {
    setBusy(true); setError('')
    try {
      await portalApi('me_food_order', { items: lines.map(([foodItemId, quantity]) => ({ foodItemId, quantity })), note })
      setCart({}); setNote(''); load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const cancel = async (id) => { setError(''); try { await portalApi('me_cancel_food_order', { orderId: id }); load() } catch (e) { setError(e.message) } }
  return (
    <>
      <div className="card" data-testid="food-menu">
        <h2 style={{ marginTop: 0 }}>Order food to your seat</h2>
        {data.whyNot && <p style={{ color: 'var(--text-muted)' }}>{data.whyNot}</p>}
        <ul className="portal-list">
          {data.items.map((i) => (
            <li key={i.id}>
              <span>{i.name} <span style={{ color: 'var(--text-muted)' }}>· {rupees(i.price)}</span>{!i.available && <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sold out</span>}</span>
              {data.canOrder && i.available && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <button type="button" className="btn btn-ghost" aria-label={`One less ${i.name}`} onClick={() => step(i.id, -1)}>−</button>
                  <span aria-live="polite" style={{ minWidth: 16, textAlign: 'center' }}>{cart[i.id] ?? 0}</span>
                  <button type="button" className="btn btn-ghost" aria-label={`One more ${i.name}`} onClick={() => step(i.id, 1)}>+</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {data.canOrder && lines.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem' }}>Note (optional)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. less sugar" style={{ width: '100%' }} /></label>
            <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={busy} onClick={order}>Order · {rupees(total)}</button>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{data.foodPass ? `Paid from your Food Pass (${rupees(data.foodPass.balance)}) when it is brought to you.` : 'Pay when it is brought to you, or it goes on your tab.'} The total is checked again then.</p>
          </div>
        )}
        {error && <p className="error-msg" role="alert">{error}</p>}
      </div>
      {data.orders.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your orders</h3>
          <ul className="portal-list">
            {data.orders.map((o) => (
              <li key={o.id}>
                <span>{o.items.map((l) => `${l.quantity}× ${l.name}`).join(', ')} · {rupees(o.total)}<span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ORDER_STATUS[o.status] ?? o.status} · {fmtDateTime(o.at)}{o.cancelReason ? ` — ${o.cancelReason}` : ''}</span></span>
                {o.status === 'placed' && <button type="button" className="btn btn-ghost" onClick={() => cancel(o.id)}>Cancel</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export const CATEGORY_LABEL = { cleanliness: 'Cleanliness', noise: 'Noise', wifi: 'Wi-Fi', seat: 'Seat or desk', food: 'Food', other: 'Something else' }
const TICKET_STATUS = { open: 'Reported', in_progress: 'Being fixed', resolved: 'Fixed', closed: 'Closed' }
export function PortalProblem() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ category: '', details: '', deskLabel: '' })
  const [msg, setMsg] = useState('')
  const load = useCallback(() => portalApi('me_tickets').then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!data) return <Loading error={error} />
  if (!data.on) return <p>Reporting here is not open yet — please tell the desk.</p>
  const send = async (e) => {
    e.preventDefault(); setError(''); setMsg('')
    if (!form.category) return setError('Choose what the problem is about')
    try {
      const r = await portalApi('me_report_problem', form)
      setMsg(r.ticket.priority === 'urgent' ? 'Thank you — this is marked urgent and the team has been told.' : 'Thank you — the team will look at it.')
      setForm({ category: '', details: '', deskLabel: '' }); load()
    } catch (err) { setError(err.message) }
  }
  return (
    <>
      <form className="card" onSubmit={send} data-testid="report-problem">
        <h2 style={{ marginTop: 0 }}>Report a problem</h2>
        <div className="chip-row" role="group" aria-label="What is it about" style={{ flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          {data.categories.map((c) => <button key={c} type="button" className={`chip${form.category === c ? ' on' : ''}`} aria-pressed={form.category === c} onClick={() => setForm({ ...form, category: c })}>{CATEGORY_LABEL[c] ?? c}</button>)}
        </div>
        <label style={{ display: 'block' }}>What happened?<textarea rows={3} maxLength={600} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} style={{ width: '100%' }} /></label>
        <label style={{ display: 'block', marginTop: '0.5rem' }}>Desk (optional)<input value={form.deskLabel} maxLength={20} onChange={(e) => setForm({ ...form, deskLabel: e.target.value })} placeholder="e.g. F12" /></label>
        <button type="submit" className="btn btn-primary" style={{ marginTop: '0.6rem' }} disabled={form.details.trim().length < 3}>Send</button>
        {msg && <p className="success-msg" role="status">{msg}</p>}
        {error && <p className="error-msg" role="alert">{error}</p>}
      </form>
      {data.tickets.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your reports</h3>
          <ul className="portal-list">
            {data.tickets.map((t) => (
              <li key={t.id}><span>{CATEGORY_LABEL[t.category]}: {t.details}<span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{TICKET_STATUS[t.status] ?? t.status} · {fmtDateTime(t.at)}{t.resolution ? ` — ${t.resolution}` : ''}</span></span></li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
