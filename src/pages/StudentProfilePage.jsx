import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatDate, paymentModeLabel, getMultiMonthDiscount, todayISO } from '../lib/utils'

const PAYMENT_OPTIONS = [
  { value: 'cash', label: '💵 Cash' },
  { value: 'upi', label: '📱 UPI' },
]

// Fallback packages — used only until live rates are fetched from fee_config (Branch Settings)
const DEFAULT_TEMP_PACKAGES = [
  { hours: 2, fee: 500 }, { hours: 3, fee: 650 }, { hours: 4, fee: 800 },
  { hours: 5, fee: 1000 }, { hours: 6, fee: 1250 }, { hours: 8, fee: 1500 },
]
const DEFAULT_PERM_PACKAGES = [
  { hours: 12, fee: 2100 }, { hours: 13, fee: 2200 }, { hours: 14, fee: 2300 },
  { hours: 15, fee: 2400 }, { hours: 24, fee: 2500 },
]

export default function StudentProfilePage() {
  const { id } = useParams()
  const { isOwner } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState('cash')
  const [holdLoading, setHoldLoading] = useState(false)
  const [holdError, setHoldError] = useState('')
  const [lockerStatus, setLockerStatus] = useState(null)
  const [lockerNo, setLockerNo] = useState('')
  const [lockerPayType, setLockerPayType] = useState('now')
  const [lockerPayMode, setLockerPayMode] = useState('cash')
  const [lockerPayAmount, setLockerPayAmount] = useState('')
  const [lockerLoading, setLockerLoading] = useState(false)
  const [lockerError, setLockerError] = useState('')
  const [tempPackages, setTempPackages] = useState(DEFAULT_TEMP_PACKAGES)
  const [permPackages, setPermPackages] = useState(DEFAULT_PERM_PACKAGES)
  const [renewOpen, setRenewOpen] = useState(false)
  const [renewCategory, setRenewCategory] = useState('temporary')
  const [renewHoursPerDay, setRenewHoursPerDay] = useState(4)
  const [renewMonths, setRenewMonths] = useState(1)
  const [renewPayMode, setRenewPayMode] = useState('cash')
  const [renewPayType, setRenewPayType] = useState('full')
  const [renewAdvance, setRenewAdvance] = useState('')
  const [renewLoading, setRenewLoading] = useState(false)
  const [renewError, setRenewError] = useState('')
  const [discountType, setDiscountType] = useState('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [discountRemarks, setDiscountRemarks] = useState('')
  const [discountLoading, setDiscountLoading] = useState(false)
  const [discountError, setDiscountError] = useState('')
  const [discountSuccess, setDiscountSuccess] = useState('')
  const [cashbackNotice, setCashbackNotice] = useState(null)
  const [foodPass, setFoodPass] = useState(null)
  const [foodPassTopup, setFoodPassTopup] = useState('')
  const [foodPassPayMode, setFoodPassPayMode] = useState('cash')
  const [foodPassLoading, setFoodPassLoading] = useState(false)
  const [foodPassError, setFoodPassError] = useState('')
  const [editingBooking, setEditingBooking] = useState(null)
  const [editStartTime, setEditStartTime] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  const refresh = useCallback(() => {
    setLoading(true)
    api('get_student_profile', { studentId: id })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { refresh() }, [refresh])

  // Pull live membership fee rates so renewal pricing reflects Branch Settings
  useEffect(() => {
    api('list_fee_config').then(({ config }) => {
      const membershipRows = (config ?? []).filter(f => f.config_type === 'membership')
      const toPackages = (category) => membershipRows
        .filter(f => f.cabin_type === category)
        .map(f => ({ hours: f.hours_per_day, fee: Number(f.fee) }))
        .sort((a, b) => a.hours - b.hours)
      const temp = toPackages('temporary')
      const perm = toPackages('permanent')
      if (temp.length) setTempPackages(temp)
      if (perm.length) setPermPackages(perm)
    }).catch(() => { /* keep defaults */ })
  }, [])

  useEffect(() => {
    const branchId = data?.student?.branch_id
    if (!branchId) return
    api('get_locker_status', { branchId }).then(setLockerStatus).catch(() => setLockerStatus(null))
  }, [data?.student?.branch_id])

  const loadFoodPass = useCallback(() => {
    api('get_food_pass', { studentId: id }).then(d => setFoodPass(d.pass)).catch(() => setFoodPass(null))
  }, [id])

  useEffect(() => { loadFoodPass() }, [loadFoodPass])

  const handleFoodPassTopup = async () => {
    if (!foodPassTopup) return
    setFoodPassLoading(true)
    setFoodPassError('')
    try {
      await api('topup_food_pass', {
        studentId: id, branchId: data.student.branch_id,
        amount: Number(foodPassTopup), paymentMode: foodPassPayMode,
      })
      setFoodPassTopup('')
      loadFoodPass()
    } catch (err) {
      setFoodPassError(err.message)
    } finally {
      setFoodPassLoading(false)
    }
  }

  useEffect(() => {
    if (lockerStatus?.availableNumbers?.length && !lockerNo) {
      setLockerNo(lockerStatus.availableNumbers[0])
    }
  }, [lockerStatus, lockerNo])

  // Keep the selected hours-per-day valid whenever the renewal category changes
  useEffect(() => {
    if (!renewOpen) return
    const pkgs = renewCategory === 'permanent' ? permPackages : tempPackages
    if (pkgs.length && !pkgs.some(p => p.hours === renewHoursPerDay)) {
      setRenewHoursPerDay(pkgs[0].hours)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renewCategory, renewOpen])

  const handleAddLocker = async () => {
    setLockerLoading(true)
    setLockerError('')
    try {
      await api('add_locker', {
        studentId: id, branchId: data.student.branch_id, lockerNo,
        paymentMode: lockerPayMode, payLater: lockerPayType === 'later',
      })
      refresh()
    } catch (err) {
      setLockerError(err.message)
    } finally {
      setLockerLoading(false)
    }
  }

  const handleLockerPayment = async (lockerId) => {
    if (!lockerPayAmount) return
    setLockerLoading(true)
    setLockerError('')
    try {
      await api('record_locker_payment', { lockerId, amount: Number(lockerPayAmount), paymentMode: lockerPayMode })
      setLockerPayAmount('')
      refresh()
    } catch (err) {
      setLockerError(err.message)
    } finally {
      setLockerLoading(false)
    }
  }

  const handleRemoveLocker = async (lockerId) => {
    if (!window.confirm('Remove this locker?')) return
    setLockerLoading(true)
    setLockerError('')
    try {
      await api('remove_locker', { lockerId })
      refresh()
    } catch (err) {
      setLockerError(err.message)
    } finally {
      setLockerLoading(false)
    }
  }

  const handlePayment = async (membershipId) => {
    if (!payAmount) return
    await api('record_payment', { membershipId, amount: Number(payAmount), paymentMode: payMode })
    setPayAmount('')
    refresh()
  }

  const handleApplyDiscount = async (membershipId) => {
    setDiscountLoading(true)
    setDiscountError('')
    setDiscountSuccess('')
    try {
      const res = await api('apply_loyalty_discount', {
        membershipId, discountType, discountValue: Number(discountValue), remarks: discountRemarks,
      })
      setDiscountSuccess(`Discount of ${formatCurrency(res.discountAmount)} applied — new fee due ${formatCurrency(res.newFeeDue)}`)
      setDiscountValue('')
      setDiscountRemarks('')
      refresh()
    } catch (err) {
      setDiscountError(err.message)
    } finally {
      setDiscountLoading(false)
    }
  }

  const handleHold = async (membershipId) => {
    setHoldLoading(true)
    setHoldError('')
    try {
      await api('pause_membership', { membershipId })
      refresh()
    } catch (err) {
      setHoldError(err.message)
    } finally {
      setHoldLoading(false)
    }
  }

  const handleResume = async (membershipId) => {
    setHoldLoading(true)
    setHoldError('')
    try {
      await api('resume_membership', { membershipId })
      refresh()
    } catch (err) {
      setHoldError(err.message)
    } finally {
      setHoldLoading(false)
    }
  }

  const toLocalDateTimeInput = (isoString) => {
    const d = new Date(isoString)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const openEditBooking = (booking) => {
    setEditingBooking(booking)
    setEditStartTime(toLocalDateTimeInput(booking.start_time))
    setEditHours(booking.hours ?? '')
    setEditStatus(booking.status)
    setEditError('')
  }

  const handleUpdateAttendance = async () => {
    setEditLoading(true)
    setEditError('')
    try {
      await api('update_attendance', {
        bookingId: editingBooking.id,
        startTime: new Date(editStartTime).toISOString(),
        hours: editHours,
        status: editStatus,
      })
      setEditingBooking(null)
      refresh()
    } catch (err) {
      setEditError(err.message)
    } finally {
      setEditLoading(false)
    }
  }

  const openRenew = (mem) => {
    setRenewOpen(true)
    setRenewCategory(mem.category)
    setRenewHoursPerDay(mem.hours_per_day)
    setRenewMonths(1)
    setRenewPayMode('cash')
    setRenewPayType('full')
    setRenewAdvance('')
    setRenewError('')
  }

  const handleRenewSubmit = async (membershipId) => {
    setRenewLoading(true)
    setRenewError('')
    try {
      const res = await api('renew_membership', {
        membershipId,
        category: renewCategory,
        hoursPerDay: renewHoursPerDay,
        monthsPaid: renewMonths,
        paymentMode: renewPayMode,
        advanceAmount: renewPayType === 'partial' ? (Number(renewAdvance) || null) : renewPayType === 'pending' ? 0 : null,
      })
      setRenewOpen(false)
      if (res.cashbackApplied) {
        setCashbackNotice(res.cashbackApplied)
      }
      refresh()
    } catch (err) {
      setRenewError(err.message)
    } finally {
      setRenewLoading(false)
    }
  }

  if (loading) return <p>Loading profile…</p>
  if (!data?.student) return <p>Student not found.</p>

  const { student, memberships, bookings, transactions, locker, overtimeSessions, holds, discounts } = data
  const activeMem = memberships?.find(m => m.is_active)
  const isPaused = activeMem?.is_paused || activeMem?.status === 'paused'
  const isExpired = !!activeMem && activeMem.end_date < todayISO()

  const feeDueNum = Number(activeMem?.fee_due ?? 0)
  const discountValueNum = Number(discountValue) || 0
  const previewDiscountAmount = discountValueNum > 0
    ? Math.min(discountType === 'percent' ? feeDueNum * (discountValueNum / 100) : discountValueNum, feeDueNum)
    : 0

  // Renewal pricing — plan (category/hours) is editable at renewal time
  const renewPackages = renewCategory === 'permanent' ? permPackages : tempPackages
  const renewPkg = renewPackages.find(p => p.hours === renewHoursPerDay) ?? renewPackages[0]
  const renewDiscount = getMultiMonthDiscount(renewMonths)
  const renewGross = renewPkg ? renewPkg.fee * renewMonths : 0
  const renewTotal = renewGross * (1 - renewDiscount / 100)
  const renewAdvanceNum = Number(renewAdvance) || 0
  const renewRemaining = renewPayType === 'partial' ? Math.max(renewTotal - renewAdvanceNum, 0) : 0

  return (
    <>
      <div className="page-header">
        <h1>{student.name}</h1>
        <Link to="/students" className="btn btn-ghost">← Students</Link>
      </div>

      <div className="stats-row">
        <div className="card stat-card">
          <div className="value">{student.total_visits}</div>
          <div className="label">Total Visits</div>
        </div>
        <div className="card stat-card">
          <div className="value">{student.total_hours_studied}</div>
          <div className="label">Hours Studied</div>
        </div>
        <div className="card stat-card">
          <div className="value">
            <span className={`badge badge-${student.status} cap`}>{student.status}</span>
          </div>
          <div className="label">Status</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Details</h3>
          {student.photo_url && <img src={student.photo_url} alt="" className="photo-preview" style={{ marginBottom: '1rem', display: 'block' }} />}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Phone', <span className="mono" key="phone">{student.phone}</span>],
                ['Course', student.course || '—'],
                activeMem && ['Membership', (
                  <span key="mem">
                    <span className="cap">{activeMem.category}</span> · {activeMem.hours_per_day}h/day
                    {isPaused && <span style={{ marginLeft: 6, background: '#ff990020', color: '#ffaa44', padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700 }}>ON HOLD</span>}
                  </span>
                )],
                activeMem && ['Cabin', activeMem.cabin_no ?? 'Floating'],
                activeMem && ['Started', formatDate(activeMem.start_date)],
                activeMem && ['Expires', formatDate(activeMem.end_date)],
                activeMem && ['Due Date', formatDate(activeMem.due_date)],
                activeMem?.fee_due > 0 && ['Fee Due', <span key="fee" style={{ color: '#ff6b6b', fontWeight: 700 }}>{formatCurrency(activeMem.fee_due)}</span>],
                locker && ['Locker', `${locker.locker_no} · Due ${formatDate(locker.locker_due_date)}`],
              ].filter(Boolean).map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid #1e1e1e' }}>
                  <td style={{ padding: '0.5rem 0.75rem 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 500, whiteSpace: 'nowrap', width: '40%' }}>
                    {label}
                  </td>
                  <td style={{ padding: '0.5rem 0', fontSize: '0.88rem', fontWeight: 600 }}>
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Hold / Resume / Renew — only students who have an availed membership see this card at all */}
        {activeMem && (
          <div className="card">
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Membership Control</h3>
            {isExpired && (
              <>
                <p style={{ color: '#ff8888', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  ⚠ Membership expired {formatDate(activeMem.end_date)} — renew to continue.
                </p>
                <button
                  type="button"
                  style={{
                    width: '100%', padding: '0.6rem', fontWeight: 700, cursor: 'pointer',
                    background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.4)',
                    color: 'var(--accent)', borderRadius: 4, marginBottom: '0.5rem',
                  }}
                  onClick={() => openRenew(activeMem)}
                >
                  ↺ Renew Membership
                </button>
              </>
            )}
            {isPaused ? (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  Membership is on hold. Days paused will be added back when resumed.
                </p>
                <button
                  type="button" className="btn btn-primary"
                  style={{ width: '100%', marginBottom: '0.5rem' }}
                  onClick={() => handleResume(activeMem.id)}
                  disabled={holdLoading}
                >
                  {holdLoading ? 'Resuming…' : '▶ Resume Membership'}
                </button>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  Put membership on hold — missed days will be redeemable on resume.
                </p>
                <button
                  type="button"
                  style={{
                    width: '100%', padding: '0.6rem', fontWeight: 700, cursor: 'pointer',
                    background: 'rgba(255,150,0,0.08)', border: '1px solid rgba(255,150,0,0.4)',
                    color: '#ffaa44', borderRadius: 4, marginBottom: '0.5rem',
                  }}
                  onClick={() => handleHold(activeMem.id)}
                  disabled={holdLoading}
                >
                  {holdLoading ? 'Holding…' : '⏸ Hold Membership'}
                </button>
              </>
            )}
            {holdError && <p className="error-msg">{holdError}</p>}
          </div>
        )}

        {/* Payment */}
        {activeMem?.fee_due > 0 && (
          <div className="card">
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Record Payment</h3>
            <div className="form-group">
              <label>Amount (₹)</label>
              <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Mode</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {PAYMENT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value} type="button"
                    onClick={() => setPayMode(value)}
                    style={{
                      flex: 1, padding: '0.55rem',
                      border: `1px solid ${payMode === value ? 'var(--accent)' : '#333'}`,
                      borderRadius: 4,
                      background: payMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                      color: payMode === value ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => handlePayment(activeMem.id)}>Record</button>
          </div>
        )}

        {/* Loyalty Discount — owner only, applied against the pending membership fee */}
        {isOwner && activeMem?.fee_due > 0 && (
          <div className="card">
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>🏷️ Discount</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              {student.total_visits} visits · {student.total_hours_studied} hrs studied — reward loyalty with a discount on the pending fee.
            </p>
            <div className="form-group">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button" onClick={() => setDiscountType('percent')}
                  style={{
                    flex: 1, padding: '0.55rem',
                    border: `1px solid ${discountType === 'percent' ? 'var(--accent)' : '#333'}`,
                    borderRadius: 4,
                    background: discountType === 'percent' ? 'var(--accent)' : '#141414',
                    color: discountType === 'percent' ? '#000' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >% Off</button>
                <button
                  type="button" onClick={() => setDiscountType('fixed')}
                  style={{
                    flex: 1, padding: '0.55rem',
                    border: `1px solid ${discountType === 'fixed' ? 'var(--accent)' : '#333'}`,
                    borderRadius: 4,
                    background: discountType === 'fixed' ? 'var(--accent)' : '#141414',
                    color: discountType === 'fixed' ? '#000' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >₹ Fixed</button>
              </div>
            </div>
            <div className="form-group">
              <input
                type="number" min={0} value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percent' ? 'e.g. 10 (%)' : 'e.g. 100 (₹)'}
              />
            </div>
            <div className="form-group">
              <input
                type="text" value={discountRemarks}
                onChange={(e) => setDiscountRemarks(e.target.value)}
                placeholder="Remarks (optional)"
              />
            </div>
            {previewDiscountAmount > 0 && (
              <p className="mono" style={{ color: '#4ade80', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                Discount: {formatCurrency(previewDiscountAmount)} → New Fee Due: {formatCurrency(feeDueNum - previewDiscountAmount)}
              </p>
            )}
            {discountError && <p className="error-msg">{discountError}</p>}
            {discountSuccess && <p style={{ color: '#4ade80', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{discountSuccess}</p>}
            <button
              type="button" className="btn btn-primary" style={{ width: '100%' }}
              onClick={() => handleApplyDiscount(activeMem.id)}
              disabled={discountLoading || !discountValueNum}
            >
              {discountLoading ? 'Applying…' : 'Apply Discount'}
            </button>
          </div>
        )}

        {/* Food Pass */}
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>🎫 Food Pass</h3>
          <p className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: foodPass && Number(foodPass.balance) < 0 ? '#ff8888' : '#4ade80', marginBottom: '0.5rem' }}>
            Balance: {formatCurrency(Number(foodPass?.balance ?? 0))}
          </p>
          {foodPass && Number(foodPass.balance) < 0 && (
            <p style={{ fontSize: '0.78rem', color: '#ffaa44', marginBottom: '0.75rem' }}>
              Balance is negative — please top up to settle.
            </p>
          )}
          <div className="form-group">
            <label>Top Up Amount (₹)</label>
            <input type="number" min={0} value={foodPassTopup} onChange={(e) => setFoodPassTopup(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Mode</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {PAYMENT_OPTIONS.map(({ value, label }) => (
                <button
                  key={value} type="button" onClick={() => setFoodPassPayMode(value)}
                  style={{
                    flex: 1, padding: '0.5rem',
                    border: `1px solid ${foodPassPayMode === value ? 'var(--accent)' : '#333'}`,
                    borderRadius: 4, background: foodPassPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                    color: foodPassPayMode === value ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          {foodPassError && <p className="error-msg">{foodPassError}</p>}
          <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={foodPassLoading || !foodPassTopup} onClick={handleFoodPassTopup}>
            {foodPassLoading ? 'Topping up…' : 'Top Up'}
          </button>
        </div>

        {/* Locker */}
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Locker</h3>
          {locker ? (
            <>
              <p style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>
                Locker <strong>{locker.locker_no}</strong> · Due {formatDate(locker.locker_due_date)}
              </p>
              {Number(locker.fee_due) > 0 ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <p className="mono" style={{ color: '#ff8888', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Pending: {formatCurrency(Number(locker.fee_due))}
                  </p>
                  <div className="form-group">
                    <label>Amount (₹)</label>
                    <input type="number" value={lockerPayAmount} onChange={(e) => setLockerPayAmount(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Mode</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {PAYMENT_OPTIONS.map(({ value, label }) => (
                        <button
                          key={value} type="button" onClick={() => setLockerPayMode(value)}
                          style={{
                            flex: 1, padding: '0.5rem',
                            border: `1px solid ${lockerPayMode === value ? 'var(--accent)' : '#333'}`,
                            borderRadius: 4, background: lockerPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                            color: lockerPayMode === value ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                          }}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => handleLockerPayment(locker.id)} disabled={lockerLoading}>
                    Record Locker Payment
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: '0.82rem', color: '#4ade80', marginBottom: '0.75rem' }}>✓ Paid in full</p>
              )}
              <button
                type="button"
                style={{ width: '100%', padding: '0.6rem', fontWeight: 700, cursor: 'pointer', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.4)', color: '#ff8888', borderRadius: 4 }}
                onClick={() => handleRemoveLocker(locker.id)}
                disabled={lockerLoading}
              >
                {lockerLoading ? 'Removing…' : '✕ Remove Locker'}
              </button>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                No locker assigned. {lockerStatus && (lockerStatus.available > 0
                  ? `${lockerStatus.available} of ${lockerStatus.capacity} available at this branch.`
                  : 'None available at this branch.')}
              </p>
              {lockerStatus?.available > 0 && (
                <>
                  <div className="form-group">
                    <select value={lockerNo} onChange={(e) => setLockerNo(e.target.value)}>
                      {lockerStatus.availableNumbers.map(n => <option key={n} value={n}>Locker {n}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payment</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {[{ value: 'now', label: 'Pay Now' }, { value: 'later', label: 'Pay Later' }].map(({ value, label }) => (
                        <button
                          key={value} type="button" onClick={() => setLockerPayType(value)}
                          style={{
                            flex: 1, padding: '0.5rem',
                            border: `1px solid ${lockerPayType === value ? 'var(--accent)' : '#333'}`,
                            borderRadius: 4, background: lockerPayType === value ? 'rgba(255,215,0,0.08)' : '#141414',
                            color: lockerPayType === value ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                          }}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                  {lockerPayType === 'now' && (
                    <div className="form-group">
                      <label>Mode</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {PAYMENT_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value} type="button" onClick={() => setLockerPayMode(value)}
                            style={{
                              flex: 1, padding: '0.5rem',
                              border: `1px solid ${lockerPayMode === value ? 'var(--accent)' : '#333'}`,
                              borderRadius: 4, background: lockerPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                              color: lockerPayMode === value ? 'var(--accent)' : 'var(--text-muted)',
                              cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                            }}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {lockerPayType === 'later' && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                      The prorated rent + deposit will be added as a pending amount, and must be cleared before the membership can be closed.
                    </p>
                  )}
                  <button
                    type="button" className="btn btn-primary" style={{ width: '100%' }}
                    onClick={handleAddLocker}
                    disabled={lockerLoading}
                  >
                    {lockerLoading ? 'Adding…' : '+ Add Locker (prorated)'}
                  </button>
                </>
              )}
            </>
          )}
          {lockerError && <p className="error-msg">{lockerError}</p>}
        </div>
      </div>

      {(() => {
        const totalHoldDaysFromMemberships = (memberships ?? []).reduce((sum, m) => sum + (m.hold_days ?? 0), 0)
        const hasAnyHoldData = (holds ?? []).length > 0 || totalHoldDaysFromMemberships > 0
        if (!hasAnyHoldData) return null
        return (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Hold History</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              Total days on hold: {totalHoldDaysFromMemberships}
            </p>
            {(holds ?? []).length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr><th>Paused On</th><th>Resumed On</th><th>Days Paused</th></tr>
                </thead>
                <tbody>
                  {holds.map(h => {
                    const stillOnHold = !h.resumed_at
                    const elapsedDays = stillOnHold
                      ? Math.max(1, Math.ceil((Date.now() - new Date(h.paused_at).getTime()) / 86_400_000))
                      : null
                    return (
                      <tr key={h.id}>
                        <td className="mono">{formatDate(h.paused_at)}</td>
                        <td className="mono">
                          {stillOnHold ? (
                            <span style={{ color: '#ffaa44', fontWeight: 700 }}>Still on hold</span>
                          ) : formatDate(h.resumed_at)}
                        </td>
                        <td>
                          {stillOnHold ? (
                            <span style={{ color: '#ffaa44' }}>{elapsedDays} so far</span>
                          ) : (h.days_paused ?? '—')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Detailed pause/resume dates aren't available for holds taken before this history was added — only the total is known.
              </p>
            )}
          </div>
        )
      })()}

      {(discounts ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>🏷️ Discount History</h3>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Value</th><th>Amount</th><th>Applied By</th><th>Remarks</th></tr>
            </thead>
            <tbody>
              {discounts.map(d => (
                <tr key={d.id}>
                  <td className="mono">{formatDate(d.created_at)}</td>
                  <td className="cap">{d.discount_type}</td>
                  <td className="mono">{d.discount_type === 'percent' ? `${d.discount_value}%` : formatCurrency(d.discount_value)}</td>
                  <td className="mono" style={{ color: '#4ade80' }}>{formatCurrency(d.discount_amount)}</td>
                  <td>{d.staff?.display_name || d.staff?.username || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{d.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(bookings ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Attendance History</h3>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Desk</th><th>Check-in</th><th>Hours</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <tr key={b.id}>
                  <td className="mono">{formatDate(b.start_time)}</td>
                  <td className="cap">{b.booking_type}</td>
                  <td>{b.desks?.label ?? '—'}</td>
                  <td className="mono">{new Date(b.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="mono">{b.hours ?? '—'}</td>
                  <td><span className={`badge ${b.status === 'active' ? 'badge-active' : b.status === 'cancelled' ? 'badge-inactive' : 'badge-pending'} cap`}>{b.status}</span></td>
                  <td>
                    <button type="button" className="btn btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => openEditBooking(b)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(overtimeSessions ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Overtime History</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            Total overtime: {(overtimeSessions ?? []).reduce((sum, s) => sum + s.overtime_minutes, 0)} minutes
          </p>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {(overtimeSessions ?? []).map(s => {
                const h = Math.floor(s.overtime_minutes / 60)
                const m = s.overtime_minutes % 60
                return (
                  <tr key={s.id}>
                    <td className="mono">{formatDate(s.session_date)}</td>
                    <td style={{ color: '#ff8888', fontWeight: 600 }}>
                      {h > 0 ? `${h}h ${m}m` : `${m}m`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Payment History</h3>
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Category</th><th>Amount</th><th>Mode</th></tr>
          </thead>
          <tbody>
            {(transactions ?? []).map(t => (
              <tr key={t.id}>
                <td className="mono">{formatDate(t.created_at)}</td>
                <td className="cap">{t.category}</td>
                <td className="mono">{formatCurrency(t.amount)}</td>
                <td>{paymentModeLabel(t.payment_mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {renewOpen && activeMem && (
        <div className="modal-overlay" onClick={() => setRenewOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Renew Membership</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{student.name}</p>

            <div className="form-group">
              <label>Plan</label>
              <select value={renewCategory} onChange={(e) => setRenewCategory(e.target.value)}>
                <option value="temporary">Temporary (floating seat)</option>
                <option value="permanent">Permanent (fixed cabin)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Hours per Day</label>
              <select value={renewHoursPerDay} onChange={(e) => setRenewHoursPerDay(Number(e.target.value))}>
                {renewPackages.map(p => (
                  <option key={p.hours} value={p.hours}>{p.hours} hrs/day — {formatCurrency(p.fee)}/mo</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Months</label>
              <select value={renewMonths} onChange={(e) => setRenewMonths(Number(e.target.value))}>
                {[1, 2, 3, 6].map(m => (
                  <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}{getMultiMonthDiscount(m) ? ` (${getMultiMonthDiscount(m)}% off)` : ''}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Payment Mode</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {PAYMENT_OPTIONS.map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setRenewPayMode(value)}
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${renewPayMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: renewPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: renewPayMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Payment Type</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[{ value: 'full', label: 'Full' }, { value: 'partial', label: 'Partial' }, { value: 'pending', label: 'Pay Later' }].map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setRenewPayType(value)}
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${renewPayType === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: renewPayType === value ? 'rgba(255,215,0,0.08)' : '#141414', color: renewPayType === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {renewPayType === 'partial' && (
              <div className="form-group">
                <label>Advance Amount (₹)</label>
                <input type="number" value={renewAdvance} onChange={(e) => setRenewAdvance(e.target.value)} placeholder="Amount paid now" min={0} max={renewTotal} />
              </div>
            )}

            <div className="card" style={{ marginBottom: '1rem', background: 'rgba(255,215,0,0.05)' }}>
              <p className="mono">Total: {formatCurrency(renewTotal)}</p>
              {renewPayType === 'pending' && (
                <p className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>Remaining to be paid: {formatCurrency(renewTotal)}</p>
              )}
              {renewPayType === 'partial' && renewAdvanceNum > 0 && (
                <>
                  <p className="mono" style={{ color: '#4ade80' }}>Paid now: {formatCurrency(renewAdvanceNum)}</p>
                  <p className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>Remaining to be paid: {formatCurrency(renewRemaining)}</p>
                </>
              )}
            </div>

            {renewError && <p className="error-msg">{renewError}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenewOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary"
                disabled={renewLoading}
                onClick={() => handleRenewSubmit(activeMem.id)}
              >
                {renewLoading ? 'Renewing…' : 'Confirm Renewal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingBooking && (
        <div className="modal-overlay" onClick={() => setEditingBooking(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Edit Attendance</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{student.name} · {editingBooking.booking_type}</p>

            <div className="form-group">
              <label>Check-in Time</label>
              <input type="datetime-local" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
            </div>

            <div className="form-group">
              <label>Hours</label>
              <input type="number" min={0} step={0.5} value={editHours} onChange={(e) => setEditHours(e.target.value)} />
            </div>

            <div className="form-group">
              <label>Status</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {editError && <p className="error-msg">{editError}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditingBooking(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={editLoading} onClick={handleUpdateAttendance}>
                {editLoading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cashbackNotice && (
        <div className="modal-overlay" onClick={() => setCashbackNotice(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>🎁 Cashback Applied</h2>
            <div className="card" style={{ margin: '1rem 0', background: 'rgba(255,215,0,0.05)' }}>
              <p className="mono" style={{ color: 'var(--accent)', fontSize: '1.3rem', fontWeight: 700 }}>
                {formatCurrency(cashbackNotice)}
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                A pending cashback was applied as a discount on this renewal.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setCashbackNotice(null)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
