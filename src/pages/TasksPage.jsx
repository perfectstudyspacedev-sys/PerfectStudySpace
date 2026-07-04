import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { todayISO } from '../lib/utils'

function TaskTable({ tasks, allBranches, onToggle, currentStaffId }) {
  if (tasks.length === 0) return <p style={{ color: 'var(--text-muted)' }}>No tasks found.</p>
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Title</th>
          {allBranches && <th>Branch</th>}
          <th>Assigned To</th>
          <th>Assigned By</th>
          <th>Repeat</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map(t => (
          <tr key={t.id}>
            <td>
              <strong>{t.title}</strong>
              {t.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t.description}</div>}
            </td>
            {allBranches && <td style={{ fontSize: '0.82rem' }}>{t.branches?.name ?? '—'}</td>}
            <td style={{ fontSize: '0.85rem' }}>{t.assigned_to?.display_name || t.assigned_to?.username}</td>
            <td style={{ fontSize: '0.85rem' }}>{t.assigned_by?.display_name || t.assigned_by?.username}</td>
            <td style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>{t.repeat_interval === 'none' ? '—' : t.repeat_interval}</td>
            <td>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700,
                background: t.completedToday ? 'rgba(74,222,128,0.1)' : 'rgba(255,150,0,0.1)',
                color: t.completedToday ? '#4ade80' : '#ffaa44',
              }}>
                {t.completedToday ? 'Done' : 'Pending'}
              </span>
            </td>
            <td>
              {t.assigned_to_staff_id === currentStaffId ? (
                <button
                  type="button"
                  className={t.completedToday ? 'btn btn-ghost' : 'btn btn-primary'}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => onToggle(t)}
                >
                  {t.completedToday ? 'Undo' : 'Complete'}
                </button>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const REPEAT_OPTIONS = [
  { value: 'none', label: 'One-time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export default function TasksPage() {
  const { staff, isOwner, branchId, branches } = useAuth()
  const [tasks, setTasks] = useState([])
  const [staffOptions, setStaffOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [allBranches, setAllBranches] = useState(isOwner)
  const [statusFilter, setStatusFilter] = useState('')

  const [assignBranchId, setAssignBranchId] = useState(isOwner ? '' : branchId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState(todayISO())
  const [repeatInterval, setRepeatInterval] = useState('none')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const t = await api('list_tasks', { branchId, allBranches: isOwner ? allBranches : false })
      setTasks(t.tasks ?? [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [branchId, isOwner, allBranches])

  useEffect(() => { load() }, [load])

  // Staff options depend on which branch is selected for assignment
  useEffect(() => {
    const targetBranch = isOwner ? assignBranchId : branchId
    if (!targetBranch) { setStaffOptions([]); return }
    api('list_branch_staff', { branchId: targetBranch }).then(d => setStaffOptions(d.staff ?? []))
  }, [isOwner, assignBranchId, branchId])

  useEffect(() => {
    setAssignedTo('')
  }, [assignBranchId])

  const handleCreate = async (e) => {
    e.preventDefault()
    const targetBranch = isOwner ? assignBranchId : branchId
    if (isOwner && !targetBranch) return setError('Please select a branch first')
    if (!title.trim()) return setError('Title is required')
    if (!assignedTo) return setError('Please select an assignee')
    setSaving(true)
    setError('')
    try {
      await api('create_task', {
        branchId: targetBranch, assignedToStaffId: assignedTo, title: title.trim(),
        description: description.trim() || null, dueDate: dueDate || null, repeatInterval,
      })
      setTitle(''); setDescription(''); setDueDate(todayISO()); setRepeatInterval('none')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleDone = async (task) => {
    try {
      await api('update_task_status', { taskId: task.id, done: !task.completedToday })
      load()
    } catch { /* ignore */ }
  }

  const applyStatusFilter = (list) => statusFilter === 'done'
    ? list.filter(t => t.completedToday)
    : statusFilter === 'pending'
      ? list.filter(t => !t.completedToday)
      : list

  const todaysTasks = tasks.filter(t => t.dueToday)
  const ownerTasks = isOwner ? todaysTasks.filter(t => t.assigned_to_staff_id === staff?.id) : []
  const otherTasks = isOwner ? todaysTasks.filter(t => t.assigned_to_staff_id !== staff?.id) : todaysTasks
  const filteredOwnerTasks = applyStatusFilter(ownerTasks)
  const filteredTasks = applyStatusFilter(otherTasks)

  return (
    <>
      <div className="page-header">
        <h1>Actions</h1>
        {isOwner && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} />
            All branches
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: '1rem', alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Assign a Task</h3>
          <form onSubmit={handleCreate}>
            {isOwner && (
              <div className="form-group">
                <label>Branch</label>
                <select value={assignBranchId} onChange={(e) => setAssignBranchId(e.target.value)} required>
                  <option value="">Select branch</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Assign To</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={isOwner && !assignBranchId} required>
                <option value="">{isOwner && !assignBranchId ? 'Select a branch first' : 'Select staff'}</option>
                {staffOptions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.display_name || s.username}{s.id === staff?.id ? ' (Myself)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" required />
            </div>
            <div className="form-group">
              <label>Details</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional details" />
            </div>
            <div className="form-group">
              <label>Repeat</label>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {REPEAT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value} type="button" onClick={() => setRepeatInterval(value)}
                    style={{
                      flex: '1 0 auto', padding: '0.4rem 0.6rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', borderRadius: 4,
                      border: `1px solid ${repeatInterval === value ? 'var(--accent)' : '#333'}`,
                      background: repeatInterval === value ? 'rgba(255,215,0,0.08)' : '#141414',
                      color: repeatInterval === value ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>{repeatInterval === 'none' ? 'Due Date' : 'Starts On'}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {repeatInterval !== 'none' && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {repeatInterval === 'weekly' && 'Repeats every week on this date’s weekday.'}
                  {repeatInterval === 'monthly' && 'Repeats every month on this date.'}
                  {repeatInterval === 'daily' && 'Shows up every day from this date onward.'}
                </p>
              )}
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Assigning…' : 'Assign Task'}</button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {isOwner && (
            <div className="card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>My Tasks (Owner)</h3>
              {loading ? <p>Loading…</p> : (
                <TaskTable tasks={filteredOwnerTasks} allBranches={allBranches} onToggle={toggleDone} currentStaffId={staff?.id} />
              )}
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ color: 'var(--accent)' }}>Tasks Today</h3>
              <div className="period-toggle">
                {['', 'pending', 'done'].map(s => (
                  <button key={s || 'all'} type="button" className={statusFilter === s ? 'active' : ''} onClick={() => setStatusFilter(s)}>
                    {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {loading ? <p>Loading…</p> : (
              <TaskTable tasks={filteredTasks} allBranches={allBranches} onToggle={toggleDone} currentStaffId={staff?.id} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
