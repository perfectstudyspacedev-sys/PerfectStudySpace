import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { portalApi } from '../lib/api'
import { fmtDateTime } from './portalUtils'

// PSS-AI P2.1 — the student's notices (payments, holds, reminders, offers).
export default function PortalInbox() {
  const { setUnread } = useOutletContext() ?? {}
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    portalApi('me_notifications').then(async (r) => {
      setList(r.notifications ?? [])
      if (r.unread > 0) { await portalApi('me_mark_read').catch(() => {}); setUnread?.(0) }
    }).catch((err) => setError(err.message))
  }, [setUnread])
  if (!list) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  return (
    <>
      <h2 style={{ marginBottom: '0.75rem' }}>Notices</h2>
      {list.length === 0 && <div className="card"><p>Nothing yet.</p></div>}
      {list.map((n) => (
        <div key={n.id} className="card" style={!n.read_at ? { borderColor: 'var(--accent)' } : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <strong>{n.title}</strong><span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{fmtDateTime(n.created_at)}</span>
          </div>
          {n.body && <p style={{ fontSize: '0.88rem', marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>{n.body}</p>}
          {n.action_url?.startsWith('/me') && <Link to={n.action_url} style={{ fontSize: '0.85rem' }}>Open →</Link>}
        </div>
      ))}
    </>
  )
}
