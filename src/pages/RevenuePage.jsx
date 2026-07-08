import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, todayISO, exportToCSV, paymentModeLabel, formatDateTime } from '../lib/utils'

const COLORS = ['#FFD700', '#22d3ee', '#a78bfa', '#4ade80', '#f97316']
const CAT_LABELS = { desk: 'Walk-in', membership: 'Membership', food: 'Food', locker: 'Locker', fine: 'Fine' }

const TOOLTIP_STYLE = {
  contentStyle: { background: '#111', border: '1px solid #333', borderRadius: 6 },
  labelStyle: { color: '#fff', fontWeight: 700, marginBottom: 4 },
  itemStyle: { color: '#fff' },
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.04) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#000" textAnchor="middle" dominantBaseline="central"
      fontSize={12} fontWeight={700} style={{ pointerEvents: 'none' }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

function formatDateTick(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function RevenuePage() {
  const { branchId, isOwner, branches } = useAuth()
  const [period, setPeriod] = useState('today')
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  const [customApplied, setCustomApplied] = useState(false)
  const [allBranches, setAllBranches] = useState(false)
  const [revenue, setRevenue] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [tab, setTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const loadRevenue = useCallback(async () => {
    const payload = {
      branchId,
      period: period === 'custom' && customApplied ? undefined : period,
      dateFrom: period === 'custom' && customApplied ? customFrom : undefined,
      dateTo: period === 'custom' && customApplied ? customTo : undefined,
      allBranches: isOwner && allBranches,
    }
    const data = await api('get_revenue', payload)
    setRevenue(data)
  }, [branchId, period, customFrom, customTo, customApplied, allBranches, isOwner])

  const loadTransactions = useCallback(async () => {
    const data = await api('list_transactions', {
      branchId, period, category: categoryFilter || undefined, search: search || undefined,
    })
    setTransactions(data.transactions ?? [])
  }, [branchId, period, categoryFilter, search])

  useEffect(() => { loadRevenue() }, [loadRevenue])
  useEffect(() => { if (tab === 'transactions') loadTransactions() }, [tab, loadTransactions])

  const pieData = revenue ? Object.entries(revenue.byCategory).filter(([, v]) => v > 0).map(([k, v]) => ({
    name: CAT_LABELS[k] ?? k, value: v,
  })) : []

  const modeData = revenue ? Object.entries(revenue.byPaymentMode).filter(([, v]) => v > 0).map(([k, v]) => ({
    name: k.charAt(0).toUpperCase() + k.slice(1), value: v,
  })) : []

  const handleExportTx = () => {
    exportToCSV('transactions.csv',
      ['Date', 'Student', 'Category', 'Amount', 'Mode'],
      transactions.map(t => [
        new Date(t.created_at).toLocaleDateString('en-IN'),
        t.students?.name ?? '-',
        t.category,
        t.amount,
        t.payment_mode,
      ]),
    )
  }

  const periodLabel = period === 'week' ? 'LAST 7 DAYS' : period === 'month' ? 'LAST 30 DAYS' : period === 'today' ? 'TODAY' : 'CUSTOM RANGE'

  return (
    <>
      <div className="page-header">
        <h1>Revenue & Reporting</h1>
        {isOwner && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} />
            All branches (consolidated)
          </label>
        )}
      </div>

      <div className="period-toggle" style={{ marginBottom: '1rem' }}>
        {['today', 'week', 'month', 'custom'].map(p => (
          <button key={p} type="button" className={period === p ? 'active' : ''} onClick={() => { setPeriod(p); setCustomApplied(false) }}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            <button type="button" className="btn btn-ghost" onClick={() => setCustomApplied(true)}>Apply</button>
          </>
        )}
      </div>

      <div className="tabs">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}>All Transactions</button>
      </div>

      {tab === 'overview' && revenue && (
        <>
          {/* Stat cards */}
          <div className="stats-row">
            <div className="card stat-card">
              <div className="value">{formatCurrency(revenue.total)}</div>
              <div className="label">Total Revenue</div>
            </div>
            {Object.entries(revenue.byCategory).filter(([k]) => k !== 'fine').map(([k, v]) => (
              <div key={k} className="card stat-card">
                <div className="value" style={{ fontSize: '1.25rem' }}>{formatCurrency(v)}</div>
                <div className="label">{CAT_LABELS[k] ?? k}</div>
              </div>
            ))}
          </div>

          {/* Pie charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <div className="card chart-card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Revenue by Category</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} labelLine={false} label={PieLabel}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} {...TOOLTIP_STYLE} />
                  <Legend formatter={(name) => <span style={{ color: 'var(--text)', fontSize: '0.82rem' }}>{name}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card chart-card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Payment Channel Split</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={modeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} labelLine={false} label={PieLabel}>
                    {modeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} {...TOOLTIP_STYLE} />
                  <Legend formatter={(name) => <span style={{ color: 'var(--text)', fontSize: '0.82rem' }}>{name}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                {modeData.map((entry, i) => (
                  <span key={i} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length], display: 'inline-block' }} />
                    {entry.name}: <strong style={{ color: 'var(--text)' }}>{formatCurrency(entry.value)}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Day-on-day revenue — area chart styled like enquiry chart */}
          {revenue.trend?.length > 0 && (
            <div className="card chart-card" style={{ marginTop: '1rem' }}>
              <p style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em', marginBottom: '1.25rem', textTransform: 'uppercase' }}>
                Daily Revenue — {periodLabel}
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={revenue.trend} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateTick}
                    tick={{ fill: '#666', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    tick={{ fill: '#666', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    formatter={(v) => [formatCurrency(v), 'Revenue']}
                    labelFormatter={formatDateTick}
                    {...TOOLTIP_STYLE}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="var(--accent)"
                    strokeWidth={2.5}
                    fill="url(#revenueGrad)"
                    dot={false}
                    activeDot={{ r: 5, fill: 'var(--accent)', stroke: '#111', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Branch performance chart — only when multiple branches have data */}
          {revenue.byBranch?.length > 1 && (
            <div className="card chart-card" style={{ marginTop: '1rem' }}>
              <p style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em', marginBottom: '1.25rem', textTransform: 'uppercase' }}>
                Branch Performance — {periodLabel}
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenue.byBranch} layout="vertical" margin={{ left: 16, right: 24, top: 4, bottom: 4 }}>
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    tick={{ fill: '#666', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#ccc', fontSize: 12, fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={90}
                  />
                  <Tooltip
                    formatter={(v) => [formatCurrency(v), 'Revenue']}
                    {...TOOLTIP_STYLE}
                  />
                  <Bar dataKey="amount" radius={[0, 6, 6, 0]} barSize={28}>
                    {revenue.byBranch.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Rank labels */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem', paddingLeft: 4 }}>
                {revenue.byBranch.map((b, i) => (
                  <span key={i} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-muted)' }}>#{i + 1}</span>
                    <strong style={{ color: 'var(--text)' }}>{b.name}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{formatCurrency(b.amount)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'transactions' && (
        <div className="card">
          <div className="filters">
            <input placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button type="button" className="btn btn-ghost" onClick={handleExportTx}>Export CSV</button>
          </div>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Amount</th><th>Mode</th><th>Branch</th></tr></thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id}>
                  <td className="mono">{formatDateTime(t.created_at)}</td>
                  <td>{t.students?.name ?? '-'} {t.students?.phone && <span className="mono" style={{ color: 'var(--text-muted)' }}>({t.students.phone})</span>}</td>
                  <td className={CAT_LABELS[t.category] ? undefined : 'cap'}>{CAT_LABELS[t.category] ?? t.category}</td>
                  <td className="mono">{formatCurrency(t.amount)}</td>
                  <td>{paymentModeLabel(t.payment_mode)}</td>
                  <td>{t.branches?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
