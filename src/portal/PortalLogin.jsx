import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { portalApi, setStudentToken } from '../lib/api'
import { nextPortalPath } from './portalUtils'

// PSS-AI P2.1 SP1 — phone number + 6-digit PIN.
export default function PortalLogin() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!/^\d{10}$/.test(phone)) return setError('Enter your 10-digit phone number')
    if (!/^\d{6}$/.test(pin)) return setError('Your PIN is 6 digits')
    setLoading(true)
    setError('')
    try {
      const res = await portalApi('me_login', { phone, pin })
      setStudentToken(res.token)
      navigate(nextPortalPath(), { replace: true })
    } catch (err) {
      setError(err.message)
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page join-page">
      <div className="login-brand">
        <img src="/pss-logo.png" alt="" className="login-brand-logo join-logo" />
        <h1 className="join-title">My Study Space</h1>
        <p style={{ color: 'var(--text-muted)' }}>Your plan, payments and study report</p>
      </div>
      <div className="card login-card">
        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label htmlFor="portal-phone">Phone number</label>
            <input id="portal-phone" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="tel-national" placeholder="10 digits" />
          </div>
          <div className="form-group">
            <label htmlFor="portal-pin">PIN</label>
            <input id="portal-pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="current-password" placeholder="6 digits" />
          </div>
          {error && <p className="error-msg" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          First time, or forgot your PIN? Ask the desk for a setup code, then <Link to="/me/setup">set your PIN</Link>.
        </p>
      </div>
    </div>
  )
}
