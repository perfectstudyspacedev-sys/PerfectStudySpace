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

// The text a cell actually renders. Column filters have to match against this, not the raw
// row value: a date is stored "2026-10-23" but displayed "23-10-26", so typing what you see
// ("23-10") found nothing. Both forms are searched, so the ISO value still matches too.
function cellText(row, col) {
  const raw = row[col?.key]
  if (raw == null || raw === '-') return ''
  if (col?.isDate) return `${formatDate(raw)} ${raw}`
  return String(raw)
}

function groupByBranchName(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = row.branches?.name ?? 'Unknown Branch'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// ── Combined Hall — read-only, every branch's students at once. The spreadsheet export,
// Top Students, and Cashback tabs are all single-branch analytics with no combined form
// defined yet, so they're only offered once a real branch is selected.
const COMBINED_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'inactive', label: 'Inactive' },
]

function CombinedStudentsView() {
  const [students, setStudents] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [branchFilter, setBranchFilter] = useState(null) // null = every branch
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api('list_students', { allBranches: true })
      setStudents(data.students ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const searched = students && search.trim()
    ? students.filter(s => {
        const q = search.trim().toLowerCase()
        return s.name.toLowerCase().includes(q) || s.contact.includes(q) || String(s.cabin).toLowerCase().includes(q)
      })
    : students

  const filtered = searched && statusFilter ? searched.filter(s => s.status === statusFilter) : searched

  const allGroups = filtered ? groupByBranchName(filtered) : []
  const visibleGroups = branchFilter ? allGroups.filter(([name]) => name === branchFilter) : allGroups

  return (
    <>
      <div className="page-header"><h1>Students — Combined Hall</h1></div>
      {error && <p className="error-msg" style={{ marginBottom: '1rem' }}>{error}</p>}
      {!students ? <p>Loading…</p> : (
        <>
          <div className="filters" style={{ marginBottom: '1rem', alignItems: 'center' }}>
            <input placeholder="Search name, phone, cabin…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="period-toggle">
              {COMBINED_STATUS_OPTIONS.map(({ value, label }) => (
                <button key={value || 'all'} type="button" className={statusFilter === value ? 'active' : ''} onClick={() => setStatusFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {allGroups.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button type="button" className={`btn ${branchFilter === null ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }} onClick={() => setBranchFilter(null)}>
                All Branches ({filtered.length})
              </button>
              {allGroups.map(([name, rows]) => (
                <button
                  key={name} type="button"
                  className={`btn ${branchFilter === name ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                  onClick={() => setBranchFilter(name)}
                >
                  {name} ({rows.length})
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {visibleGroups.map(([branchName, rows]) => (
              <div key={branchName} className="card" style={{ overflowX: 'auto' }}>
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>{branchName} · {rows.length} student{rows.length === 1 ? '' : 's'}</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(col => <th key={col.key}>{col.label}</th>)}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(s => (
                      <tr key={s.id} className={(s.isOverdue || s.lockerOverdue) ? 'row-overdue' : ''}>
                        {COLUMNS.map(col => (
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
      )}
    </>
  )
}

export default function StudentsPage() {
  const { branchId, isOwner: isOwnerRole, isCombinedHall } = useAuth()
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
    if (!branchId || isCombinedHall) return
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
    Object.entries(filters).forEach(([key, rawVal]) => {
      const val = rawVal.trim().toLowerCase()
      if (!val) return
      const col = COLUMNS.find(c => c.key === key)
      rows = rows.filter(r => cellText(r, col).toLowerCase().includes(val))
    })
    rows.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Placeholder "-" cells always sink to the bottom regardless of direction — a student
      // with no locker isn't "before" or "after" locker 1, they just have nothing to compare,
      // and letting "-" sort as text put them above every real value in ascending order.
      const aBlank = av == null || av === '-' || av === ''
      const bBlank = bv == null || bv === '-' || bv === ''
      if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1
      let cmp
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        // Numeric strings (S.No, locker no, hours) must compare as numbers or "10" lands
        // between "1" and "2". Dates stay on their ISO value, which is already sortable.
        const an = Number(av)
        const bn = Number(bv)
        cmp = !Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== ''
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [students, search, statusFilter, courseFilter, filters, sortKey, sortDir])

  // Ten filter boxes sit in one scrolling row, so a stray character in an off-screen column
  // could empty the table with nothing on screen explaining why. Surface the count and a
  // one-click reset.
  const activeFilterCount = Object.values(filters).filter(v => v && v.trim()).length

  const handleExport = () => {
    exportToCSV(
      `students-${branchId?.slice(0, 8)}.csv`,
      COLUMNS.map(c => c.label),
      // Export the dates in the same DD-MM-YY form the table shows, not the raw ISO value.
      filtered.map(r => COLUMNS.map(c => (c.isDate && r[c.key] && r[c.key] !== '-' ? formatDate(r[c.key]) : r[c.key]))),
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

  if (isCombinedHall) return <CombinedStudentsView />

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
              {filtered.length} of {students.length} students · Red rows = overdue payment or locker
              {activeFilterCount > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setFilters({})}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
                  >
                    ✕ Clear {activeFilterCount} column filter{activeFilterCount === 1 ? '' : 's'}
                  </button>
                </>
              )}
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
