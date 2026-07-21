import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { exportToCSV, formatDate, formatCurrency } from '../lib/utils'
import { DEV_MODE } from '../lib/devMode'

const COLUMNS = [
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

export default function StudentsPage() {
  const { branchId, isOwner: isOwnerRole } = useAuth()
  // Dev-mode: staff get the same Students spreadsheet access as owner, code-level only.
  const isOwner = isOwnerRole || DEV_MODE
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState('sNo')
  const [sortDir, setSortDir] = useState('asc')
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [tab, setTab] = useState(isOwner ? 'list' : 'loyalty')
  const [cashbackTarget, setCashbackTarget] = useState(null)
  const [cashbackType, setCashbackType] = useState('percent')
  const [cashbackValue, setCashbackValue] = useState('')
  const [cashbackNotes, setCashbackNotes] = useState('')
  const [cashbackLoading, setCashbackLoading] = useState(false)
  const [cashbackError, setCashbackError] = useState('')

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const data = await api('list_students', { branchId })
      setStudents(data.students ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { load() }, [load])

  const courses = useMemo(() => {
    const set = new Set(students.map(s => s.course).filter(c => c && c !== '-'))
    return [...set].sort()
  }, [students])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    let rows = [...students]
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      rows = rows.filter(r => r.name.toLowerCase().includes(s) || r.contact.includes(s) || r.cabin.toLowerCase().includes(s))
    }
    if (statusFilter) rows = rows.filter(r => r.status === statusFilter)
    if (courseFilter) rows = rows.filter(r => r.course === courseFilter)
    Object.entries(filters).forEach(([key, val]) => {
      if (val) rows = rows.filter(r => String(r[key] ?? '').toLowerCase().includes(val.toLowerCase()))
    })
    rows.sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [students, search, statusFilter, courseFilter, filters, sortKey, sortDir])

  const handleExport = () => {
    exportToCSV(
      `students-${branchId?.slice(0, 8)}.csv`,
      COLUMNS.map(c => c.label),
      filtered.map(r => COLUMNS.map(c => r[c.key])),
    )
  }

  const [topStudents, setTopStudents] = useState([])
  const [topPeriod, setTopPeriod] = useState('month')
  const [topSortBy, setTopSortBy] = useState('hours')
  useEffect(() => {
    if (tab !== 'loyalty' || !branchId) return
    api('get_top_students', { branchId, sortBy: topSortBy, period: topPeriod }).then(d => setTopStudents(d.students ?? []))
  }, [tab, branchId, topPeriod, topSortBy])

  const [cashbacks, setCashbacks] = useState([])
  const [cashbacksLoading, setCashbacksLoading] = useState(false)
  const [cashbackStatusFilter, setCashbackStatusFilter] = useState('')
  useEffect(() => {
    if (tab !== 'cashbacks' || !branchId) return
    setCashbacksLoading(true)
    api('list_cashbacks', { branchId })
      .then(d => setCashbacks(d.cashbacks ?? []))
      .finally(() => setCashbacksLoading(false))
  }, [tab, branchId])

  const filteredCashbacks = useMemo(() => {
    if (!cashbackStatusFilter) return cashbacks
    return cashbacks.filter(c => c.status === cashbackStatusFilter)
  }, [cashbacks, cashbackStatusFilter])

  const openCashback = (student) => {
    setCashbackTarget(student)
    setCashbackType('percent')
    setCashbackValue('')
    setCashbackNotes('')
    setCashbackError('')
  }

  const handleGrantCashback = async () => {
    setCashbackLoading(true)
    setCashbackError('')
    try {
      await api('grant_cashback', {
        studentId: cashbackTarget.id, branchId, cashbackType, cashbackValue: Number(cashbackValue),
        monthLabel: topPeriod === 'month' ? new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }) : undefined,
        notes: cashbackNotes,
      })
      setCashbackTarget(null)
    } catch (err) {
      setCashbackError(err.message)
    } finally {
      setCashbackLoading(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Students</h1>
        {isOwner && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-ghost" onClick={handleExport}>Export Excel</button>
          </div>
        )}
      </div>

      <div className="tabs">
        {isOwner && (
          <button type="button" className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>Spreadsheet View</button>
        )}
        <button type="button" className={tab === 'loyalty' ? 'active' : ''} onClick={() => setTab('loyalty')}>Top Students</button>
        <button type="button" className={tab === 'cashbacks' ? 'active' : ''} onClick={() => setTab('cashbacks')}>Cashback</button>
      </div>

      {isOwner && tab === 'list' && (
        <>
          <div className="filters">
            <input placeholder="Search name, phone, cabin…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
              <option value="">All Courses</option>
              {courses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            {loading ? <p>Loading…</p> : (
              <table className="data-table">
                <thead>
                  <tr>
                    {COLUMNS.map(col => (
                      <th key={col.key} className="th-sortable" onClick={() => handleSort(col.key)}>
                        {col.label}
                        <span className="filter-icon">{sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                      </th>
                    ))}
                    <th>Status</th>
                  </tr>
                  <tr>
                    {COLUMNS.map(col => (
                      <th key={col.key}>
                        <input
                          placeholder="Filter"
                          value={filters[col.key] ?? ''}
                          onChange={(e) => setFilters(f => ({ ...f, [col.key]: e.target.value }))}
                          style={{ width: '100%', padding: '0.25rem', fontSize: '0.75rem', background: '#141414', border: '1px solid #333', color: 'var(--text)' }}
                        />
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className={(row.isOverdue || row.lockerOverdue) ? 'row-overdue' : ''}>
                      {COLUMNS.map(col => (
                        <td key={col.key}>
                          {col.key === 'name' ? (
                            <Link to={`/students/${row.id}`} style={{ color: 'var(--accent)' }}>{row[col.key]}</Link>
                          ) : col.isDate && row[col.key] && row[col.key] !== '-' ? formatDate(row[col.key]) : row[col.key]}
                        </td>
                      ))}
                      <td>
                        <span className={`badge badge-${row.status} cap`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {filtered.length} students · Red rows = overdue payment or locker
            </p>
          </div>
        </>
      )}

      {tab === 'loyalty' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 style={{ color: 'var(--accent)' }}>Top Students</h2>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="period-toggle">
                {[{ v: 'all', l: 'All Time' }, { v: 'month', l: 'This Month' }].map(({ v, l }) => (
                  <button key={v} type="button" className={topPeriod === v ? 'active' : ''} onClick={() => setTopPeriod(v)}>{l}</button>
                ))}
              </div>
              <div className="period-toggle">
                {[{ v: 'visits', l: 'By Visits' }, { v: 'hours', l: 'By Hours' }].map(({ v, l }) => (
                  <button key={v} type="button" className={topSortBy === v ? 'active' : ''} onClick={() => setTopSortBy(v)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Rank</th><th>Name</th><th>Visits</th><th>Hours</th><th>Course</th><th></th></tr>
            </thead>
            <tbody>
              {topStudents.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td><Link to={`/students/${s.id}`} style={{ color: 'var(--accent)' }}>{s.name}</Link></td>
                  <td className="mono">{s.total_visits}</td>
                  <td className="mono">{s.total_hours_studied}</td>
                  <td>{s.course ?? '-'}</td>
                  <td>
                    {s.is_member ? (
                      <button type="button" className="btn btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => openCashback(s)}>
                        🎁 Cashback
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title="Only membership students are eligible for cashback">
                        — Not a member
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cashbacks' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 style={{ color: 'var(--accent)' }}>Cashback</h2>
            <div className="period-toggle">
              {[{ v: '', l: 'All' }, { v: 'pending', l: 'Yet to Avail' }, { v: 'redeemed', l: 'Redeemed' }, { v: 'settled', l: 'Settled' }].map(({ v, l }) => (
                <button key={v} type="button" className={cashbackStatusFilter === v ? 'active' : ''} onClick={() => setCashbackStatusFilter(v)}>{l}</button>
              ))}
            </div>
          </div>
          {cashbacksLoading ? <p>Loading…</p> : (
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Month</th><th>Cashback</th><th>Status</th><th>Redeemed</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {filteredCashbacks.map(c => (
                  <tr key={c.id}>
                    <td><Link to={`/students/${c.studentId}`} style={{ color: 'var(--accent)' }}>{c.studentName}</Link></td>
                    <td>{c.monthLabel ?? '-'}</td>
                    <td className="mono">
                      {c.cashbackType === 'percent'
                        ? `${c.cashbackValue}%${c.estimatedAmount != null ? ` (${c.status === 'pending' ? '~' : ''}${formatCurrency(c.estimatedAmount)})` : ''}`
                        : formatCurrency(c.cashbackValue)}
                    </td>
                    <td>
                      <span className={`badge ${c.status === 'pending' ? 'badge-pending' : 'badge-active'} cap`}>
                        {c.status === 'pending' ? 'Yet to Avail' : c.status}
                      </span>
                    </td>
                    <td>
                      {c.redeemedAt ? `${formatCurrency(c.redeemedAmount)} · ${formatDate(c.redeemedAt)}` : '-'}
                    </td>
                    <td>{c.notes ?? '-'}</td>
                  </tr>
                ))}
                {!filteredCashbacks.length && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No cashback records found.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {cashbackTarget && (
        <div className="modal-overlay" onClick={() => setCashbackTarget(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>🎁 Grant Cashback</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{cashbackTarget.name}</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Applied as a discount on their next renewal — or paid out in cash if they close their membership instead of renewing.
            </p>
            <div className="form-group">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button" onClick={() => setCashbackType('percent')}
                  style={{
                    flex: 1, padding: '0.55rem',
                    border: `1px solid ${cashbackType === 'percent' ? 'var(--accent)' : '#333'}`,
                    borderRadius: 999, background: cashbackType === 'percent' ? 'var(--accent)' : '#141414',
                    color: cashbackType === 'percent' ? '#000' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >% Off</button>
                <button
                  type="button" onClick={() => setCashbackType('fixed')}
                  style={{
                    flex: 1, padding: '0.55rem',
                    border: `1px solid ${cashbackType === 'fixed' ? 'var(--accent)' : '#333'}`,
                    borderRadius: 999, background: cashbackType === 'fixed' ? 'var(--accent)' : '#141414',
                    color: cashbackType === 'fixed' ? '#000' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >₹ Fixed</button>
              </div>
            </div>
            <div className="form-group">
              <input
                type="number" min={0} value={cashbackValue} onChange={(e) => setCashbackValue(e.target.value)}
                placeholder={cashbackType === 'percent' ? 'e.g. 10 (%)' : 'e.g. 200 (₹)'}
              />
            </div>
            <div className="form-group">
              <input type="text" value={cashbackNotes} onChange={(e) => setCashbackNotes(e.target.value)} placeholder="Notes (optional)" />
            </div>
            {cashbackError && <p className="error-msg">{cashbackError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCashbackTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={cashbackLoading || !cashbackValue} onClick={handleGrantCashback}>
                {cashbackLoading ? 'Granting…' : 'Grant Cashback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
