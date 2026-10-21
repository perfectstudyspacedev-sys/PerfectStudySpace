import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatCurrency, openWhatsApp, todayISO } from '../lib/utils'

// PSS-AI P2.4 A4 — today's renewal and dues reminders, ranked by the 08:00 job. Each row has a
// drafted WhatsApp message (edit it if you like); the WhatsApp button opens the chat with it and
// marks it sent. Nothing is sent automatically.
export default function SendListPage() {
  const [date, setDate] = useState(todayISO())
  const [rows, setRows] = useState([])
  const [edits, setEdits] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const r = await api('list_send_list', { date }); setRows(r.rows ?? []) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }, [date])
  useEffect(() => { load() }, [load])

  const mark = async (row, status, message) => {
    try { await api('update_send_list_item', { id: row.id, status, ...(message ? { message } : {}) }); await load() } catch (err) { setError(err.message) }
  }
  const send = (row) => {
    const message = edits[row.id] ?? row.message
    openWhatsApp(row.phone, message)
    mark(row, 'sent', message !== row.message ? message : undefined)
  }

  const pending = rows.filter((r) => r.status === 'pending')
  return (
    <>
      <div className="page-header">
        <h1>Send list</h1>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} aria-label="List date" />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Ranked each morning by renewal risk, days left and dues. {pending.length} to send.
      </p>
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {loading && !rows.length ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : rows.length === 0 ? <p>No reminders for this day.</p> : rows.map((r) => (
        <div key={r.id} className="card" data-testid="send-row" style={{ marginBottom: '0.9rem', opacity: r.status === 'pending' ? 1 : 0.6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span><strong>{r.name}</strong> <span style={{ color: 'var(--text-muted)' }}>· {r.phone} · {r.branch}</span></span>
            <span style={{ fontSize: '0.85rem' }}>{r.reason}{r.amount ? ` · ${formatCurrency(r.amount)}` : ''}</span>
          </div>
          <textarea rows={3} value={edits[r.id] ?? r.message} disabled={r.status !== 'pending'} onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value }))} style={{ width: '100%', marginTop: '0.6rem' }} aria-label={`Message to ${r.name}`} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            {r.status === 'pending' ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => send(r)}>💬 WhatsApp</button>
                <button type="button" className="btn btn-ghost" onClick={() => mark(r, 'skipped')}>Skip</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{r.status === 'sent' ? 'Sent' : 'Skipped'}</span>
                <button type="button" className="btn btn-ghost" onClick={() => mark(r, 'pending')}>Undo</button>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  )
}
