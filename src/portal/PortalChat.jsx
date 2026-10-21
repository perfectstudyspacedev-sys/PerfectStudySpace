import { useEffect, useRef, useState } from 'react'
import { portalAgent, portalApi } from '../lib/api'
import { fmtDateTime } from './portalUtils'

// PSS-AI P2.4 A1 — chat with the hall. With the assistant on, the concierge answers (in review
// mode a person checks each reply first); otherwise the message goes straight to the desk.
export default function PortalChat() {
  const [data, setData] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const endRef = useRef(null)

  const load = () => portalApi('me_chat_history').then(setData).catch((err) => setError(err.message))
  useEffect(() => { load() }, [])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [data])

  const send = async (e) => {
    e.preventDefault()
    const message = text.trim()
    if (!message || busy) return
    setBusy(true); setError(''); setNote('')
    try {
      const r = data?.assistant ? await portalAgent({ agent: 'concierge', message }) : await portalApi('me_chat_send', { body: message })
      setText('')
      if (r.pending || !data?.assistant) setNote('Thanks! The team will reply here soon.')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 style={{ marginBottom: '0.25rem' }}>Chat</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
        {data?.assistant ? 'Ask about your plan, dues, payments, holds or study hours. Replies are checked by the team.' : 'Write to the desk — they reply here.'} Write in English or Tamil.
      </p>
      <div className="card portal-chat" aria-live="polite" data-testid="chat-log">
        {!data ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : data.messages.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No messages yet.</p> : data.messages.map((m) => (
          <div key={m.id} className={`portal-msg ${m.role === 'student' ? 'me' : 'them'}`}>
            {m.role === 'staff' && <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>Desk</div>}
            {m.body}
            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '0.2rem' }}>{fmtDateTime(m.at)}</div>
          </div>
        ))}
        {data?.waiting && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Waiting for a reply…</p>}
        <div ref={endRef} />
      </div>
      {note && <p className="success-msg" role="status" style={{ marginBottom: '0.5rem' }}>{note}</p>}
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      <form onSubmit={send} style={{ display: 'flex', gap: '0.5rem' }}>
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <input id="chat-input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Type a message" style={{ flex: 1 }} className="portal-input" />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? '…' : 'Send'}</button>
      </form>
    </>
  )
}
