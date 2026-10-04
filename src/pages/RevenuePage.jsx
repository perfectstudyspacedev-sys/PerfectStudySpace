import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, todayISO, exportToCSV, paymentModeLabel, formatDateTime, formatDate } from '../lib/utils'
import { chartTooltip } from '../components/ChartTooltip'

const COLORS = ['#FFD700', '#22d3ee', '#a78bfa', '#4ade80', '#f97316', '#77aef8', '#f472b6']
// 'fine' is the only transaction category no automated flow writes, so add_manual_payment
// uses it for every manually recorded payment (the reason lives in the row's notes) —
// "Fine" was the wrong name for what these rows actually are.
const CAT_LABELS = { desk: 'Walk-in', membership: 'Membership', food: 'Food', locker: 'Locker', overtime: 'Overtime', fine: 'Manual Entry' }
// Non-transaction rows the All Transactions feed can also be filtered to (cashbacks table
// and the payouts ledger) — values must match list_transactions' category handling.
const EXTRA_FILTERS = [
  { value: 'cashback', label: 'Cashback' },
  { value: 'membership_refund', label: 'Membership Refunds' },
  { value: 'locker_deposit', label: 'Locker Deposit Refunds' },
  { value: 'food_pass_refund', label: 'Food Pass Refunds' },
]
const ENTRY_TYPE_LABELS = { income: 'Income', payout: 'Payout', info: 'Info only' }
const REFERRAL_LABELS = {
  google_search: 'Google Search', instagram: 'Social Media', word_of_mouth: 'Word of Mouth',
  flex: 'Flex (Banner/Hoarding)', ai_platform: 'Claude/ChatGPT/AI Platforms', unknown: 'Not Recorded',
}
const TX_PAGE_SIZE = 200

const TOOLTIP_STYLE = {
  contentStyle: { background: '#111', border: '1px solid #333', borderRadius: 6 },
  labelStyle: { color: '#fff', fontWeight: 700, marginBottom: 4 },
  itemStyle: { color: '#fff' },
}

const SECTION_HEADING = { color: 'var(--accent)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em', marginBottom: '1.25rem', textTransform: 'uppercase' }
const MUTED_NOTE = { color: 'var(--text-muted)', fontSize: '0.82rem' }

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

// Axis ticks — the old `₹${v/1000}k` rounded every tick under ₹500 to "₹0k" and turned a
// ₹1,500 step into "₹2k", so small days and in-between gridlines all read wrong.
function compactRupees(v) {
  const trim = (n) => n.toFixed(1).replace(/\.0$/, '')
  if (Math.abs(v) >= 100000) return `₹${trim(v / 100000)}L`
  if (Math.abs(v) >= 1000) return `₹${trim(v / 1000)}k`
  return `₹${v}`
}

// Spreadsheet-friendly local timestamp for the CSV ("2026-10-04 15:45").
function csvDateTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// formatCurrency(-500) renders "₹-500"; refunds and payouts read as "-₹500".
function formatSignedCurrency(n) {
  return Number(n) < 0 ? `-${formatCurrency(-Number(n))}` : formatCurrency(n)
}

function categoryLabel(t) {
  return CAT_LABELS[t.category] ?? t.category
}

function EmptyChart({ children }) {
  return (
    <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', ...MUTED_NOTE }}>
      {children}
    </div>
  )
}

