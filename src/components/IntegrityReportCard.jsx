import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/utils'

// PSS-AI P0.8 — the nightly data check (02:00 IST cron job), for owner and admin only. Shown only
// when the last report found something. The check itself changes nothing.
const FINDINGS = [
  ['membership_dates', 'membership end or due dates differ from what the plan gives'],
  ['negative_food_pass', 'Food Pass balance below zero'],
  ['stale_active_bookings', 'session still open more than 24 hours after it started'],
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
  if (!found.length) return null

  return (
    <div className="card" role="status" style={{ marginBottom: '1.5rem', borderColor: 'rgba(255,150,0,0.5)' }}>
      <h3 style={{ color: '#ffaa44', marginBottom: '0.5rem' }}>⚠ Nightly data check</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
        {formatDateTime(report.occurredAt)} · nothing was changed
      </p>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.88rem', lineHeight: 1.6 }}>
        {found.map(([key, label]) => (
          <li key={key}><strong>{report.counts[key]}</strong> {label}</li>
        ))}
      </ul>
      {Number(report.counts?.stale_active_bookings) > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.6rem' }}>
          Open sessions can be checked out from Active Session.
        </p>
      )}
    </div>
  )
}
