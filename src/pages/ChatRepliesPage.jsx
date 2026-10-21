import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/utils'

// PSS-AI P2.4 A1 — students' portal chats that need a person: unanswered messages and the
// concierge's draft replies (shadow mode). Send a draft as is, edit it first, discard it, or write
// your own reply. Students see only what is sent.
function Thread({ t, onSend, onDiscard, busy }) {
  const draft = t.drafts.at(-1)
  const [text, setText] = useState(draft?.body ?? '')
  useEffect(() => { setText(draft?.body ?? '') }, [draft?.id, draft?.body])
  return (
    <div className="card" data-testid="chat-thread" style={{ marginBottom: '1rem' }}>
      <strong>{t.name}</strong> <span style={{ color: 'var(--text-muted)' }}>· {t.phone}</span>
      <div style={{ display: 'grid', gap: '0.4rem', margin: '0.75rem 0' }}>
        {t.messages.filter((m) => m.status === 'sent').map((m) => (
          <div key={m.id} style={{ fontSize: '0.88rem', justifySelf: m.role === 'student' ? 'start' : 'end', maxWidth: '85%', background: m.role === 'student' ? 'rgba(255,255,255,0.06)' : 'rgba(255,215,0,0.12)', padding: '0.45rem 0.7rem', borderRadius: 10, whiteSpace: 'pre-wrap' }}>
            {m.body}<div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.role === 'student' ? 'Student' : m.role === 'staff' ? 'Desk' : 'Assistant'} · {formatDateTime(m.at)}</div>
          </div>
        ))}
      </div>
      <label style={{ fontSize: '0.8rem' }}>{draft ? 'Draft reply from the assistant — check it, edit if needed' : 'Your reply'}
        <textarea rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} style={{ width: '100%', marginTop: '0.3rem' }} />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => onSend(t, text, draft)}>Send</button>
        {draft && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDiscard(draft)}>Discard draft</button>}
      </div>
    </div>
  )
}

export default function ChatRepliesPage() {
  const { branchId, isOwner, isCombinedHall } = useAuth()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api('list_chat_threads', isOwner && isCombinedHall ? {} : { branchId })
      setThreads(res.threads ?? [])
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }, [branchId, isOwner, isCombinedHall])
  useEffect(() => { load() }, [load])

  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load() } catch (err) { setError(err.message) } finally { setBusy(false) } }
  const send = (t, body, draft) => act(() => api('send_chat_reply', { studentId: t.studentId, body, ...(draft ? { draftId: draft.id } : {}) }))
  const discard = (draft) => act(() => api('discard_chat_draft', { draftId: draft.id }))

  return (
    <>
      <div className="page-header">
        <h1>Chat replies</h1>
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {loading && !threads.length ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : threads.length === 0 ? <p>No chats waiting for a reply.</p> : threads.map((t) => <Thread key={t.studentId} t={t} busy={busy} onSend={send} onDiscard={discard} />)}
    </>
  )
}
