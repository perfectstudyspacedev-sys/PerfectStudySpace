import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { nowTimeStr, localTimeStrToISO, formatCurrency, openWhatsApp, DEFAULT_WELCOME_TEMPLATE } from '../lib/utils'
import PaymentModeSelector, { isSplitValid } from './PaymentModeSelector'

// Fallback used only until live fee config loads from the backend.
const FALLBACK_FEES = { 3: 35, 4: 45, 5: 55, 6: 60, 7: 70, 8: 80, 9: 90, 12: 100 }
export const WALKIN_HOUR_OPTIONS = Object.keys(FALLBACK_FEES).map(Number)

// Walk-in modal — name/phone autocomplete + hourly booking, no page navigation
export default function WalkInModal({ branchId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState(3)
  const [paymentMode, setPaymentMode] = useState({ mode: 'cash', cashAmount: '', upiAmount: '' })
  const [startTime, setStartTime] = useState(nowTimeStr)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [isNewStudent, setIsNewStudent] = useState(false)
  const [waSent, setWaSent] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [nameMatches, setNameMatches] = useState([])
  const [fees, setFees] = useState(FALLBACK_FEES)
  // Same shared app_settings-backed template the Membership page's "New Registration" tab
  // edits — fetched here too since walk-ins send the same welcome message on a new student.
  const [waTemplate, setWaTemplate] = useState(DEFAULT_WELCOME_TEMPLATE)

  useEffect(() => {
    api('get_welcome_template').then(({ value }) => setWaTemplate(value)).catch(() => {})
  }, [])

  useEffect(() => {
    api('list_fee_config').then(data => {
      const walkinRows = (data.config ?? []).filter(f => f.config_type === 'walkin')
      if (walkinRows.length) {
        const map = {}
        walkinRows.forEach(f => { map[f.max_hours] = Number(f.fee) })
        setFees(map)
        if (!(hours in map)) setHours(Number(Object.keys(map)[0]))
      }
    }).catch(() => { /* keep fallback */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hourOptions = Object.keys(fees).map(Number).sort((a, b) => a - b)
  // PSS-AI Phase 3 (I3): every price shown comes from the server's quote (the fee_config price while
  // yield pricing is off), and the price shown is sent back, so a price that changed meanwhile is
  // refused, not charged. Quotes are asked for whatever the cached switches say (review fix).
  const flags = useFeatureFlags()
  const [quotes, setQuotes] = useState({})
  const [priceNote, setPriceNote] = useState(null)
  const loadQuotes = useCallback(() => {
    if (!branchId) { setQuotes({}); setPriceNote(null); return }
    Promise.all(hourOptions.map((h) => api('quote_walkin', { branchId, hours: h }).then((q) => [h, q]).catch(() => null)))
      .then((list) => {
        const ok = list.filter(Boolean)
        setQuotes(Object.fromEntries(ok.map(([h, q]) => [h, q.amount])))
        const q = ok[0]?.[1]
        setPriceNote(q && q.pct ? `Today's walk-in prices: ${q.pct > 0 ? '+' : ''}${q.pct}%${q.reason ? ` — ${q.reason}` : ''}` : null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, hourOptions.join(',')])
  useEffect(() => { loadQuotes() }, [loadQuotes])
  const walkinFee = (h) => quotes[h] ?? fees[h] ?? 0

  // PSS-AI Phase 3 (O1/SP10): cabins whose hours are on sale for this walk-in's time.
  const [released, setReleased] = useState([])
  const [releaseId, setReleaseId] = useState('')
  useEffect(() => {
    if (!(flags.hourRelease || flags.overbooking) || !branchId) { setReleased([]); return undefined }
    let live = true
    api('list_resellable_desks', { branchId, startTime: localTimeStrToISO(startTime), hours })
      .then((r) => { if (live) { setReleased(r.desks ?? []); setReleaseId((cur) => (r.desks ?? []).some((d) => d.releaseId === cur) ? cur : '') } })
      .catch(() => { if (live) setReleased([]) })
    return () => { live = false }
  }, [flags.hourRelease, flags.overbooking, branchId, startTime, hours])
  const hm = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })

  // PSS-AI Phase 4 (I4): with seat matching on, the best free desk for this person is offered.
  const [suggested, setSuggested] = useState(null)
  const [useSuggested, setUseSuggested] = useState(true)
  const loadSuggestion = useCallback(() => {
    if (!flags.seatMatching || !branchId) { setSuggested(null); return }
    api('suggest_desk', { branchId, ...(selectedStudent?.id ? { studentId: selectedStudent.id } : {}) })
      .then((r) => setSuggested(r.desk ? { ...r.desk, reason: r.reason } : null)).catch(() => setSuggested(null))
  }, [flags.seatMatching, branchId, selectedStudent?.id])
  useEffect(() => { loadSuggestion() }, [loadSuggestion])
  const deskForWalkin = !releaseId && suggested && useSuggested ? suggested.id : null

  const lookupPhone = useCallback(async (p) => {
    if (p.length !== 10) return
    try {
      const { student } = await api('lookup_student', { phone: p })
      if (student?.name) {
        setName(student.name)
        setSelectedStudent(student)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (phone.length === 10) lookupPhone(phone)
  }, [phone, lookupPhone])

  useEffect(() => {
    if (selectedStudent && name === selectedStudent.name) return
    setSelectedStudent(null)
    if (!branchId || name.trim().length < 2) { setNameMatches([]); return }
    const id = setTimeout(() => {
      api('search_students_by_name', { branchId, query: name.trim() })
        .then(data => setNameMatches(data.students ?? []))
        .catch(() => setNameMatches([]))
    }, 250)
    return () => clearTimeout(id)
  }, [name, branchId, selectedStudent])

  const pickStudent = (s) => {
    setSelectedStudent(s)
    setName(s.name)
    setPhone(s.phone ?? '')
    setNameMatches([])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!/^\d{10}$/.test(phone)) return setError('Phone must be 10 digits')
    if (!isSplitValid(paymentMode, walkinFee(hours))) return setError('Cash + UPI must add up to the total')
    setLoading(true)
    setError('')
    try {
      const result = await api('create_walkin', {
        branchId, name, phone, hours, paymentMode: paymentMode.mode,
        cashAmount: paymentMode.cashAmount, upiAmount: paymentMode.upiAmount,
        startTime: localTimeStrToISO(startTime),
        ...(hours in quotes ? { expectedAmount: quotes[hours] } : {}),
        ...(releaseId ? { releaseId } : {}),
        ...(deskForWalkin ? { deskId: deskForWalkin } : {}),
      })
      setReceipt(result.booking)
      if (result.isNewStudent) {
        setIsNewStudent(true)
        openWhatsApp(phone, waTemplate.replace(/\{name\}/gi, name))
        setWaSent(true)
      }
    } catch (err) {
      setError(err.message)
      // A price or a released desk that changed meanwhile: show the current ones.
      if (/price is now|walk-in price is|just sold|not available|no longer that member|booked in that cabin/.test(err.message)) { loadQuotes(); setReleaseId(''); loadSuggestion() }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        {receipt ? (
          <>
            <h2 style={{ color: 'var(--accent)' }}>Walk-in Confirmed</h2>
            <p><strong>{name}</strong></p>
            <p className="mono">{hours} hours · {formatCurrency(receipt.amount ?? walkinFee(hours))}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Payment: {paymentMode.mode === 'split'
                ? `Cash ₹${paymentMode.cashAmount} + UPI ₹${paymentMode.upiAmount}`
                : paymentMode.mode.toUpperCase()}
            </p>
            {isNewStudent && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                <p style={{ color: waSent ? '#4ade80' : 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.6rem' }}>
                  {waSent ? `💬 WhatsApp welcome message sent to ${phone}` : `A welcome message will be sent to ${phone}.`}
                </p>
                <button
                  type="button"
                  onClick={() => openWhatsApp(phone, waTemplate.replace(/\{name\}/gi, name))}
                  style={{
                    width: '100%', padding: '0.6rem', borderRadius: 999, fontWeight: 700, cursor: 'pointer',
                    background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80',
                  }}
                >
                  💬 Resend Welcome Message
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onDone}>Close</button>
              <button
                type="button" className="btn btn-primary"
                onClick={() => { setReceipt(null); setName(''); setPhone(''); setSelectedStudent(null); setIsNewStudent(false); setWaSent(false) }}
              >New Walk-in</button>
            </div>
          </>
        ) : (
          <>
            <h2>Walk-in Booking</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your Full Name" autoComplete="off" autoFocus required />
                {selectedStudent && (
                  <p style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '0.3rem' }}>✓ Matched existing student</p>
                )}
                {nameMatches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                    background: '#141414', border: '1px solid #333', borderRadius: 4, marginTop: 2,
                    maxHeight: 180, overflowY: 'auto',
                  }}>
                    {nameMatches.map(s => (
                      <button
                        key={s.id} type="button" onClick={() => pickStudent(s)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.5rem 0.75rem',
                          background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '0.85rem', textAlign: 'left',
                        }}
                      >
                        <span>{s.name}</span>
                        <span className="mono" style={{ color: 'var(--text-muted)' }}>{s.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Phone Number</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" required />
              </div>
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Number of Hours</label>
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {hourOptions.map(h => (
                    <option key={h} value={h}>{h} hrs — {formatCurrency(walkinFee(h))}</option>
                  ))}
                </select>
              </div>
              {released.length > 0 && (
                <div className="form-group">
                  <label htmlFor="walkin-release">Desk</label>
                  <select id="walkin-release" value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
                    <option value="">Any free seat</option>
                    {released.map((d) => (
                      <option key={d.releaseId} value={d.releaseId}>
                        {d.deskLabel} — free {hm(d.from)}–{hm(d.to)} ({d.source === 'member' ? 'member released' : 'usually free'})
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    A member's cabin, for these hours only. If they arrive, they are seated elsewhere.
                  </p>
                </div>
              )}
              {suggested && !releaseId && (
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.75rem' }} data-testid="suggested-desk">
                  <input type="checkbox" checked={useSuggested} onChange={(e) => setUseSuggested(e.target.checked)} />
                  Seat them at <strong>{suggested.label}</strong>{suggested.reason ? <span style={{ color: 'var(--text-muted)' }}>({suggested.reason})</span> : null}
                </label>
              )}
              <div className="form-group">
                <label>Payment Mode</label>
                <PaymentModeSelector value={paymentMode} onChange={setPaymentMode} total={walkinFee(hours)} />
              </div>
              <p className="mono" style={{ marginBottom: priceNote ? '0.25rem' : '1rem', color: 'var(--accent)' }}>
                Bill: {formatCurrency(walkinFee(hours))}
              </p>
              {priceNote && <p data-testid="walkin-price-note" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{priceNote}</p>}
              {error && <p className="error-msg">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading || !branchId}>
                  {loading ? 'Registering…' : `Register — ${formatCurrency(walkinFee(hours))}`}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
