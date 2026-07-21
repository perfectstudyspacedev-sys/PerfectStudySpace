import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatCurrency, formatDate, todayISO } from '../lib/utils'

const STUDENT_COLUMNS = [
  { key: 'sNo', label: 'S.No' },
  { key: 'name', label: 'Name' },
  { key: 'cabin', label: 'Cabin' },
  { key: 'dueDate', label: 'Due Date', isDate: true },
  { key: 'month', label: 'Month' },
  { key: 'hours', label: 'Hours' },
  { key: 'locker', label: 'Locker' },
  { key: 'lockerDue', label: 'Locker Due', isDate: true },
  { key: 'course', label: 'Course' },
  { key: 'contact', label: 'Contact' },
]

function groupByBranch(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = row.branches?.name ?? 'Unknown Branch'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export default function CombinedHallPage() {
  const [tab, setTab] = useState('overview')
  const [hall, setHall] = useState(null)
  const [seatMap, setSeatMap] = useState(null)
  const [pending, setPending] = useState(null)
  const [pendingDate, setPendingDate] = useState(todayISO())
  const [students, setStudents] = useState(null)
  const [studentSearch, setStudentSearch] = useState('')
  const [memberships, setMemberships] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api('get_combined_hall')
      setHall(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSeatMap = useCallback(async () => {
    setError('')
    try {
      const data = await api('get_combined_seatmap')
      setSeatMap(data)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadPending = useCallback(async () => {
    setError('')
    try {
      const data = await api('get_combined_pending', { date: pendingDate })
      setPending(data)
    } catch (err) {
      setError(err.message)
    }
  }, [pendingDate])

  const loadStudents = useCallback(async () => {
    setError('')
    try {
      const data = await api('list_students', { allBranches: true })
      setStudents(data.students)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadMemberships = useCallback(async () => {
    setError('')
    try {
      const data = await api('list_active_memberships', { allBranches: true })
      setMemberships(data.members)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadSessions = useCallback(async () => {
    setError('')
    try {
      const data = await api('list_today_bookings', { allBranches: true })
      setSessions(data.bookings)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { loadOverview() }, [loadOverview])
  useEffect(() => { if (tab === 'seatmap') loadSeatMap() }, [tab, loadSeatMap])
  useEffect(() => { if (tab === 'pending') loadPending() }, [tab, loadPending])
  useEffect(() => { if (tab === 'students') loadStudents() }, [tab, loadStudents])
  useEffect(() => { if (tab === 'membership') loadMemberships() }, [tab, loadMemberships])
  useEffect(() => { if (tab === 'sessions') loadSessions() }, [tab, loadSessions])

  return (
    <>
      <div className="page-header"><h1>Combined Hall</h1></div>
      <div className="tabs">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'seatmap' ? 'active' : ''} onClick={() => setTab('seatmap')}>Seat Map</button>
        <button type="button" className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending Tracking</button>
        <button type="button" className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>Students</button>
        <button type="button" className={tab === 'membership' ? 'active' : ''} onClick={() => setTab('membership')}>Membership</button>
        <button type="button" className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>Active Session</button>
      </div>

      {error && <p className="error-msg" style={{ marginBottom: '1rem' }}>{error}</p>}

      {tab === 'overview' && (
        loading ? <p>Loading…</p> : hall && (
          <>
            <div className="stats-row">
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.currentlyStudying}</div>
                <div className="label">Currently Studying (All Branches)</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.activeMemberships}</div>
                <div className="label">Active Memberships</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.permanentDesks}</div>
                <div className="label">Permanent Desks Occupied</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.freeDesks}</div>
                <div className="label">Free Desks</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.pending}</div>
                <div className="label">Payment Pending</div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>By Branch</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Branch</th><th>Studying</th><th>Active Members</th><th>Temp</th><th>Perm</th>
                    <th>Free Desks</th><th>Permanent Desks</th><th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {hall.branches.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td className="mono">{b.currentlyStudying}</td>
                      <td className="mono">{b.activeMemberships}</td>
                      <td className="mono">{b.temporary}</td>
                      <td className="mono">{b.permanent}</td>
                      <td className="mono">{b.freeDesks}</td>
                      <td className="mono">{b.permanentDesks}</td>
                      <td className="mono" style={{ color: b.pending > 0 ? '#ff8c42' : undefined }}>{b.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {tab === 'seatmap' && (
        !seatMap ? <p>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {seatMap.branches.map(b => (
              <div key={b.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ color: 'var(--accent)' }}>{b.name}</h3>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--accent)' }}>{b.summary.free}</strong> Free ·{' '}
                    <strong style={{ color: '#a0a0a0' }}>{b.summary.permanent}</strong> Permanent ·{' '}
                    {b.summary.total} Total
                  </span>
                </div>
                <div className="seat-map" style={{ marginTop: '0.75rem' }}>
                  {b.desks.map(desk => (
                    <div key={desk.id} className={`seat-cell ${desk.status}`} style={{ cursor: 'default' }}>
                      {desk.label}
                      {desk.status === 'reserved' && desk.students?.name && (
                        <span className="seat-tooltip">{desk.students.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'pending' && (
        <>
          <div className="form-group" style={{ maxWidth: 200, marginBottom: '1rem' }}>
            <label>Date</label>
            <input type="date" value={pendingDate} onChange={(e) => setPendingDate(e.target.value)} />
          </div>
          {!pending ? <p>Loading…</p> : (
            <>
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>
                  Payments Pending (All Outstanding) — {pending.duePayments.length} student{pending.duePayments.length === 1 ? '' : 's'}
                </h3>
                {pending.duePayments.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No pending payments.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {groupByBranch(pending.duePayments).map(([branchName, rows]) => (
                      <div key={branchName}>
                        <h4 style={{ fontSize: '0.85rem', color: '#a78bfa', marginBottom: '0.5rem' }}>
                          {branchName} · {rows.length} pending
                        </h4>
                        <table className="data-table">
                          <thead>
                            <tr><th>Student</th><th>Course</th><th>Plan</th><th>Cabin</th><th>Due Date</th><th>Amount Pending</th></tr>
                          </thead>
                          <tbody>
                            {rows.map(m => (
                              <tr key={m.id} className="row-overdue">
                                <td>
                                  <Link to={`/students/${m.student_id}`} style={{ color: 'var(--accent)' }}>{m.students?.name}</Link>
                                  <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.students?.phone}</div>
                                </td>
                                <td style={{ fontSize: '0.82rem' }}>{m.students?.course ?? '—'}</td>
                                <td style={{ fontSize: '0.82rem' }} className="cap">{m.category} · {m.hours_per_day}h/day</td>
                                <td style={{ fontSize: '0.82rem' }}>{m.cabin_no ?? '—'}</td>
                                <td className="mono">{formatDate(m.due_date)}</td>
                                <td className="mono" style={{ color: '#ff8888', fontWeight: 700 }}>{formatCurrency(m.fee_due)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>
                  Memberships Expiring On {formatDate(pending.date)} — {pending.expiredMemberships.length} student{pending.expiredMemberships.length === 1 ? '' : 's'}
                </h3>
                {pending.expiredMemberships.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>None.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {groupByBranch(pending.expiredMemberships).map(([branchName, rows]) => (
                      <div key={branchName}>
                        <h4 style={{ fontSize: '0.85rem', color: '#a78bfa', marginBottom: '0.5rem' }}>
                          {branchName} · {rows.length} expiring
                        </h4>
                        <table className="data-table">
                          <thead>
                            <tr><th>Student</th><th>Course</th><th>Plan</th><th>Cabin</th><th>End Date</th></tr>
                          </thead>
                          <tbody>
                            {rows.map(m => (
                              <tr key={m.id} className="row-overdue">
                                <td>
                                  <Link to={`/students/${m.student_id}`} style={{ color: 'var(--accent)' }}>{m.students?.name}</Link>
                                  <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.students?.phone}</div>
                                </td>
                                <td style={{ fontSize: '0.82rem' }}>{m.students?.course ?? '—'}</td>
                                <td style={{ fontSize: '0.82rem' }} className="cap">{m.category} · {m.hours_per_day}h/day</td>
                                <td style={{ fontSize: '0.82rem' }}>{m.cabin_no ?? '—'}</td>
                                <td className="mono">{formatDate(m.end_date)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'students' && (
        !students ? <p>Loading…</p> : (
          <>
            <div className="filters" style={{ marginBottom: '1rem' }}>
              <input
                placeholder="Search name, phone, cabin…" value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {groupByBranch(
                studentSearch.trim()
                  ? students.filter(s => {
                      const q = studentSearch.trim().toLowerCase()
                      return s.name.toLowerCase().includes(q) || s.contact.includes(q) || String(s.cabin).toLowerCase().includes(q)
                    })
                  : students
              ).map(([branchName, rows]) => (
                <div key={branchName} className="card" style={{ overflowX: 'auto' }}>
                  <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>{branchName} · {rows.length} student{rows.length === 1 ? '' : 's'}</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {STUDENT_COLUMNS.map(col => <th key={col.key}>{col.label}</th>)}
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(s => (
                        <tr key={s.id} className={(s.isOverdue || s.lockerOverdue) ? 'row-overdue' : ''}>
                          {STUDENT_COLUMNS.map(col => (
                            <td key={col.key}>
                              {col.key === 'name' ? (
                                <Link to={`/students/${s.id}`} style={{ color: 'var(--accent)' }}>{s.name}</Link>
                              ) : col.isDate && s[col.key] && s[col.key] !== '-' ? formatDate(s[col.key]) : s[col.key]}
                            </td>
                          ))}
                          <td><span className={`badge badge-${s.status} cap`}>{s.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {tab === 'membership' && (
        !memberships ? <p>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {groupByBranch(memberships).map(([branchName, rows]) => (
              <div key={branchName} className="card">
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>{branchName} · {rows.length} active membership{rows.length === 1 ? '' : 's'}</h3>
                <table className="data-table">
                  <thead>
                    <tr><th>Student</th><th>Category</th><th>Hours</th><th>Cabin</th><th>Start</th><th>End</th><th>Fee Due</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(m => (
                      <tr key={m.membership_id} className={m.fee_due > 0 ? 'row-overdue' : ''}>
                        <td>
                          <Link to={`/students/${m.student_id}`} style={{ color: 'var(--accent)' }}>{m.student_name}</Link>
                          <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.student_phone}</div>
                        </td>
                        <td className="cap">{m.category}</td>
                        <td className="mono">{m.hours_per_day}h/day</td>
                        <td>{m.cabin_no ?? '—'}</td>
                        <td className="mono">{formatDate(m.start_date)}</td>
                        <td className="mono">{formatDate(m.end_date)}</td>
                        <td className="mono" style={{ color: m.fee_due > 0 ? '#ff8888' : undefined, fontWeight: m.fee_due > 0 ? 700 : 400 }}>{formatCurrency(m.fee_due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'sessions' && (
        !sessions ? <p>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {groupByBranch(sessions).map(([branchName, rows]) => (
              <div key={branchName} className="card">
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>{branchName} · {rows.length} active session{rows.length === 1 ? '' : 's'}</h3>
                <table className="data-table">
                  <thead>
                    <tr><th>Student</th><th>Desk</th><th>Type</th><th>Started</th><th>Hours</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(b => (
                      <tr key={b.id}>
                        <td>
                          <Link to={`/students/${b.student_id}`} style={{ color: 'var(--accent)' }}>{b.students?.name}</Link>
                          <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.students?.phone}</div>
                        </td>
                        <td>{b.desks?.label ?? '—'}</td>
                        <td className="cap">{b.booking_type}</td>
                        <td className="mono">{new Date(b.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="mono">{b.hours ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      )}
    </>
  )
}
