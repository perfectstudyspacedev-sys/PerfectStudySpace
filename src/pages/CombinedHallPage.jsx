import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { todayISO } from '../lib/utils'

export default function CombinedHallPage() {
  const [tab, setTab] = useState('overview')
  const [hall, setHall] = useState(null)
  const [seatMap, setSeatMap] = useState(null)
  const [pending, setPending] = useState(null)
  const [pendingDate, setPendingDate] = useState(todayISO())
  const [loading, setLoading] = useState(true)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api('get_combined_hall')
      setHall(data)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSeatMap = useCallback(async () => {
    const data = await api('get_combined_seatmap')
    setSeatMap(data)
  }, [])

  const loadPending = useCallback(async () => {
    const data = await api('get_combined_pending', { date: pendingDate })
    setPending(data)
  }, [pendingDate])

  useEffect(() => { loadOverview() }, [loadOverview])
  useEffect(() => { if (tab === 'seatmap') loadSeatMap() }, [tab, loadSeatMap])
  useEffect(() => { if (tab === 'pending') loadPending() }, [tab, loadPending])

  return (
    <>
      <div className="page-header"><h1>Combined Hall</h1></div>
      <div className="tabs">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'seatmap' ? 'active' : ''} onClick={() => setTab('seatmap')}>Seat Map</button>
        <button type="button" className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending Tracking</button>
      </div>

      {tab === 'overview' && (
        loading ? <p>Loading…</p> : hall && (
          <>
            <div className="stats-row">
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.currentlyStudying}</div>
                <div className="label">Currently Studying (All Branches)</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.activeMemberships}</div>
                <div className="label">Active Memberships</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.permanentDesks}</div>
                <div className="label">Permanent Desks Occupied</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.freeDesks}</div>
                <div className="label">Free Desks</div>
              </div>
              <div className="card stat-card">
                <div className="value count-up">{hall.totals.pending}</div>
                <div className="label">Payment Pending</div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>By Branch</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Branch</th><th>Studying</th><th>Active Members</th><th>Temp</th><th>Perm</th>
                    <th>Free Desks</th><th>Permanent Desks</th><th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {hall.branches.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td className="mono">{b.currentlyStudying}</td>
                      <td className="mono">{b.activeMemberships}</td>
                      <td className="mono">{b.temporary}</td>
                      <td className="mono">{b.permanent}</td>
                      <td className="mono">{b.freeDesks}</td>
                      <td className="mono">{b.permanentDesks}</td>
                      <td className="mono" style={{ color: b.pending > 0 ? '#ff8c42' : undefined }}>{b.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {tab === 'seatmap' && (
        !seatMap ? <p>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {seatMap.branches.map(b => (
              <div key={b.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ color: 'var(--accent)' }}>{b.name}</h3>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--accent)' }}>{b.summary.free}</strong> Free ·{' '}
                    <strong style={{ color: '#a0a0a0' }}>{b.summary.permanent}</strong> Permanent ·{' '}
                    {b.summary.total} Total
                  </span>
                </div>
                <div className="seat-map" style={{ marginTop: '0.75rem' }}>
                  {b.desks.map(desk => (
                    <div key={desk.id} className={`seat-cell ${desk.status}`} style={{ cursor: 'default' }}>
                      {desk.label}
                      {desk.status === 'reserved' && desk.students?.name && (
                        <span className="seat-tooltip">{desk.students.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'pending' && (
        <>
          <div className="form-group" style={{ maxWidth: 200, marginBottom: '1rem' }}>
            <label>Date</label>
            <input type="date" value={pendingDate} onChange={(e) => setPendingDate(e.target.value)} />
          </div>
          {!pending ? <p>Loading…</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem' }}>
              <div className="card">
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Payments Due On/Before {pending.date}</h3>
                {pending.duePayments.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No pending payments.</p>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Branch</th><th>Student</th><th>Due Date</th><th>Amount</th></tr></thead>
                    <tbody>
                      {pending.duePayments.map(m => (
                        <tr key={m.id} className="row-overdue">
                          <td>{m.branches?.name}</td>
                          <td>{m.students?.name}<div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.students?.phone}</div></td>
                          <td className="mono">{m.due_date}</td>
                          <td className="mono">₹{m.fee_due}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card">
                <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Memberships Expiring On {pending.date}</h3>
                {pending.expiredMemberships.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>None.</p>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Branch</th><th>Student</th><th>End Date</th></tr></thead>
                    <tbody>
                      {pending.expiredMemberships.map(m => (
                        <tr key={m.id} className="row-overdue">
                          <td>{m.branches?.name}</td>
                          <td>{m.students?.name}<div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.students?.phone}</div></td>
                          <td className="mono">{m.end_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
