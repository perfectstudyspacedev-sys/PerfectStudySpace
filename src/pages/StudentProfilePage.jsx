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

function toLocalDateInput(isoString) {
  const d = new Date(isoString)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function toLocalTimeInput(isoString) {
  const d = new Date(isoString)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function combineDateTime(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(`${dateStr}T00:00:00`)
  d.setHours(h, m, 0, 0)
  return d
}

// Shared modal for both editing an existing attendance record's in/out time and adding a
// forgotten one from scratch — same fields either way, just a different submit action.
function AttendanceModal({ studentId, branchId, booking, onClose, onDone }) {
  const isEdit = !!booking
  const [date, setDate] = useState(booking ? toLocalDateInput(booking.start_time) : todayISO())
  const [checkIn, setCheckIn] = useState(booking ? toLocalTimeInput(booking.start_time) : '09:00')
  const [checkOut, setCheckOut] = useState(booking && booking.status !== 'active' ? toLocalTimeInput(booking.end_time) : '')
  const [scheduledHours, setScheduledHours] = useState(booking ? String(booking.scheduled_hours ?? booking.hours ?? '') : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!checkOut) return setError('Check-out time is required')
    setLoading(true)
    setError('')
    try {
      const startTime = combineDateTime(date, checkIn).toISOString()
      const endTime = combineDateTime(date, checkOut).toISOString()
      if (isEdit) {
        const res = await api('update_attendance', {
          bookingId: booking.id, startTime, endTime,
          scheduledHours: scheduledHours !== '' ? Number(scheduledHours) : undefined,
        })
        if (res?.overtimeAlreadyBilled) {
          window.alert('Attendance updated. Note: overtime for this session was already billed/collected, so its amount was not adjusted — check the Overtime History table if it needs a manual correction.')
        }
      } else {
        await api('add_attendance', { studentId, branchId, startTime, endTime })
      }
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
        <h2>{isEdit ? 'Edit Attendance' : 'Add Attendance'}</h2>
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
        </div>
        <div className="form-group">
          <label>Check-in Time</label>
          <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Check-out Time</label>
          <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </div>
        {isEdit && (
          <div className="form-group">
            <label>Scheduled Hours (their true original allotment)</label>
            <input
              type="number" min={0} step={0.5} value={scheduledHours}
              onChange={(e) => setScheduledHours(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Used as the baseline for overtime — only change this if it looks wrong (e.g. from a record edited before this fix existed), not just because you're correcting the check-in/out time.
            </p>
          </div>
        )}
        {error && <p className="error-msg">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={handleSave}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Mid-cycle plan change (temp <-> permanent, or hours/day) on the current active
// membership — prorates the difference over the days remaining, doesn't touch expiry.
function ChangePlanModal({ membership, tempPackages, permPackages, isOwner, onClose, onDone }) {
  const [category, setCategory] = useState(membership.category)
  const [hoursPerDay, setHoursPerDay] = useState(membership.hours_per_day)
  const [endDate, setEndDate] = useState(membership.end_date)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const packages = category === 'permanent' ? permPackages : tempPackages
  const pkg = packages.find(p => p.hours === hoursPerDay) ?? packages[0]
  const remainingDays = Math.max(1, Math.ceil((new Date(membership.end_date + 'T12:00:00') - new Date()) / 86_400_000))
  const oldDailyRate = Number(membership.monthly_fee) / 30
  const newDailyRate = pkg ? pkg.fee / 30 : 0
  const proratedPreview = Math.round((newDailyRate - oldDailyRate) * remainingDays)
  const noChange = category === membership.category && hoursPerDay === membership.hours_per_day && endDate === membership.end_date

  const handleSubmit = async () => {
    if (!pkg) return setError('Select a valid plan')
    setLoading(true)
    setError('')
    try {
      await api('change_membership_plan', {
        membershipId: membership.id, newCategory: category, newHoursPerDay: pkg.hours,
        newEndDate: isOwner && endDate !== membership.end_date ? endDate : undefined,
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
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2>Change Plan</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Currently: <span className="cap">{membership.category}</span> · {membership.hours_per_day}h/day. Change takes effect immediately;
          the {remainingDays} day{remainingDays === 1 ? '' : 's'} left on this membership are prorated at the new rate.
        </p>
        <div className="form-group">
          <label>Category</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['temporary', 'permanent'].map(c => (
              <button
                key={c} type="button"
                onClick={() => { setCategory(c); const opts = c === 'permanent' ? permPackages : tempPackages; if (opts.length) setHoursPerDay(opts[0].hours) }}
                style={{
                  flex: 1, padding: '0.55rem', textTransform: 'capitalize',
                  border: `1px solid ${category === c ? 'var(--accent)' : '#333'}`, borderRadius: 999,
                  background: category === c ? 'rgba(255,215,0,0.08)' : '#141414',
                  color: category === c ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600,
                }}
              >{c}</button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label>Hours / Day</label>
          <select value={hoursPerDay} onChange={(e) => setHoursPerDay(Number(e.target.value))}>
            {packages.map(p => <option key={p.hours} value={p.hours}>{p.hours}h/day — {formatCurrency(p.fee)}/mo</option>)}
          </select>
        </div>
        {isOwner && (
          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}
        {(category !== membership.category || hoursPerDay !== membership.hours_per_day) && (
          <p className="mono" style={{ marginBottom: '1rem', color: proratedPreview >= 0 ? '#ff8888' : '#4ade80' }}>
            {proratedPreview >= 0
              ? `Additional ₹${proratedPreview} will be added to fee due`
              : `₹${Math.abs(proratedPreview)} credit will be applied`}
          </p>
        )}
        {error && <p className="error-msg">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading || noChange} onClick={handleSubmit}>
            {loading ? 'Saving…' : 'Confirm Change'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChangeCabinModal({ membership, branchId, onClose, onDone }) {
  const [desks, setDesks] = useState(null)
  const [selectedDesk, setSelectedDesk] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('get_seat_map', { branchId }).then(d => setDesks((d.desks ?? []).filter(x => x.status === 'free'))).catch(() => setDesks([]))
  }, [branchId])

  const handleSubmit = async () => {
    if (!selectedDesk) return setError('Select a cabin')
    setLoading(true)
    setError('')
    try {
      await api('change_membership_cabin', { membershipId: membership.id, deskId: selectedDesk })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <h2>Change Cabin</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Current cabin: {membership.cabin_no ?? '—'}
        </p>
        <div className="form-group">
          <label>New Cabin</label>
          {desks === null ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : desks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No free cabins available.</p>
          ) : (
            <select value={selectedDesk} onChange={(e) => setSelectedDesk(e.target.value)}>
              <option value="">Select a cabin</option>
              {desks.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          )}
        </div>
        {error && <p className="error-msg">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading || !selectedDesk} onClick={handleSubmit}>
            {loading ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Shown when resuming a permanent membership whose cabin was released while on hold — a
// new cabin (possibly a different one, if the old one was taken in the meantime) must be
// picked before the membership can go active again, so two students never end up assigned
// to the same seat.
function ResumeCabinModal({ branchId, loading, error, onClose, onSubmit }) {
  const [desks, setDesks] = useState(null)
  const [selectedDesk, setSelectedDesk] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    api('get_seat_map', { branchId }).then(d => setDesks((d.desks ?? []).filter(x => x.status === 'free'))).catch(() => setDesks([]))
  }, [branchId])

  const handleSubmit = () => {
    if (!selectedDesk) return setLocalError('Select a cabin')
    setLocalError('')
    onSubmit(selectedDesk)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <h2>Select Cabin & Resume</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Their cabin was released for other students while on hold. Pick a cabin to resume this membership.
        </p>
        <div className="form-group">
          <label>Cabin</label>
          {desks === null ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : desks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No free cabins available right now.</p>
          ) : (
            <select value={selectedDesk} onChange={(e) => setSelectedDesk(e.target.value)}>
              <option value="">Select a cabin</option>
              {desks.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          )}
        </div>
        {(localError || error) && <p className="error-msg">{localError || error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={loading || !selectedDesk} onClick={handleSubmit}>
            {loading ? 'Resuming…' : 'Confirm & Resume'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StudentProfilePage() {
  const { id } = useParams()
  const { isOwner, branches } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openPanel, setOpenPanel] = useState(null) // which shrunk-to-a-button card is currently shown as a modal
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
  const [redeemCashbackLoading, setRedeemCashbackLoading] = useState(false)
  const [redeemCashbackError, setRedeemCashbackError] = useState('')
  const [redeemCashbackNotice, setRedeemCashbackNotice] = useState(null)
  const [foodPass, setFoodPass] = useState(null)
  const [foodPassTopup, setFoodPassTopup] = useState('')
  const [foodPassPayMode, setFoodPassPayMode] = useState('cash')
  const [foodPassLoading, setFoodPassLoading] = useState(false)
  const [foodPassError, setFoodPassError] = useState('')
  const [attendanceModal, setAttendanceModal] = useState(null) // { booking } to edit, or {} to add
  const [overtimeToggleLoading, setOvertimeToggleLoading] = useState(null)
  const [planChangeOpen, setPlanChangeOpen] = useState(false)
  const [cabinChangeOpen, setCabinChangeOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferBranchId, setTransferBranchId] = useState('')
  const [transferDeskId, setTransferDeskId] = useState('')
  const [transferDesks, setTransferDesks] = useState(null)
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferError, setTransferError] = useState('')
  const [resumeCabinOpen, setResumeCabinOpen] = useState(false)
  const [deleteMembershipOpen, setDeleteMembershipOpen] = useState(false)
  const [deleteMembershipLoading, setDeleteMembershipLoading] = useState(false)
  const [deleteMembershipError, setDeleteMembershipError] = useState('')
  const [deleteMembershipNotice, setDeleteMembershipNotice] = useState(null)
  const [deleteSummary, setDeleteSummary] = useState(null)
  const [deletePayMode, setDeletePayMode] = useState('cash')

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

  // A permanent membership needs a specific free cabin picked at the destination branch
  // before a transfer is allowed, so re-fetch its seat map whenever the chosen branch changes.
  useEffect(() => {
    setTransferDeskId('')
    if (!transferOpen || !transferBranchId) { setTransferDesks(null); return }
    const isPermanent = (data?.memberships ?? []).find(m => m.is_active)?.category === 'permanent'
    if (!isPermanent) { setTransferDesks(null); return }
    setTransferDesks(null)
    api('get_seat_map', { branchId: transferBranchId })
      .then(d => setTransferDesks((d.desks ?? []).filter(x => x.status === 'free')))
      .catch(() => setTransferDesks([]))
  }, [transferOpen, transferBranchId, data?.memberships])

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
      let msg = res.discountAmount > 0
        ? `Discount of ${formatCurrency(res.discountAmount)} applied — new fee due ${formatCurrency(res.newFeeDue)}`
        : ''
      if (res.bankedAsCashback > 0) {
        msg += `${msg ? ' — ' : ''}🎁 ${formatCurrency(res.bankedAsCashback)} banked as cashback`
      }
      if (res.cashbackBankedNote) msg += ` (${res.cashbackBankedNote})`
      setDiscountSuccess(msg)
      setDiscountValue('')
      setDiscountRemarks('')
      refresh()
    } catch (err) {
      setDiscountError(err.message)
    } finally {
      setDiscountLoading(false)
    }
  }

  const handleRedeemCashbackNow = async () => {
    setRedeemCashbackLoading(true)
    setRedeemCashbackError('')
    try {
      const res = await api('redeem_cashback_now', { studentId: student.id })
      setOpenPanel(null)
      setRedeemCashbackNotice(res.cashbackAmount)
      refresh()
    } catch (err) {
      setRedeemCashbackError(err.message)
    } finally {
      setRedeemCashbackLoading(false)
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

  const handleResume = async (membershipId, deskId) => {
    setHoldLoading(true)
    setHoldError('')
    try {
      await api('resume_membership', { membershipId, deskId })
      setResumeCabinOpen(false)
      refresh()
    } catch (err) {
      setHoldError(err.message)
    } finally {
      setHoldLoading(false)
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
      if (res.cashbackApplied || res.overtimeCharged) {
        setCashbackNotice({ amount: res.cashbackApplied, overtimeCharged: res.overtimeCharged })
      }
      refresh()
    } catch (err) {
      setRenewError(err.message)
    } finally {
      setRenewLoading(false)
    }
  }

  const openDeleteMembership = async (membershipId) => {
    setDeleteMembershipError('')
    setDeleteSummary(null)
    setDeletePayMode('cash')
    setOpenPanel(null) // don't stack this modal on top of the still-open Membership Control one
    setDeleteMembershipOpen(true)
    try {
      const summary = await api('get_membership_delete_summary', { membershipId })
      setDeleteSummary(summary)
    } catch (err) {
      setDeleteMembershipError(err.message)
    }
  }

  const handleDeleteMembership = async (membershipId) => {
    setDeleteMembershipLoading(true)
    setDeleteMembershipError('')
    try {
      const res = await api('delete_membership', {
        membershipId,
        paymentMode: deleteSummary?.netAmount > 0 ? deletePayMode : undefined,
      })
      setDeleteMembershipOpen(false)
      setOpenPanel(null)
      setDeleteMembershipNotice(res)
      refresh()
    } catch (err) {
      setDeleteMembershipError(err.message)
    } finally {
      setDeleteMembershipLoading(false)
    }
  }

  const handleToggleOvertimeExcluded = async (overtimeSessionId, excluded) => {
    setOvertimeToggleLoading(overtimeSessionId)
    try {
      await api('set_overtime_excluded', { overtimeSessionId, excluded })
      refresh()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setOvertimeToggleLoading(null)
    }
  }

  const handleTransferBranch = async () => {
    if (!transferBranchId) return
    setTransferLoading(true)
    setTransferError('')
    try {
      await api('transfer_student_branch', { studentId: id, newBranchId: transferBranchId, deskId: transferDeskId || undefined })
      setTransferOpen(false)
      refresh()
    } catch (err) {
      setTransferError(err.message)
    } finally {
      setTransferLoading(false)
    }
  }

  if (loading) return <p>Loading profile…</p>
  if (!data?.student) return <p>Student not found.</p>

  const { student, memberships, bookings, transactions, locker, overtimeSessions, holds, discounts, cashbacks, planChanges, edits } = data
  const activeMem = memberships?.find(m => m.is_active)
  const isPaused = activeMem?.is_paused || activeMem?.status === 'paused'
  const isExpired = !!activeMem && activeMem.end_date < todayISO()
  const daysLeft = activeMem
    ? Math.round((new Date(activeMem.end_date + 'T12:00:00').getTime() - new Date(todayISO() + 'T12:00:00').getTime()) / 86_400_000)
    : 0


  const feeDueNum = Number(activeMem?.fee_due ?? 0)
  const discountValueNum = Number(discountValue) || 0
  const discountBase = feeDueNum > 0 ? feeDueNum : Number(activeMem?.monthly_fee ?? 0) * Number(activeMem?.months_paid ?? 1)
  const rawDiscountAmount = discountValueNum > 0
    ? (discountType === 'percent' ? discountBase * (discountValueNum / 100) : discountValueNum)
    : 0
  const previewDiscountAmount = Math.min(rawDiscountAmount, feeDueNum)
  const previewBankedAsCashback = Math.max(rawDiscountAmount - feeDueNum, 0)
  const pendingCashback = (cashbacks ?? []).find(c => c.status === 'pending')

  // Renewal pricing — plan (category/hours) is editable at renewal time
  const renewPackages = renewCategory === 'permanent' ? permPackages : tempPackages
  const renewPkg = renewPackages.find(p => p.hours === renewHoursPerDay) ?? renewPackages[0]
  const renewDiscount = getMultiMonthDiscount(renewMonths)
  const renewGross = renewPkg ? renewPkg.fee * renewMonths : 0
  const renewBeforeCashback = renewGross * (1 - renewDiscount / 100)
  const renewCashbackAmount = pendingCashback
    ? Math.min(
        pendingCashback.cashback_type === 'percent'
          ? renewBeforeCashback * (Number(pendingCashback.cashback_value) / 100)
          : Number(pendingCashback.cashback_value),
        renewBeforeCashback,
      )
    : 0
  const renewTotal = renewBeforeCashback - renewCashbackAmount
  const renewAdvanceNum = Number(renewAdvance) || 0
  const renewRemaining = renewPayType === 'partial' ? Math.max(renewTotal - renewAdvanceNum, 0) : 0

  return (
    <>
      <div className="page-header">
        <h1>{student.name}</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {isOwner && (memberships ?? []).length > 0 && (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => { setTransferBranchId(''); setTransferError(''); setTransferOpen(true) }}
            >
              🔀 Transfer Branch
            </button>
          )}
          <Link to="/students" className="btn btn-ghost">← Students</Link>
        </div>
      </div>

      <div className="profile-summary-grid">
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Details</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Phone', <span className="mono" key="phone">{student.phone}</span>],
                ['Emergency Contact', <span className="mono" key="emergency">{student.emergency_contact || '—'}</span>],
                ['Course', student.course || '—'],
                activeMem && ['Membership', (
                  <span key="mem">
                    <span className="cap">{activeMem.category}</span> · {activeMem.hours_per_day}h/day
                    {isPaused && <span style={{ marginLeft: 6, background: '#ff990020', color: '#ffaa44', padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700 }}>ON HOLD</span>}
                  </span>
                )],
                activeMem && ['Cabin', activeMem.cabin_no ?? (isPaused && activeMem.category === 'permanent' ? 'Released (on hold)' : 'Floating')],
                activeMem && ['Started', formatDate(activeMem.start_date)],
                activeMem && ['Expires', formatDate(activeMem.end_date)],
                activeMem && ['Days Left', (
                  // +1 on the non-expired side counts both today and the (inclusive) end
                  // date as usable days — a membership starting and ending on the same day
                  // is 1 day left, not 0. The "expired Xd ago" side is unaffected — it's
                  // already counting full days elapsed since the last valid day.
                  <span key="daysleft" style={{ color: daysLeft < 0 ? '#ff6b6b' : daysLeft + 1 <= 5 ? '#ffaa44' : undefined, fontWeight: 700 }}>
                    {daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft + 1} day${daysLeft + 1 === 1 ? '' : 's'}`}
                  </span>
                )],
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card stat-card profile-stat-tile">
            <div className="value">{student.total_visits}</div>
            <div className="label">Total Visits</div>
          </div>
          <div className="card stat-card profile-stat-tile">
            <div className="value">{student.total_hours_studied}</div>
            <div className="label">Hours Studied</div>
          </div>
          <div className="card stat-card profile-stat-tile">
            <div className="value">
              <span className={`badge badge-${student.status} cap`}>{student.status}</span>
            </div>
            <div className="label">Status</div>
          </div>
        </div>

        {/* The rest of these were full cards — shrunk to buttons that open the same content in a modal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {activeMem && (
            <button type="button" className="btn btn-ghost btn-glass" style={{ width: '100%', flex: 1, maxHeight: 60 }} onClick={() => setOpenPanel('membership')}>⚙ Membership Control</button>
          )}
          {activeMem?.fee_due > 0 && (
            <button type="button" className="btn btn-ghost btn-glass" style={{ width: '100%', flex: 1, maxHeight: 60 }} onClick={() => setOpenPanel('payment')}>💳 Record Payment</button>
          )}
          {isOwner && activeMem && (
            <button type="button" className="btn btn-ghost btn-glass" style={{ width: '100%', flex: 1, maxHeight: 60 }} onClick={() => setOpenPanel('discount')}>🏷️ Discount</button>
          )}
          {activeMem && pendingCashback && (
            <button type="button" className="btn btn-ghost btn-glass" style={{ width: '100%', flex: 1, maxHeight: 60 }} onClick={() => setOpenPanel('cashback')}>🎁 Cashback</button>
          )}
          {activeMem && (
            <button
              type="button" className="btn btn-ghost btn-glass"
              style={{ width: '100%', flex: 1, maxHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              onClick={() => setOpenPanel('foodpass')}
            >
              <span>🎫 Food Pass</span>
              {foodPass && (
                <span className="mono" style={{ fontSize: '0.78rem', fontWeight: 700, color: Number(foodPass.balance) < 0 ? '#ff8888' : '#4ade80' }}>
                  ({formatCurrency(Number(foodPass.balance))})
                </span>
              )}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-glass" style={{ width: '100%', flex: 1, maxHeight: 60 }} onClick={() => setOpenPanel('locker')}>🔑 Locker</button>
        </div>
      </div>

      {/* Hold / Resume / Renew — only students who have an availed membership see this card at all */}
        {activeMem && openPanel === 'membership' && (
          <div className="modal-overlay" onClick={() => setOpenPanel(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Membership Control</h2>
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
                    color: 'var(--accent)', borderRadius: 999, marginBottom: '0.5rem',
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
                  {activeMem.category === 'permanent' && !activeMem.desk_id && ' Their cabin was released while on hold and given up for other students — pick a cabin to resume.'}
                </p>
                <button
                  type="button" className="btn btn-primary"
                  style={{ width: '100%', marginBottom: '0.5rem' }}
                  onClick={() => activeMem.category === 'permanent' && !activeMem.desk_id ? setResumeCabinOpen(true) : handleResume(activeMem.id)}
                  disabled={holdLoading}
                >
                  {holdLoading ? 'Resuming…' : activeMem.category === 'permanent' && !activeMem.desk_id ? '🪑 Select Cabin & Resume' : '▶ Resume Membership'}
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
                    color: '#ffaa44', borderRadius: 999, marginBottom: '0.5rem',
                  }}
                  onClick={() => handleHold(activeMem.id)}
                  disabled={holdLoading}
                >
                  {holdLoading ? 'Holding…' : '⏸ Hold Membership'}
                </button>
              </>
            )}
            {holdError && <p className="error-msg">{holdError}</p>}
            {!isPaused && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button type="button" className="btn btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setPlanChangeOpen(true)}>
                  ⇄ Change Plan
                </button>
                {activeMem.category === 'permanent' && (
                  <button type="button" className="btn btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setCabinChangeOpen(true)}>
                    🪑 Change Cabin
                  </button>
                )}
              </div>
            )}
            {isOwner && (
              <button
                type="button"
                style={{
                  width: '100%', padding: '0.6rem', fontWeight: 700, cursor: 'pointer', marginTop: '0.5rem',
                  background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.4)',
                  color: '#ff8888', borderRadius: 999,
                }}
                onClick={() => openDeleteMembership(activeMem.id)}
              >
                🗑️ Delete Membership
              </button>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenPanel(null)}>Close</button>
            </div>
          </div>
          </div>
        )}

        {/* Payment */}
        {activeMem?.fee_due > 0 && openPanel === 'payment' && (
          <div className="modal-overlay" onClick={() => setOpenPanel(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Record Payment</h2>
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
                      borderRadius: 999,
                      background: payMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                      color: payMode === value ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenPanel(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => handlePayment(activeMem.id)}>Record</button>
            </div>
          </div>
          </div>
        )}

        {/* Loyalty Discount — owner only. Available on any active membership; if there's no
            pending fee (or the discount exceeds it), the excess is banked as a cashback. */}
        {isOwner && activeMem && openPanel === 'discount' && (
          <div className="modal-overlay" onClick={() => setOpenPanel(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>🏷️ Discount</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              {student.total_visits} visits · {student.total_hours_studied} hrs studied — reward loyalty with a discount.
              {feeDueNum <= 0 && ' This membership has no pending fee, so the discount will be banked as a cashback.'}
            </p>
            <div className="form-group">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button" onClick={() => setDiscountType('percent')}
                  style={{
                    flex: 1, padding: '0.55rem',
                    border: `1px solid ${discountType === 'percent' ? 'var(--accent)' : '#333'}`,
                    borderRadius: 999,
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
                    borderRadius: 999,
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
            {previewBankedAsCashback > 0 && (
              <p className="mono" style={{ color: 'var(--accent)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                🎁 {formatCurrency(previewBankedAsCashback)} will be banked as cashback
              </p>
            )}
            {discountError && <p className="error-msg">{discountError}</p>}
            {discountSuccess && <p style={{ color: '#4ade80', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{discountSuccess}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenPanel(null)}>Close</button>
              <button
                type="button" className="btn btn-primary"
                onClick={() => handleApplyDiscount(activeMem.id)}
                disabled={discountLoading || !discountValueNum}
              >
                {discountLoading ? 'Applying…' : 'Apply Discount'}
              </button>
            </div>
          </div>
          </div>
        )}

        {/* Cashback — read-only display; granted from the Top Students leaderboard */}
        {activeMem && pendingCashback && openPanel === 'cashback' && (
          <div className="modal-overlay" onClick={() => setOpenPanel(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>🎁 Cashback</h2>
            <p className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.3rem' }}>
              {pendingCashback.cashback_type === 'percent' ? `${pendingCashback.cashback_value}% Off` : formatCurrency(pendingCashback.cashback_value)}
            </p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Pending — will be applied as a discount on the next renewal, or paid out in cash if the membership is closed instead.
            </p>
            {pendingCashback.notes && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontStyle: 'italic' }}>{pendingCashback.notes}</p>
            )}
            {redeemCashbackError && <p className="error-msg">{redeemCashbackError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenPanel(null)}>Close</button>
              <button
                type="button" className="btn btn-primary"
                onClick={handleRedeemCashbackNow}
                disabled={redeemCashbackLoading}
              >
                {redeemCashbackLoading ? 'Redeeming…' : '💵 Redeem Now'}
              </button>
            </div>
          </div>
          </div>
        )}

        {/* Food Pass — only for students with a currently active membership (not walk-ins),
            same rule as Cashback so the two features are consistent. */}
        {activeMem && openPanel === 'foodpass' && (
          <div className="modal-overlay" onClick={() => setOpenPanel(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
          <h2 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>🎫 Food Pass</h2>
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
                    borderRadius: 999, background: foodPassPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                    color: foodPassPayMode === value ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          {foodPassError && <p className="error-msg">{foodPassError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setOpenPanel(null)}>Close</button>
            <button type="button" className="btn btn-primary" disabled={foodPassLoading || !foodPassTopup} onClick={handleFoodPassTopup}>
              {foodPassLoading ? 'Topping up…' : 'Top Up'}
            </button>
          </div>
          </div>
          </div>
        )}

        {/* Locker */}
        {openPanel === 'locker' && (
          <div className="modal-overlay" onClick={() => setOpenPanel(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
          <h2 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Locker</h2>
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
                            borderRadius: 999, background: lockerPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
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
                            borderRadius: 999, background: lockerPayType === value ? 'rgba(255,215,0,0.08)' : '#141414',
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
                              borderRadius: 999, background: lockerPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
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
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setOpenPanel(null)}>Close</button>
          </div>
          </div>
          </div>
        )}

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

      {(cashbacks ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>🎁 Cashback History</h3>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Value</th><th>Status</th><th>Redeemed/Settled Amount</th><th>Granted By</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {cashbacks.map(c => (
                <tr key={c.id}>
                  <td className="mono">{formatDate(c.created_at)}</td>
                  <td className="cap">{c.cashback_type}</td>
                  <td className="mono">
                    {c.cashback_type === 'percent'
                      ? `${c.cashback_value}%${c.estimatedAmount != null ? ` (${c.status === 'pending' ? '~' : ''}${formatCurrency(c.estimatedAmount)})` : ''}`
                      : formatCurrency(c.cashback_value)}
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'pending' ? 'badge-pending' : c.status === 'redeemed' ? 'badge-active' : 'badge-trial'} cap`}>
                      {c.status === 'redeemed' ? 'Redeemed at Renewal' : c.status === 'settled' ? 'Paid Out at Closure' : 'Pending'}
                    </span>
                  </td>
                  <td className="mono" style={{ color: '#4ade80' }}>{c.redeemed_amount != null ? formatCurrency(c.redeemed_amount) : '—'}</td>
                  <td>{c.staff?.display_name || c.staff?.username || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{c.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(planChanges ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>⇄ Plan Change History</h3>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>From</th><th>To</th><th>Prorated</th><th>Changed By</th></tr>
            </thead>
            <tbody>
              {planChanges.map(p => (
                <tr key={p.id}>
                  <td className="mono">{formatDate(p.created_at)}</td>
                  <td className="cap" style={{ fontSize: '0.85rem' }}>{p.old_category} · {p.old_hours_per_day}h/day</td>
                  <td className="cap" style={{ fontSize: '0.85rem' }}>{p.new_category} · {p.new_hours_per_day}h/day</td>
                  <td className="mono" style={{ color: Number(p.prorated_amount) >= 0 ? '#ff8888' : '#4ade80' }}>
                    {Number(p.prorated_amount) >= 0 ? formatCurrency(p.prorated_amount) : `−${formatCurrency(Math.abs(p.prorated_amount))}`}
                  </td>
                  <td>{p.staff?.display_name || p.staff?.username || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(edits ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>✏️ Edit History</h3>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Edit</th><th>From</th><th>To</th><th>Changed By</th></tr>
            </thead>
            <tbody>
              {edits.map(e => (
                <tr key={e.id}>
                  <td className="mono">{formatDate(e.created_at)}</td>
                  <td className="cap">{e.edit_type === 'cabin' ? 'Cabin' : 'End Date'}</td>
                  <td className="mono" style={{ fontSize: '0.85rem' }}>
                    {e.edit_type === 'end_date' ? formatDate(e.old_value) : (e.old_value ?? '—')}
                  </td>
                  <td className="mono" style={{ fontSize: '0.85rem' }}>
                    {e.edit_type === 'end_date' ? formatDate(e.new_value) : (e.new_value ?? '—')}
                  </td>
                  <td>{e.staff?.display_name || e.staff?.username || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>Attendance History</h3>
          <button type="button" className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setAttendanceModal({})}>
            + Add Attendance
          </button>
        </div>
        {(bookings ?? []).length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No attendance records yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Desk</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <tr key={b.id}>
                  <td className="mono">{formatDate(b.start_time)}</td>
                  <td className="cap">{b.booking_type}</td>
                  <td>{b.desks?.label ?? '—'}</td>
                  <td className="mono">{new Date(b.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="mono">
                    {b.status === 'active'
                      ? '—'
                      : new Date(b.end_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="mono">{b.hours ?? '—'}</td>
                  <td><span className={`badge ${b.status === 'active' ? 'badge-active' : b.status === 'cancelled' ? 'badge-inactive' : 'badge-pending'} cap`}>{b.status}</span></td>
                  <td>
                    {b.status !== 'active' && (
                      <button
                        type="button" className="btn btn-ghost"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => setAttendanceModal({ booking: b })}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {attendanceModal && (
        <AttendanceModal
          studentId={id}
          branchId={student.branch_id}
          booking={attendanceModal.booking}
          onClose={() => setAttendanceModal(null)}
          onDone={() => { setAttendanceModal(null); refresh() }}
        />
      )}

      {planChangeOpen && activeMem && (
        <ChangePlanModal
          membership={activeMem}
          tempPackages={tempPackages}
          permPackages={permPackages}
          isOwner={isOwner}
          onClose={() => setPlanChangeOpen(false)}
          onDone={() => { setPlanChangeOpen(false); refresh() }}
        />
      )}

      {cabinChangeOpen && activeMem && (
        <ChangeCabinModal
          membership={activeMem}
          branchId={student.branch_id}
          onClose={() => setCabinChangeOpen(false)}
          onDone={() => { setCabinChangeOpen(false); refresh() }}
        />
      )}

      {resumeCabinOpen && activeMem && (
        <ResumeCabinModal
          branchId={student.branch_id}
          loading={holdLoading}
          error={holdError}
          onClose={() => setResumeCabinOpen(false)}
          onSubmit={(deskId) => handleResume(activeMem.id, deskId)}
        />
      )}

      {(overtimeSessions ?? []).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Overtime History</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            Total overtime: {(overtimeSessions ?? []).reduce((sum, s) => sum + s.overtime_minutes, 0)} minutes
            {' '}(includes the 15 min grace period — billing itself still exempts it). Owed so far: {formatCurrency((overtimeSessions ?? []).filter(s => !s.billed_at && !s.excluded).reduce((sum, s) => sum + Number(s.billed_amount ?? 0), 0))}
          </p>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Duration</th><th>Amount</th><th>Status</th><th>Omit</th></tr>
            </thead>
            <tbody>
              {(overtimeSessions ?? []).map(s => {
                const h = Math.floor(s.overtime_minutes / 60)
                const m = s.overtime_minutes % 60
                return (
                  <tr key={s.id} style={s.excluded ? { opacity: 0.5 } : undefined}>
                    <td className="mono">{formatDate(s.session_date)}</td>
                    <td style={{ color: '#ff8888', fontWeight: 600 }}>
                      {h > 0 ? `${h}h ${m}m` : `${m}m`}
                    </td>
                    <td className="mono">{s.billed_amount != null ? formatCurrency(s.billed_amount) : '—'}</td>
                    <td>
                      {s.billed_at ? (
                        <span className="badge badge-active">Billed{s.billed_amount != null ? ` (${formatCurrency(s.billed_amount)})` : ''}</span>
                      ) : s.excluded ? (
                        <span className="badge badge-inactive">Omitted</span>
                      ) : (
                        <span className="badge badge-pending">Pending</span>
                      )}
                    </td>
                    <td>
                      {!s.billed_at && (
                        <input
                          type="checkbox" checked={!!s.excluded}
                          disabled={overtimeToggleLoading === s.id}
                          onChange={(e) => handleToggleOvertimeExcluded(s.id, e.target.checked)}
                          title="Omit this overtime from billing"
                        />
                      )}
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
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${renewPayMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 999, background: renewPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: renewPayMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Payment Type</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[{ value: 'full', label: 'Full' }, { value: 'partial', label: 'Partial' }, { value: 'pending', label: 'Pay Later' }].map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setRenewPayType(value)}
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${renewPayType === value ? 'var(--accent)' : '#333'}`, borderRadius: 999, background: renewPayType === value ? 'rgba(255,215,0,0.08)' : '#141414', color: renewPayType === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
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
              {renewCashbackAmount > 0 && (
                <>
                  <p className="mono" style={{ color: 'var(--text-muted)' }}>Before cashback: {formatCurrency(renewBeforeCashback)}</p>
                  <p className="mono" style={{ color: '#4ade80' }}>🎁 Cashback applied: -{formatCurrency(renewCashbackAmount)}</p>
                </>
              )}
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

      {cashbackNotice && (
        <div className="modal-overlay" onClick={() => setCashbackNotice(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>Renewal Settled</h2>
            {cashbackNotice.amount > 0 && (
              <div className="card" style={{ margin: '1rem 0', background: 'rgba(255,215,0,0.05)' }}>
                <p className="mono" style={{ color: 'var(--accent)', fontSize: '1.2rem', fontWeight: 700 }}>
                  🎁 {formatCurrency(cashbackNotice.amount)}
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  A pending cashback was applied as a discount on this renewal.
                </p>
              </div>
            )}
            {cashbackNotice.overtimeCharged > 0 && (
              <div className="card" style={{ margin: '1rem 0', background: 'rgba(255,60,60,0.06)' }}>
                <p className="mono" style={{ color: '#ff8888', fontSize: '1.2rem', fontWeight: 700 }}>
                  ⏱ {formatCurrency(cashbackNotice.overtimeCharged)}
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  Accumulated overtime was added to this renewal's bill.
                </p>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setCashbackNotice(null)}>Got it</button>
            </div>
          </div>
        </div>
      )}

      {transferOpen && (
        <div className="modal-overlay" onClick={() => setTransferOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>🔀 Transfer Branch</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              Permanently moves {student.name} to another branch.
              {activeMem?.category === 'permanent'
                ? ' Their current cabin will be released here; a cabin at the destination branch must be picked below.'
                : ' An active locker will be released.'}
            </p>
            <div className="form-group">
              <label>Destination Branch</label>
              <select value={transferBranchId} onChange={(e) => setTransferBranchId(e.target.value)}>
                <option value="">Select branch…</option>
                {branches.filter(b => b.id !== student.branch_id).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            {activeMem?.category === 'permanent' && transferBranchId && (
              <div className="form-group">
                <label>Cabin at Destination Branch</label>
                {transferDesks === null ? (
                  <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
                ) : transferDesks.length === 0 ? (
                  <p style={{ color: '#ff8888', fontSize: '0.82rem' }}>No free cabins at this branch — transfer isn't possible until one opens up.</p>
                ) : (
                  <select value={transferDeskId} onChange={(e) => setTransferDeskId(e.target.value)}>
                    <option value="">Select a cabin</option>
                    {transferDesks.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                )}
              </div>
            )}
            {transferError && <p className="error-msg">{transferError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setTransferOpen(false)}>Cancel</button>
              <button
                type="button" className="btn btn-primary"
                onClick={handleTransferBranch}
                disabled={
                  transferLoading || !transferBranchId ||
                  (activeMem?.category === 'permanent' && (!transferDesks?.length || !transferDeskId))
                }
              >
                {transferLoading ? 'Transferring…' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteMembershipOpen && activeMem && (
        <div className="modal-overlay" onClick={() => setDeleteMembershipOpen(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: '#ff8888', marginBottom: '0.5rem' }}>🗑️ Delete Membership — {student.name}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              Ends the membership immediately{activeMem.category === 'permanent' ? ' and releases their cabin' : ''} — runs the same locker/Food Pass/cashback/overtime settlement as Finish Membership, plus a prorated refund for unused days. This can't be undone.
            </p>

            {deleteMembershipError && <p className="error-msg">{deleteMembershipError}</p>}

            {!deleteSummary ? (
              !deleteMembershipError && <p>Checking final settlement…</p>
            ) : (
              <>
                <div className="card" style={{ marginBottom: '0.75rem', background: 'rgba(255,215,0,0.05)' }}>
                  <h3 style={{ color: 'var(--accent)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Owed to the Business</h3>
                  <p className="mono" style={{ fontSize: '0.85rem' }}>Membership: {formatCurrency(deleteSummary.membershipDue)}</p>
                  {deleteSummary.locker && <p className="mono" style={{ fontSize: '0.85rem' }}>Locker rent: {formatCurrency(deleteSummary.lockerDue)}</p>}
                  {deleteSummary.foodPassOwed > 0 && <p className="mono" style={{ fontSize: '0.85rem' }}>Food Pass shortfall: {formatCurrency(deleteSummary.foodPassOwed)}</p>}
                  {deleteSummary.overtimeDue > 0 && <p className="mono" style={{ fontSize: '0.85rem' }}>Overtime ({deleteSummary.overtimeMinutes}m): {formatCurrency(deleteSummary.overtimeDue)}</p>}
                  <p className="mono" style={{ fontWeight: 700, marginTop: '0.3rem' }}>Total: {formatCurrency(deleteSummary.totalOwed)}</p>
                </div>

                <div className="card" style={{ marginBottom: '0.75rem', background: 'rgba(74,222,128,0.05)' }}>
                  <h3 style={{ color: '#4ade80', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Owed Back to the Student</h3>
                  {deleteSummary.lockerDepositRefund > 0 && <p className="mono" style={{ fontSize: '0.85rem' }}>Locker deposit: {formatCurrency(deleteSummary.lockerDepositRefund)}</p>}
                  {deleteSummary.foodPassRefund > 0 && <p className="mono" style={{ fontSize: '0.85rem' }}>Food Pass balance: {formatCurrency(deleteSummary.foodPassRefund)}</p>}
                  {deleteSummary.cashbackAmount > 0 && <p className="mono" style={{ fontSize: '0.85rem' }}>Unredeemed cashback: {formatCurrency(deleteSummary.cashbackAmount)}</p>}
                  <p className="mono" style={{ fontSize: '0.85rem' }}>
                    Unused days ({deleteSummary.remainingDays} of {deleteSummary.totalDays}): {formatCurrency(deleteSummary.proratedRefund)}
                  </p>
                  <p className="mono" style={{ fontWeight: 700, marginTop: '0.3rem' }}>Total: {formatCurrency(deleteSummary.totalCredit)}</p>
                </div>

                <div className="card" style={{ marginBottom: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                  {deleteSummary.netAmount > 0 ? (
                    <p className="mono" style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--accent)' }}>
                      Collect {formatCurrency(deleteSummary.netAmount)} from the student
                    </p>
                  ) : deleteSummary.netAmount < 0 ? (
                    <p className="mono" style={{ fontWeight: 700, fontSize: '1.05rem', color: '#4ade80' }}>
                      Pay back {formatCurrency(-deleteSummary.netAmount)} to the student
                    </p>
                  ) : (
                    <p className="mono" style={{ fontWeight: 700, fontSize: '1.05rem', color: '#4ade80' }}>
                      Fully settled — nothing to collect or refund
                    </p>
                  )}
                </div>

                {deleteSummary.netAmount > 0 && (
                  <div className="form-group">
                    <label>Payment Mode</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {PAYMENT_OPTIONS.map(({ value, label }) => (
                        <button
                          key={value} type="button" onClick={() => setDeletePayMode(value)}
                          style={{
                            flex: 1, padding: '0.5rem',
                            border: `1px solid ${deletePayMode === value ? 'var(--accent)' : '#333'}`,
                            borderRadius: 999, background: deletePayMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                            color: deletePayMode === value ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: 600,
                          }}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleteMembershipOpen(false)}>Cancel</button>
              <button
                type="button"
                style={{
                  padding: '0.55rem 1.1rem', fontWeight: 700, cursor: 'pointer',
                  background: '#ff8888', border: 'none', color: '#1a0000', borderRadius: 999,
                }}
                onClick={() => handleDeleteMembership(activeMem.id)}
                disabled={!deleteSummary || deleteMembershipLoading}
              >
                {deleteMembershipLoading ? 'Deleting…'
                  : deleteSummary?.netAmount > 0 ? `Collect ${formatCurrency(deleteSummary.netAmount)} & Delete`
                  : deleteSummary?.netAmount < 0 ? `Pay Back ${formatCurrency(-deleteSummary.netAmount)} & Delete`
                  : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteMembershipNotice != null && (
        <div className="modal-overlay" onClick={() => setDeleteMembershipNotice(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>🗑️ Membership Deleted</h2>
            <div className="card" style={{ margin: '1rem 0', background: 'rgba(255,255,255,0.03)' }}>
              {deleteMembershipNotice.refundAmount > 0 ? (
                <p className="mono" style={{ color: '#4ade80', fontSize: '1.2rem', fontWeight: 700 }}>
                  Paid back {formatCurrency(deleteMembershipNotice.refundAmount)}
                </p>
              ) : deleteMembershipNotice.collectedAmount > 0 ? (
                <p className="mono" style={{ color: 'var(--accent)', fontSize: '1.2rem', fontWeight: 700 }}>
                  Collected {formatCurrency(deleteMembershipNotice.collectedAmount)}
                </p>
              ) : (
                <p className="mono" style={{ color: '#4ade80', fontSize: '1.2rem', fontWeight: 700 }}>Fully settled</p>
              )}
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Includes {formatCurrency(deleteMembershipNotice.proratedRefund)} refunded for {deleteMembershipNotice.remainingDays} of {deleteMembershipNotice.totalDays} unused day(s)
                {deleteMembershipNotice.lockerDepositRefund > 0 && `, ${formatCurrency(deleteMembershipNotice.lockerDepositRefund)} locker deposit`}
                {deleteMembershipNotice.foodPassRefund > 0 && `, ${formatCurrency(deleteMembershipNotice.foodPassRefund)} Food Pass balance`}
                {deleteMembershipNotice.cashbackAmount > 0 && `, ${formatCurrency(deleteMembershipNotice.cashbackAmount)} cashback`}.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDeleteMembershipNotice(null)}>Got it</button>
            </div>
          </div>
        </div>
      )}

      {redeemCashbackNotice != null && (
        <div className="modal-overlay" onClick={() => setRedeemCashbackNotice(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <h2>🎁 Cashback Redeemed</h2>
            <div className="card" style={{ margin: '1rem 0', background: 'rgba(74,222,128,0.06)' }}>
              <p className="mono" style={{ color: '#4ade80', fontSize: '1.2rem', fontWeight: 700 }}>
                {formatCurrency(redeemCashbackNotice)}
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                Handed to the student as cash.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setRedeemCashbackNotice(null)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
