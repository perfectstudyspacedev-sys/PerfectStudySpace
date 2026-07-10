import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { nowTimeStr, localTimeStrToISO, formatCurrency, formatDate } from '../lib/utils'
import WalkInModal from '../components/WalkInModal'

function autoShift() {
  const h = new Date().getHours()
  if (h >= 6 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
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
  const [successNotices, setSuccessNotices] = useState(null)

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
      const notices = []
      if (result.expiredMembership) {
        notices.push(`${student.name}'s membership has expired. They've been checked in for today — please prompt them to renew.`)
      }
      if (result.crossBranchVisit) {
        notices.push(`${student.name} is registered at a different branch — their home branch has been notified of today's visit.`)
      }
      if (result.isSplitSession) {
        notices.push(`This is a split session — ${result.sessionHours}h remaining of today's daily quota has been allotted for this check-in.`)
      }
      if (notices.length) {
        setSuccessNotices(notices)
        setLoading(false)
      } else {
        onDone()
      }
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  if (successNotices) {
    return (
      <div className="modal-overlay" onClick={onDone}>
        <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
          <h2>Attendance Marked</h2>
          {successNotices.map((msg, i) => (
            <div key={i} style={{
              background: 'rgba(255,150,0,0.08)', border: '1px solid rgba(255,150,0,0.4)',
              borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.75rem',
            }}>
              <p style={{ color: '#ffaa44', fontSize: '0.88rem', fontWeight: 600 }}>⚠ {msg}</p>
            </div>
          ))}
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onDone}>Continue</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <h2>Attendance</h2>
        {error && (
          <div style={{
            background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.4)',
            borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1rem',
          }}>
            <p style={{ color: '#ff6b6b', fontSize: '0.88rem', fontWeight: 600 }}>⚠ {error}</p>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ position: 'relative' }}>
            <label>Member Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Start typing the student's name"
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
              placeholder="10-digit mobile"
            />
          </div>
          <div className="form-group">
            <label>Start Time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
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
  const [enquiryFollowupCount, setEnquiryFollowupCount] = useState(0)

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

  // Not a real task — a live count of open enquiry follow-ups due today or overdue.
  // Shows as an extra row in "My Tasks Today" (no Complete button, since it's just a
  // pointer to the Enquiries tab) and disappears on its own once every follow-up due
  // today has been marked done there.
  const loadEnquiryFollowups = useCallback(async () => {
    if (!branchId) return
    try {
      const { followups } = await api('list_open_enquiry_followups', { branchId })
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
      const dueOrOverdue = (followups ?? []).filter(f => new Date(f.due_at) <= todayEnd)
      setEnquiryFollowupCount(dueOrOverdue.length)
    } catch { /* ignore */ }
  }, [branchId])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadMyTasks() }, [loadMyTasks])
  useEffect(() => { loadEnquiryFollowups() }, [loadEnquiryFollowups])

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
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>My Tasks Today</h3>
          {myTasks.length === 0 && enquiryFollowupCount === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No tasks assigned to you today.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {enquiryFollowupCount > 0 && (
                <div
                  onClick={() => navigate('/enquiries')}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                    padding: '0.5rem 0.6rem', background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: 4,
                  }}
                >
                  <strong style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>Enquiry follow ups</strong>
                  <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 700 }}>{enquiryFollowupCount}</span>
                </div>
              )}
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
