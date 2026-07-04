import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

export default function MessagesPage() {
  const { branchId, staff } = useAuth()
  const [messages, setMessages] = useState([])
  const [alerts, setAlerts] = useState([])
  const [content, setContent] = useState('')
  const [tab, setTab] = useState('chat')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!branchId) return
    try {
      const [msgData, alertData] = await Promise.all([
        api('list_messages', { branchId }),
        api('list_alerts', { branchId }),
      ])
      setMessages(msgData.messages ?? [])
      setAlerts(alertData.alerts ?? [])
    } catch { /* ignore */ }
  }, [branchId])

  useEffect(() => { load() }, [load])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!content.trim()) return
    setSending(true)
    setError('')
    try {
      await api('send_message', {
        branchId,
        recipientType: 'staff',
        recipientStudentId: null,
        content: content.trim(),
      })
      setContent('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const resolveAlert = async (alertId) => {
    await api('resolve_alert', { alertId })
    load()
  }

  return (
    <>
      <div className="page-header"><h1>Staff Chat & Alerts</h1></div>

      <div className="tabs">
        <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          Chat ({messages.length})
        </button>
        <button type="button" className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
          Alerts ({alerts.filter(a => !a.resolved_at).length})
        </button>
      </div>

      {tab === 'chat' && (
        <div className="card" style={{ maxWidth: 580 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Internal messages between owner and staff only — not visible to students.
          </p>

          <div className="activity-feed" style={{ marginBottom: '1rem', maxHeight: 360 }}>
            {messages.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No messages yet.</p>
            )}
            {messages.map(m => (
              <div key={m.id} className="activity-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <p style={{ flex: 1 }}>{m.content}</p>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {m.staff?.displayName || m.staff?.username || 'Staff'}
                  </span>
                </div>
                <div className="time">{new Date(m.sent_at).toLocaleString('en-IN')}</div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              style={{ flex: 1, padding: '0.6rem 0.75rem', background: '#141414', border: '1px solid #333', borderRadius: 4, color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.9rem' }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`Message as ${staff?.displayName || staff?.username}…`}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending ? '…' : 'Send'}
            </button>
          </form>
          {error && <p className="error-msg" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="card">
          {alerts.filter(a => !a.resolved_at).length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>No pending alerts.</p>
          )}
          {alerts.filter(a => !a.resolved_at).map(a => (
            <div key={a.id} className="activity-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{a.students?.name}</strong> — {a.alert_type.replace('_', ' ')}
                {a.due_date && <span className="mono"> · Due {a.due_date}</span>}
                {a.message && <p style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{a.message}</p>}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => resolveAlert(a.id)}>Resolve</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
