import { useState, useEffect, useCallback } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
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

// Drag-and-drop branch board — cards default to each staff member's home branch column;
// dragging a card to a different column assigns them there for today only (covering an
// absence), and dropping back on their home column clears the override.
function StaffBranchBoard() {
  const [grid, setGrid] = useState(null)
  const [dragStaffId, setDragStaffId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [busyStaffId, setBusyStaffId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api('get_staff_grid')
      setGrid(data)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDrop = async (branchId) => {
    setDropTarget(null)
    if (!dragStaffId) return
    setBusyStaffId(dragStaffId)
    setDragStaffId(null)
    setError('')
    try {
      await api('assign_staff_override', { staffId: dragStaffId, branchId })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyStaffId(null)
    }
  }

  const handleReset = async (staffId) => {
    setBusyStaffId(staffId)
    setError('')
    try {
      await api('clear_staff_override', { staffId })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyStaffId(null)
    }
  }

  if (!grid) return <p style={{ color: 'var(--text-muted)' }}>Loading branch board…</p>

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: 'var(--accent)', marginBottom: '0.6rem', fontSize: '1.3rem' }}>Branch Assignment Board</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '1.25rem' }}>
        Drag a staff card onto another branch to cover an absence for today only ({grid.date}). Drop it back on their home branch to undo.
      </p>
      {error && <p className="error-msg">{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.branches.length}, minmax(260px, 1fr))`, gap: '1rem', overflowX: 'auto' }}>
        {grid.branches.map(b => {
          const staffHere = grid.staff.filter(s => s.effectiveBranchId === b.id)
          const isDropTarget = dropTarget === b.id
          return (
            <div
              key={b.id}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(b.id) }}
              onDragLeave={() => setDropTarget(t => (t === b.id ? null : t))}
              onDrop={(e) => { e.preventDefault(); handleDrop(b.id) }}
              style={{
                background: isDropTarget ? 'rgba(255,215,0,0.14)' : '#141414',
                border: '2px solid var(--accent)',
                boxShadow: isDropTarget ? '0 0 0 2px rgba(255,215,0,0.35)' : 'none',
                borderRadius: 10, padding: '1rem', minHeight: 200,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--accent)', marginBottom: '0.85rem' }}>
                {b.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '1rem' }}>({staffHere.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {staffHere.map(s => (
                  <div
                    key={s.id}
                    draggable
                    onDragStart={() => setDragStaffId(s.id)}
                    onDragEnd={() => setDragStaffId(null)}
                    style={{
                      padding: '0.75rem 0.9rem', borderRadius: 8, cursor: 'grab',
                      background: s.isOverrideToday ? 'rgba(255,150,0,0.1)' : '#1c1c1c',
                      border: `1px solid ${s.isOverrideToday ? 'rgba(255,150,0,0.45)' : '#333'}`,
                      opacity: busyStaffId === s.id ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{s.displayName}</div>
                    {s.isOverrideToday && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffaa44' }}>Covering today</span>
                        <button
                          type="button"
                          onClick={() => handleReset(s.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          reset
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {staffHere.length === 0 && (
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>No staff</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// PSS-AI S1: how much the retiring desk-staff screens are still used — the owner switches
// pssai_retire_staff_ops on only after a full month at zero.
const PAGE_VIEWS = ['list_staff_attendance', 'get_staff_grid']
const MODULE_LABEL = { list_staff_attendance: 'Attendance list', end_staff_session: 'End Session', assign_staff_override: 'Branch cover (assign)', clear_staff_override: 'Branch cover (clear)', get_staff_grid: 'Branch cover board', send_message: 'Staff messages sent' }
function StaffModuleUsage() {
  const [u, setU] = useState(null)
  useEffect(() => { api('get_staff_module_usage').then(setU).catch(() => setU(null)) }, [])
  if (!u) return null
  return (
    <div className="card" data-testid="staff-usage" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ color: 'var(--accent)', marginTop: 0 }}>Desk-staff screens: use in the last {u.days} days</h3>
      <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
        {u.on ? 'Retired (pssai_retire_staff_ops is on).' : u.unusedForAMonth ? 'Unused for a month — they can be retired (pssai_retire_staff_ops).' : `Still used ${u.total} time${u.total === 1 ? '' : 's'}${u.lastUsedAt ? `, last on ${new Date(u.lastUsedAt).toLocaleDateString('en-IN')}` : ''} — wait for a full month at zero before retiring them.`}
      </p>
      <ul style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{Object.entries(u.usage).filter(([k]) => !PAGE_VIEWS.includes(k)).map(([k, n]) => <li key={k}>{MODULE_LABEL[k] ?? k}: {n}</li>)}</ul>
      <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Opening this page ({u.views ?? 0} times) doesn't count as use.</p>
      {Array.isArray(u.deskAccounts) && u.deskAccounts.length > 0 && (
        <p data-testid="desk-accounts" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
          Desk accounts that will stop signing in when retired: <strong>{u.deskAccounts.join(', ')}</strong>. Set each one's Duty (kitchen or housekeeping) or deactivate it first.
        </p>
      )}
    </div>
  )
}

// PSS-AI S1 (C18): with pssai_retire_staff_ops on, the attendance list and the branch-cover board
// are retired, and only kitchen and housekeeping staff accounts can be added.
const DUTIES = [['desk', 'Desk'], ['kitchen', 'Kitchen'], ['housekeeping', 'Housekeeping']]

export default function StaffPage() {
  const { isOwner, isAdmin, staff: currentStaff, logout } = useAuth()
  const flags = useFeatureFlags()
  const retired = !!flags.retireStaffOps
  const navigate = useNavigate()
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
  const [duty, setDuty] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [editTarget, setEditTarget] = useState(null)
  const [editUsername, setEditUsername] = useState('')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editBranchId, setEditBranchId] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editDuty, setEditDuty] = useState('')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [showAddStaff, setShowAddStaff] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api('list_staff'), api('list_branches')])
      setStaffList(s.staff ?? [])
      setBranches(b.branches ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadAttendance = useCallback(async () => {
    try {
      const a = await api('list_staff_attendance', { date: attendanceDate })
      setAttendance(a)
    } catch (err) {
      setError(err.message)
    }
  }, [attendanceDate])

  useEffect(() => { if (isOwner) load() }, [isOwner, load])
  // Only once the switches are in: with S1 on, the attendance list is retired (it answers 410).
  useEffect(() => { if (isOwner && flags.loaded && !retired) loadAttendance() }, [isOwner, flags.loaded, retired, loadAttendance])

  const branchScoped = staffBranchFilter ? staffList.filter(s => s.branch_id === staffBranchFilter) : staffList
  const activeStaff = branchScoped.filter(s => s.is_active)
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
      const chosen = duty || (retired ? 'kitchen' : '')
      await api('create_staff', { username, password, displayName, role: 'staff', branchId, ...(chosen ? { duty: chosen } : {}) })
      setUsername(''); setPassword(''); setDisplayName(''); setBranchId(''); setDuty('')
      setShowAddStaff(false)
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
    setEditDuty(s.duty || '')
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
        ...(editTarget.role === 'staff' && editDuty && editDuty !== editTarget.duty ? { duty: editDuty } : {}),
      })
      setEditTarget(null)
      load()
    } catch (err) {
      setEditError(err.message)
    } finally {
      setEditSaving(false)
    }
  }

  const deactivateStaff = (s) => {
    const isSelf = s.id === currentStaff?.id
    setConfirmDialog({
      message: isSelf
        ? `Deactivate YOUR OWN account? This logs you out immediately and cannot be undone — this account can never be reactivated, and you will need another owner or admin account to get back in. Are you absolutely sure?`
        : `Permanently remove ${s.display_name || s.username}? This cannot be undone — they will be logged out immediately and can never be reactivated.`,
      onConfirm: async () => {
        try {
          await api('update_staff', { staffId: s.id, isActive: false })
          if (isSelf) {
            logout()
            navigate('/login')
          } else {
            load()
          }
        } catch (err) {
          window.alert(err.message)
        }
      },
    })
  }

  return (
    <>
      <div className="page-header"><h1>Staff Management</h1></div>

      {retired && (
        <div className="card" style={{ marginTop: '1.5rem' }} data-testid="staff-retired">
          <p style={{ margin: 0, fontSize: '0.9rem' }}>The desk-staff modules are retired: attendance, End Session and branch cover are off. Only kitchen and housekeeping accounts can be added; tasks on <strong>Actions</strong> stay.</p>
        </div>
      )}
      {flags.loaded && !retired && (
      <div className="card" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
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
          Login is marked automatically the moment a staff member is active in the app for the day.
        </p>
        {!attendance || filteredAttendance.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No staff found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff</th><th>Branch</th><th>Status</th><th>Login Time</th><th>Logout Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttendance.map(r => (
                <tr key={r.staffId}>
                  <td style={{ fontWeight: 700, fontSize: '0.95rem' }}>{r.displayName}</td>
                  <td>{r.branchName ?? '—'}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: '0.78rem', fontWeight: 700,
                      background: r.present ? 'rgba(74,222,128,0.1)' : 'rgba(255,60,60,0.1)',
                      color: r.present ? '#4ade80' : '#ff8888',
                    }}>
                      {r.present ? 'Present' : 'Absent'}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: '0.9rem' }}>
                    {r.present ? new Date(r.firstLoginAt).toLocaleTimeString('en-IN') : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: '0.9rem', color: r.lastLogoutAt ? '#ffaa44' : 'var(--text-muted)' }}>
                    {r.present ? (r.lastLogoutAt ? new Date(r.lastLogoutAt).toLocaleTimeString('en-IN') : 'Still in session') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      )}

      <div className="card" style={retired ? { marginTop: '1.5rem' } : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>All Accounts</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <BranchPillFilter branches={branches} value={staffBranchFilter} onChange={setStaffBranchFilter} />
            <button type="button" className="btn btn-primary" onClick={() => setShowAddStaff(true)}>+ Add New Staff</button>
          </div>
        </div>
        {activeStaff.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No active staff found.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
            {activeStaff.map(s => (
              <div key={s.id} style={{
                display: 'flex', flexDirection: 'column', gap: '0.6rem',
                padding: '0.75rem 0.9rem', borderRadius: 8,
                background: '#141414', border: '1px solid #2c2c2c',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.9rem' }}>{s.display_name || s.username}</strong>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.2rem' }}>
                      <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.role}</span>
                      {s.branches?.name && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>· {s.branches.name}</span>
                      )}
                      {s.role === 'staff' && s.duty && s.duty !== 'desk' && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· {s.duty}</span>
                      )}
                    </div>
                  </div>
                  <span className="badge badge-active">Active</span>
                </div>
                {(s.role !== 'owner' || s.id === currentStaff?.id || isAdmin) && (
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1, padding: '0.35rem', fontSize: '0.75rem' }} onClick={() => openEdit(s)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      style={{
                        flex: 1, padding: '0.35rem', fontSize: '0.75rem', borderRadius: 999, cursor: 'pointer',
                        background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.35)', color: '#ff8888',
                      }}
                      onClick={() => deactivateStaff(s)}
                    >
                      Deactivate
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>

      {flags.loaded && !retired && (
        <div style={{ marginTop: '1.5rem' }}>
          <StaffBranchBoard />
        </div>
      )}
      <StaffModuleUsage />

      {showAddStaff && (
        <div className="modal-overlay" onClick={() => setShowAddStaff(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Add New Staff</h2>
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
              <div className="form-group">
                <label htmlFor="new-staff-duty">Duty</label>
                <select id="new-staff-duty" value={duty || (retired ? 'kitchen' : 'desk')} onChange={(e) => setDuty(e.target.value)}>
                  {DUTIES.filter(([v]) => !retired || v !== 'desk').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {error && <p className="error-msg">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddStaff(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Staff'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

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
            {editTarget.role === 'staff' && (
              <div className="form-group">
                <label htmlFor="edit-staff-duty">Duty</label>
                <select id="edit-staff-duty" value={editDuty || 'desk'} onChange={(e) => setEditDuty(e.target.value)}>
                  {DUTIES.filter(([v]) => !retired || v !== 'desk' || editTarget.duty === 'desk' || !editTarget.duty).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}
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

      {confirmDialog && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>Are you sure?</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => { const { onConfirm } = confirmDialog; setConfirmDialog(null); onConfirm() }}
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
