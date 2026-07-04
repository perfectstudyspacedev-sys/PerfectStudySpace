import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, todayISO, exportToCSV } from '../lib/utils'

export default function ReportsPage() {
  const { branchId, isOwner } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [report, setReport] = useState(null)
  const [actionable, setActionable] = useState(null)
  const [taskReport, setTaskReport] = useState(null)
  const [taskAllBranches, setTaskAllBranches] = useState(isOwner)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const [rpt, act] = await Promise.all([
        api('get_daily_report', { branchId, date }),
        api('get_actionable_items', { branchId }),
      ])
      setReport(rpt)
      setActionable(act)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [branchId, date])

  const loadTaskReport = useCallback(async () => {
    if (!branchId) return
    try {
      const data = await api('get_task_completion_report', { branchId, date, allBranches: isOwner && taskAllBranches })
      setTaskReport(data)
    } catch (e) { console.error(e) }
  }, [branchId, date, isOwner, taskAllBranches])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTaskReport() }, [loadTaskReport])

  const canSeeCollections = report?.totalCollections != null

  const exportDaily = () => {
    if (!report) return
    exportToCSV(`daily-report-${date}.csv`,
      ['Type', 'Detail', 'Amount'],
      [
        ...(report.transactions ?? []).map(t => ['Transaction', t.category, t.amount]),
        ...(report.walkins ?? []).map(w => ['Walk-in', w.students?.name, w.amount]),
        ...(report.newMembers ?? []).map(m => ['New Member', m.students?.name, m.total_paid]),
      ],
    )
  }

  const exportActionable = () => {
    if (!actionable) return
    const rows = [
      ...(actionable.dueToday ?? []).map(m => ['Payment Due', m.students?.name, m.students?.phone, m.due_date, m.fee_due]),
      ...(actionable.expiringSoon ?? []).map(m => ['Expiring', m.students?.name, m.students?.phone, m.end_date, '']),
      ...(actionable.overdueLockers ?? []).map(l => ['Locker Overdue', l.students?.name, l.students?.phone, l.locker_due_date, l.locker_no]),
    ]
    exportToCSV(`actionable-${todayISO()}.csv`, ['Type', 'Name', 'Phone', 'Date', 'Extra'], rows)
  }

  return (
    <>
      <div className="page-header">
        <h1>Daily Reports</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {canSeeCollections && (
            <button type="button" className="btn btn-ghost" onClick={exportDaily}>Export Daily (CSV)</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={exportActionable}>Export Action Items (CSV)</button>
        </div>
      </div>

      <div className="form-group" style={{ maxWidth: 200, marginBottom: '1rem' }}>
        <label>Report Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {loading && <p>Loading…</p>}

      {report && (
        <>
          <div className="stats-row">
            {canSeeCollections && (
              <div className="card stat-card">
                <div className="value">{formatCurrency(report.totalCollections)}</div>
                <div className="label">Total Collections</div>
              </div>
            )}
            <div className="card stat-card">
              <div className="value">{report.walkins?.length ?? 0}</div>
              <div className="label">Walk-ins</div>
            </div>
            <div className="card stat-card">
              <div className="value">{report.newMembers?.length ?? 0}</div>
              <div className="label">New Memberships</div>
            </div>
            {canSeeCollections && (
              <div className="card stat-card">
                <div className="value">{report.transactions?.length ?? 0}</div>
                <div className="label">Transactions</div>
              </div>
            )}
          </div>

          {canSeeCollections && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>End-of-Day Summary — {date}</h3>
              <table className="data-table">
                <thead><tr><th>Time</th><th>Category</th><th>Amount</th><th>Mode</th></tr></thead>
                <tbody>
                  {(report.transactions ?? []).map(t => (
                    <tr key={t.id}>
                      <td className="mono">{new Date(t.created_at).toLocaleTimeString('en-IN')}</td>
                      <td>{t.category}</td>
                      <td className="mono">{formatCurrency(t.amount)}</td>
                      <td>{t.payment_mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>Tasks Completed — {date}</h3>
          {isOwner && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={taskAllBranches} onChange={(e) => setTaskAllBranches(e.target.checked)} />
              All branches
            </label>
          )}
        </div>
        {!taskReport || taskReport.tasks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No tasks due on this date.</p>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              {taskReport.tasks.filter(t => t.completedToday).length} of {taskReport.tasks.length} completed
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  {taskAllBranches && <th>Branch</th>}
                  <th>Assigned To</th>
                  <th>Repeat</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {taskReport.tasks.map(t => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    {taskAllBranches && <td style={{ fontSize: '0.82rem' }}>{t.branches?.name ?? '—'}</td>}
                    <td style={{ fontSize: '0.85rem' }}>{t.assigned_to?.display_name || t.assigned_to?.username}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {actionable && (
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Actionable Items (Today)</h3>
          {(actionable.dueToday?.length ?? 0) === 0 && (actionable.overdueLockers?.length ?? 0) === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>All clear — no urgent follow-ups.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Type</th><th>Student</th><th>Phone</th><th>Due Date</th><th>Amount</th></tr></thead>
              <tbody>
                {actionable.dueToday?.map(m => (
                  <tr key={m.id} className="row-overdue">
                    <td>Payment Due</td>
                    <td>{m.students?.name}</td>
                    <td className="mono">{m.students?.phone}</td>
                    <td className="mono">{m.due_date}</td>
                    <td className="mono">{formatCurrency(m.fee_due)}</td>
                  </tr>
                ))}
                {actionable.overdueLockers?.map(l => (
                  <tr key={l.id} className="row-overdue">
                    <td>Locker Overdue</td>
                    <td>{l.students?.name}</td>
                    <td className="mono">{l.students?.phone}</td>
                    <td className="mono">{l.locker_due_date}</td>
                    <td>Locker {l.locker_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  )
}
