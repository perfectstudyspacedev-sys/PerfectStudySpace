import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { todayISO } from '../lib/utils'

function BranchPillFilter({ branches, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      {[{ id: '', name: 'All Branches' }, ...branches].map(b => (
        <button
          key={b.id || 'all'}
          type="button"
          onClick={() => onChange(b.id)}
          style={{
            padding: '4px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${value === b.id ? 'var(--accent)' : '#333'}`,
            background: value === b.id ? 'rgba(255,215,0,0.1)' : '#141414',
            color: value === b.id ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {b.name}
        </button>
      ))}
    </div>
  )
}

export default function StaffPage() {
  const { isOwner } = useAuth()
  const [staffList, setStaffList] = useState([])
  const [branches, setBranches] = useState([])
  const [staffBranchFilter, setStaffBranchFilter] = useState('')
  const [attendanceBranchFilter, setAttendanceBranchFilter] = useState('')
  const [attendance, setAttendance] = useState(null)
  const [attendanceDate, setAttendanceDate] = useState(todayISO())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [editTarget, setEditTarget] = useState(null)
  const [editUsername, setEditUsername] = useState('')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editBranchId, setEditBranchId] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

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
  const filteredAttendance = attendance
    ? (attendanceBranchFilter
        ? attendance.rows.filter(r => r.branchId === attendanceBranchFilter)
        : attendance.rows)
    : []

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

  const openEdit = (s) => {
    setEditTarget(s)
    setEditUsername(s.username)
    setEditDisplayName(s.display_name || '')
    setEditBranchId(s.branch_id || '')
    setEditPassword('')
    setEditError('')
  }

  const handleEditSave = async () => {
    if (!editTarget) return
    setEditSaving(true)
    setEditError('')
    try {
      await api('update_staff', {
        staffId: editTarget.id, username: editUsername, displayName: editDisplayName,
        branchId: editBranchId, newPassword: editPassword || undefined,
      })
      setEditTarget(null)
      load()
    } catch (err) {
      setEditError(err.message)
    } finally {
      setEditSaving(false)
    }
  }

  const toggleActive = async (s) => {
    const verb = s.is_active ? 'deactivate' : 'reactivate'
    if (!window.confirm(`Are you sure you want to ${verb} ${s.display_name || s.username}?`)) return
    try {
      await api('update_staff', { staffId: s.id, isActive: !s.is_active })
      load()
    } catch (err) {
      window.alert(err.message)
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>All Accounts</h3>
          <BranchPillFilter branches={branches} value={staffBranchFilter} onChange={setStaffBranchFilter} />
        </div>
        {filteredStaff.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No staff found.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
            {filteredStaff.map(s => (
              <div key={s.id} style={{
                display: 'flex', flexDirection: 'column', gap: '0.6rem',
                padding: '0.75rem 0.9rem', borderRadius: 8,
                background: '#141414', border: `1px solid ${s.is_active ? '#2c2c2c' : 'rgba(255,60,60,0.3)'}`,
                opacity: s.is_active ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.9rem' }}>{s.display_name || s.username}</strong>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.2rem' }}>
                      <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.role}</span>
                      {s.branches?.name && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>· {s.branches.name}</span>
                      )}
                    </div>
                  </div>
                  <span className={`badge badge-${s.is_active ? 'active' : 'inactive'}`}>{s.is_active ? 'Active' : 'Inactive'}</span>
                </div>
                {s.role !== 'owner' && (
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1, padding: '0.35rem', fontSize: '0.75rem' }} onClick={() => openEdit(s)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      style={{
                        flex: 1, padding: '0.35rem', fontSize: '0.75rem', borderRadius: 4, cursor: 'pointer',
                        background: s.is_active ? 'rgba(255,60,60,0.08)' : 'rgba(74,222,128,0.08)',
                        border: `1px solid ${s.is_active ? 'rgba(255,60,60,0.35)' : 'rgba(74,222,128,0.35)'}`,
                        color: s.is_active ? '#ff8888' : '#4ade80',
                      }}
                      onClick={() => toggleActive(s)}
                    >
                      {s.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>Attendance</h3>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <BranchPillFilter branches={branches} value={attendanceBranchFilter} onChange={setAttendanceBranchFilter} />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          Automatically marked the first time a staff member logs in each day.
        </p>
        {!attendance || filteredAttendance.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No staff found.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
            {filteredAttendance.map(r => (
              <div key={r.staffId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.75rem 0.9rem', borderRadius: 8, background: '#141414',
                border: `1px solid ${r.present ? 'rgba(74,222,128,0.3)' : 'rgba(255,60,60,0.25)'}`,
              }}>
                <div>
                  <strong style={{ fontSize: '0.88rem' }}>{r.displayName}</strong>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{r.branchName ?? '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                    background: r.present ? 'rgba(74,222,128,0.1)' : 'rgba(255,60,60,0.1)',
                    color: r.present ? '#4ade80' : '#ff8888',
                  }}>
                    {r.present ? 'Present' : 'Absent'}
                  </span>
                  {r.present && (
                    <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {new Date(r.firstLoginAt).toLocaleTimeString('en-IN')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editTarget && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Edit Staff — {editTarget.display_name || editTarget.username}</h2>
            <div className="form-group">
              <label>Username</label>
              <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Display Name</label>
              <input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Assigned Branch</label>
              <select value={editBranchId} onChange={(e) => setEditBranchId(e.target.value)}>
                <option value="">Select branch</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>New Password (leave blank to keep current)</label>
              <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {editError && <p className="error-msg">{editError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={editSaving} onClick={handleEditSave}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
