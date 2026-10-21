import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import UpiQr from './UpiQr'
import PrivacyNotice from '../portal/PrivacyNotice'
import { rupees, shrinkImage } from '../portal/portalUtils'

// PSS-AI P2.4 A3 — after the sign-up form, when the owner has switched self-pay on: pick a plan,
// choose a portal PIN, optionally add an ID photo (C3), and pay by UPI. The owner confirms the
// payment and the registration completes; the amount always comes from the server.
export default function SignupPayment({ code, refCode, phone }) {
  const [info, setInfo] = useState(null)
  const [plan, setPlan] = useState({ key: '', months: 1 })
  const [pin, setPin] = useState({ a: '', b: '', accept: false })
  const [idPhoto, setIdPhoto] = useState(null)
  const [request, setRequest] = useState(null)
  const [utr, setUtr] = useState('')
  const [shot, setShot] = useState(null)
  const [step, setStep] = useState('plan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { api('public_signup_plans', { code }).then(setInfo).catch(() => setInfo({ selfPay: false })) }, [code])
  if (!info?.selfPay) return null

  const chosen = info.plans.find((p) => `${p.category}:${p.hoursPerDay}` === plan.key)
  const discount = info.months.find((m) => m.months === plan.months)?.discountPercent ?? 0
  const estimate = chosen ? Math.round(chosen.monthlyFee * plan.months * (1 - discount / 100)) : 0
  const pick = (setter) => async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try { setter({ ...(await shrinkImage(file)), name: file.name }) } catch (err) { setError(err.message) }
  }

  const askToPay = async () => {
    if (!chosen) return setError('Choose a plan')
    if (!/^\d{6}$/.test(pin.a)) return setError('Choose a 6-digit PIN for the student portal')
    if (pin.a !== pin.b) return setError('The two PINs are not the same')
    if (!pin.accept) return setError('Please read and accept the privacy notice')
    setBusy(true); setError('')
    try {
      const r = await api('public_signup_pay', { code, ref: refCode, phone, category: chosen.category, hoursPerDay: chosen.hoursPerDay, months: plan.months, pin: pin.a, acceptPrivacy: true, ...(idPhoto ? { idPhoto: { data: idPhoto.data } } : {}) })
      setRequest(r)
      setStep('pay')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const sendProof = async (e) => {
    e.preventDefault()
    if (utr && !/^\d{12}$/.test(utr)) return setError('The UTR (UPI reference number) is 12 digits')
    if (!utr && !shot) return setError('Type the 12-digit UTR, add a screenshot, or both')
    setBusy(true); setError('')
    try {
      await api('public_signup_proof', { code, ref: refCode, phone, reference: request.reference, ...(utr ? { utr } : {}), ...(shot ? { image: { data: shot.data } } : {}) })
      setStep('done')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div data-testid="signup-pay" style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', textAlign: 'left' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Finish now: choose a plan and pay by UPI</h3>
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.6rem' }}>{error}</p>}
      {step === 'plan' && (
        <>
          <div className="form-group">
            <label htmlFor="su-plan">Plan</label>
            <select id="su-plan" value={plan.key} onChange={(e) => setPlan((p) => ({ ...p, key: e.target.value }))}>
              <option value="">Choose a plan</option>
              {info.plans.map((p) => <option key={`${p.category}:${p.hoursPerDay}`} value={`${p.category}:${p.hoursPerDay}`}>{p.category === 'permanent' ? 'Permanent seat' : 'Any free seat'}, {p.hoursPerDay} h a day — {rupees(p.monthlyFee)}/month</option>)}
            </select>
          </div>
          <div className="chip-row" role="group" aria-label="Months" style={{ marginBottom: '0.75rem' }}>
            {info.months.map((m) => <button key={m.months} type="button" className={`chip${plan.months === m.months ? ' on' : ''}`} aria-pressed={plan.months === m.months} onClick={() => setPlan((p) => ({ ...p, months: m.months }))}>{m.months} mo{m.discountPercent ? ` (−${m.discountPercent}%)` : ''}</button>)}
          </div>
          {chosen && <p style={{ marginBottom: '0.75rem' }}>About <strong>{rupees(estimate)}</strong> — the exact amount is shown next.</p>}
          <div className="form-group">
            <label htmlFor="su-pin">Choose a 6-digit PIN for your student portal</label>
            <input id="su-pin" type="password" inputMode="numeric" value={pin.a} onChange={(e) => setPin((x) => ({ ...x, a: e.target.value.replace(/\D/g, '').slice(0, 6) }))} autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label htmlFor="su-pin2">Type the PIN again</label>
            <input id="su-pin2" type="password" inputMode="numeric" value={pin.b} onChange={(e) => setPin((x) => ({ ...x, b: e.target.value.replace(/\D/g, '').slice(0, 6) }))} autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label htmlFor="su-id">ID photo (optional — Aadhaar or college ID)</label>
            <input id="su-id" type="file" accept="image/*" onChange={pick(setIdPhoto)} />
            {idPhoto && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ready: {idPhoto.name}</p>}
          </div>
          <details style={{ marginBottom: '0.6rem' }}><summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>Privacy notice</summary><div style={{ marginTop: '0.4rem' }}><PrivacyNotice /></div></details>
          <label style={{ display: 'flex', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            <input type="checkbox" checked={pin.accept} onChange={(e) => setPin((x) => ({ ...x, accept: e.target.checked }))} /> I have read the privacy notice and agree
          </label>
          <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={askToPay}>{busy ? 'Working…' : 'Continue to payment'}</button>
        </>
      )}
      {step === 'pay' && request && (
        <div data-testid="signup-pay-step">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{request.label}</p>
          <div className="portal-big">{rupees(request.amount)}</div>
          <p style={{ fontSize: '0.85rem', margin: '0.4rem 0 0.8rem' }}>Reference <span className="mono">{request.reference}</span></p>
          <a className="btn btn-primary" href={request.upiLink} style={{ display: 'block', textAlign: 'center' }}>Pay with a UPI app</a>
          <div className="portal-qr-box"><UpiQr link={request.upiLink} /></div>
          <form onSubmit={sendProof} style={{ marginTop: '1rem' }}>
            <div className="form-group">
              <label htmlFor="su-utr">After paying: UTR / UPI reference number (12 digits)</label>
              <input id="su-utr" inputMode="numeric" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))} />
            </div>
            <div className="form-group">
              <label htmlFor="su-shot">or a screenshot of the payment</label>
              <input id="su-shot" type="file" accept="image/*" onChange={pick(setShot)} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Sending…' : 'Send proof'}</button>
          </form>
        </div>
      )}
      {step === 'done' && (
        <p data-testid="signup-pay-done" style={{ color: '#4ade80' }}>
          Sent! The owner confirms payments between 8 am and 10 pm, usually within 2 hours. Then log in at /me with your phone number and PIN.
        </p>
      )}
    </div>
  )
}
