import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatDateTime, openWhatsApp } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI Phase 3 — the Enquiries page's AI parts: the lead score badge (I24), the AI duplicate
// suggestions (merged through the page's own merge dialog), and the website chat in the enquiry
// drawer (A2: send the assistant's draft here or on WhatsApp, or discard it).

export function LeadScore({ e }) {
  if (e.score == null) return null
  const s = Number(e.score)
  const tone = s >= 60 ? '#4ade80' : s >= 30 ? 'var(--accent)' : 'var(--text-muted)'
  return <span data-testid="lead-score" title={e.score_reason ?? ''} className="mono" style={{ marginLeft: 6, fontSize: '0.72rem', padding: '0.05rem 0.35rem', borderRadius: 6, border: `1px solid ${tone}`, color: tone }}>{Math.round(s)}</span>
}

export function DedupePanel({ branchId, enquiries, onReview }) {
  const { leadTools } = useFeatureFlags()
  const [list, setList] = useState([])
  const load = useCallback(() => {
    if (!leadTools || !branchId) { setList([]); return }
    api('list_enquiry_dedupe', { branchId }).then((r) => setList(r.suggestions ?? [])).catch(() => setList([]))
  }, [leadTools, branchId])
  useEffect(() => { load() }, [load, enquiries.length])
  const byId = new Map(enquiries.map((e) => [e.id, e]))
  const shown = list.filter((s) => byId.has(s.enquiry_a) && byId.has(s.enquiry_b))
  if (!shown.length) return null
  const dismiss = async (s) => { try { await api('update_enquiry_dedupe', { id: s.id, status: 'dismissed' }); load() } catch { /* stays listed */ } }
  return (
    <div className="card" data-testid="dedupe-panel" style={{ marginBottom: '1.2rem' }}>
      <h3 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>Possibly the same person ({shown.length})</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>Suggested by AI from names and messages (it never sees phone numbers). Check before merging.</p>
      {shown.map((s) => {
        const a = byId.get(s.enquiry_a), b = byId.get(s.enquiry_b)
        return (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', padding: '0.4rem 0', borderTop: '1px solid var(--border)' }}>
            <span><strong>{a.name}</strong> <span className="mono" style={{ color: 'var(--text-muted)' }}>{a.phone}</span> ⇄ <strong>{b.name}</strong> <span className="mono" style={{ color: 'var(--text-muted)' }}>{b.phone}</span>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.verdict === 'same' ? 'Likely the same' : 'Not sure'}{s.confidence != null ? ` (${Math.round(Number(s.confidence) * 100)}%)` : ''} — {s.reason}</span>
            </span>
            <span style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" className="btn btn-primary" onClick={() => onReview([a, b])}>Review &amp; merge</button>
              <button type="button" className="btn btn-ghost" onClick={() => dismiss(s)}>Not the same</button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function EnquiryChatPanel({ enquiryId, phone }) {
  const [chats, setChats] = useState([])
  const [edit, setEdit] = useState({})
  const [own, setOwn] = useState({})
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api('list_enquiry_chat', { enquiryId }).then((r) => setChats(r.chats ?? [])).catch(() => setChats([]))
  }, [enquiryId])
  useEffect(() => { load() }, [load])
  if (!chats.length) return null
  const send = async (chatId, m, viaWhatsApp) => {
    const body = (edit[m.id] ?? m.body).trim()
    setError('')
    try {
      if (viaWhatsApp && phone) openWhatsApp(phone, body)
      await api('send_enquiry_chat_reply', { chatId, draftId: m.id, body })
      load()
    } catch (e) { setError(e.message) }
  }
  const discard = async (m) => { try { await api('discard_enquiry_chat_draft', { draftId: m.id }); load() } catch (e) { setError(e.message) } }
  // A reply written by staff, when the AI wrote none (or it was discarded).
  const sendOwn = async (chatId, viaWhatsApp) => {
    const body = (own[chatId] ?? '').trim()
    if (!body) return
    setError('')
    try {
      if (viaWhatsApp && phone) openWhatsApp(phone, body)
      await api('send_enquiry_chat_reply', { chatId, body })
      setOwn((x) => ({ ...x, [chatId]: '' }))
      load()
    } catch (e) { setError(e.message) }
  }
  return (
    <div className="drw-field" data-testid="enquiry-chat" style={{ marginTop: '0.75rem' }}>
      <div className="drw-lbl">💬 Website chat</div>
      {error && <p className="error-msg">{error}</p>}
      {chats.map((c) => c.messages.map((m) => (
        <div key={m.id} style={{ margin: '0.35rem 0', padding: '0.4rem 0.6rem', borderRadius: 8, background: m.role === 'visitor' ? 'rgba(255,255,255,0.04)' : 'rgba(255,215,0,0.06)', fontSize: '0.85rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.role === 'visitor' ? 'Visitor' : m.role === 'assistant' ? (m.status === 'draft' ? 'AI draft (not sent)' : 'AI') : 'Staff'} · {formatDateTime(m.sent_at ?? m.created_at)}</div>
          {m.status === 'draft' ? (
            <>
              <textarea rows={3} aria-label="Draft reply" value={edit[m.id] ?? m.body} onChange={(e) => setEdit((x) => ({ ...x, [m.id]: e.target.value }))} style={{ width: '100%', marginTop: '0.3rem' }} />
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" onClick={() => send(c.id, m, false)}>Send in chat</button>
                {phone && <button type="button" className="btn btn-ghost" onClick={() => send(c.id, m, true)}>💬 WhatsApp too</button>}
                <button type="button" className="btn btn-ghost" onClick={() => discard(m)}>Discard</button>
              </div>
            </>
          ) : <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
        </div>
      )))}
      {chats.filter((c) => !c.messages.some((m) => m.status === 'draft')).map((c) => (
        <div key={`reply-${c.id}`} style={{ marginTop: '0.4rem' }}>
          <textarea rows={2} aria-label="Write a reply" placeholder="Write a reply…" value={own[c.id] ?? ''} onChange={(e) => setOwn((x) => ({ ...x, [c.id]: e.target.value }))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={!(own[c.id] ?? '').trim()} onClick={() => sendOwn(c.id, false)}>Send in chat</button>
            {phone && <button type="button" className="btn btn-ghost" disabled={!(own[c.id] ?? '').trim()} onClick={() => sendOwn(c.id, true)}>💬 WhatsApp too</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
