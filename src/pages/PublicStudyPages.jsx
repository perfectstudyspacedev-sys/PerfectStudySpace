import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

// PSS-AI Phase 6 — the two public pages on the student site. Both are read-only:
//  - /verify/<id> (I33/SP22): does a study certificate check? Shows exactly what was signed.
//  - /p/<token> (I34/SP23): the weekly summary a student chose to share; nothing when stopped.
const fmt = (d) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '')
const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
const Frame = ({ children }) => (
  <div className="login-page join-page">
    <div className="card login-card" style={{ maxWidth: 520 }}>{children}</div>
  </div>
)

export function VerifyCertificate() {
  const { id } = useParams()
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('public_verify_certificate', { id }).then(setR).catch((e) => setError(e.message || 'Not found')) }, [id])
  if (error) return <Frame><p className="error-msg">This certificate could not be found.</p></Frame>
  if (!r) return <Frame><p style={{ color: 'var(--text-muted)' }}>Checking…</p></Frame>
  if (!r.found) return <Frame><h2 style={{ marginTop: 0 }}>Not found</h2><p>No certificate has the number {id}.</p></Frame>
  return (
    <Frame>
      <div data-testid="verify-result">
        <h2 style={{ marginTop: 0, color: r.valid ? '#4ade80' : '#ff8888' }}>{r.valid ? '✓ Genuine certificate' : r.revoked ? 'Withdrawn by the student' : '✗ This certificate does not check'}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{r.hall}</p>
        <p style={{ fontSize: '1.2rem', margin: '0.3rem 0' }}><strong>{r.name}</strong></p>
        <p>{r.hours} hours of study on {r.days} days, {fmt(r.from)} – {fmt(r.to)}.</p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Certificate {id}, issued {fmt(String(r.issuedAt).slice(0, 10))}. {r.valid ? 'The hall’s signature matches these details.' : 'Do not rely on it.'}</p>
      </div>
    </Frame>
  )
}

export function ParentDigest() {
  const { token } = useParams()
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('public_parent_digest', { token }).then(setR).catch((e) => setError(e.message || 'This link does not work')) }, [token])
  if (error) return <Frame><p className="error-msg">{error}</p></Frame>
  if (!r) return <Frame><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Frame>
  if (!r.weeks.length) return <Frame><h2 style={{ marginTop: 0 }}>Weekly study summary</h2><p>The first summary arrives on Sunday evening.</p></Frame>
  const [latest, ...earlier] = r.weeks
  const max = Math.max(60, ...latest.days.map((d) => d.minutes))
  return (
    <Frame>
      <div data-testid="digest">
        <h2 style={{ marginTop: 0 }}>{latest.name}’s week at {latest.hall}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmt(latest.weekStart)} – {fmt(latest.weekEnd)}</p>
        <p style={{ fontSize: '1.2rem' }}><strong>{hm(latest.minutes)}</strong> over <strong>{latest.daysAttended}</strong> day{latest.daysAttended === 1 ? '' : 's'}{latest.focus != null ? ` · focus ${latest.focus}/5` : ''}</p>
        <table className="data-table"><tbody>{latest.days.map((d) => (
          <tr key={d.date}><td>{new Date(`${d.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}</td>
            <td><span style={{ display: 'inline-block', height: 8, width: `${Math.round((d.minutes / max) * 160)}px`, background: 'var(--accent)', borderRadius: 4 }} /></td>
            <td className="mono">{d.minutes ? hm(d.minutes) : '—'}</td></tr>
        ))}</tbody></table>
        {latest.planEnds && <p style={{ fontSize: '0.85rem' }}>Current plan ends on {fmt(latest.planEnds)}.</p>}
        {earlier.length > 0 && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Earlier weeks: {earlier.map((w) => `${fmt(w.weekStart)}: ${hm(w.minutes)}`).join(' · ')}</p>}
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Shared by the student, who can stop this link at any time.</p>
      </div>
    </Frame>
  )
}
