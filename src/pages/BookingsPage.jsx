import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency } from '../lib/utils'

function getTimeStatus(endIso, totalPauseMs = 0) {
  const ms = new Date(endIso).getTime() + totalPauseMs - Date.now()
  if (ms <= 0) {
    const over = Math.abs(ms)
    const h = Math.floor(over / 3_600_000)
    const m = Math.floor((over % 3_600_000) / 60_000)
    return {
      label: h > 0 ? `+${h}h ${m}m` : `+${m}m`,
      over: true,
      soon: false,
    }
  }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return {
    label: h > 0 ? `${h}h ${m}m` : `${m}m`,
    over: false,
    soon: ms < 10 * 60_000,
  }
}

function timeStr(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function categoryLabel(type) {
  if (type === 'walkin')    return { text: 'Walk-in',   color: 'var(--accent)',  bg: 'rgba(255,215,0,0.10)',  border: 'rgba(255,215,0,0.25)' }
  if (type === 'permanent') return { text: 'Permanent', color: '#a78bfa',        bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.25)' }
  return                           { text: 'Temporary',  color: '#4ade80',        bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.25)' }
}

// ── Ended-session alert banner ─────────────────────────────────────────────
function EndedAlerts({ alerts, onDismiss }) {
  if (alerts.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
      {alerts.map(a => (
        <div key={a.key} style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          background: '#1a0505', border: '1px solid #ff4444',
          borderRadius: 6, padding: '0.65rem 1rem',
          boxShadow: '0 2px 12px rgba(255,60,60,0.25)',
          animation: 'slideInToast 0.2s ease',
        }}>
          <span style={{ fontSize: '1.1rem' }}>🔔</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#ff8888' }}>{a.name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {' '}— session ended &nbsp;
              <span style={{ fontWeight: 700, color: '#ff4444' }}>{a.overtime} overtime</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(a.key)}
            style={{ background: 'none', border: 'none', color: '#ff8888', cursor: 'pointer', fontSize: '1.1rem', padding: '0 0.25rem', lineHeight: 1 }}
            title="Dismiss"
          >✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Checkout overtime modal ────────────────────────────────────────────────
function CheckoutModal({ booking, onConfirm, onCancel, loading }) {
  const [payMode, setPayMode] = useState(booking.payment_mode || 'cash')

  const totalPauseMs = (booking.total_pause_minutes ?? 0) * 60_000
  const endMs = new Date(booking.end_time).getTime() + totalPauseMs
  const overtimeMs = Math.max(Date.now() - endMs, 0)
  const overtimeMinutes = Math.ceil(overtimeMs / 60_000)
  const isWalkin = booking.booking_type === 'walkin'

  // Walk-in overtime charge — first 15 min grace, then charge beyond that
  const GRACE_MINUTES = 15
  const billableMinutes = isWalkin ? Math.max(0, overtimeMinutes - GRACE_MINUTES) : 0
  const hourlyRate = isWalkin ? (Number(booking.amount) / Number(booking.hours)) : 0
  const overtimeCharge = isWalkin ? Math.round(billableMinutes * hourlyRate / 60) : 0
  const inGrace = isWalkin && overtimeMinutes <= GRACE_MINUTES

  const otH = Math.floor(overtimeMinutes / 60)
  const otM = overtimeMinutes % 60
  const otLabel = otH > 0 ? `${otH}h ${otM}m` : `${otM}m`

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2>Checkout — {booking.students?.name}</h2>

        <div style={{ background: inGrace ? 'rgba(74,222,128,0.07)' : 'rgba(255,60,60,0.08)', border: `1px solid ${inGrace ? 'rgba(74,222,128,0.3)' : 'rgba(255,60,60,0.3)'}`, borderRadius: 6, padding: '0.75rem', marginBottom: '1rem' }}>
          <p style={{ fontWeight: 700, color: inGrace ? '#4ade80' : '#ff8888', marginBottom: '0.3rem' }}>
            ⏱ {otLabel} overtime {inGrace ? '— within grace period' : ''}
          </p>
          {isWalkin ? (
            inGrace ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Under 15 minutes — no extra charge applies.
              </p>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                15 min grace + {billableMinutes}m billed at ₹{Math.round(hourlyRate)}/hr
              </p>
            )
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Overtime will be logged to this member&apos;s profile for settlement at membership end.
            </p>
          )}
        </div>

        {isWalkin ? (
          <>
            <div className="card" style={{ marginBottom: '1rem', background: 'rgba(255,215,0,0.05)' }}>
              <p className="mono">Original: {formatCurrency(Number(booking.amount))}</p>
              {!inGrace && (
                <>
                  <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Grace: first 15m free</p>
                  <p className="mono" style={{ color: '#ff8888' }}>Overtime ({billableMinutes}m): +{formatCurrency(overtimeCharge)}</p>
                </>
              )}
              <p className="mono" style={{ color: 'var(--accent)', fontSize: '1.1rem', fontWeight: 700, marginTop: '0.4rem' }}>
                Total: {formatCurrency(Number(booking.amount) + overtimeCharge)}
              </p>
            </div>
            <div className="form-group">
              <label>Payment Mode</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setPayMode(value)}
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${payMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: payMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: payMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                  >{label}</button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading}
            onClick={() => onConfirm({ overtimeMinutes, overtimeCharge, overtimePaymentMode: payMode })}
          >
            {loading ? 'Checking out…'
              : isWalkin && !inGrace ? `Collect ₹${(Number(booking.amount) + overtimeCharge).toLocaleString('en-IN')} & Check Out`
              : isWalkin && inGrace ? 'Check Out (No Extra Charge)'
              : 'Log Overtime & Check Out'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Food order modal — attach a food bill to a student, optionally as a checkout step ──
function FoodOrderModal({ branchId, booking, standalone = false, onClose, onSkip, onDone }) {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState([])
  const [paymentMode, setPaymentMode] = useState('cash')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('list_food_items', { branchId }).then(d => setItems((d.items ?? []).filter(i => i.is_active)))
  }, [branchId])

  const filtered = search.trim() ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) : items

  const addItem = (item) => {
    setOrders(prev => {
      const exists = prev.find(o => o.foodItemId === item.id)
      if (exists) return prev.map(o => o.foodItemId === item.id ? { ...o, quantity: o.quantity + 1 } : o)
      return [...prev, { foodItemId: item.id, name: item.name, price: Number(item.price), quantity: 1 }]
    })
    setSearch('')
  }

  const changeQty = (foodItemId, delta) => {
    setOrders(prev => prev.map(o => o.foodItemId === foodItemId ? { ...o, quantity: o.quantity + delta } : o).filter(o => o.quantity > 0))
  }

  const total = orders.reduce((s, o) => s + o.price * o.quantity, 0)

  const handleSave = async () => {
    if (orders.length === 0) {
      if (standalone) return setError('Add at least one item')
      return onSkip()
    }
    setSaving(true)
    setError('')
    try {
      await api('create_food_bill', {
        branchId, studentId: booking.student_id, studentName: booking.students?.name ?? null,
        studentPhone: booking.students?.phone ?? null, bookingId: booking.id, paymentMode,
        items: orders.map(o => ({ foodItemId: o.foodItemId, quantity: o.quantity })),
      })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2>{standalone ? 'Food Bill' : 'Checkout'} — {booking.students?.name}</h2>
        {!standalone && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            Add any food items before finishing this checkout, or skip if there's nothing to bill.
          </p>
        )}
        <div className="form-group">
          <input placeholder="Search food items…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {search.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem', maxHeight: 160, overflowY: 'auto' }}>
            {filtered.map(item => (
              <button key={item.id} type="button" className="btn btn-ghost" style={{ justifyContent: 'space-between', display: 'flex' }} onClick={() => addItem(item)}>
                <span>{item.name}</span>
                <span className="mono">{formatCurrency(item.price)}</span>
              </button>
            ))}
          </div>
        )}
        {orders.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            {orders.map(o => (
              <div key={o.foodItemId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.88rem' }}>{o.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <button type="button" className="btn btn-ghost" style={{ padding: '0.15rem 0.5rem' }} onClick={() => changeQty(o.foodItemId, -1)}>−</button>
                  <span className="mono">{o.quantity}</span>
                  <button type="button" className="btn btn-ghost" style={{ padding: '0.15rem 0.5rem' }} onClick={() => changeQty(o.foodItemId, 1)}>+</button>
                  <span className="mono" style={{ minWidth: 56, textAlign: 'right' }}>{formatCurrency(o.price * o.quantity)}</span>
                </div>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>Total</span>
              <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{formatCurrency(total)}</span>
            </div>
          </div>
        )}
        <div className="form-group">
          <label>Payment Mode</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
              <button key={value} type="button" onClick={() => setPaymentMode(value)}
                style={{ flex: 1, padding: '0.5rem', border: `1px solid ${paymentMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: paymentMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: paymentMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
              >{label}</button>
            ))}
          </div>
        </div>
        {error && <p className="error-msg">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {!standalone && (
            <button type="button" className="btn btn-ghost" onClick={onSkip}>Skip</button>
          )}
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…'
              : standalone ? `Add Bill — ${formatCurrency(total)}`
              : orders.length === 0 ? 'Continue'
              : `Add Bill & Continue — ${formatCurrency(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BookingsPage() {
  const { branchId } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [tick, setTick] = useState(0)
  const [endedAlerts, setEndedAlerts] = useState([])
  const [checkoutFlow, setCheckoutFlow] = useState(null) // { booking, step: 'food' | 'confirm' }
  const [foodOrderBooking, setFoodOrderBooking] = useState(null)
  const notifiedIds = useRef(new Set())

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const data = await api('list_today_bookings', { branchId })
      setBookings(data.bookings ?? [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [branchId])

  useEffect(() => { load() }, [load])

  // Re-render every 30s so time left ticks
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Detect ended sessions and fire top-of-page alerts
  useEffect(() => {
    bookings.forEach(b => {
      if (b.is_paused) return
      const totalPauseMs = (b.total_pause_minutes ?? 0) * 60_000
      const ts = getTimeStatus(b.end_time, totalPauseMs)
      if (ts.over && !notifiedIds.current.has(b.id)) {
        notifiedIds.current.add(b.id)
        setEndedAlerts(prev => [...prev, {
          key: b.id,
          name: b.students?.name || 'Unknown',
          overtime: ts.label,
        }])
      }
    })
  }, [bookings, tick])

  const dismissAlert = (key) => setEndedAlerts(prev => prev.filter(a => a.key !== key))

  const doAction = async (key, fn) => {
    setActionLoading(key)
    try { await fn() } catch { /* ignore */ }
    finally { setActionLoading(null); load() }
  }

  // Checkout always starts with an optional food-bill step, then finishes the session
  const handleCheckout = (b) => {
    setCheckoutFlow({ booking: b, step: 'food' })
  }

  const proceedAfterFood = () => {
    const b = checkoutFlow.booking
    const totalPauseMs = (b.total_pause_minutes ?? 0) * 60_000
    const ts = getTimeStatus(b.end_time, totalPauseMs)
    if (ts.over) {
      setCheckoutFlow({ booking: b, step: 'confirm' })
    } else {
      setCheckoutFlow(null)
      doAction(b.id + ':checkout', () => api('checkout_booking', { bookingId: b.id }))
    }
  }

  const confirmCheckout = async ({ overtimeMinutes, overtimePaymentMode }) => {
    if (!checkoutFlow) return
    const b = checkoutFlow.booking
    setActionLoading(b.id + ':checkout')
    try {
      await api('checkout_booking', {
        bookingId: b.id,
        overtimeMinutes,
        overtimePaymentMode,
      })
      setCheckoutFlow(null)
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const walkinCount = bookings.filter(b => b.booking_type === 'walkin').length
  const memberCount = bookings.filter(b => b.booking_type !== 'walkin').length
  const pausedCount = bookings.filter(b => b.is_paused).length

  return (
    <>
      <div className="page-header">
        <h1>Bookings</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Currently present today</span>
        <button type="button" className="btn btn-ghost" onClick={load}>↻ Refresh</button>
      </div>

      {/* Ended-session alerts — persistent until dismissed */}
      <EndedAlerts alerts={endedAlerts} onDismiss={dismissAlert} />

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, background: 'rgba(255,215,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,215,0,0.2)' }}>
          {walkinCount} Walk-in
        </span>
        <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, background: 'rgba(74,222,128,0.08)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}>
          {memberCount} Member
        </span>
        <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid #333' }}>
          {bookings.length} Total
        </span>
        {pausedCount > 0 && (
          <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, background: 'rgba(255,150,0,0.08)', color: '#ffaa44', border: '1px solid rgba(255,150,0,0.2)' }}>
            {pausedCount} On Break
          </span>
        )}
      </div>

      {loading ? <p>Loading…</p> : bookings.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>No students currently present.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: '0.75rem', display: 'inline-block' }}>
            + New Walk-in (from Dashboard)
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Category</th>
                <th>Desk / Cabin</th>
                <th>Time</th>
                <th>Time Left</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => {
                const isPaused  = !!b.is_paused
                const isWalkin  = b.booking_type === 'walkin'
                const totalPauseMs = (b.total_pause_minutes ?? 0) * 60_000
                const ts        = getTimeStatus(b.end_time, totalPauseMs)
                const cat       = categoryLabel(b.booking_type)
                const deskLabel = b.desks?.label ?? null

                return (
                  <tr key={b.id} style={{
                    background: isPaused   ? 'rgba(255,150,0,0.03)'
                              : ts.over    ? 'rgba(255,60,60,0.05)'
                              : undefined,
                  }}>

                    {/* Student — name only */}
                    <td>
                      <Link
                        to={`/students/${b.student_id}`}
                        style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {b.students?.name ?? '—'}
                      </Link>
                    </td>

                    {/* Category */}
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                        background: cat.bg, color: cat.color, border: `1px solid ${cat.border}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {cat.text}
                      </span>
                    </td>

                    {/* Desk / Cabin */}
                    <td>
                      {deskLabel
                        ? <span className="mono" style={{ fontWeight: 600 }}>{deskLabel}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>}
                    </td>

                    {/* Booked time window */}
                    <td>
                      <div className="mono" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                        {timeStr(b.start_time)} → {timeStr(b.end_time)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.hours}h booked</div>
                      {b.total_pause_minutes > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#ffaa44' }}>+{b.total_pause_minutes}m break</div>
                      )}
                    </td>

                    {/* Time Left / Overtime / On Break */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {isPaused ? (
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#ffaa44' }}>⏸ On Break</span>
                      ) : ts.over ? (
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#ff4444' }}>Session Ended</span>
                          <div style={{ fontSize: '0.78rem', color: '#ff8888', fontWeight: 600 }}>{ts.label} overtime</div>
                        </div>
                      ) : (
                        <span style={{
                          fontWeight: 700, fontSize: '0.85rem',
                          color: ts.soon ? 'var(--accent)' : '#4ade80',
                        }}>
                          {ts.label}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'nowrap' }}>
                        {/* Break / Continue only for members */}
                        {!isWalkin && (
                          isPaused ? (
                            <button type="button" className="btn btn-primary"
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                              disabled={actionLoading === b.id + ':resume'}
                              onClick={() => doAction(b.id + ':resume', () => api('resume_session', { bookingId: b.id }))}
                            >▶ Continue</button>
                          ) : (
                            <button type="button" style={{
                              padding: '0.25rem 0.55rem', fontSize: '0.78rem', fontWeight: 600,
                              background: 'rgba(255,150,0,0.08)', border: '1px solid rgba(255,150,0,0.4)',
                              color: '#ffaa44', borderRadius: 4, cursor: 'pointer',
                            }}
                              disabled={actionLoading === b.id + ':pause'}
                              onClick={() => doAction(b.id + ':pause', () => api('pause_session', { bookingId: b.id }))}
                            >⏸ Break</button>
                          )
                        )}

                        {/* Add food bill before/at checkout */}
                        <button type="button" style={{
                          padding: '0.25rem 0.55rem', fontSize: '0.78rem', fontWeight: 600,
                          background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.3)',
                          color: 'var(--accent)', borderRadius: 4, cursor: 'pointer',
                        }}
                          onClick={() => setFoodOrderBooking(b)}
                        >🍽 Food</button>

                        {/* Checkout for everyone */}
                        <button type="button" style={{
                          padding: '0.25rem 0.55rem', fontSize: '0.78rem', fontWeight: 600,
                          background: ts.over ? 'rgba(255,60,60,0.18)' : 'rgba(255,60,60,0.08)',
                          border: `1px solid ${ts.over ? 'rgba(255,60,60,0.6)' : 'rgba(255,60,60,0.3)'}`,
                          color: '#ff8888', borderRadius: 4, cursor: 'pointer',
                        }}
                          disabled={actionLoading === b.id + ':checkout'}
                          onClick={() => handleCheckout(b)}
                        >✓ Out</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <span style={{ display: 'none' }}>{tick}</span>

      {checkoutFlow?.step === 'food' && (
        <FoodOrderModal
          branchId={branchId}
          booking={checkoutFlow.booking}
          onClose={() => setCheckoutFlow(null)}
          onSkip={proceedAfterFood}
          onDone={proceedAfterFood}
        />
      )}

      {checkoutFlow?.step === 'confirm' && (
        <CheckoutModal
          booking={checkoutFlow.booking}
          loading={actionLoading === checkoutFlow.booking.id + ':checkout'}
          onConfirm={confirmCheckout}
          onCancel={() => setCheckoutFlow(null)}
        />
      )}

      {foodOrderBooking && (
        <FoodOrderModal
          branchId={branchId}
          booking={foodOrderBooking}
          standalone
          onClose={() => setFoodOrderBooking(null)}
          onDone={() => setFoodOrderBooking(null)}
        />
      )}
    </>
  )
}
