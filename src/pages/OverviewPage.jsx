import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatCurrency } from '../lib/utils'

// PSS-AI Phase 6, O10 — one owner, every branch: one row per branch plus totals, read from the
// same tables as each branch's own screens. One Approvals queue and one brief already cover every
// branch; this page links to them.
const COLS = [
  ['checkedIn', 'In now'], ['freeSeats', 'Free seats'], ['collectedToday', 'Collected today', true], ['collectedMonth', 'This month', true],
  ['dues', 'Dues', true], ['endingThisWeek', 'Plans ending (7 days)'], ['approvals', 'Approvals'], ['tickets', 'Problems'], ['foodOrders', 'Food orders'],
]

export default function OverviewPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api('get_owner_overview').then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])
  const cell = (v, money) => (money ? formatCurrency(v) : v)
  return (
    <>
      <div className="page-header"><h1>Every branch</h1></div>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {!data ? (!error && <p>Loading…</p>) : !data.on ? <p style={{ color: 'var(--text-muted)' }}>This page is switched off (pssai_owner_overview).</p> : (
        <div className="card" data-testid="overview">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Branch</th>{COLS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
              <tbody>
                {data.branches.map((b) => (
                  <tr key={b.id} data-testid="overview-row"><td><strong>{b.name}</strong></td>{COLS.map(([k, , money]) => <td key={k} className="mono">{cell(b[k], money)}{k === 'freeSeats' ? ` / ${b.seats}` : ''}</td>)}</tr>
                ))}
                <tr data-testid="overview-total"><td><strong>All branches</strong></td>{COLS.map(([k, , money]) => <td key={k} className="mono"><strong>{cell(data.totals[k], money)}</strong></td>)}</tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 0 }}>
            Collections are every payment recorded (refunds are listed on Revenue). Updated every minute. One queue for all branches: <Link to="/approvals">Approvals</Link>.
          </p>
        </div>
      )}
    </>
  )
}
