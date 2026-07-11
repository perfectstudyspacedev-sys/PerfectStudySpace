import { useState, useEffect, useCallback } from 'react'
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, todayISO, exportToCSV, formatDate, formatDateTime } from '../lib/utils'
import { chartTooltip } from '../components/ChartTooltip'

function formatDateTick(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const ACTIVITY_CAT_LABELS = { desk: 'Walk-in Fee', membership: 'Membership Payment', food: 'Food', locker: 'Locker', overtime: 'Overtime' }
const ACTIVITY_BOOKING_LABELS = { walkin: 'Walk-in Booking', temporary: 'Temporary Check-in', permanent: 'Permanent Check-in' }

function describeActivity(a) {
  if (a.kind === 'booking') return ACTIVITY_BOOKING_LABELS[a.label] ?? a.label
  if (a.kind === 'membership' || a.kind === 'cashback') return a.label
  return `Payment — ${ACTIVITY_CAT_LABELS[a.label] ?? a.label}`
}

export default function ReportsPage() {
  const { branchId, isOwner } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [period, setPeriod] = useState('day') // owner only: day | week | month | custom
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  const [report, setReport] = useState(null)
  const [actionable, setActionable] = useState(null)
  const [taskReport, setTaskReport] = useState(null)
  const [taskAllBranches, setTaskAllBranches] = useState(isOwner)
  const [loading, setLoading] = useState(false)
  const [recentActivity, setRecentActivity] = useState([])

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const reportPayload = isOwner && period !== 'day'
        ? { branchId, period, dateFrom: period === 'custom' ? customFrom : undefined, dateTo: period === 'custom' ? customTo : undefined }
        : { branchId, date }
      const [rpt, act] = await Promise.all([
        api('get_daily_report', reportPayload),
        api('get_actionable_items', { branchId }),
      ])
      setReport(rpt)
      setActionable(act)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [branchId, date, isOwner, period, customFrom, customTo])

  const loadTaskReport = useCallback(async () => {
    if (!branchId) return
    try {
      const data = await api('get_task_completion_report', { branchId, date, allBranches: isOwner && taskAllBranches })
      setTaskReport(data)
    } catch (e) { console.error(e) }
  }, [branchId, date, isOwner, taskAllBranches])

  const loadRecentActivity = useCallback(async () => {
    // Only shown for the Day view — skip fetching entirely for Week/Month/Custom.
    if (!branchId || (isOwner && period !== 'day')) return
    try {
      const data = await api('get_recent_activity', { branchId, date })
      setRecentActivity(data.recentActivity ?? [])
    } catch (e) { console.error(e) }
  }, [branchId, date, isOwner, period])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTaskReport() }, [loadTaskReport])
  useEffect(() => { loadRecentActivity() }, [loadRecentActivity])

  // One row per student — a student who is both expired and payment-due shows up once,
  // with every applicable status badge, instead of duplicating them across separate rows.
  const buildActionableRows = (act) => {
    if (!act) return []
    const rows = new Map()
    const upsert = (studentId, name, phone, status, dueDate, amount, overdue) => {
      const key = studentId ?? phone ?? name
      if (!key) return
      const row = rows.get(key) ?? { name, phone, statuses: [], dueDate: null, amount: 0, overdue: false }
      if (!row.statuses.includes(status)) row.statuses.push(status)
      if (!row.dueDate || (dueDate && dueDate < row.dueDate)) row.dueDate = dueDate
      row.amount += Number(amount || 0)
      if (overdue) row.overdue = true
      rows.set(key, row)
    }
    ;(act.expiredMemberships ?? []).forEach(m => upsert(m.student_id, m.students?.name, m.students?.phone, 'Expired', m.end_date, 0, true))
    ;(act.dueToday ?? []).forEach(m => upsert(m.student_id, m.students?.name, m.students?.phone, 'Payment Due', m.due_date, m.fee_due, true))
    ;(act.expiringSoon ?? []).forEach(m => upsert(m.student_id, m.students?.name, m.students?.phone, 'Expiring This Week', m.end_date, 0, false))
    ;(act.overdueLockers ?? []).forEach(l => upsert(l.student_id, l.students?.name, l.students?.phone, 'Locker Overdue', l.locker_due_date, l.fee_due, true))
    return [...rows.entries()].map(([key, row]) => ({ key, ...row }))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
  }

  const actionableRows = buildActionableRows(actionable)
  const totalPendingDue = actionableRows.reduce((sum, r) => sum + Number(r.amount || 0), 0)

  const exportActionable = () => {
    if (!actionableRows.length) return
    const rows = actionableRows.map(r => [r.statuses.join(', '), r.name, r.phone, r.dueDate ?? '', r.amount])
    exportToCSV(`actionable-${todayISO()}.csv`, ['Status', 'Name', 'Phone', 'Date', 'Amount'], rows)
  }

  return (
    <>
      <div className="page-header">
        <h1>Daily Reports</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {isOwner && (
            <button type="button" className="btn btn-ghost" onClick={exportActionable}>Export Action Items (CSV)</button>
          )}
        </div>
      </div>

      {isOwner && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {[{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'custom', label: 'Custom' }].map(p => (
            <button
              key={p.key} type="button"
              onClick={() => setPeriod(p.key)}
              style={{
                padding: '0.4rem 1rem', borderRadius: 20, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${period === p.key ? 'var(--accent)' : '#333'}`,
                background: period === p.key ? 'rgba(255,215,0,0.1)' : '#141414',
                color: period === p.key ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {(!isOwner || period === 'day') && (
        <div className="form-group" style={{ maxWidth: 200, marginBottom: '1rem' }}>
          <label>Report Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}

      {isOwner && period === 'custom' && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>From</label>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>To</label>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      {isOwner && (period === 'week' || period === 'month') && report?.dateFrom && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Showing {formatDate(report.dateFrom)} – {formatDate(report.dateTo)}
        </p>
      )}

      {loading && <p>Loading…</p>}

      {report && (
        <>
          <div className="stats-row">
            {isOwner && (
              <div className="card stat-card">
                <div className="value" style={{ color: totalPendingDue > 0 ? '#ff8888' : undefined }}>{formatCurrency(totalPendingDue)}</div>
                <div className="label">Pending Due</div>
              </div>
            )}
          </div>

          {report.attendanceBreakdown && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>
                Attendance Breakdown — {report.dateFrom && report.dateFrom !== report.dateTo
                  ? `${formatDate(report.dateFrom)} – ${formatDate(report.dateTo)}`
                  : formatDate(report.date ?? date)}
              </h3>
              <div className="stats-row" style={{ marginBottom: 0 }}>
                <div className="card stat-card">
                  <div className="value">{report.attendanceBreakdown.total}</div>
                  <div className="label">Total Attendance</div>
                </div>
                <div className="card stat-card">
                  <div className="value">{report.walkins?.length ?? 0}</div>
                  <div className="label">Walk-ins</div>
                </div>
                <div className="card stat-card">
                  <div className="value">{report.newMembers?.length ?? 0}</div>
                  <div className="label">New Memberships</div>
                </div>
                <div className="card stat-card">
                  <div className="value">{report.attendanceBreakdown.temporary}</div>
                  <div className="label">Temporary</div>
                </div>
                <div className="card stat-card">
                  <div className="value">{report.attendanceBreakdown.permanent}</div>
                  <div className="label">Permanent</div>
                </div>
              </div>
            </div>
          )}

          {(report.attendanceTrend?.length > 0 || report.registrationsTrend?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              {report.attendanceTrend?.length > 0 && (
                <div className="card chart-card">
                  <p style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em', marginBottom: '1.25rem', textTransform: 'uppercase' }}>
                    Attendance Trend
                  </p>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={report.attendanceTrend} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="attendanceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#292929" vertical={false} />
                      <XAxis dataKey="label" tickFormatter={formatDateTick} tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                      <YAxis allowDecimals={false} tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                      <Tooltip content={chartTooltip({ formatLabel: formatDateTick, formatValue: (v) => `${v} students` })} />
                      <Area
                        type="monotone" dataKey="count"
                        stroke="var(--accent)" strokeWidth={2.5} fill="url(#attendanceGrad)"
                        dot={false} activeDot={{ r: 5, fill: 'var(--accent)', stroke: '#111', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {report.registrationsTrend?.length > 0 && (
                <div className="card chart-card">
                  <p style={{ color: '#4ade80', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em', marginBottom: '1.25rem', textTransform: 'uppercase' }}>
                    New Membership Registrations Trend
                  </p>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={report.registrationsTrend} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="registrationsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4ade80" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#292929" vertical={false} />
                      <XAxis dataKey="label" tickFormatter={formatDateTick} tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                      <YAxis allowDecimals={false} tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                      <Tooltip content={chartTooltip({ formatLabel: formatDateTick, formatValue: (v) => `${v} new memberships` })} />
                      <Area
                        type="monotone" dataKey="count"
                        stroke="#4ade80" strokeWidth={2.5} fill="url(#registrationsGrad)"
                        dot={false} activeDot={{ r: 5, fill: '#4ade80', stroke: '#111', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

        </>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ color: 'var(--accent)' }}>Tasks Completed — {formatDate(date)}</h3>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h3 style={{ color: 'var(--accent)' }}>Actionable Items (Today)</h3>
            {totalPendingDue > 0 && (
              <span className="mono" style={{ color: '#ff8888', fontWeight: 700, fontSize: '0.95rem' }}>
                Total Pending Due: {formatCurrency(totalPendingDue)}
              </span>
            )}
          </div>
          {actionableRows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>All clear — no urgent follow-ups.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Status</th><th>Student</th><th>Phone</th><th>Since / Due</th><th>Amount</th></tr></thead>
              <tbody>
                {actionableRows.map(r => (
                  <tr key={r.key} className={r.overdue ? 'row-overdue' : ''}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {r.statuses.map(s => (
                          <span key={s} style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                            background: s === 'Expiring This Week' ? 'rgba(255,150,0,0.15)' : 'rgba(255,70,70,0.15)',
                            color: s === 'Expiring This Week' ? '#ffaa44' : '#ff8888',
                          }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{r.name}</td>
                    <td className="mono">{r.phone}</td>
                    <td className="mono">{r.dueDate ? formatDate(r.dueDate) : '—'}</td>
                    <td className="mono">{r.amount > 0 ? formatCurrency(r.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(!isOwner || period === 'day') && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>
            Recent Activity — {formatDate(date)}
          </h3>
          {recentActivity.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No recent activity.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Date</th><th>Student</th><th>Activity</th><th>Status / Mode</th><th>Amount</th></tr></thead>
              <tbody>
                {recentActivity.map(a => (
                  <tr key={a.id}>
                    <td className="mono">{formatDateTime(a.time)}</td>
                    <td>{a.studentName ?? '-'} {a.studentPhone && <span className="mono" style={{ color: 'var(--text-muted)' }}>({a.studentPhone})</span>}</td>
                    <td className="cap">{describeActivity(a)}</td>
                    <td className="cap">{a.status ?? '-'}</td>
                    <td className="mono">{a.amount != null ? formatCurrency(a.amount) : '-'}</td>
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
