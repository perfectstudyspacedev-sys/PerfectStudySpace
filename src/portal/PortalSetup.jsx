import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { portalApi, setStudentToken } from '../lib/api'
import PrivacyNotice from './PrivacyNotice'

// PSS-AI P2.1 SP1 — the desk's 6-digit setup code + a new PIN (also how a forgotten PIN is reset).
export default function PortalSetup() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [form, setForm] = useState({ phone: (params.get('p') ?? '').replace(/\D/g, '').slice(0, 10), code: '', pin: '', pin2: '', accept: false })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const digits = (key, n) => (e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, '').slice(0, n) }))

  const submit = async (e) => {
    e.preventDefault()
    if (!/^\d{10}$/.test(form.phone)) return setError('Enter your 10-digit phone number')
    if (!/^\d{6}$/.test(form.code)) return setError('The setup code from the desk is 6 digits')
    if (!/^\d{6}$/.test(form.pin)) return setError('Choose a 6-digit PIN')
    if (form.pin !== form.pin2) return setError('The two PINs are not the same')
    if (!form.accept) return setError('Please read and accept the privacy notice')
    setLoading(true)
    setError('')
    try {
      const res = await portalApi('me_set_pin', { phone: form.phone, code: form.code, pin: form.pin, acceptPrivacy: true })
      setStudentToken(res.token)
      navigate('/me', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page join-page">
      <div className="login-brand">
        <img src="/pss-logo.png" alt="" className="login-brand-logo join-logo" />
        <h1 className="join-title">Set your PIN</h1>
      </div>
      <div className="card login-card">
        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label htmlFor="setup-phone">Phone number</label>
            <input id="setup-phone" value={form.phone} onChange={digits('phone', 10)} inputMode="numeric" autoComplete="tel-national" placeholder="10 digits" />
          </div>
          <div className="form-group">
            <label htmlFor="setup-code">Setup code from the desk</label>
            <input id="setup-code" value={form.code} onChange={digits('code', 6)} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" />
          </div>
          <div className="form-group">
            <label htmlFor="setup-pin">New PIN (6 digits — not 123456 or one digit repeated)</label>
            <input id="setup-pin" type="password" value={form.pin} onChange={digits('pin', 6)} inputMode="numeric" autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label htmlFor="setup-pin2">Type the PIN again</label>
            <input id="setup-pin2" type="password" value={form.pin2} onChange={digits('pin2', 6)} inputMode="numeric" autoComplete="new-password" />
          </div>
          <details style={{ margin: '0.5rem 0 0.75rem' }} open>
            <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>Privacy notice</summary>
            <div style={{ marginTop: '0.5rem' }}><PrivacyNotice /></div>
          </details>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={form.accept} onChange={(e) => setForm((f) => ({ ...f, accept: e.target.checked }))} style={{ marginTop: '0.2rem' }} />
            I have read the privacy notice and agree
          </label>
          {error && <p className="error-msg" role="alert" style={{ marginTop: '0.75rem' }}>{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.75rem' }} disabled={loading}>
            {loading ? 'Saving…' : 'Set PIN and log in'}
          </button>
        </form>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem' }}><Link to="/me/login">Back to log in</Link></p>
      </div>
    </div>
  )
}
