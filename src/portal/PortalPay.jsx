import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { portalApi } from '../lib/api'
import QrCode from '../components/UpiQr'
import { PURPOSE_LABEL, rupees, shrinkImage } from './portalUtils'

// PSS-AI P2.2 — pay by UPI and send the proof. The amount always comes from the server; the
// owner confirms each payment (D2: 08:00–22:00 IST, usually within 2 hours).
const FOOD_PASS_CHIPS = [200, 500, 1000]

export default function PortalPay() {
  const [params] = useSearchParams()
  const [info, setInfo] = useState(null)
  const [choice, setChoice] = useState({ purpose: params.get('purpose') ?? '', months: 1, amount: 500 })
  const [request, setRequest] = useState(null)       // { reference, amount, label, upiLink, vpa, payeeName }
  const [step, setStep] = useState('choose')
  const [utr, setUtr] = useState('')
  const [shot, setShot] = useState(null)             // { data, name }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    portalApi('me_membership').then((m) => {
      setInfo(m)
      const ref = params.get('ref')
      const open = ref && m.openPayments.find((p) => p.reference === ref && p.status === 'requested')
      if (open) { setRequest({ reference: open.reference, amount: open.amount, label: PURPOSE_LABEL[open.purpose] }); setStep('proof') }
      if (m.renewalQuotes?.length) setChoice((c) => ({ ...c, months: m.renewalQuotes[0].months }))
    }).catch((err) => setError(err.message))
  }, [params])

  if (error && !info) return <p className="error-msg">{error}</p>
  if (!info) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  if (!info.upiPay) return <div className="card"><p>Paying in the portal is not open yet — please pay at the desk.</p></div>

  const m = info.membership
  const options = [
    info.renewalQuotes.length > 0 && { purpose: 'renewal', label: 'Renew my plan' },
    m?.feeDue > 0 && { purpose: 'dues', label: `Pay dues ${rupees(m.feeDue)}` },
    info.locker && info.locker.feeDue === 0 && { purpose: 'locker', label: `Locker ${info.locker.lockerNo}, one month ${rupees(info.locker.monthlyFee)}` },
    m && { purpose: 'food_pass', label: 'Top up Food Pass' },
  ].filter(Boolean)

  const ask = async () => {
    setBusy(true)
    setError('')
    try {
      const payload = choice.purpose === 'renewal' ? { months: choice.months } : choice.purpose === 'food_pass' ? { amount: Number(choice.amount) } : {}
      const r = await portalApi('me_payment_request', { purpose: choice.purpose, ...payload })
      setRequest(r)
      setStep('pay')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pickShot = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try { setShot({ ...(await shrinkImage(file)), name: file.name }) } catch (err) { setError(err.message); setShot(null) }
  }

  const sendProof = async (e) => {
    e.preventDefault()
    if (utr && !/^\d{12}$/.test(utr)) return setError('The UTR (UPI reference number) is 12 digits')
    if (!utr && !shot) return setError('Type the 12-digit UTR, add a screenshot, or both')
    setBusy(true)
    setError('')
    try {
      await portalApi('me_submit_payment_proof', { reference: request.reference, ...(utr ? { utr } : {}), ...(shot ? { image: { data: shot.data } } : {}) })
      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 style={{ marginBottom: '0.75rem' }}>Pay</h2>
      {error && <p className="error-msg" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</p>}

      {step === 'choose' && (
        <div className="card">
          {options.length === 0 ? <p>There is nothing to pay right now.</p> : (
            <>
              <fieldset style={{ border: 0 }}>
                <legend style={{ marginBottom: '0.5rem' }}>What are you paying for?</legend>
                {options.map((o) => (
                  <label key={o.purpose} className="portal-radio">
                    <input type="radio" name="purpose" value={o.purpose} checked={choice.purpose === o.purpose} onChange={() => setChoice((c) => ({ ...c, purpose: o.purpose }))} />
                    {o.label}
                  </label>
                ))}
              </fieldset>
              {choice.purpose === 'renewal' && (
                <div className="chip-row" role="group" aria-label="Months" style={{ marginTop: '0.75rem' }}>
                  {info.renewalQuotes.map((q) => (
                    <button key={q.months} type="button" className={`chip${choice.months === q.months ? ' on' : ''}`} aria-pressed={choice.months === q.months} onClick={() => setChoice((c) => ({ ...c, months: q.months }))}>
                      {q.months} mo · {rupees(q.amount)}
                    </button>
                  ))}
                </div>
              )}
              {choice.purpose === 'food_pass' && (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label htmlFor="fp-amount">Amount (₹100 – ₹5,000)</label>
                  <div className="chip-row" style={{ marginBottom: '0.5rem' }}>
                    {FOOD_PASS_CHIPS.map((a) => <button key={a} type="button" className={`chip${Number(choice.amount) === a ? ' on' : ''}`} onClick={() => setChoice((c) => ({ ...c, amount: a }))}>{rupees(a)}</button>)}
                  </div>
                  <input id="fp-amount" inputMode="numeric" value={choice.amount} onChange={(e) => setChoice((c) => ({ ...c, amount: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                </div>
              )}
              <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} disabled={busy || !choice.purpose} onClick={ask}>
                {busy ? 'Working…' : 'Continue'}
              </button>
            </>
          )}
        </div>
      )}

      {step === 'pay' && request && (
        <div className="card" data-testid="pay-step">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{request.label}</p>
          <div className="portal-big">{rupees(request.amount)}</div>
          <p style={{ fontSize: '0.85rem', margin: '0.4rem 0 0.9rem' }}>Reference <span className="mono">{request.reference}</span> — keep it in the payment note.</p>
          <a className="btn btn-primary" href={request.upiLink} style={{ display: 'block', textAlign: 'center' }}>Pay with a UPI app</a>
          <div className="portal-qr-box">
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>On a computer? Scan this with your phone's UPI app.</p>
            <QrCode link={request.upiLink} />
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>Paying to {request.payeeName} · <span className="mono">{request.vpa}</span></p>
          <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: '1rem' }} onClick={() => setStep('proof')}>I have paid — send the proof</button>
        </div>
      )}

      {step === 'proof' && request && (
        <form className="card" onSubmit={sendProof} data-testid="proof-step">
          <p style={{ marginBottom: '0.75rem' }}>{request.label} · <strong>{rupees(request.amount)}</strong> · <span className="mono">{request.reference}</span></p>
          <div className="form-group">
            <label htmlFor="proof-utr">UTR / UPI reference number (12 digits)</label>
            <input id="proof-utr" inputMode="numeric" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="e.g. 431298765012" />
          </div>
          <div className="form-group">
            <label htmlFor="proof-shot">Screenshot of the payment</label>
            <input id="proof-shot" type="file" accept="image/*" onChange={pickShot} />
            {shot && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ready: {shot.name}</p>}
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Sending…' : 'Send proof'}</button>
        </form>
      )}

      {step === 'done' && (
        <div className="card" data-testid="pay-done">
          <p style={{ fontWeight: 700, color: '#4ade80' }}>Sent — thank you!</p>
          <p style={{ fontSize: '0.9rem', margin: '0.5rem 0' }}>The owner checks UPI payments between 8 am and 10 pm, usually within 2 hours. You will see it in Receipts once it is confirmed.</p>
          <Link to="/me" className="btn btn-ghost">Back home</Link>
        </div>
      )}
    </>
  )
}
