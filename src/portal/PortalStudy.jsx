import { useCallback, useEffect, useState } from 'react'
import { copyText } from '../lib/clipboard'
import qrcode from 'qrcode-generator'
import { portalApi } from '../lib/api'
import { fmtDate, hoursText } from './portalUtils'

// PSS-AI Phases 5 and 6 — the portal's study pages: focus by time of day (SP18), the exam coach
// (SP19), Study Wrapped (SP20), a study buddy (SP21, both opt in, both say yes), verified study
// certificates (SP22) and a weekly summary link for the family (SP23). Every number is the
// server's, worked out from the student's own sessions.
const Loading = ({ error }) => (error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Loading…</p>)
const Off = () => <div className="card"><p>This page is not open yet.</p></div>
const WINDOW = { morning: 'Mornings (5–12)', afternoon: 'Afternoons (12–5)', evening: 'Evenings (5–9)', night: 'Nights (after 9)' }
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

function useMe(action, payload) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const key = JSON.stringify(payload ?? {})
  const load = useCallback(() => { setError(''); return portalApi(action, JSON.parse(key)).then(setData).catch((e) => setError(e.message)) }, [action, key])
  useEffect(() => { load() }, [load])
  return { data, error, load, setError }
}

const Bar = ({ value, max = 5 }) => (
  <span style={{ display: 'inline-block', width: 120, height: 8, background: '#222', borderRadius: 4, verticalAlign: 'middle', marginRight: 6 }}>
    <span style={{ display: 'block', width: `${Math.round(((value ?? 0) / max) * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
  </span>
)

export function PortalFocus() {
  const { data, error } = useMe('me_focus_profile')
  if (!data) return <Loading error={error} />
  if (!data.on) return <Off />
  return (
    <div className="card" data-testid="focus">
      <h2 style={{ marginTop: 0 }}>When you focus best</h2>
      {!data.enough ? <p>Rate your focus when you check out (1–5) — after 5 ratings you'll see your best time of day here. You have {data.ratings} so far.</p> : (
        <>
          {data.best && <p>Your best time: <strong>{WINDOW[data.best]}</strong>. Try to keep your hardest subjects for then.</p>}
          <table className="data-table"><tbody>
            {data.windows.map((w) => <tr key={w.window}><td>{WINDOW[w.window]}</td><td>{w.average == null ? '—' : <><Bar value={w.average} />{w.average}</>}</td><td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{w.ratings} rating{w.ratings === 1 ? '' : 's'}</td></tr>)}
          </tbody></table>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>By day: {data.weekdays.filter((d) => d.average != null).map((d) => `${DAYS[d.weekday]} ${d.average}`).join(' · ') || '—'}</p>
        </>
      )}
    </div>
  )
}

export function PortalCoach() {
  const { data, error } = useMe('me_exam_coach')
  if (!data) return <Loading error={error} />
  if (!data.on) return <Off />
  return (
    <div className="card" data-testid="coach">
      <h2 style={{ marginTop: 0 }}>Your exam coach</h2>
      {data.daysLeft != null ? <p style={{ fontSize: '1.2rem' }}><strong>{data.daysLeft} days</strong> to {data.examLabel ?? 'your exam'} ({fmtDate(data.examDate)})</p> : <p>{data.examLabel ? `Preparing for ${data.examLabel}. No exam date is confirmed yet.` : 'No exam on your profile yet.'}</p>}
      <p>Last two weeks: <strong>{data.avgHours} h a day</strong> (your plan: {data.target} h){data.onTrack ? ' — on track ✓' : ''}; you came in on {data.daysStudied} of 14 days.</p>
      <ul>{data.tips.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  )
}

const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export function PortalWrapped() {
  const [month, setMonth] = useState('')
  const { data, error } = useMe('me_wrapped', month ? { month } : {})
  if (!data) return <Loading error={error} />
  if (!data.on) return <Off />
  const thisMonth = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7)
  const prev = (m) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
  return (
    <div className="card" data-testid="wrapped">
      <h2 style={{ marginTop: 0 }}>Your {monthLabel(data.month)}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
        {[[hoursText(data.minutes), 'studied'], [data.days, 'days in'], [`${data.longestStreak} day${data.longestStreak === 1 ? '' : 's'}`, 'longest streak'], [data.bestDay ? `${hoursText(data.bestDay.minutes)}` : '—', data.bestDay ? `best day, ${fmtDate(data.bestDay.date)}` : 'best day'], [data.favouriteDesk ?? '—', 'favourite desk'], [data.focus ?? '—', 'average focus']].map(([v, l]) => (
          <div key={l} style={{ background: '#141414', borderRadius: 8, padding: '0.6rem' }}><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{v}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{l}</div></div>
        ))}
      </div>
      {data.percentile != null && <p>You studied more than <strong>{data.percentile}%</strong> of members at your branch this month.</p>}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-ghost" onClick={() => setMonth(prev(data.month))}>‹ {monthLabel(prev(data.month))}</button>
        {data.month < thisMonth && <button type="button" className="btn btn-ghost" onClick={() => setMonth(thisMonth)}>This month ›</button>}
      </div>
    </div>
  )
}

export function PortalBuddy() {
  const { data, error, load, setError } = useMe('me_buddy')
  const [win, setWin] = useState('evening')
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading error={error} />
  if (!data.on) return <Off />
  const act = async (action, payload) => { setBusy(true); setError(''); try { await portalApi(action, payload); await load() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const m = data.match
  return (
    <div className="card" data-testid="buddy">
      <h2 style={{ marginTop: 0 }}>Study buddy</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Get paired with a member of your branch preparing for the same exam at the same time of day. Names are shown only after you both say yes — never phone numbers. Meet at the hall.</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {!data.profile ? (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="buddy-window">When you usually study</label>
            <select id="buddy-window" value={win} onChange={(e) => setWin(e.target.value)}>{data.windows.map((w) => <option key={w} value={w}>{WINDOW[w]}</option>)}</select>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('me_buddy_join', { window: win })}>Find me a buddy</button>
        </div>
      ) : (
        <>
          <p>You're in: {WINDOW[data.profile.window]}{data.profile.exam ? ` · ${data.profile.exam}` : ''}. New pairs are made every Monday.</p>
          {m && m.status === 'proposed' && (
            <div data-testid="buddy-match" style={{ background: '#141414', borderRadius: 8, padding: '0.6rem', marginBottom: '0.5rem' }}>
              <p style={{ margin: '0 0 0.4rem' }}>We found someone{m.exam ? ` preparing for ${m.exam}` : ''}, studying {WINDOW[m.window]?.toLowerCase() ?? 'at your time'}.</p>
              {m.myAnswer ? <p style={{ margin: 0 }}>You said {m.myAnswer}. Waiting for them.</p> : (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('me_buddy_respond', { matchId: m.id, accept: true })}>Yes, pair us</button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('me_buddy_respond', { matchId: m.id, accept: false })}>No thanks</button>
                </div>
              )}
            </div>
          )}
          {m && m.status === 'connected' && <p data-testid="buddy-connected" style={{ background: '#0d1a0d', borderRadius: 8, padding: '0.6rem' }}>Your study buddy is <strong>{m.firstName}</strong> ({WINDOW[m.window]?.toLowerCase()}). Say hi at the hall!</p>}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('me_buddy_leave')}>Stop looking</button>
        </>
      )}
    </div>
  )
}

function printCertificate(c) {
  const qr = qrcode(0, 'M'); qr.addData(c.verifyUrl); qr.make()
  const w = window.open('', '_blank', 'width=800,height=900')
  if (!w) return
  const esc = (t) => String(t ?? '').replace(/[<>&"]/g, '')
  w.document.write(`<!doctype html><title>Study certificate — ${esc(c.name)}</title><body style="font-family:Georgia,serif;text-align:center;padding:48px;color:#111">
    <p style="letter-spacing:4px;font-size:14px;margin:0">${esc(c.hall)}</p>
    <h1 style="font-size:36px;margin:16px 0 8px">Certificate of study</h1>
    <p style="font-size:18px">This certifies that</p><p style="font-size:30px;margin:8px 0"><b>${esc(c.name)}</b></p>
    <p style="font-size:18px">studied at the hall for <b>${esc(c.hours)} hours</b> on <b>${esc(c.days)} days</b><br>between ${esc(fmtDate(c.from))} and ${esc(fmtDate(c.to))}.</p>
    <div style="margin:24px 0">${qr.createImgTag(5, 4)}</div>
    <p style="font-size:13px;color:#444">Check it: ${esc(c.verifyUrl)}<br>Certificate ${esc(c.id)} · issued ${esc(fmtDate(String(c.issuedAt).slice(0, 10)))}</p></body>`)
  w.document.close()
  // Printed from here: the new window keeps the site's CSP, which allows no inline script.
  w.focus()
  w.print()
}

export function PortalCertificates() {
  const { data, error, load, setError } = useMe('me_certificates')
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [copyNotice, setCopyNotice] = useState('')
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading error={error} />
  if (!data.on) return <Off />
  const issue = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await portalApi('me_issue_certificate', { dateFrom: from, dateTo: to }); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const revoke = async (c) => {
    if (!window.confirm('Withdraw this certificate? Its check link will then say it was withdrawn.')) return
    try { await portalApi('me_revoke_certificate', { id: c.id }); await load() } catch (err) { setError(err.message) }
  }
  return (
    <div className="card" data-testid="certificates">
      <h2 style={{ marginTop: 0 }}>Study certificates</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>A signed record of your real study hours, with a link and QR code anyone can use to check it. Up to 12 months at a time.</p>
      <form onSubmit={issue} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="cert-from">From</label><input id="cert-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="form-group" style={{ marginBottom: 0 }}><label htmlFor="cert-to">To</label><input id="cert-to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Making…' : 'Make a certificate'}</button>
      </form>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <ul className="portal-list" style={{ marginTop: '0.75rem' }}>
        {data.certificates.map((c) => (
          <li key={c.id} data-testid="certificate" style={{ display: 'block' }}>
            <strong>{c.hours} h · {c.days} days</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{fmtDate(c.from)} – {fmtDate(c.to)}{c.revoked ? ' · withdrawn' : ''}</span>
            {!c.revoked && (
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" onClick={() => printCertificate(c)}>🖨 Print</button>
                <button type="button" className="btn btn-ghost" onClick={async () => setCopyNotice(await copyText(c.verifyUrl) ? 'Check link copied.' : `Copy this check link: ${c.verifyUrl}`)}>Copy check link</button>
                <button type="button" className="btn btn-ghost" onClick={() => revoke(c)}>Withdraw</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {copyNotice && <p role="status" style={{ overflowWrap: 'anywhere', marginTop: '0.75rem' }}>{copyNotice}</p>}
    </div>
  )
}

export function PortalFamily() {
  const { data, error, load, setError } = useMe('me_parent_info')
  const [url, setUrl] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading error={error} />
  if (!data.on) return <Off />
  const make = async () => {
    if (data.link && !window.confirm('Make a new link? The old one stops working at once.')) return
    setBusy(true); setError('')
    try { const r = await portalApi('me_parent_link'); setUrl(r.url); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const stop = async () => {
    if (!window.confirm('Stop the link? Your family will no longer see the summary.')) return
    try { await portalApi('me_revoke_parent_link'); setUrl(''); await load() } catch (e) { setError(e.message) }
  }
  const share = () => window.open(`https://wa.me/?text=${encodeURIComponent(`My weekly study summary at Perfect Study Space: ${url}`)}`, '_blank', 'noopener,noreferrer')
  return (
    <div className="card" data-testid="family">
      <h2 style={{ marginTop: 0 }}>A weekly summary for your family</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>A read-only page with your hours each day, days attended, average focus and when your plan ends — updated every Sunday evening. No amounts, phone numbers or messages. You can stop it any time.</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {url && (
        <div data-testid="family-link" style={{ background: '#141414', borderRadius: 8, padding: '0.6rem', wordBreak: 'break-all' }}>
          <p style={{ margin: '0 0 0.4rem' }}>Send this link to your family (it is shown only now):</p>
          <code>{url}</code>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
            <button type="button" className="btn btn-primary" onClick={share}>Share on WhatsApp</button>
            <button type="button" className="btn btn-ghost" onClick={async () => setCopyNotice(await copyText(url) ? 'Link copied.' : 'Copy the link shown above manually.')}>Copy</button>
          </div>
        </div>
      )}
      {copyNotice && <p role="status">{copyNotice}</p>}
      {data.link ? (
        <p>A link is live since {fmtDate(String(data.link.createdAt).slice(0, 10))}{data.link.lastViewedAt ? `; last opened ${fmtDate(String(data.link.lastViewedAt).slice(0, 10))}` : '; not opened yet'}.</p>
      ) : !url && <p>No link yet.</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={make}>{data.link ? 'Make a new link' : 'Make the link'}</button>
        {data.link && <button type="button" className="btn btn-ghost" onClick={stop}>Stop the link</button>}
      </div>
    </div>
  )
}
