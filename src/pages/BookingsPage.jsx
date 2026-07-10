import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, formatDate, todayISO } from '../lib/utils'
import WalkInModal from '../components/WalkInModal'

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

// ── Edit check-in time for a booking already in progress — time only, the date and
// booked hours stay fixed to what was recorded at check-in ────────────────────────
function toLocalTimeInput(isoString) {
  const d = new Date(isoString)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function EditStartTimeModal({ booking, onClose, onDone }) {
  const [time, setTime] = useState(toLocalTimeInput(booking.start_time))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setLoading(true)
    setError('')
    try {
      const [h, m] = time.split(':').map(Number)
      const newStart = new Date(booking.start_time)
      newStart.setHours(h, m, 0, 0)
      await api('update_attendance', {
        bookingId: booking.id,
        startTime: newStart.toISOString(),
      })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <h2>Edit Check-in Time</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{booking.students?.name}</p>

        <div className="form-group">
          <label>Check-in Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>

        {error && <p className="error-msg">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={handleSave}>
            {loading ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Checkout overtime modal ────────────────────────────────────────────────
function CheckoutModal({ booking, onConfirm, onCancel, loading }) {
  const [payMode, setPayMode] = useState(booking.payment_mode || 'cash')
  const [settleFoodNow, setSettleFoodNow] = useState(false)

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
  const foodTotal = Number(booking.foodTotal ?? 0)
  const unpaidFoodTotal = Number(booking.unpaidFoodTotal ?? 0)
  const paidFoodTotal = foodTotal - unpaidFoodTotal
  const alreadyPaid = Number(booking.amount) + paidFoodTotal
  const remainingDue = overtimeCharge + (isWalkin ? unpaidFoodTotal : 0) // session fee already settled — overtime + any unpaid food are owed now
  const fullBill = alreadyPaid + remainingDue
  const membership = booking.memberships
  const membershipDue = membership ? Number(membership.fee_due ?? 0) : 0
  const isExpiredUnrenewed = !!membership && membership.end_date < todayISO()
  const hasFoodPass = !isWalkin && !!booking.hasFoodPass
  // A Food Pass holder's food is auto-deducted at checkout — nothing to "collect" from them.
  const memberDueNow = hasFoodPass ? 0 : unpaidFoodTotal
  const canClose = !isExpiredUnrenewed || membershipDue <= 0

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2>Checkout — {booking.students?.name}</h2>

        {overtimeMinutes > 0 && (
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
        )}

        {/* Payment summary — what's been paid vs what's still pending */}
        <div className="card" style={{ marginBottom: '1rem', background: 'rgba(255,215,0,0.05)' }}>
          <h3 style={{ color: 'var(--accent)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Payment Summary</h3>
          {isWalkin ? (
            <>
              <p className="mono" style={{ color: '#4ade80' }}>Session fee (paid): {formatCurrency(Number(booking.amount))}</p>
              {paidFoodTotal > 0 && <p className="mono" style={{ color: '#4ade80' }}>Food bill (paid): {formatCurrency(paidFoodTotal)}</p>}
              {unpaidFoodTotal > 0 && <p className="mono" style={{ color: '#ff8888' }}>Food bill (to collect): {formatCurrency(unpaidFoodTotal)}</p>}
              {overtimeCharge > 0 && <p className="mono" style={{ color: '#ff8888' }}>Overtime (new charge): {formatCurrency(overtimeCharge)}</p>}
              <p className="mono" style={{ marginTop: '0.4rem' }}>Full bill: {formatCurrency(fullBill)}</p>
              <p className="mono" style={{ color: remainingDue > 0 ? 'var(--accent)' : '#4ade80', fontSize: '1.05rem', fontWeight: 700 }}>
                Remaining to be paid: {formatCurrency(remainingDue)}
              </p>
            </>
          ) : (
            <>
              {paidFoodTotal > 0 && <p className="mono" style={{ color: '#4ade80' }}>Food bill (paid separately): {formatCurrency(paidFoodTotal)}</p>}
              {unpaidFoodTotal > 0 && hasFoodPass && (
                <p className="mono" style={{ color: '#4ade80', fontWeight: 700 }}>
                  🎫 {formatCurrency(unpaidFoodTotal)} will be settled from Food Pass
                </p>
              )}
              {unpaidFoodTotal > 0 && !hasFoodPass && (
                <>
                  <p className="mono" style={{ color: '#ff8888', fontWeight: 700 }}>Food bill (pending): {formatCurrency(unpaidFoodTotal)}</p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Can carry forward up to 3 days from the order date — or collect it now below.
                  </p>
                </>
              )}
              {isExpiredUnrenewed && (
                <>
                  <p style={{ color: '#ff4444', fontWeight: 700, marginTop: paidFoodTotal || unpaidFoodTotal ? '0.5rem' : 0 }}>
                    ⚠ Membership expired {formatDate(membership.end_date)} — not renewed
                  </p>
                  <p className="mono" style={{ color: '#ff4444', fontWeight: 700 }}>
                    Membership pending: {formatCurrency(membershipDue)}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    Renew the membership from the student's profile before checking them out again.
                  </p>
                </>
              )}
              {!paidFoodTotal && !unpaidFoodTotal && !isExpiredUnrenewed && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nothing pending — membership in good standing.</p>
              )}
            </>
          )}
        </div>

        {!isWalkin && memberDueNow > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={settleFoodNow} onChange={(e) => setSettleFoodNow(e.target.checked)} />
            Collect the pending food bill now instead of carrying it forward
          </label>
        )}

        {(isWalkin ? remainingDue > 0 : memberDueNow > 0 && settleFoodNow) && (
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
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading}
            onClick={() => onConfirm({ overtimeMinutes, overtimeCharge, overtimePaymentMode: payMode, settleFoodNow })}
          >
            {loading ? 'Checking out…'
              : isWalkin && remainingDue > 0 ? `Collect ₹${remainingDue.toLocaleString('en-IN')} & Check Out`
              : !isWalkin && memberDueNow > 0 && settleFoodNow ? `Collect ₹${memberDueNow.toLocaleString('en-IN')} & Check Out`
              : !isWalkin && !canClose ? 'Check Out Anyway'
              : 'Check Out'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Food order modal — attach a food bill to a student at any point during their stay ──
function FoodOrderModal({ branchId, booking, onClose, onDone }) {
  const isMember = booking.booking_type !== 'walkin'
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [foodPass, setFoodPass] = useState(null)
  const [payChoice, setPayChoice] = useState('later')
  const [payMode, setPayMode] = useState('cash')
  const [negativeBalance, setNegativeBalance] = useState(null)
  const [collectMode, setCollectMode] = useState('cash')
  const [collecting, setCollecting] = useState(false)

  useEffect(() => {
    api('list_food_items', { branchId }).then(d => setItems((d.items ?? []).filter(i => i.is_active)))
  }, [branchId])

  useEffect(() => {
    if (!isMember) return
    api('get_food_pass', { studentId: booking.student_id }).then(d => {
      setFoodPass(d.pass)
      if (d.pass) setPayChoice('pass')
    }).catch(() => setFoodPass(null))
  }, [isMember, booking.student_id])

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
    if (orders.length === 0) return setError('Add at least one item')
    setSaving(true)
    setError('')
    try {
      const res = await api('create_food_bill', {
        branchId, studentId: booking.student_id, studentName: booking.students?.name ?? null,
        studentPhone: booking.students?.phone ?? null, bookingId: booking.id,
        items: orders.map(o => ({ foodItemId: o.foodItemId, quantity: o.quantity })),
        paymentMode: isMember && !foodPass && payChoice === 'now' ? payMode : undefined,
      })
      if (res.foodPassBalance != null && res.foodPassBalance < 0) {
        setNegativeBalance(-res.foodPassBalance)
      } else {
        onDone()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCollectShortfall = async () => {
    setCollecting(true)
    try {
      await api('topup_food_pass', {
        studentId: booking.student_id, branchId, amount: negativeBalance, paymentMode: collectMode,
      })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setCollecting(false)
    }
  }

  if (negativeBalance != null) {
    return (
      <div className="modal-overlay" onClick={onDone}>
        <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
          <h2>🎫 Food Pass Balance Negative</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{booking.students?.name}</p>
          <div className="card" style={{ marginBottom: '1rem', background: 'rgba(255,60,60,0.06)' }}>
            <p className="mono" style={{ color: '#ff8888', fontSize: '1.2rem', fontWeight: 700 }}>
              -{formatCurrency(negativeBalance)}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              The order was placed, but the Food Pass balance is now negative. Collect this amount from the student now, or skip and settle it later.
            </p>
          </div>
          <div className="form-group">
            <label>Mode</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
                <button key={value} type="button" onClick={() => setCollectMode(value)}
                  style={{ flex: 1, padding: '0.5rem', border: `1px solid ${collectMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: collectMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: collectMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                >{label}</button>
              ))}
            </div>
          </div>
          {error && <p className="error-msg">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onDone}>Skip for Now</button>
            <button type="button" className="btn btn-primary" disabled={collecting} onClick={handleCollectShortfall}>
              {collecting ? 'Collecting…' : `Collect ${formatCurrency(negativeBalance)}`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2>Food Bill — {booking.students?.name}</h2>
        {Number(booking.foodTotal ?? 0) > 0 && (
          <p style={{ fontSize: '0.8rem', color: '#4ade80', marginBottom: '0.75rem' }}>
            ✓ Already billed {formatCurrency(Number(booking.foodTotal))} for this session
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
        {isMember ? (
          foodPass ? (
            <div className="form-group">
              <div style={{ padding: '0.65rem 0.8rem', background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: 6 }}>
                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)' }}>🎫 Paying via Food Pass</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Current balance: {formatCurrency(Number(foodPass.balance))}
                </p>
                {Number(foodPass.balance) - total < 0 && (
                  <p style={{ fontSize: '0.78rem', color: '#ffaa44', marginTop: '0.3rem' }}>
                    This will take the balance negative — you'll be asked to collect the shortfall after saving.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>Payment</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => setPayChoice('now')}
                    style={{ flex: '1 0 auto', padding: '0.5rem 0.7rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', borderRadius: 4, border: `1px solid ${payChoice === 'now' ? 'var(--accent)' : '#333'}`, background: payChoice === 'now' ? 'rgba(255,215,0,0.08)' : '#141414', color: payChoice === 'now' ? 'var(--accent)' : 'var(--text-muted)' }}
                  >Pay Now</button>
                  <button type="button" onClick={() => setPayChoice('later')}
                    style={{ flex: '1 0 auto', padding: '0.5rem 0.7rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', borderRadius: 4, border: `1px solid ${payChoice === 'later' ? 'var(--accent)' : '#333'}`, background: payChoice === 'later' ? 'rgba(255,215,0,0.08)' : '#141414', color: payChoice === 'later' ? 'var(--accent)' : 'var(--text-muted)' }}
                  >Pay Later</button>
                </div>
              </div>
              {payChoice === 'now' && (
                <div className="form-group">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
                      <button key={value} type="button" onClick={() => setPayMode(value)}
                        style={{ flex: 1, padding: '0.5rem', border: `1px solid ${payMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: payMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: payMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              )}
              {payChoice === 'later' && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Carried on the student's tab — must be settled within 3 days or checkout will be blocked.
                </p>
              )}
            </>
          )
        ) : (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Payment for this isn't collected now — it's added to the bill and settled (cash/UPI) at final checkout.
          </p>
        )}
        {error && <p className="error-msg">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving || orders.length === 0} onClick={handleSave}>
            {saving ? 'Saving…' : `Save Order — ${formatCurrency(total)}`}
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
  const [checkoutBooking, setCheckoutBooking] = useState(null)
  const [foodOrderBooking, setFoodOrderBooking] = useState(null)
  const [editBooking, setEditBooking] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [showWalkIn, setShowWalkIn] = useState(false)
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

  // Checkout always shows a payment summary (paid vs pending) before finishing the session
  const handleCheckout = (b) => {
    setCheckoutBooking(b)
  }

  const confirmCheckout = async ({ overtimeMinutes, overtimePaymentMode, settleFoodNow }) => {
    if (!checkoutBooking) return
    const b = checkoutBooking
    setActionLoading(b.id + ':checkout')
    try {
      await api('checkout_booking', {
        bookingId: b.id,
        overtimeMinutes,
        overtimePaymentMode,
        settleFoodNow,
      })
      setCheckoutBooking(null)
      load()
    } catch (err) {
      window.alert(err.message)
    } finally { setActionLoading(null) }
  }

  const walkinCount = bookings.filter(b => b.booking_type === 'walkin').length
  const memberCount = bookings.filter(b => b.booking_type !== 'walkin').length
  const pausedCount = bookings.filter(b => b.is_paused).length
  const filteredBookings = typeFilter === 'walkin' ? bookings.filter(b => b.booking_type === 'walkin')
    : typeFilter === 'member' ? bookings.filter(b => b.booking_type !== 'walkin')
    : bookings

  return (
    <>
      <div className="page-header">
        <h1>Bookings</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Currently present today</span>
        <button type="button" className="btn btn-ghost" onClick={load}>↻ Refresh</button>
      </div>

      {/* Ended-session alerts — persistent until dismissed */}
      <EndedAlerts alerts={endedAlerts} onDismiss={dismissAlert} />

      {/* Summary chips — click to filter the list below */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" onClick={() => setTypeFilter('all')} style={{
          padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          background: typeFilter === 'all' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
          color: typeFilter === 'all' ? 'var(--text)' : 'var(--text-muted)',
          border: `1px solid ${typeFilter === 'all' ? '#666' : '#333'}`,
        }}>
          {bookings.length} Total
        </button>
        <button type="button" onClick={() => setTypeFilter('walkin')} style={{
          padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          background: typeFilter === 'walkin' ? 'rgba(255,215,0,0.18)' : 'rgba(255,215,0,0.08)',
          color: 'var(--accent)',
          border: `1px solid ${typeFilter === 'walkin' ? 'var(--accent)' : 'rgba(255,215,0,0.2)'}`,
        }}>
          {walkinCount} Walk-in
        </button>
        <button type="button" onClick={() => setTypeFilter('member')} style={{
          padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          background: typeFilter === 'member' ? 'rgba(74,222,128,0.18)' : 'rgba(74,222,128,0.08)',
          color: '#4ade80',
          border: `1px solid ${typeFilter === 'member' ? '#4ade80' : 'rgba(74,222,128,0.2)'}`,
        }}>
          {memberCount} Member
        </button>
        {pausedCount > 0 && (
          <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, background: 'rgba(255,150,0,0.08)', color: '#ffaa44', border: '1px solid rgba(255,150,0,0.2)' }}>
            {pausedCount} On Break
          </span>
        )}
      </div>

      {loading ? <p>Loading…</p> : bookings.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>No students currently present.</p>
          <button
            type="button" className="btn btn-primary"
            style={{ marginTop: '0.75rem', padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
            onClick={() => setShowWalkIn(true)}
          >
            + New Walk-in
          </button>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>No {typeFilter === 'walkin' ? 'walk-in' : 'member'} students currently present.</p>
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
              {filteredBookings.map(b => {
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

                        {/* Edit start time / hours */}
                        <button type="button" className="btn btn-ghost" style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                          onClick={() => setEditBooking(b)}
                        >✎ Edit</button>

                        {/* Add food bill before/at checkout */}
                        <button type="button" style={{
                          padding: '0.25rem 0.55rem', fontSize: '0.78rem', fontWeight: 600,
                          background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.3)',
                          color: 'var(--accent)', borderRadius: 4, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                        }}
                          onClick={() => setFoodOrderBooking(b)}
                        >
                          🍽 Food
                          {Number(b.foodTotal) > 0 && (
                            <span className="mono" style={{ color: '#4ade80', fontWeight: 700 }}>{formatCurrency(Number(b.foodTotal))}</span>
                          )}
                        </button>

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

      {checkoutBooking && (
        <CheckoutModal
          booking={checkoutBooking}
          loading={actionLoading === checkoutBooking.id + ':checkout'}
          onConfirm={confirmCheckout}
          onCancel={() => setCheckoutBooking(null)}
        />
      )}

      {editBooking && (
        <EditStartTimeModal
          booking={editBooking}
          onClose={() => setEditBooking(null)}
          onDone={() => { setEditBooking(null); load() }}
        />
      )}

      {foodOrderBooking && (
        <FoodOrderModal
          branchId={branchId}
          booking={foodOrderBooking}
          onClose={() => setFoodOrderBooking(null)}
          onDone={() => { setFoodOrderBooking(null); load() }}
        />
      )}

      {showWalkIn && (
        <WalkInModal
          branchId={branchId}
          onClose={() => setShowWalkIn(false)}
          onDone={() => { setShowWalkIn(false); load() }}
        />
      )}
    </>
  )
}
