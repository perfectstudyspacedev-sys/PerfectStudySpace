import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { publicAgent } from '../lib/api'

// PSS-AI Phase 3, A2 — the enquiry chat on the join site (/ask, C9); the public website links here.
// The visitor picks a branch and gives a name and phone (with consent), then asks questions. An AI
// answers from the hall's own facts; in shadow mode (the default) a person replies on WhatsApp.
// The chat key stays in this browser so the visitor can come back to the conversation.
const KEY = 'pss_enquiry_chat'

export default function AskPage() {
  const [params] = useSearchParams()
  const ref = params.get('r') ?? undefined
  const [branches, setBranches] = useState(null)
  const [closed, setClosed] = useState('')
  const [form, setForm] = useState({ branchId: '', name: '', phone: '', consent: false })
  // A field people never see (off-screen, skipped by Tab): scripts that fill every field fill it.
  const [website, setWebsite] = useState('')
  const [chatKey, setChatKey] = useState(() => { try { return localStorage.getItem(KEY) } catch { return null } })
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    publicAgent({ agent: 'enquiry', op: 'branches' }).then((r) => setBranches(r.branches ?? [])).catch((e) => setClosed(e.message))
  }, [])
  // A returning visitor sees their conversation (and any reply the team sent since). Only on
  // arrival: during a visit the page already shows what was said.
  useEffect(() => {
    if (!chatKey) return
    publicAgent({ agent: 'enquiry', op: 'history', chatKey }).then((r) => setMessages(r.messages ?? [])).catch(() => {
      try { localStorage.removeItem(KEY) } catch { /* ignore */ }
      setChatKey(null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [messages])

  const send = async (e) => {
    e.preventDefault()
    const message = text.trim()
    if (!message) return
    if (!chatKey) {
      if (!form.branchId) return setError('Choose a branch')
      if (form.name.trim().length < 2) return setError('Write your name')
      if (!/^\d{10}$/.test(form.phone)) return setError('Phone must be 10 digits')
      if (!form.consent) return setError('Please tick the box so we can reply to you')
    }
    setBusy(true); setError('')
    setMessages((m) => [...m, { role: 'visitor', body: message, at: new Date().toISOString() }])
    setText('')
    try {
      const r = await publicAgent({ agent: 'enquiry', op: 'send', message, website, ...(chatKey ? { chatKey } : { ...form, ref }) })
      if (r.chatKey) { try { localStorage.setItem(KEY, r.chatKey) } catch { /* the chat works for this visit */ } setChatKey(r.chatKey) }
      setMessages((m) => [...m, { role: 'team', body: r.reply ?? r.message, at: new Date().toISOString(), pending: !!r.pending }])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page join-page">
      <div className="login-brand">
        <img src="/pss-logo.png" alt="" className="login-brand-logo join-logo" />
        <h1 className="join-title">Perfect Study Space</h1>
        <p style={{ color: 'var(--text-muted)' }}>Ask us anything about joining</p>
      </div>
      <div className="card login-card" data-testid="ask-card">
        {closed ? <p className="error-msg">{closed}</p> : !branches ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
          <form onSubmit={send}>
            <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }} />
            {!chatKey && (
              <>
                <div className="form-group">
                  <label htmlFor="ask-branch">Branch</label>
                  <select id="ask-branch" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                    <option value="">Choose a branch</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label htmlFor="ask-name">Your name</label><input id="ask-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></div>
                <div className="form-group"><label htmlFor="ask-phone">WhatsApp number</label><input id="ask-phone" inputMode="numeric" value={form.phone} placeholder="10 digits" onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} autoComplete="tel-national" /></div>
                <label style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                  <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                  <span>Keep my name, number and messages so the team can reply to me. (We don't share them.)</span>
                </label>
              </>
            )}
            <div aria-live="polite" style={{ maxHeight: 340, overflowY: 'auto', marginBottom: '0.75rem' }}>
              {messages.map((m, i) => (
                <div key={i} data-testid={`ask-msg-${m.role}`} style={{ margin: '0.35rem 0', padding: '0.5rem 0.7rem', borderRadius: 10, maxWidth: '88%', marginLeft: m.role === 'visitor' ? 'auto' : 0, background: m.role === 'visitor' ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.05)', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                  {m.body}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div className="form-group">
              <label htmlFor="ask-text">{chatKey ? 'Your message' : 'Your question'}</label>
              <textarea id="ask-text" rows={2} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="Fees, timings, seats…" />
            </div>
            {error && <p className="error-msg" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
