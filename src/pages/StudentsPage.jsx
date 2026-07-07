import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { exportToCSV } from '../lib/utils'

const COLUMNS = [
  { key: 'sNo', label: 'S.No' },
  { key: 'name', label: 'Name' },
  { key: 'cabin', label: 'Cabin' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'month', label: 'Month' },
  { key: 'hours', label: 'Hours' },
  { key: 'locker', label: 'Locker' },
  { key: 'lockerDue', label: 'Locker Due' },
  { key: 'course', label: 'Course' },
  { key: 'contact', label: 'Contact' },
]

export default function StudentsPage() {
  const { branchId, isOwner } = useAuth()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState('sNo')
  const [sortDir, setSortDir] = useState('asc')
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [tab, setTab] = useState('list')

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
    if (search) {
      const s = search.toLowerCase()
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
  const [topPeriod, setTopPeriod] = useState('all')
  const [topSortBy, setTopSortBy] = useState('visits')
  useEffect(() => {
    if (tab !== 'loyalty' || !branchId) return
    api('get_top_students', { branchId, sortBy: topSortBy, period: topPeriod }).then(d => setTopStudents(d.students ?? []))
  }, [tab, branchId, topPeriod, topSortBy])

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
        <button type="button" className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>Spreadsheet View</button>
        <button type="button" className={tab === 'loyalty' ? 'active' : ''} onClick={() => setTab('loyalty')}>Top Students</button>
      </div>

      {tab === 'list' && (
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
                          ) : row[col.key]}
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
              <tr><th>Rank</th><th>Name</th><th>Phone</th><th>Visits</th><th>Hours</th><th>Course</th></tr>
            </thead>
            <tbody>
              {topStudents.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td><Link to={`/students/${s.id}`} style={{ color: 'var(--accent)' }}>{s.name}</Link></td>
                  <td className="mono">{s.phone}</td>
                  <td className="mono">{s.total_visits}</td>
                  <td className="mono">{s.total_hours_studied}</td>
                  <td>{s.course ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