export default function RevenuePage() {
  const { branchId, isOwner, isCombinedHall } = useAuth()
  const [period, setPeriod] = useState('today')
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  // The range last confirmed with Apply. Editing the date inputs no longer refetches (or
  // silently snaps the page back to today) until Apply is pressed again.
  const [appliedRange, setAppliedRange] = useState(null)
  const [allBranches, setAllBranches] = useState(false)
  // Combined Hall has no single real branch to fall back to — the existing "All branches"
  // mode (get_revenue etc. already ignore branchId entirely when this is true) is forced on
  // rather than building a second combined view; the manual toggle is just hidden below.
  const effectiveAllBranches = isCombinedHall || allBranches
  const consolidated = isOwner && effectiveAllBranches
  const hasScope = !!branchId || isCombinedHall

  const [revenue, setRevenue] = useState(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [revenueError, setRevenueError] = useState('')
  const [referralStats, setReferralStats] = useState(null)
  const [referralError, setReferralError] = useState('')
  const [transactions, setTransactions] = useState([])
  const [txLoading, setTxLoading] = useState(false)
  const [txError, setTxError] = useState('')
  const [txVisible, setTxVisible] = useState(TX_PAGE_SIZE)
  const [tab, setTab] = useState('overview')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Each loader stamps its request; a response is only applied if no newer request for the
  // same data has started since. Without this, quickly switching period/branch (or typing
  // in search) let a slow earlier response land last and overwrite the newer one.
  const revenueReq = useRef(0)
  const referralReq = useRef(0)
  const txReq = useRef(0)

  // Custom with nothing applied yet shows today's figures (as the hint below says).
  const queryPeriod = period === 'custom' ? (appliedRange ? undefined : 'today') : period
  const queryFrom = period === 'custom' && appliedRange ? appliedRange.from : undefined
  const queryTo = period === 'custom' && appliedRange ? appliedRange.to : undefined

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const loadRevenue = useCallback(async () => {
    if (!hasScope) return
    const reqId = ++revenueReq.current
    setRevenueLoading(true)
    setRevenueError('')
    try {
      const data = await api('get_revenue', {
        branchId, period: queryPeriod, dateFrom: queryFrom, dateTo: queryTo, allBranches: consolidated,
      })
      if (reqId === revenueReq.current) setRevenue(data)
    } catch (e) {
      if (reqId === revenueReq.current) {
        // Never leave the previous period's figures on screen under the new selection.
        setRevenue(null)
        setRevenueError(e.message || 'Could not load revenue')
      }
    } finally {
      if (reqId === revenueReq.current) setRevenueLoading(false)
    }
  }, [hasScope, branchId, queryPeriod, queryFrom, queryTo, consolidated])

  const loadReferralStats = useCallback(async () => {
    if (!hasScope) return
    const reqId = ++referralReq.current
    setReferralError('')
    try {
      const data = await api('get_referral_stats', { branchId, allBranches: consolidated })
      if (reqId === referralReq.current) setReferralStats(data)
    } catch (e) {
      if (reqId === referralReq.current) {
        setReferralStats(null)
        setReferralError(e.message || 'Could not load referral sources')
      }
    }
  }, [hasScope, branchId, consolidated])

  const loadTransactions = useCallback(async () => {
    if (!hasScope) return
    const reqId = ++txReq.current
    setTxLoading(true)
    setTxError('')
    try {
      const data = await api('list_transactions', {
        branchId, period: queryPeriod, dateFrom: queryFrom, dateTo: queryTo,
        category: categoryFilter || undefined, search: search || undefined,
        allBranches: consolidated,
      })
      if (reqId === txReq.current) {
        setTransactions(data.transactions ?? [])
        setTxVisible(TX_PAGE_SIZE)
      }
    } catch (e) {
      if (reqId === txReq.current) {
        setTransactions([])
        setTxError(e.message || 'Could not load transactions')
      }
    } finally {
      if (reqId === txReq.current) setTxLoading(false)
    }
  }, [hasScope, branchId, queryPeriod, queryFrom, queryTo, categoryFilter, search, consolidated])

  useEffect(() => { loadRevenue() }, [loadRevenue])
  useEffect(() => { loadReferralStats() }, [loadReferralStats])
  useEffect(() => { if (tab === 'transactions') loadTransactions() }, [tab, loadTransactions])

  const referralPieData = referralStats
    ? referralStats.rows.map(r => ({ name: REFERRAL_LABELS[r.source] ?? r.source, value: r.count }))
    : []

  const pieData = revenue ? Object.entries(revenue.byCategory).filter(([, v]) => v > 0).map(([k, v]) => ({
    name: CAT_LABELS[k] ?? k, value: v,
  })) : []

  const modeData = revenue ? Object.entries(revenue.byPaymentMode).filter(([, v]) => v > 0).map(([k, v]) => ({
    name: paymentModeLabel(k), value: v,
  })) : []

  // Manual entries are rare, so their card only appears once there's something in it — but
  // when there is, it must show: the gross total above already includes it, and hiding the
  // card left the category cards not adding up to Gross Revenue.
  const categoryCards = revenue
    ? Object.entries(revenue.byCategory).filter(([k, v]) => k !== 'fine' || v > 0)
    : []

  const collected = transactions.filter(t => t.entry_type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0)
  const paidOut = transactions.filter(t => t.entry_type === 'payout').reduce((s, t) => s - Number(t.amount || 0), 0)

  const handleExportTx = () => {
    const rangeTag = revenue ? (revenue.dateFrom === revenue.dateTo ? revenue.dateFrom : `${revenue.dateFrom}_to_${revenue.dateTo}`) : todayISO()
    exportToCSV(`transactions_${rangeTag}.csv`,
      ['Date', 'Student', 'Phone', 'Category', 'Type', 'Amount', 'Mode', 'Branch', 'Notes'],
      transactions.map(t => [
        csvDateTime(t.created_at),
        t.students?.name ?? '',
        t.students?.phone ?? '',
        categoryLabel(t),
        ENTRY_TYPE_LABELS[t.entry_type] ?? '',
        t.amount ?? '',
        t.payment_mode ? paymentModeLabel(t.payment_mode) : '',
        t.branches?.name ?? '',
        t.notes ?? '',
      ]),
    )
  }

  // A reversed range returns nothing from the server (created_at can't be >= from and <= to
  // when from > to), which looked identical to "no revenue in this period" — call it out
  // instead of letting an empty page imply zero earnings.
  const customRangeInvalid = period === 'custom' && customFrom > customTo
  const customPending = period === 'custom' && (!appliedRange || appliedRange.from !== customFrom || appliedRange.to !== customTo)

  const periodLabel = period === 'week' ? 'LAST 7 DAYS' : period === 'month' ? 'THIS MONTH' : period === 'today' ? 'TODAY'
    : appliedRange ? `${formatDate(appliedRange.from)} → ${formatDate(appliedRange.to)}` : 'TODAY'

  const showTrend = revenue?.trend?.length > 1
  const rangeText = revenue
    ? (revenue.dateFrom === revenue.dateTo ? formatDate(revenue.dateFrom) : `${formatDate(revenue.dateFrom)} – ${formatDate(revenue.dateTo)}`)
    : null

  return (
    <>
      <div className="page-header">
        <h1>Revenue & Reporting</h1>
        {isCombinedHall ? (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>🏢 All branches (Combined Hall)</span>
        ) : isOwner && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} />
            All branches (consolidated)
          </label>
        )}
      </div>

      <div className="period-toggle" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {['today', 'week', 'month', 'custom'].map(p => (
          <button key={p} type="button" className={period === p ? 'active' : ''} onClick={() => { setPeriod(p); setAppliedRange(null) }}>
            {p === 'week' ? 'Last 7 Days' : p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" aria-label="From date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" aria-label="To date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
            <button
              type="button"
              className={customPending ? 'btn' : 'btn btn-ghost'}
              disabled={customRangeInvalid || !customPending || !customFrom || !customTo}
              onClick={() => setAppliedRange({ from: customFrom, to: customTo })}
            >
              {customPending ? 'Apply' : 'Applied'}
            </button>
          </>
        )}
      </div>

      {customRangeInvalid && (
        <p className="error-msg" style={{ marginBottom: '1rem' }}>
          "From" date is after "To" date — swap them to see results.
        </p>
      )}
      {period === 'custom' && !appliedRange && !customRangeInvalid && (
        <p style={{ ...MUTED_NOTE, marginBottom: '1rem' }}>
          Showing today's figures — pick a date range above and hit Apply.
        </p>
      )}
      {period === 'custom' && appliedRange && customPending && !customRangeInvalid && (
        <p style={{ ...MUTED_NOTE, marginBottom: '1rem' }}>
          Dates changed — hit Apply to update. Still showing {formatDate(appliedRange.from)} – {formatDate(appliedRange.to)}.
        </p>
      )}
      {rangeText && (
        <p style={{ ...MUTED_NOTE, marginBottom: '1rem' }}>
          Showing {rangeText}{consolidated ? ' · all branches' : ''}{revenueLoading ? ' · updating…' : ''}
        </p>
      )}

      <div className="tabs">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}>All Transactions</button>
      </div>

      {tab === 'overview' && revenueError && (
        <p className="error-msg" style={{ marginBottom: '1rem' }}>
          Couldn't load revenue: {revenueError}{' '}
          <button type="button" className="btn btn-ghost" onClick={loadRevenue}>Retry</button>
        </p>
      )}
      {tab === 'overview' && !revenue && !revenueError && (
        <p style={MUTED_NOTE}>{hasScope ? 'Loading revenue…' : 'Select a branch to see revenue.'}</p>
      )}

      {tab === 'overview' && revenue && (
        <div style={{ opacity: revenueLoading ? 0.55 : 1, transition: 'opacity 0.15s' }} aria-busy={revenueLoading}>
          {/* Stat cards — gross/surrendered/net on their own row, category breakdown below */}
          <div className="stats-row">
            <div className="card stat-card">
              <div className="value">{formatCurrency(revenue.total)}</div>
              <div className="label">Gross Revenue</div>
            </div>
            {revenue.totalPayouts > 0 && (
              <div className="card stat-card">
                <div className="value" style={{ color: '#ff8888' }}>{formatCurrency(revenue.totalPayouts)}</div>
                <div className="label">Surrendered to Students</div>
              </div>
            )}
            {revenue.totalPayouts > 0 && (
              <div className="card stat-card">
                <div className="value" style={{ color: revenue.netRevenue < 0 ? '#ff8888' : '#4ade80' }}>{formatSignedCurrency(revenue.netRevenue)}</div>
                <div className="label">Net Revenue</div>
              </div>
            )}
          </div>

          <div className="stats-row">
            {categoryCards.map(([k, v]) => (
              <div key={k} className="card stat-card">
                <div className="value" style={{ fontSize: '1.25rem' }}>{formatCurrency(v)}</div>
                <div className="label">{CAT_LABELS[k] ?? k}</div>
              </div>
            ))}
          </div>

          {revenue.totalPayouts > 0 && (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Surrendered to Students</h3>
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                {revenue.payouts.cashback > 0 && (
                  <p className="mono" style={{ fontSize: '1.02rem' }}>🎁 Cashback: <strong style={{ color: '#ff8888' }}>{formatCurrency(revenue.payouts.cashback)}</strong></p>
                )}
                {revenue.payouts.locker_deposit > 0 && (
                  <p className="mono" style={{ fontSize: '1.02rem' }}>🔑 Locker Deposits: <strong style={{ color: '#ff8888' }}>{formatCurrency(revenue.payouts.locker_deposit)}</strong></p>
                )}
                {revenue.payouts.food_pass_refund > 0 && (
                  <p className="mono" style={{ fontSize: '1.02rem' }}>🎫 Food Pass Refunds: <strong style={{ color: '#ff8888' }}>{formatCurrency(revenue.payouts.food_pass_refund)}</strong></p>
                )}
                {revenue.payouts.membership_refund > 0 && (
                  <p className="mono" style={{ fontSize: '1.02rem' }}>🗑️ Membership Refunds: <strong style={{ color: '#ff8888' }}>{formatCurrency(revenue.payouts.membership_refund)}</strong></p>
                )}
              </div>
            </div>
          )}

          {/* Pie charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1rem' }}>
            <div className="card chart-card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Revenue by Category</h3>
              {pieData.length === 0 ? <EmptyChart>No revenue in this period.</EmptyChart> : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} labelLine={false} label={PieLabel}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} {...TOOLTIP_STYLE} />
                    <Legend formatter={(name) => <span style={{ color: 'var(--text)', fontSize: '0.82rem' }}>{name}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card chart-card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Payment Channel Split</h3>
              {modeData.length === 0 ? <EmptyChart>No payments in this period.</EmptyChart> : (
                <>
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
                      <span key={entry.name} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length], display: 'inline-block' }} />
                        {entry.name}: <strong style={{ color: 'var(--text)' }}>{formatCurrency(entry.value)}</strong>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Day-on-day revenue — every day in the range, ₹0 days included */}
          {showTrend && (
            <div className="card chart-card" style={{ marginTop: '1rem' }}>
              <p style={SECTION_HEADING}>Daily Revenue — {periodLabel}</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={revenue.trend} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#292929" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateTick}
                    tick={{ fill: '#666', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    tickFormatter={compactRupees}
                    tick={{ fill: '#666', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    allowDecimals={false}
                  />
                  <Tooltip content={chartTooltip({ formatLabel: formatDateTick, formatValue: formatCurrency })} />
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
              <p style={SECTION_HEADING}>Branch Performance (Gross) — {periodLabel}</p>
              <ResponsiveContainer width="100%" height={Math.max(160, revenue.byBranch.length * 44)}>
                <BarChart data={revenue.byBranch} layout="vertical" margin={{ left: 16, right: 24, top: 4, bottom: 4 }}>
                  <XAxis
                    type="number"
                    tickFormatter={compactRupees}
                    tick={{ fill: '#666', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
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
                    {revenue.byBranch.map((b, i) => (
                      <Cell key={b.name} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Rank labels */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem', paddingLeft: 4 }}>
                {revenue.byBranch.map((b, i) => (
                  <span key={b.name} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-muted)' }}>#{i + 1}</span>
                    <strong style={{ color: 'var(--text)' }}>{b.name}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{formatCurrency(b.amount)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* How did you hear about us — all-time, not tied to the period picker above */}
          {referralError && (
            <p className="error-msg" style={{ marginTop: '1rem' }}>Couldn't load referral sources: {referralError}</p>
          )}
          {referralStats?.rows?.length > 0 && (
            <div className="card chart-card" style={{ marginTop: '1rem' }}>
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.25rem' }}>How Did You Hear About Us</h3>
              <p style={{ ...MUTED_NOTE, marginBottom: '1rem' }}>
                All time{consolidated ? ', all branches' : ''} — not affected by the date range above.
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={referralPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} labelLine={false} label={PieLabel}>
                    {referralPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${v} student${v === 1 ? '' : 's'}`} {...TOOLTIP_STYLE} />
                  <Legend formatter={(name) => <span style={{ color: 'var(--text)', fontSize: '0.82rem' }}>{name}</span>} />
                </PieChart>
              </ResponsiveContainer>

              <table className="data-table" style={{ marginTop: '1rem' }}>
                <thead>
                  <tr><th>Source</th><th>Students</th><th>Share</th></tr>
                </thead>
                <tbody>
                  {referralStats.rows.map(r => (
                    <tr key={r.source}>
                      <td>{REFERRAL_LABELS[r.source] ?? r.source}</td>
                      <td className="mono">{r.count}</td>
                      <td className="mono">{r.percent}%</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{referralStats.total}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>100%</td>
                  </tr>
                </tbody>
              </table>
              {referralStats.notRecorded > 0 && (
                <p style={{ ...MUTED_NOTE, marginTop: '0.75rem' }}>
                  {referralStats.notRecorded} more student{referralStats.notRecorded === 1 ? ' has' : 's have'} no source recorded and {referralStats.notRecorded === 1 ? "isn't" : "aren't"} counted above.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'transactions' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div className="filters">
            <input placeholder="Search name or phone…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              {EXTRA_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <button type="button" className="btn btn-ghost" onClick={handleExportTx} disabled={txLoading || transactions.length === 0}>Export CSV</button>
          </div>

          {txError && (
            <p className="error-msg" style={{ marginBottom: '1rem' }}>
              Couldn't load transactions: {txError}{' '}
              <button type="button" className="btn btn-ghost" onClick={loadTransactions}>Retry</button>
            </p>
          )}
          {!txError && (
            <p style={{ ...MUTED_NOTE, marginBottom: '0.75rem' }}>
              {txLoading ? 'Loading…' : (
                <>
                  {transactions.length} entr{transactions.length === 1 ? 'y' : 'ies'} · Collected <strong style={{ color: 'var(--text)' }}>{formatCurrency(collected)}</strong>
                  {paidOut > 0 && <> · Paid out <strong style={{ color: '#ff8888' }}>{formatCurrency(paidOut)}</strong></>}
                </>
              )}
            </p>
          )}

          <table className="data-table" style={{ opacity: txLoading ? 0.55 : 1 }}>
            <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Amount</th><th>Mode</th><th>Branch</th></tr></thead>
            <tbody>
              {!txLoading && !txError && transactions.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  No transactions in this period{search || categoryFilter ? ' matching these filters' : ''}.
                </td></tr>
              )}
              {transactions.slice(0, txVisible).map(t => (
                <tr key={t.id}>
                  <td className="mono">{formatDateTime(t.created_at)}</td>
                  <td>{t.students?.name ?? '-'} {t.students?.phone && <span className="mono" style={{ color: 'var(--text-muted)' }}>({t.students.phone})</span>}</td>
                  <td>
                    <span className={CAT_LABELS[t.category] ? undefined : 'cap'}>{categoryLabel(t)}</span>
                    {t.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.notes}</div>}
                  </td>
                  <td
                    className="mono"
                    title={t.entry_type === 'info' ? 'For information — no money changed hands in this entry' : undefined}
                    style={t.amount < 0 ? { color: '#ff8888' } : t.entry_type === 'info' ? { color: 'var(--text-muted)' } : undefined}
                  >
                    {t.amount != null ? formatSignedCurrency(t.amount) : '-'}
                  </td>
                  <td>{t.payment_mode ? paymentModeLabel(t.payment_mode) : '-'}</td>
                  <td>{t.branches?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {transactions.length > txVisible && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setTxVisible(v => v + TX_PAGE_SIZE)}>
                Show more ({transactions.length - txVisible} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
