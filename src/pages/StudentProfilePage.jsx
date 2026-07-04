import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatCurrency } from '../lib/utils'

const PAYMENT_OPTIONS = [
  { value: 'cash', label: '💵 Cash' },
  { value: 'upi', label: '📱 UPI' },
]

export default function StudentProfilePage() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState('cash')
  const [holdLoading, setHoldLoading] = useState(false)
  const [holdError, setHoldError] = useState('')
  const [lockerStatus, setLockerStatus] = useState(null)
  const [lockerNo, setLockerNo] = useState('')
  const [lockerLoading, setLockerLoading] = useState(false)
  const [lockerError, setLockerError] = useState('')

  const refresh = useCallback(() => {
    setLoading(true)
    api('get_student_profile', { studentId: id })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const branchId = data?.student?.branch_id
    if (!branchId) return
    api('get_locker_status', { branchId }).then(setLockerStatus).catch(() => setLockerStatus(null))
  }, [data?.student?.branch_id])

  useEffect(() => {
    if (lockerStatus?.availableNumbers?.length && !lockerNo) {
      setLockerNo(lockerStatus.availableNumbers[0])
    }
  }, [lockerStatus, lockerNo])

  const handleAddLocker = async () => {
    setLockerLoading(true)
    setLockerError('')
    try {
      await api('add_locker', { studentId: id, branchId: data.student.branch_id, lockerNo, paymentMode: 'cash' })
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

  if (loading) return <p>Loading profile…</p>
  if (!data?.student) return <p>Student not found.</p>

  const { student, memberships, bookings, transactions, locker, overtimeSessions, holds } = data
  const activeMem = memberships?.find(m => m.is_active)
  const isPaused = activeMem?.is_paused || activeMem?.status === 'paused'

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
            <span className={`badge badge-${student.status}`}>{student.status}</span>
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
                    {activeMem.category} · {activeMem.hours_per_day}h/day
                    {isPaused && <span style={{ marginLeft: 6, background: '#ff990020', color: '#ffaa44', padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700 }}>ON HOLD</span>}
                  </span>
                )],
                activeMem && ['Cabin', activeMem.cabin_no ?? 'Floating'],
                activeMem && ['Started', activeMem.start_date],
                activeMem && ['Expires', activeMem.end_date],
                activeMem && ['Due Date', activeMem.due_date],
                activeMem?.fee_due > 0 && ['Fee Due', <span key="fee" style={{ color: '#ff6b6b', fontWeight: 700 }}>{formatCurrency(activeMem.fee_due)}</span>],
                locker && ['Locker', `${locker.locker_no} · Due ${locker.locker_due_date}`],
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

        {/* Hold / Resume */}
        {activeMem && (
          <div className="card">
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Membership Control</h3>
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

        {/* Locker */}
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Locker</h3>
          {locker ? (
            <>
              <p style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>
                Locker <strong>{locker.locker_no}</strong> · Due {locker.locker_due_date}
              </p>
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
                  {holds.map(h => (
                    <tr key={h.id}>
                      <td className="mono">{new Date(h.paused_at).toLocaleDateString('en-IN')}</td>
                      <td className="mono">
                        {h.resumed_at ? new Date(h.resumed_at).toLocaleDateString('en-IN') : (
                          <span style={{ color: '#ffaa44', fontWeight: 700 }}>Still on hold</span>
                        )}
                      </td>
                      <td>{h.days_paused ?? '—'}</td>
                    </tr>
                  ))}
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
                    <td className="mono">{s.session_date}</td>
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
                <td className="mono">{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                <td>{t.category}</td>
                <td className="mono">{formatCurrency(t.amount)}</td>
                <td>{t.payment_mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
