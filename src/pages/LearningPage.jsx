import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI Phase 5 — the self-improving system, owner side. Everything here is worked out by code
// from the hall's own records; nothing changes a rule or a price until the owner says so.
//  - Rules (I8): proposed from the owner's past decisions; signed hold rules decide by themselves.
//  - What if (I6): a policy change tried on the last 180 days.
//  - Experiments (O6, C20): two variants, a stable split, a winner only with enough students.
//  - Space use (O7): occupancy by weekday and hour, and what it suggests.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pct = (x) => `${Math.round(Number(x || 0) * 100)}%`

function useLoad(fn, deps) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { setError(''); return fn().then(setData).catch((e) => setError(e.message)) }, deps)
  useEffect(() => { load() }, [load])
  return { data, error, load, setError }
}

function RulesTab() {
  const { data, error, load, setError } = useLoad(() => api('list_policy_rules'), [])
  const decide = async (r, decision) => {
    const words = { sign: 'Sign this rule? Matching hold requests will then be approved by themselves.', retire: 'Retire this rule? Matching requests will wait for you again.', dismiss: 'Dismiss this proposal? It will not be proposed again.' }
    if (!window.confirm(words[decision])) return
    try { await api('decide_policy_rule', { ruleId: r.id, decision }); load() } catch (e) { setError(e.message) }
  }
  if (!data) return error ? <p className="error-msg">{error}</p> : <p>Loading…</p>
  const live = data.rules.filter((r) => r.status !== 'retired')
  return (
    <div className="card" data-testid="rules">
      <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Each week your decided approvals are grouped; a group decided the same way at least 9 times in 10 (6 or more decisions) becomes a proposal. A signed rule shows on matching approval cards; only student hold requests are ever approved by a rule — never refunds, plan changes or money.
      </p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {live.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No proposals yet — they appear after enough decisions.</p> : (
        <table className="data-table">
          <thead><tr><th>Rule</th><th>Status</th><th>Used</th><th /></tr></thead>
          <tbody>{live.map((r) => (
            <tr key={r.id} data-testid="rule">
              <td>{r.description}<div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.outcome === 'approve' ? 'Approve' : 'Deny'} · {r.support} decisions · {pct(r.agreement)} the same{r.outcome === 'deny' ? ' · shown only, never applied' : ''}</div></td>
              <td><span className="badge">{r.status === 'active' ? 'Signed' : 'Proposed'}</span></td>
              <td className="mono">{r.applied_count || 0}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.status === 'proposed' && <><button type="button" className="btn btn-primary" onClick={() => decide(r, 'sign')}>Sign</button> <button type="button" className="btn btn-ghost" onClick={() => decide(r, 'dismiss')}>Dismiss</button></>}
                {r.status === 'active' && <button type="button" className="btn btn-ghost" onClick={() => decide(r, 'retire')}>Retire</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

const POLICIES = {
  renewal_grace: { label: 'Renewal grace days', unit: 'days', max: 30 },
  overtime_grace: { label: 'Overtime grace minutes', unit: 'minutes', max: 60 },
  self_hold_days: { label: 'Self-hold limit', unit: 'days', max: 31 },
}

function TwinTab() {
  const [policy, setPolicy] = useState('renewal_grace')
  const [value, setValue] = useState('5')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api('simulate_policy', { policy, value: Number(value) })) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const p = POLICIES[policy]
  return (
    <div className="card" data-testid="twin">
      <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Try a change on the last 180 days of real records. Nothing changes until you change the real setting.</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="twin-policy">What to try</label>
          <select id="twin-policy" value={policy} onChange={(e) => { setPolicy(e.target.value); setResult(null) }}>
            {Object.entries(POLICIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="twin-value">New value ({p.unit})</label>
          <input id="twin-value" type="number" min={0} max={p.max} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 100 }} />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Try it'}</button>
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {result && (
        <div data-testid="twin-result" style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: '0 0 0.3rem' }}><strong>{p.label}: {result.current} → {result.proposed} {p.unit}</strong></p>
          {result.policy === 'renewal_grace' && <p style={{ margin: 0 }}>{result.renewals} late renewals; {result.changed} would change, {result.difference >= 0 ? 'bringing in' : 'losing'} <strong>{formatCurrency(Math.abs(result.difference))}</strong>. {result.checkinsRefused} of {result.checkins} check-ins after a plan ended would have been refused.</p>}
          {result.policy === 'overtime_grace' && <p style={{ margin: 0 }}>{result.sessions} overtime sessions; {result.changed} would be priced differently: {formatCurrency(result.currentTotal)} → {formatCurrency(result.proposedTotal)} (<strong>{result.difference >= 0 ? '+' : '−'}{formatCurrency(Math.abs(result.difference))}</strong>).</p>}
          {result.policy === 'self_hold_days' && <p style={{ margin: 0 }}>Of {result.requests} hold requests, {result.autoNow} run by themselves today; {result.autoThen} would, and {result.toApprovalThen} would wait for you.</p>}
        </div>
      )}
    </div>
  )
}

const KINDS = {
  winback_offer: { label: 'Win-back offer (% off, at most 10)', hint: 'e.g. 5 and 10' },
  next_exam_offer: { label: 'Next-exam plan length (months)', hint: '1, 2, 3 or 6' },
  menu_feature: { label: 'Featured menu item (one branch)', hint: 'two items of the branch' },
}

function NewExperiment({ onMade }) {
  const { branchId } = useAuth()
  const [kind, setKind] = useState('winback_offer')
  const [name, setName] = useState('')
  const [a, setA] = useState('5')
  const [b, setB] = useState('10')
  const [weeks, setWeeks] = useState('4')
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (kind !== 'menu_feature' || !branchId) return
    api('list_food_items', { branchId }).then((r) => { const list = (r.items ?? []).filter((i) => i.is_active !== false); setItems(list); setA(list[0]?.id ?? ''); setB(list[1]?.id ?? '') }).catch(() => setItems([]))
  }, [kind, branchId])
  const pick = (k) => { setKind(k); setA(k === 'next_exam_offer' ? '3' : k === 'winback_offer' ? '5' : ''); setB(k === 'next_exam_offer' ? '6' : k === 'winback_offer' ? '10' : '') }
  const label = (v) => (kind === 'menu_feature' ? items.find((i) => i.id === v)?.name ?? 'Item' : kind === 'winback_offer' ? `${v}%` : `${v} months`)
  const make = async (e) => {
    e.preventDefault(); setError('')
    const value = (v) => (kind === 'menu_feature' ? v : Number(v))
    try {
      await api('create_experiment', { kind, name: name || `${KINDS[kind].label.split(' (')[0]}: ${label(a)} vs ${label(b)}`, variants: [{ label: label(a), value: value(a) }, { label: label(b), value: value(b) }], weeks: Number(weeks), ...(kind === 'menu_feature' ? { branchId } : {}) })
      setName(''); onMade()
    } catch (err) { setError(err.message) }
  }
  return (
    <form onSubmit={make} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }} data-testid="new-experiment">
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="exp-kind">Test</label>
        <select id="exp-kind" value={kind} onChange={(e) => pick(e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      </div>
      {kind === 'menu_feature' ? (
        <>
          <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="exp-a">A</label><select id="exp-a" value={a} onChange={(e) => setA(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="exp-b">B</label><select id="exp-b" value={b} onChange={(e) => setB(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        </>
      ) : (
        <>
          <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="exp-a">A</label><input id="exp-a" type="number" value={a} onChange={(e) => setA(e.target.value)} style={{ width: 80 }} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="exp-b">B</label><input id="exp-b" type="number" value={b} onChange={(e) => setB(e.target.value)} style={{ width: 80 }} /></div>
        </>
      )}
      <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="exp-weeks">Weeks</label><input id="exp-weeks" type="number" min={1} max={12} value={weeks} onChange={(e) => setWeeks(e.target.value)} style={{ width: 70 }} /></div>
      <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}><label htmlFor="exp-name">Name (optional)</label><input id="exp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={KINDS[kind].hint} /></div>
      <button type="submit" className="btn btn-primary">Start</button>
      {error && <p className="error-msg" role="alert" style={{ width: '100%' }}>{error}</p>}
    </form>
  )
}

function ExperimentsTab() {
  const { data, error, load, setError } = useLoad(() => api('list_experiments'), [])
  const act = async (e, payload, ask) => {
    if (ask && !window.confirm(ask)) return
    try { await api('update_experiment', { experimentId: e.id, ...payload }); load() } catch (err) { setError(err.message) }
  }
  if (!data) return error ? <p className="error-msg">{error}</p> : <p>Loading…</p>
  const SETTING = { winback_offer: 'the win-back offer', next_exam_offer: 'the next-exam plan length', menu_feature: "the branch's featured item" }
  return (
    <div className="card" data-testid="experiments">
      <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Each student always sees the same variant. A winner is named only with 20 students per variant and a clear difference (p &lt; 0.1). Keeping a variant sets {Object.values(SETTING).join(', ')} for real.</p>
      <NewExperiment onMade={load} />
      {error && <p className="error-msg" role="alert">{error}</p>}
      {data.experiments.length === 0 ? <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>No experiments yet.</p> : data.experiments.map((e) => {
        const stats = e.live ?? e.result
        return (
          <div key={e.id} data-testid="experiment" style={{ borderTop: '1px solid #222', padding: '0.6rem 0', marginTop: '0.6rem' }}>
            <strong>{e.name}</strong> <span className="badge">{e.status}</span>{e.branch ? <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}> · {e.branch}</span> : null}
            {e.ends_at && e.status === 'running' && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}> · ends {formatDate(e.ends_at.slice(0, 10))}</span>}
            {stats && (
              <table className="data-table" style={{ marginTop: '0.4rem' }}>
                <thead><tr><th>Variant</th><th>Shown to</th><th>Came back / ordered</th><th>Rate</th></tr></thead>
                <tbody>{(stats.rows ?? []).map((r) => {
                  const v = (e.variants ?? []).find((x) => x.key === r.key)
                  return <tr key={r.key}><td>{r.key}: {v?.label}{(stats.winner ?? e.winner) === r.key ? ' 🏆' : ''}</td><td>{r.n}</td><td>{r.k}</td><td>{pct(r.rate)}</td></tr>
                })}</tbody>
              </table>
            )}
            {stats && <p style={{ margin: '0.3rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{stats.enough ? (stats.winner ? `A clear winner (p = ${stats.p}).` : `No clear difference yet (p = ${stats.p}).`) : 'Not enough students yet (20 per variant).'}</p>}
            {['running', 'ended'].includes(e.status) && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {(e.variants ?? []).map((v) => <button key={v.key} type="button" className="btn btn-ghost" onClick={() => act(e, { decision: 'keep', variant: v.key }, `Keep ${v.key} (${v.label})? This sets ${SETTING[e.kind]} for real.`)}>Keep {v.key}</button>)}
                {e.status === 'running' && <button type="button" className="btn btn-ghost" onClick={() => act(e, { decision: 'stop' })}>Stop</button>}
                <button type="button" className="btn btn-ghost" onClick={() => act(e, { decision: 'drop' }, 'Drop it? Nothing is changed.')}>Drop</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function YieldTab() {
  const { branchId, isCombinedHall } = useAuth()
  const { data, error } = useLoad(() => (branchId && !isCombinedHall ? api('get_space_yield', { branchId }) : Promise.resolve(null)), [branchId, isCombinedHall])
  if (!branchId || isCombinedHall) return <p style={{ color: 'var(--text-muted)' }}>Choose one branch at the top.</p>
  if (!data) return error ? <p className="error-msg">{error}</p> : <p>Loading…</p>
  const hours = Array.from({ length: 17 }, (_, i) => i + 6)
  const shade = (v) => `rgba(255, 184, 0, ${Math.min(1, v) * 0.85 + 0.05})`
  return (
    <div className="card" data-testid="yield">
      <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Open seats in use by weekday and hour, averaged over the last {data.weeks} weeks ({data.seats} open seats, {data.cabins} cabins; cabins used {pct(data.cabinUse)} of the day; {data.waitlist} waiting for a cabin).</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ fontSize: '0.7rem' }}>
          <thead><tr><th />{hours.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{data.grid.map((row, d) => (
            <tr key={d}><td>{DAYS[d]}</td>{hours.map((h) => <td key={h} title={`${DAYS[d]} ${h}:00 — ${pct(row[h])}`} style={{ background: shade(row[h]), color: row[h] > 0.5 ? '#000' : undefined, textAlign: 'center' }}>{Math.round(row[h] * 100)}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      <h4 style={{ marginBottom: '0.3rem' }}>Suggestions</h4>
      {data.suggestions.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Nothing stands out yet.</p> : <ul style={{ margin: 0 }}>{data.suggestions.map((s) => <li key={s.kind} data-testid="yield-suggestion">{s.text}</li>)}</ul>}
    </div>
  )
}

export default function LearningPage() {
  const flags = useFeatureFlags()
  const tabs = [
    flags.policyLearner && ['rules', 'Rules'],
    flags.digitalTwin && ['twin', 'What if'],
    flags.experiments && ['experiments', 'Experiments'],
    flags.spaceYield && ['yield', 'Space use'],
  ].filter(Boolean)
  const [tab, setTab] = useState(null)
  const current = tab && tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0]
  return (
    <>
      <div className="page-header"><h1>Learning</h1></div>
      {!tabs.length ? <p style={{ color: 'var(--text-muted)' }}>Nothing here is switched on yet. See docs/ops/DEPLOY.md, Part 6.</p> : (
        <>
          <div role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={current === k} className={`btn ${current === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          {current === 'rules' && <RulesTab />}
          {current === 'twin' && <TwinTab />}
          {current === 'experiments' && <ExperimentsTab />}
          {current === 'yield' && <YieldTab />}
        </>
      )}
    </>
  )
}
