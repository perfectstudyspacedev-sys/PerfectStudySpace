import { useCallback, useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { api } from '../lib/api'

// PSS-AI Phase 4 (SP13, I4) — the owner's self check-in poster for a branch: where the hall is
// (D9: students must be within 100 m), the QR poster to print, and a new key when a poster must
// stop working. With seat matching on, also what each open seat offers.
const TAG_LABEL = { window: 'Window', power: 'Power', quiet: 'Quiet', ac: 'AC' }

function Qr({ url }) {
  const src = useMemo(() => { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); return qr.createDataURL(6, 2) }, [url])
  return <img src={src} alt="Check-in QR code" style={{ width: 180, height: 180, background: '#fff', padding: 6, borderRadius: 8 }} />
}

function printPoster(name, url) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make()
  const w = window.open('', '_blank', 'width=700,height=900')
  if (!w) return
  w.document.write(`<!doctype html><title>Check in — ${name}</title><body style="font-family:sans-serif;text-align:center;padding:40px">
    <h1 style="font-size:40px;margin:0 0 8px">Check in here</h1><p style="font-size:22px;margin:0 0 24px">${name.replace(/[<>&]/g, '')} · Perfect Study Space</p>
    ${qr.createImgTag(10, 4)}
    <p style="font-size:20px">1. Open your phone camera and scan.<br>2. Log in to the student portal.<br>3. Tap <b>Check in</b>.</p>
    <p style="font-size:16px;color:#555">Your phone checks you are inside the hall. You can always check in at the desk.</p></body>`)
  w.document.close()
  // Printed from here: the new window keeps the site's CSP, which allows no inline script.
  w.focus()
  setTimeout(() => w.print(), 300)
}

export default function SelfCheckinCard({ branchId }) {
  const [data, setData] = useState(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const r = await api('get_checkin_settings', { branchId })
      setData(r)
      const b = r.branches.find((x) => x.id === branchId)
      setLat(b?.latitude ?? ''); setLng(b?.longitude ?? '')
    } catch (e) { setError(e.message) }
  }, [branchId])
  useEffect(() => { if (branchId) load() }, [branchId, load])
  if (!data) return error ? <div className="card"><p className="error-msg">{error}</p></div> : null
  const b = data.branches.find((x) => x.id === branchId)
  if (!b) return null
  const here = () => navigator.geolocation?.getCurrentPosition(
    (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setMsg(`Read with ±${Math.round(p.coords.accuracy)} m accuracy — save it if you are inside the hall.`) },
    () => setError('Could not read this device\'s location'), { enableHighAccuracy: true, timeout: 15000 })
  const save = async () => { setError(''); setMsg(''); try { await api('set_branch_location', { branchId, latitude: Number(lat), longitude: Number(lng) }); setMsg('Location saved.'); load() } catch (e) { setError(e.message) } }
  const rotate = async () => {
    if (b.posterUrl && !window.confirm('Make a new poster? The old printed poster stops working at once.')) return
    setError(''); try { await api('rotate_checkin_key', { branchId }); setMsg('New poster ready — print it and replace the old one.'); load() } catch (e) { setError(e.message) }
  }
  const toggleTag = async (d, t) => {
    const tags = d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t]
    try { await api('set_desk_tags', { deskId: d.id, tags }); load() } catch (e) { setError(e.message) }
  }
  return (
    <div className="card" data-testid="self-checkin-card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>Self check-in — {b.name}</h3>
      {!data.on && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Self check-in is switched off; you can set the branch up now.</p>}
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Students must be within 100 m of this point. Stand inside the hall and press "Use this device's location", or type it from a map.</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
        <input aria-label="Latitude" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} style={{ width: 130 }} />
        <input aria-label="Longitude" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} style={{ width: 130 }} />
        <button type="button" className="btn btn-ghost" onClick={here}>📍 Use this device's location</button>
        <button type="button" className="btn btn-primary" disabled={lat === '' || lng === ''} onClick={save}>Save location</button>
      </div>
      {b.posterUrl ? (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Qr url={b.posterUrl} />
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <button type="button" className="btn btn-primary" disabled={!b.ready} onClick={() => printPoster(b.name, b.posterUrl)}>🖨 Print poster</button>
            <button type="button" className="btn btn-ghost" onClick={rotate}>New poster (old one stops working)</button>
            {!b.ready && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Save the location first.</span>}
          </div>
        </div>
      ) : <button type="button" className="btn btn-primary" onClick={rotate}>Make the check-in poster</button>}
      {data.seatMatching && data.desks?.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4 style={{ margin: '0 0 0.4rem' }}>What each open seat has</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>Students who ask for these are seated at matching desks when they check in.</p>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            {data.desks.map((d) => (
              <div key={d.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 50 }}>{d.label}</strong>
                {data.tags.map((t) => <button key={t} type="button" className={`chip${d.tags.includes(t) ? ' on' : ''}`} aria-pressed={d.tags.includes(t)} onClick={() => toggleTag(d, t)}>{TAG_LABEL[t] ?? t}</button>)}
              </div>
            ))}
          </div>
        </div>
      )}
      {msg && <p className="success-msg" role="status">{msg}</p>}
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  )
}
