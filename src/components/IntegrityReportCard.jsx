import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/utils'

// PSS-AI P0.8 — the nightly data check (02:00 IST cron job), for owner and admin only. Shown only
// when the last report found something, or when the check has stopped running (the scheduled
// jobs are then probably not running either). The check itself changes nothing.
const STALE_HOURS = 36
const FINDINGS = [
  ['membership_dates', 'membership end date matches neither its months nor its days — review it'],
  ['negative_food_pass', 'Food Pass balance below zero'],
  ['stale_active_bookings', 'session still open more than 24 hours after it started'],
  ['proofs_without_transactions', 'UPI payment marked confirmed with no transaction recorded — check it in Approvals'],
  ['stuck_agent_runs', 'AI run that never finished (its cost was not counted)'],
]

export default function IntegrityReportCard() {
  const { isOwner } = useAuth()
  const [report, setReport] = useState(null)

  useEffect(() => {
    if (!isOwner) return undefined
    let live = true
    api('get_integrity_report')
      .then((res) => { if (live) setReport(res?.report ?? null) })
      .catch(() => { /* the card is optional; the dashboard works without it */ })
    return () => { live = false }
  }, [isOwner])

  if (!isOwner || !report) return null
  const found = FINDINGS.filter(([key]) => Number(report.counts?.[key]) > 0)
  const stale = Date.now() - new Date(report.occurredAt).getTime() > STALE_HOURS * 3600e3
  if (!found.length && !stale) return null

  return (
    <div className="card" role="status" style={{ marginBottom: '1.5rem', borderColor: 'rgba(255,150,0,0.5)' }}>
      <h3 style={{ color: '#ffaa44', marginBottom: '0.5rem' }}>⚠ Nightly data check</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
        {formatDateTime(report.occurredAt)} · nothing was changed
      </p>
      {stale && (
        <p data-testid="integrity-stale" style={{ fontSize: '0.85rem', marginBottom: '0.6rem' }}>
          The check has not run since then. The scheduled jobs (renewal reminders, sign-up clean-up) may have
          stopped — see docs/ops/cron.sql.
        </p>
      )}
      {found.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.88rem', lineHeight: 1.6 }}>
          {found.map(([key, label]) => (
            <li key={key}><strong>{report.counts[key]}</strong> {label}</li>
          ))}
        </ul>
      )}
      {Number(report.counts?.stale_active_bookings) > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.6rem' }}>
          Open sessions can be checked out from Active Session.
        </p>
      )}
    </div>
  )
}
