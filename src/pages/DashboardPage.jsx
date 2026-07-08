import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { nowTimeStr, localTimeStrToISO, formatCurrency, formatDate, formatDateTime } from '../lib/utils'

function autoShift() {
  const h = new Date().getHours()
  if (h >= 6 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

const WALKIN_HOUR_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 12]
function walkinFee(hours) {
  if (hours <= 3) return 35
  if (hours <= 6) return 60
  if (hours <= 8) return 80
  return 100
}

// Walk-in modal — name/phone autocomplete + hourly booking, no page navigation
function WalkInModal({ branchId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState(3)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [startTime, setStartTime] = useState(nowTimeStr)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [nameMatches, setNameMatches] = useState([])

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
    setLoading(true)
    setError('')
    try {
      const result = await api('create_walkin', {
        branchId, name, phone, hours, paymentMode,
        startTime: localTimeStrToISO(startTime),
      })
      setReceipt(result.booking)
    } catch (err) {
      setError(err.message)
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
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Payment: {paymentMode.toUpperCase()}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onDone}>Close</button>
              <button
                type="button" className="btn btn-primary"
                onClick={() => { setReceipt(null); setName(''); setPhone(''); setSelectedStudent(null) }}
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
                  {WALKIN_HOUR_OPTIONS.map(h => (
                    <option key={h} value={h}>{h} hrs — {formatCurrency(walkinFee(h))}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Payment Mode</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
                    <button
                      key={value} type="button"
                      onClick={() => setPaymentMode(value)}
                      style={{
                        flex: 1, padding: '0.6rem',
                        border: `1px solid ${paymentMode === value ? 'var(--accent)' : '#333'}`,
                        borderRadius: 4,
                        background: paymentMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                        color: paymentMode === value ? 'var(--accent)' : 'var(--text-muted)',
                        cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                      }}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <p className="mono" style={{ marginBottom: '1rem', color: 'var(--accent)' }}>
                Bill: {formatCurrency(walkinFee(hours))}
              </p>
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

// Attendance modal — name/phone lookup + instant check-in, no desk selection
function CheckInModal({ branchId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [nameMatches, setNameMatches] = useState([])
  const [startTime, setStartTime] = useState(nowTimeStr)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    const lookupPhone = selectedStudent?.phone || phone
    if (!/^\d{10}$/.test(lookupPhone || '')) return setError('Select a student or enter a valid 10-digit phone number')
    setError('')
    setLoading(true)
    try {
      // Always resolve the authoritative record by phone — the name-search dropdown only
      // returns {id, name, phone}, not membership status, so it can't be trusted directly.
      const res = await api('lookup_student', { phone: lookupPhone })
      const student = res.student
      if (!student) return setError('No student found')
      if (!student.is_member) return setError('This student does not have an active membership')

      const result = await api('check_in_member', {
        branchId,
        studentId: student.id,
        deskId: null, // desk auto-resolved by API for permanent; null for temporary
        startTime: localTimeStrToISO(startTime),
      })
      if (result.expiredMembership) {
        window.alert(`${student.name}'s membership has expired. They've been checked in for today — please prompt them to renew.`)
      }
      if (result.crossBranchVisit) {
        window.alert(`${student.name} is registered at a different branch — their home branch has been notified of today's visit.`)
      }
      onDone()
    } catch (err) {
      if (err.message.includes('grace period is over')) {
        window.alert(err.message)
      } else {
        setError(err.message)
      }
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <h2>Attendance</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ position: 'relative' }}>
            <label>Member Name or Phone</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Start typing the student's name or phone"
              autoComplete="off"
              autoFocus
            />
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
            <label>Phone</label>
            <input
              value={phone}
              onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setSelectedStudent(null) }}
              placeholder="Auto-filled once a name is selected"
            />
          </div>
          <div className="form-group">
            <label>Start Time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Marking…' : 'Mark Attendance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { branchId, activeBranch } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [seatMap, setSeatMap] = useState(null)
  const [selectedDesk, setSelectedDesk] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [myTasks, setMyTasks] = useState([])

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const [dash, seats] = await Promise.all([
        api('get_dashboard', { branchId }),
        api('get_seat_map', { branchId, shift: autoShift() }),
      ])
      setData(dash)
      setSeatMap(seats)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [branchId])

  const loadMyTasks = useCallback(async () => {
    try {
      const data = await api('get_my_tasks_today')
      setMyTasks(data.tasks ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadMyTasks() }, [loadMyTasks])

  const toggleMyTask = async (task) => {
    try {
      await api('update_task_status', { taskId: task.id, done: !task.completedToday })
      loadMyTasks()
    } catch { /* ignore */ }
  }

  if (!branchId) return <p>Select a branch to continue.</p>
  if (loading && !data) return <p>Loading dashboard…</p>

  return (
    <>
      <div className="page-header">
        <h1>{activeBranch?.name ?? 'Dashboard'}</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowCheckIn(true)}>
          ✓ Attendance
        </button>
      </div>

      {data && (
        <div className="stats-row">
          <div className="card stat-card">
            <div className="value count-up">{data.students?.currentlyStudying ?? 0}</div>
            <div className="label">Currently Studying</div>
          </div>
          <div className="card stat-card">
            <div className="value count-up">{data.students?.checkedInToday ?? 0}</div>
            <div className="label">Attendance Today</div>
          </div>
          <div className="card stat-card">
            <div className="value count-up">{data.students?.active ?? 0}</div>
            <div className="label">Active Memberships</div>
          </div>
          <div className="card stat-card">
            <div className="value count-up" style={{ fontSize: '1.1rem' }}>
              {data.students?.temporary ?? 0}T · {data.students?.permanent ?? 0}P
            </div>
            <div className="label">Temp · Permanent</div>
          </div>
          <div className="card stat-card">
            <div className="value count-up">{data.students?.pending ?? 0}</div>
            <div className="label">Payment Pending</div>
          </div>
        </div>
      )}

      <div className="action-boxes">
        <div className="action-box card" onClick={() => setShowWalkIn(true)} role="button" tabIndex={0}>
          <h2>Walk-in</h2>
          <p>Hourly desk booking for visiting students</p>
        </div>
        <div className="action-box card" onClick={() => navigate('/membership')} role="button" tabIndex={0}>
          <h2>Membership</h2>
          <p>Temporary or permanent monthly membership</p>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>Seat Map</h2>
          {seatMap?.summary && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>{seatMap.summary.free}</strong> Free ·{' '}
              <strong style={{ color: '#a0a0a0' }}>{seatMap.summary.permanent}</strong> Permanent
            </span>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <span style={{ color: 'var(--accent)' }}>■</span> Free &nbsp;
          <span style={{ color: '#666' }}>■</span> Permanent (reserved)
        </p>
        {seatMap && (
          <div className="seat-map">
            {seatMap.desks.map(desk => {
              const isReserved = desk.status === 'reserved'
              return (
                <div
                  key={desk.id}
                  className={`seat-cell ${desk.status}`}
                  onClick={isReserved ? () => setSelectedDesk(desk) : undefined}
                  style={!isReserved ? { cursor: 'default' } : undefined}
                >
                  {desk.label}
                  {isReserved && desk.students?.name && (
                    <span className="seat-tooltip">{desk.students.name}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedDesk && (
        <div className="modal-overlay" onClick={() => setSelectedDesk(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Desk {selectedDesk.label}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Reserved · Permanent Member
            </p>
            {selectedDesk.students?.name ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <p style={{ fontWeight: 700, fontSize: '1.05rem' }}>{selectedDesk.students.name}</p>
                {selectedDesk.students.phone && (
                  <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{selectedDesk.students.phone}</p>
                )}
                {selectedDesk.students.course && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{selectedDesk.students.course}</p>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>No permanent member assigned yet</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSelectedDesk(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Today&apos;s Action Items</h3>
          {(data?.actionable?.expiredToday?.length ?? 0) === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No urgent items today.</p>
          ) : (
            <div className="activity-feed">
              {data?.actionable?.expiredToday?.map(m => (
                <div key={m.id} className="activity-item" style={{ borderColor: '#ff6b6b' }}>
                  <strong>{m.students?.name}</strong>
                  <span className="mono" style={{ color: 'var(--text-muted)' }}> · expired {formatDate(m.end_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Recent Activity</h3>
          <div className="activity-feed">
            {(data?.recentActivity ?? []).map(a => (
              <div key={a.id} className="activity-item">
                <strong>{a.studentName}</strong> — {a.type}
                <div className="time">{formatDateTime(a.time)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>My Tasks Today</h3>
          {myTasks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No tasks assigned to you today.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {myTasks.map(t => (
                <div key={t.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.5rem 0.6rem', background: '#141414', border: '1px solid #333', borderRadius: 4,
                }}>
                  <div>
                    <strong style={{ fontSize: '0.85rem', textDecoration: t.completedToday ? 'line-through' : 'none', color: t.completedToday ? 'var(--text-muted)' : undefined }}>
                      {t.title}
                    </strong>
                    {t.repeat_interval !== 'none' && (
                      <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>({t.repeat_interval})</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={t.completedToday ? 'btn btn-ghost' : 'btn btn-primary'}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    onClick={() => toggleMyTask(t)}
                  >
                    {t.completedToday ? 'Undo' : 'Complete'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCheckIn && (
        <CheckInModal
          branchId={branchId}
          onClose={() => setShowCheckIn(false)}
          onDone={() => { setShowCheckIn(false); load() }}
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
