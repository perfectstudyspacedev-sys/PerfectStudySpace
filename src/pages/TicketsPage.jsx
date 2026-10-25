import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI Phase 4 (I22/SP17) — problems students report in the portal, as tickets. Urgent ones come
// first (fire, smoke, leaks, theft…, by fixed word rules, never AI). Resolving one tells the student.
const CATEGORY = { cleanliness: 'Cleanliness', noise: 'Noise', wifi: 'Wi-Fi', seat: 'Seat or desk', food: 'Food', other: 'Other' }
const PRIORITY = { urgent: ['Urgent', '#ff6b6b'], high: ['High', '#ffaa44'], normal: ['Normal', 'var(--text-muted)'] }
const STATUS = { open: 'Open', in_progress: 'Being fixed', resolved: 'Fixed', closed: 'Closed' }

export default function TicketsPage() {
  const { branchId, isOwner, isCombinedHall } = useAuth()
  const { tickets: on } = useFeatureFlags()
  const [view, setView] = useState('open')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const all = isOwner && isCombinedHall
  const load = useCallback(() => api('list_tickets', { ...(all ? { allBranches: true } : { branchId }), view }).then((r) => setRows(r.tickets ?? [])).catch((e) => setError(e.message)), [all, branchId, view])
  useEffect(() => { load() }, [load])
  const update = async (t, payload) => {
    setBusy(true); setError('')
    try { await api('update_ticket', { ticketId: t.id, ...payload }); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const resolve = (t) => {
    const resolution = window.prompt('What was done? (the student sees this)', '')
    if (resolution !== null) update(t, { status: 'resolved', resolution })
  }
  return (
    <>
      <div className="page-header">
        <h1>Problems reported</h1>
        <button type="button" className="btn btn-ghost" onClick={load}>↻ Refresh</button>
      </div>
      {!on && <p style={{ color: 'var(--text-muted)' }}>Reporting from the portal is not switched on; older reports still show here.</p>}
      <div className="period-toggle" style={{ marginBottom: '0.75rem' }}>
        {[['open', 'Open'], ['all', 'Last 30 days']].map(([v, l]) => <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)}>{l}</button>)}
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {!rows ? <p>Loading…</p> : rows.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Nothing reported.</p> : rows.map((t) => {
        const [pl, pc] = PRIORITY[t.priority] ?? PRIORITY.normal
        return (
          <div key={t.id} className="card" data-testid="ticket" style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong>{CATEGORY[t.category] ?? t.category}{t.deskLabel ? ` · desk ${t.deskLabel}` : ''}</strong>
              <span><span style={{ color: pc, fontWeight: 700, fontSize: '0.8rem' }}>{pl}</span> · <span className="badge">{STATUS[t.status] ?? t.status}</span></span>
            </div>
            <p style={{ margin: '0.4rem 0', whiteSpace: 'pre-wrap' }}>{t.details}</p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.student ?? 'A student'}{all && t.branch ? ` · ${t.branch}` : ''} · {formatDateTime(t.at)}{t.resolution ? ` · Done: ${t.resolution}` : ''}</p>
            {['open', 'in_progress'].includes(t.status) && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {t.status === 'open' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => update(t, { status: 'in_progress' })}>Working on it</button>}
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => resolve(t)}>Fixed</button>
                <select aria-label="Priority" value={t.priority} disabled={busy} onChange={(e) => update(t, { priority: e.target.value })}>
                  {Object.entries(PRIORITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => update(t, { status: 'closed' })}>Close</button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
