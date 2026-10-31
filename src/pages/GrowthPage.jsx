import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatCurrency, formatDate, todayISO } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { copyText } from '../lib/clipboard'

// PSS-AI Phase 3 — the owner's growth tools, one tab each: today's walk-in prices (I3), seat hours
// resold (O1/SP10), referral links (C10) and the exam calendar (I25). Each tab shows only when
// its switch is on; prices and amounts always come from the server.
const CHANNEL_LABEL = { instagram: 'Instagram', google: 'Google', flex_banner: 'Flex banner', friend: 'Friend', whatsapp: 'WhatsApp', other: 'Other' }
const hm = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—')

export default function GrowthPage() {
  const flags = useFeatureFlags()
  const tabs = [
    flags.yieldPricing && ['prices', 'Walk-in prices'],
    (flags.hourRelease || flags.overbooking) && ['resales', 'Seat resales'],
    flags.referralLinks && ['referrals', 'Referral links'],
    // Hand-entered exams drive prices, win-back and next-exam plans too, not only the radar.
    (flags.examRadar || flags.nextExam || flags.winback || flags.yieldPricing) && ['exams', 'Exam calendar'],
  ].filter(Boolean)
  const [tab, setTab] = useState(null)
  const current = tab && tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0]
  return (
    <>
      <div className="page-header"><h1>Growth</h1></div>
      {!tabs.length ? (
        <p style={{ color: 'var(--text-muted)' }}>Nothing here is switched on yet. See docs/ops/DEPLOY.md, Part 4.</p>
      ) : (
        <>
          <div role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={current === k} className={`btn ${current === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          {current === 'prices' && <PricesTab />}
          {current === 'resales' && <ResalesTab />}
          {current === 'referrals' && <ReferralsTab />}
          {current === 'exams' && <ExamsTab />}
        </>
      )}
    </>
  )
}

function useLoad(action, payload = {}) {
  const key = JSON.stringify(payload)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setError('')
    return api(action, JSON.parse(key)).then(setData).catch((e) => setError(e.message))
  }, [action, key])
  useEffect(() => { load() }, [load])
  return { data, error, setError, load }
}

function PricesTab() {
  const { data, error, setError, load } = useLoad('list_walkin_prices')
  const [form, setForm] = useState({ branchId: '', date: todayISO(), changePct: '', reason: '' })
  if (!data) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  const save = async (clear = false) => {
    try {
      await api('set_walkin_price_day', { branchId: form.branchId, date: form.date, changePct: clear ? null : Number(form.changePct), reason: form.reason })
      setForm((f) => ({ ...f, changePct: '', reason: '' }))
      load()
    } catch (e) { setError(e.message) }
  }
  const byBranch = (id) => data.days.filter((d) => d.branch_id === id)
  return (
    <>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Each night the price change for the day is worked out from how full each branch usually is on that weekday, plus 5% when a confirmed exam is within 30 days. Your limits: {data.limits.floor}% to +{data.limits.ceiling}% (never beyond ±20%). Base prices: {data.tiers.map((t) => `up to ${t.maxHours}h ${formatCurrency(t.fee)}`).join(' · ')}.
      </p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {data.branches.map((b) => (
        <div key={b.id} className="card" style={{ marginBottom: '0.75rem' }} data-testid="price-branch">
          <strong>{b.name}</strong>
          {byBranch(b.id).length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No change set — base prices apply.</p> : (
            <table style={{ width: '100%', fontSize: '0.85rem', marginTop: '0.4rem' }}>
              <tbody>
                {byBranch(b.id).map((d) => (
                  <tr key={d.price_date}>
                    <td>{formatDate(d.price_date)}</td>
                    <td className="mono">{d.change_pct > 0 ? '+' : ''}{d.change_pct}%</td>
                    <td style={{ color: 'var(--text-muted)' }}>{d.source === 'owner' ? '✋ ' : ''}{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <div className="card">
        <strong>Set a day yourself</strong>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <select aria-label="Branch" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">Branch…</option>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" aria-label="Day" value={form.date} min={todayISO()} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input type="number" aria-label="Change in percent" placeholder="% e.g. 10 or -10" value={form.changePct} min={data.limits.floor} max={data.limits.ceiling} onChange={(e) => setForm({ ...form, changePct: e.target.value })} style={{ width: 130 }} />
          <input aria-label="Why" placeholder="Why (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button type="button" className="btn btn-primary" disabled={!form.branchId || form.changePct === ''} onClick={() => save(false)}>Save</button>
          <button type="button" className="btn btn-ghost" disabled={!form.branchId} onClick={() => save(true)}>Back to automatic</button>
        </div>
      </div>
    </>
  )
}

function ResalesTab() {
  const { data, error } = useLoad('list_seat_resales')
  if (!data) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  const s = data.summary
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {[['Resales (30 days)', s.resales], ['Hours sold', s.hours], ['Walk-in money', formatCurrency(s.revenue)], ['Credits to members', formatCurrency(s.credits)], ['Member arrived anyway', s.collisions], ['Free days given', s.freeDays]].map(([label, v]) => (
          <div key={label} className="card"><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</div><div className="mono" style={{ fontSize: '1.2rem' }}>{v}</div></div>
        ))}
      </div>
      {data.resales.length === 0 ? <p>No resales yet.</p> : (
        <table style={{ width: '100%', fontSize: '0.85rem' }}>
          <thead><tr><th align="left">When</th><th align="left">Desk</th><th align="left">Kind</th><th align="right">Paid</th><th align="right">Credit</th><th align="left">Member came?</th></tr></thead>
          <tbody>
            {data.resales.map((r) => (
              <tr key={r.id}>
                <td>{hm(r.from)}–{hm(r.to).split(', ').pop()}</td><td>{r.branch} · {r.desk}</td>
                <td>{r.source === 'member' ? 'Released by member' : 'Predicted free'}</td>
                <td align="right" className="mono">{formatCurrency(r.amount)}</td><td align="right" className="mono">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                <td>{{ fallback_desk: 'Yes — given another desk', free_day: 'Yes — one free day', no_desk: 'Yes — no desk free' }[r.collision] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function ReferralsTab() {
  const { data, error, setError, load } = useLoad('list_referral_links')
  const [form, setForm] = useState({ branchId: '', channel: 'instagram', label: '' })
  const [copyNotice, setCopyNotice] = useState('')
  const { data: branches } = useLoad('list_walkin_prices')
  if (!data) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  const create = async () => {
    try { await api('create_referral_link', form); setForm((f) => ({ ...f, label: '' })); load() } catch (e) { setError(e.message) }
  }
  const toggle = async (l) => { try { await api('update_referral_link', { id: l.id, isActive: !l.isActive }); load() } catch (e) { setError(e.message) } }
  const copy = async url => setCopyNotice(await copyText(url) ? 'Link copied.' : `Copy this link: ${url}`)
  return (
    <>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>One link per place you advertise. People who sign up or chat through it are counted; "joined" means they took a membership. Making a new sign-up link never breaks these.</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select aria-label="Branch" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">Branch…</option>
            {(branches?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select aria-label="Channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            {data.channels.filter((c) => c !== 'friend').map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
          <input aria-label="Label" placeholder="Label, e.g. Bus stop banner" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <button type="button" className="btn btn-primary" disabled={!form.branchId} onClick={create}>Make link</button>
        </div>
      </div>
      {copyNotice && <p role="status" style={{ overflowWrap: 'anywhere', marginBottom: '0.75rem' }}>{copyNotice}</p>}
      <div className="table-scroll">
      <table style={{ width: '100%', fontSize: '0.85rem' }} data-testid="referral-table">
        <thead><tr><th align="left">Link</th><th align="left">Channel</th><th align="right">Sign-ups</th><th align="right">Chats</th><th align="right">Joined</th><th /></tr></thead>
        <tbody>
          {data.links.map((l) => (
            <tr key={l.id} style={{ opacity: l.isActive ? 1 : 0.5 }}>
              <td><button type="button" className="btn btn-ghost" title="Copy" onClick={() => copy(l.url)} style={{ padding: '0.1rem 0.4rem' }}>📋</button> <span className="mono">{l.url.replace(/^https?:\/\//, '')}</span><div style={{ color: 'var(--text-muted)' }}>{l.branch}{l.label ? ` · ${l.label}` : ''}{l.referrer ? ` · ${l.referrer}` : ''}</div></td>
              <td>{CHANNEL_LABEL[l.channel] ?? l.channel}</td>
              <td align="right">{l.signups}</td><td align="right">{l.enquiries}</td><td align="right"><strong>{l.joined}</strong></td>
              <td align="right"><button type="button" className="btn btn-ghost" onClick={() => toggle(l)}>{l.isActive ? 'Switch off' : 'Switch on'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  )
}

function ExamsTab() {
  const { data, error, setError, load } = useLoad('list_exam_notices')
  const [form, setForm] = useState({ examName: '', examDate: '', applyBy: '' })
  if (!data) return error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  const review = async (n, decision) => { try { await api('review_exam_notice', { id: n.id, decision }); load() } catch (e) { setError(e.message) } }
  const add = async () => {
    try { await api('add_exam_notice', { examName: form.examName, examDate: form.examDate || undefined, applyBy: form.applyBy || undefined }); setForm({ examName: '', examDate: '', applyBy: '' }); load() } catch (e) { setError(e.message) }
  }
  const suggested = data.notices.filter((n) => n.status === 'suggested')
  const confirmed = data.notices.filter((n) => n.status === 'confirmed')
  const row = (n, actions) => (
    <tr key={n.id}>
      <td>{n.exam_name}<div style={{ color: 'var(--text-muted)' }}>{n.source.toUpperCase()}{n.label && n.label !== n.exam_name ? ` · ${n.label}` : ''}</div></td>
      <td>{n.apply_by ? formatDate(n.apply_by) : '—'}</td><td>{n.exam_date ? formatDate(n.exam_date) : '—'}</td>
      <td align="right">{n.students}</td><td align="right">{actions}</td>
    </tr>
  )
  return (
    <>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Each morning the radar reads the exam boards' public pages and suggests what it found. Only confirmed exams change prices, win-back offers and next-exam plans. "Students" counts members who wrote that exam as what they prepare for.</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {suggested.length > 0 && (
        <>
          <h3 style={{ marginTop: '0.9rem' }}>Waiting for you ({suggested.length})</h3>
          <table style={{ width: '100%', fontSize: '0.85rem', marginBottom: '1rem' }} data-testid="exam-suggested">
            <thead><tr><th align="left">Exam</th><th align="left">Apply by</th><th align="left">Exam date</th><th align="right">Students</th><th /></tr></thead>
            <tbody>{suggested.map((n) => row(n, <><button type="button" className="btn btn-primary" onClick={() => review(n, 'confirm')}>Confirm</button> <button type="button" className="btn btn-ghost" onClick={() => review(n, 'dismiss')}>Dismiss</button></>))}</tbody>
          </table>
        </>
      )}
      <h3 style={{ marginTop: '0.9rem' }}>Confirmed</h3>
      {confirmed.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>None yet.</p> : (
        <table style={{ width: '100%', fontSize: '0.85rem', marginBottom: '1rem' }}>
          <thead><tr><th align="left">Exam</th><th align="left">Apply by</th><th align="left">Exam date</th><th align="right">Students</th><th /></tr></thead>
          <tbody>{confirmed.map((n) => row(n, null))}</tbody>
        </table>
      )}
      <div className="card">
        <strong>Add an exam by hand</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>(when a board's page can't be read)</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <input aria-label="Exam name" placeholder="e.g. TNPSC Group 4 2027" value={form.examName} onChange={(e) => setForm({ ...form, examName: e.target.value })} style={{ minWidth: 220 }} />
          <label style={{ fontSize: '0.8rem' }}>Apply by <input type="date" value={form.applyBy} onChange={(e) => setForm({ ...form, applyBy: e.target.value })} /></label>
          <label style={{ fontSize: '0.8rem' }}>Exam date <input type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} /></label>
          <button type="button" className="btn btn-primary" disabled={form.examName.trim().length < 2 || (!form.examDate && !form.applyBy)} onClick={add}>Add</button>
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.75rem' }}>Exam ladder (next-exam plans): {data.ladder.map((r) => r.join(' → ')).join(' · ')}. Change it with the <code>exam_ladder</code> setting.</p>
    </>
  )
}
