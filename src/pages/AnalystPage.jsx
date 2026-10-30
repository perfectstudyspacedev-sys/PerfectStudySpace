import { useEffect, useRef, useState } from 'react'
import { agentApi } from '../lib/api'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI P1.8 — ask the owner analyst about the business. It reads the same reports as the app
// (revenue, dashboard, dues, enquiries, scores, flags, forecast) and cannot change anything. The
// chat is kept in this tab only (sessionStorage) and sent back with each question as plain text.
const STORE_KEY = 'pss_analyst_chat'
const MAX_TURNS = 5 // earlier question/answer pairs sent with a new question
const EXAMPLES = [
  'How much did each branch collect this month?',
  'Which members are most likely not to renew?',
  'Who still owes fees, and how much in total?',
  'What cash should we expect over the next 4 weeks?',
]
const TOOL_LABEL = {
  list_branches: 'branches', get_dashboard: 'dashboard', get_revenue: 'revenue', list_transactions: 'transactions',
  get_daily_report: 'daily report', get_referral_stats: 'referrals', get_discounts_waivers: 'discounts and waivers',
  get_actionable_items: 'action items', list_enquiries: 'enquiries', search_students_by_name: 'student search',
  get_student_profile: 'student profile', get_student_scores: 'scores', list_anomaly_flags: 'flags',
  get_forecast: 'forecast', get_integrity_report: 'data check',
}

function loadChat() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) ?? [] } catch { return [] }
}

export default function AnalystPage() {
  const { analyst } = useFeatureFlags()
  const [chat, setChat] = useState(loadChat)
  const [question, setQuestion] = useState('')
  const [deep, setDeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [budget, setBudget] = useState(null)
  const endRef = useRef(null)

  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(chat.slice(-20))) } catch { /* private mode */ }
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [chat])

  useEffect(() => {
    if (!analyst) return undefined
    let live = true
    agentApi({ agent: 'analyst', op: 'usage' }).then((b) => { if (live) setBudget(b) }).catch(() => {})
    return () => { live = false }
  }, [analyst])

  const ask = async (text) => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setError('')
    const history = chat.filter((t) => t.answer && t.stop !== 'error').slice(-MAX_TURNS)
      .flatMap((t) => [{ role: 'user', text: t.question }, { role: 'assistant', text: t.answer.slice(0, 4000) }])
    try {
      const res = await agentApi({ agent: 'analyst', question: q, history, deep })
      setChat((c) => [...c, { question: q, answer: res.answer, stop: res.stop, tools: res.toolCalls ?? [], deep, model: res.model }])
      if (res.budget) setBudget((b) => ({ ...b, ...res.budget }))
      setQuestion('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => { e.preventDefault(); ask(question) }

  return (
    <>
      <div className="page-header">
        <h1>Analyst</h1>
        {chat.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setChat([])}>Clear chat</button>}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Answers come from the app&apos;s own reports, read by AI. It cannot change anything. Check important
        figures on the Revenue and Reports pages.
        {budget && <> · AI spend this month: ${Number(budget.usedUsd).toFixed(2)} of ${Number(budget.capUsd).toFixed(2)}</>}
      </p>
      {budget?.providers && (
        <details className="card" style={{ marginBottom: '1rem' }}>
          <summary style={{ cursor: 'pointer' }}>AI models: Ollama → Gemini → Claude</summary>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>The first configured provider that supports the task is used. Structured results use Gemini or Claude.</p>
          <table className="data-table" style={{ width: '100%', fontSize: '0.8rem' }}>
            <thead><tr><th scope="col">Provider</th><th scope="col">Setup</th><th scope="col">Routine model</th><th scope="col">Deep model</th></tr></thead>
            <tbody>{budget.providers.map((p) => <tr key={p.provider}>
              <td>{{ ollama: 'Ollama Cloud', gemini: 'Gemini', claude: 'Claude' }[p.provider] ?? p.provider}</td>
              <td>{p.configured ? 'Key configured' : 'Key needed'}</td><td>{p.routine}</td><td>{p.hard}</td>
            </tr>)}</tbody>
          </table>
        </details>
      )}
      {!analyst && (
        <p className="error-msg" style={{ marginBottom: '1rem' }}>The analyst is switched off (pssai_analyst).</p>
      )}

      <div aria-live="polite" style={{ display: 'grid', gap: '0.9rem', marginBottom: '1rem' }}>
        {chat.length === 0 && analyst && (
          <div className="card">
            <p style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Try asking:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="btn btn-ghost" disabled={busy} onClick={() => ask(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}
        {chat.map((t, i) => (
          <div key={i} className="card" data-testid="analyst-turn">
            <p style={{ marginTop: 0, fontWeight: 600 }}>{t.question}</p>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: '0.5rem' }}>{t.answer}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>
              {t.tools.length ? `Looked at: ${[...new Set(t.tools.map((x) => TOOL_LABEL[x.name] ?? x.name))].join(', ')}` : 'No reports looked at'}
              {t.tools.some((x) => !x.ok) && ' (some reports could not be read)'}
              {t.deep && ' · deep answer'}
              {t.model && ` · ${t.model}`}
            </p>
          </div>
        ))}
        {busy && <p style={{ color: 'var(--text-muted)' }}>Working it out… this can take up to a minute.</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="error-msg" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: '0.6rem' }}>
        <label htmlFor="analyst-q" style={{ fontSize: '0.85rem' }}>Your question</label>
        <textarea id="analyst-q" rows={2} maxLength={2000} value={question} disabled={!analyst || busy}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question) } }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} disabled={busy} />
            Deep answer (slower, costs more)
          </label>
          <button type="submit" className="btn btn-primary" disabled={!analyst || busy || !question.trim()}>
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>
    </>
  )
}
