import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'

function formatMsgTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function formatDayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const isSameDay = (a, b) => a.toDateString() === b.toDateString()
  if (isSameDay(d, today)) return 'Today'
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(d, yesterday)) return 'Yesterday'
  return formatDate(iso)
}

export default function MessagesPage() {
  const { branchId, staff, activeBranch } = useAuth()
  const [channel, setChannel] = useState('branch')
  const [messages, setMessages] = useState([])
  const [alerts, setAlerts] = useState([])
  const [content, setContent] = useState('')
  const [tab, setTab] = useState('chat')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  const load = useCallback(async () => {
    if (!branchId) return
    try {
      const [msgData, alertData] = await Promise.all([
        api('list_messages', { branchId, channel }),
        api('list_alerts', { branchId }),
      ])
      setMessages(msgData.messages ?? [])
      setAlerts(alertData.alerts ?? [])
    } catch { /* ignore */ }
  }, [branchId, channel])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!content.trim()) return
    setSending(true)
    setError('')
    try {
      await api('send_message', {
        branchId, channel,
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
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)' }}>
          <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #262626' }}>
            <div className="period-toggle">
              <button type="button" className={channel === 'branch' ? 'active' : ''} onClick={() => setChannel('branch')}>
                🏢 {activeBranch?.name ?? 'Branch'} Team
              </button>
              <button type="button" className={channel === 'all' ? 'active' : ''} onClick={() => setChannel('all')}>
                🌐 All Staff
              </button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Internal messages between owner and staff only — not visible to students.
            </p>
          </div>

          <div
            ref={scrollRef}
            style={{
              display: 'flex', flexDirection: 'column', gap: '0.15rem',
              padding: '1rem', flex: 1, minHeight: 0, overflowY: 'auto',
              background: 'repeating-linear-gradient(135deg, #0f0f0f 0px, #0f0f0f 2px, #111 2px, #111 4px)',
            }}
          >
            {messages.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 'auto' }}>No messages yet. Say hello 👋</p>
            )}
            {[...messages].reverse().map((m, i, arr) => {
              const isMe = m.sender_staff_id === staff?.id
              const prev = arr[i - 1]
              const showDayLabel = !prev || formatDayLabel(prev.sent_at) !== formatDayLabel(m.sent_at)
              const showName = !isMe && (!prev || prev.sender_staff_id !== m.sender_staff_id || showDayLabel)
              return (
                <div key={m.id}>
                  {showDayLabel && (
                    <div style={{ textAlign: 'center', margin: '0.75rem 0' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: '#1c1c1c', padding: '2px 10px', borderRadius: 10 }}>
                        {formatDayLabel(m.sent_at)}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: showName ? '0.4rem' : '0.05rem' }}>
                    <div style={{ maxWidth: '75%' }}>
                      {showName && (
                        <p style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 700, marginBottom: '0.15rem', marginLeft: '0.6rem' }}>
                          {m.staff?.displayName || m.staff?.username || 'Staff'}
                        </p>
                      )}
                      <div style={{
                        background: isMe ? 'rgba(255,215,0,0.14)' : '#1e1e1e',
                        border: `1px solid ${isMe ? 'rgba(255,215,0,0.3)' : '#2c2c2c'}`,
                        borderRadius: 12,
                        borderTopRightRadius: isMe ? 3 : 12,
                        borderTopLeftRadius: isMe ? 12 : 3,
                        padding: '0.5rem 0.75rem',
                      }}>
                        <p style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '0.2rem' }}>
                          {formatMsgTime(m.sent_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid #262626' }}>
            <input
              style={{ flex: 1, padding: '0.6rem 0.9rem', background: '#141414', border: '1px solid #333', borderRadius: 20, color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.9rem' }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`Message as ${staff?.displayName || staff?.username}…`}
              required
            />
            <button type="submit" className="btn btn-primary" style={{ borderRadius: 20 }} disabled={sending}>
              {sending ? '…' : 'Send'}
            </button>
          </form>
          {error && <p className="error-msg" style={{ margin: '0 1rem 0.75rem' }}>{error}</p>}
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
                {a.due_date && <span className="mono"> · Due {formatDate(a.due_date)}</span>}
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
