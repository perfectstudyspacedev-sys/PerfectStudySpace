import { useEffect, useState } from 'react'
import { portalApi } from '../lib/api'
import { addDaysISO, fmtDate, hoursText, istDate, minutesByDay } from './portalUtils'

// PSS-AI P2.1 SP5 — study hours per day, with focus ratings.
const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days']]

export default function PortalReport() {
  const [days, setDays] = useState(7)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const to = istDate(Date.now())
    const from = addDaysISO(to, -(days - 1))
    setReport(null)
    portalApi('me_study_report', { dateFrom: from, dateTo: to }).then(setReport).catch((err) => setError(err.message))
  }, [days])

  const rows = report ? minutesByDay(report.bookings, report.dateFrom, report.dateTo) : []
  const total = rows.reduce((s, r) => s + r.minutes, 0)
  const studied = rows.filter((r) => r.minutes > 0).length
  const focus = rows.flatMap((r) => r.focus)
  const max = Math.max(60, ...rows.map((r) => r.minutes))

  return (
    <>
      <h2 style={{ marginBottom: '0.75rem' }}>Study report</h2>
      <div className="chip-row" role="group" aria-label="Period" style={{ marginBottom: '0.75rem' }}>
        {RANGES.map(([n, label]) => <button key={n} type="button" className={`chip${days === n ? ' on' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>{label}</button>)}
      </div>
      {error && <p className="error-msg">{error}</p>}
      {!report ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
        <>
          <div className="card">
            <dl className="portal-kv">
              <dt>Total</dt><dd data-testid="report-total">{hoursText(total)}</dd>
              <dt>Days studied</dt><dd>{studied} of {rows.length}</dd>
              <dt>Average per study day</dt><dd>{studied ? hoursText(Math.round(total / studied)) : '—'}</dd>
              {focus.length > 0 && <><dt>Average focus</dt><dd>{(focus.reduce((s, x) => s + x, 0) / focus.length).toFixed(1)} / 5</dd></>}
            </dl>
          </div>
          <div className="card">
            <ul className="portal-bars" aria-label="Hours per day">
              {rows.slice().reverse().map((r) => (
                <li key={r.date}>
                  <span className="portal-bar-date">{fmtDate(r.date).replace(/ \d{4}$/, '')}</span>
                  <span className="portal-bar-track"><span className="portal-bar" style={{ width: `${(r.minutes / max) * 100}%` }} /></span>
                  <span className="portal-bar-value">{r.minutes ? hoursText(r.minutes) : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  )
}
