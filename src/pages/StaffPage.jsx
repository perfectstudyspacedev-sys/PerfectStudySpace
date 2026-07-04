import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { todayISO } from '../lib/utils'

export default function StaffPage() {
  const { isOwner } = useAuth()
  const [staffList, setStaffList] = useState([])
  const [branches, setBranches] = useState([])
  const [staffBranchFilter, setStaffBranchFilter] = useState('')
  const [attendance, setAttendance] = useState(null)
  const [attendanceDate, setAttendanceDate] = useState(todayISO())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([api('list_staff'), api('list_branches')])
    setStaffList(s.staff ?? [])
    setBranches(b.branches ?? [])
  }, [])

  const loadAttendance = useCallback(async () => {
    const a = await api('list_staff_attendance', { date: attendanceDate })
    setAttendance(a)
  }, [attendanceDate])

  useEffect(() => { if (isOwner) load() }, [isOwner, load])
  useEffect(() => { if (isOwner) loadAttendance() }, [isOwner, loadAttendance])

  const filteredStaff = staffBranchFilter ? staffList.filter(s => s.branch_id === staffBranchFilter) : staffList

  if (!isOwner) return <Navigate to="/" replace />

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('create_staff', { username, password, displayName, role: 'staff', branchId })
      setUsername(''); setPassword(''); setDisplayName(''); setBranchId('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-header"><h1>Staff Management</h1></div>

      <div className="card" style={{ maxWidth: 480, marginBottom: '1.5rem' }}>
        <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Add Staff Account</h3>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Display Name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Assigned Branch</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              <option value="">Select branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Staff'}</button>
        </form>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>All Accounts</h3>
          <select value={staffBranchFilter} onChange={(e) => setStaffBranchFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="guest-list">
          {filteredStaff.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No staff found.</p>}
          {filteredStaff.map(s => (
            <div key={s.id} className={`guest-item ${!s.is_active ? 'inactive' : ''}`}>
              <div>
                <strong>{s.display_name || s.username}</strong>
                <span className="mono" style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>({s.role})</span>
                {s.branches?.name && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{s.branches.name}</p>}
              </div>
              <span className={`badge badge-${s.is_active ? 'active' : 'inactive'}`}>{s.is_active ? 'Active' : 'Inactive'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>Attendance</h3>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          Automatically marked the first time a staff member logs in each day.
        </p>
        {!attendance || attendance.rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No staff found.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Staff</th><th>Branch</th><th>Status</th><th>First Login</th></tr></thead>
            <tbody>
              {attendance.rows.map(r => (
                <tr key={r.staffId}>
                  <td>{r.displayName}</td>
                  <td>{r.branchName ?? '—'}</td>
                  <td>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700,
                      background: r.present ? 'rgba(74,222,128,0.1)' : 'rgba(255,60,60,0.1)',
                      color: r.present ? '#4ade80' : '#ff8888',
                    }}>
                      {r.present ? 'Present' : 'Absent'}
                    </span>
                  </td>
                  <td className="mono">{r.firstLoginAt ? new Date(r.firstLoginAt).toLocaleTimeString('en-IN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
