import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI P1.6 — unusual discounts, waivers, cashbacks, attendance edits and overtime exclusions,
// found by the weekly anomaly job (ml/anomaly.py). The owner marks each one ok or a problem.
// Nothing is changed by a flag; it only asks for a look.
const KIND_LABEL = {
  discount: 'Discount', cashback: 'Cashback', waiver: 'Waiver',
  attendance_edit: 'Attendance edit', overtime_exclusion: 'Overtime excluded',
  // Phase 4 (A5 session watch)
  session_auto_closed: 'Session closed at 23:30', checkout_corrected: 'Checkout time corrected',
}
const TABS = [['open', 'Open'], ['problem', 'Problem'], ['ok', 'OK'], ['all', 'All']]

export default function FlagsPage() {
  const { anomaly } = useFeatureFlags()
  const [status, setStatus] = useState('open')
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api('list_anomaly_flags', { status })
      setFlags(res.flags ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  const review = async (flag, verdict) => {
    setBusy(flag.id + verdict)
    setError('')
    try {
      await api('review_anomaly_flag', { flagId: flag.id, status: verdict })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Flags</h1>
        <button type="button" className="btn btn-ghost" onClick={load}>↻ Refresh</button>
      </div>
      {!anomaly && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          The weekly anomaly check is switched off (pssai_anomaly). Flags already found are still listed.
        </p>
      )}
      <div role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={status === key}
            className={`btn ${status === key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatus(key)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error-msg" style={{ marginBottom: '1rem' }}>{error}</p>}
      {loading ? <p>Loading…</p> : flags.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text-muted)' }}>No {status === 'all' ? '' : TABS.find(([k]) => k === status)[1].toLowerCase() + ' '}flags.</p></div>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {flags.map((f) => (
            <div key={f.id} className="card" data-testid="flag-row">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong style={{ color: 'var(--accent)' }}>{KIND_LABEL[f.kind] ?? f.kind}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {f.branch_name ?? 'All branches'} · {formatDateTime(f.created_at)} · score {Number(f.score ?? 0).toFixed(1)}
                </span>
              </div>
              <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', lineHeight: 1.5 }}>{f.explanation}</p>
              {f.status === 'open' ? (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => review(f, 'ok')}>
                    {busy === f.id + 'ok' ? 'Saving…' : 'It’s fine'}
                  </button>
                  <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => review(f, 'problem')}>
                    {busy === f.id + 'problem' ? 'Saving…' : 'Problem'}
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: '0.8rem', color: f.status === 'problem' ? '#ff6b6b' : '#4ade80' }}>
                  Marked {f.status === 'problem' ? 'a problem' : 'fine'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
