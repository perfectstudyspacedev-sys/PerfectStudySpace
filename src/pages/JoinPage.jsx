import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { REFERRAL_OPTIONS } from '../lib/utils'

// SSP — the public self sign-up page (/join/<branch code>). Reached only by the branch's link,
// outside the login. It can only submit details; staff approve and finish the registration.
export default function JoinPage() {
  const { code } = useParams()
  const [branchName, setBranchName] = useState(null)
  const [linkError, setLinkError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', emergencyContact: '', course: '', referralSource: '', website: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    let cancelled = false
    api('public_signup_info', { code })
      .then((d) => { if (!cancelled) setBranchName(d.branchName) })
      .catch((e) => { if (!cancelled) setLinkError(e.message || 'This sign-up link is no longer valid.') })
    return () => { cancelled = true }
  }, [code])

  const set = (key) => (e) => {
    const digitsOnly = key === 'phone' || key === 'emergencyContact'
    const value = digitsOnly ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const submit = async (e) => {
    e.preventDefault()
    const name = form.name.trim().replace(/\s+/g, ' ')
    if (name.split(' ').length < 2) return setError('Please enter your full name (first and last name)')
    if (!/^\d{10}$/.test(form.phone)) return setError('Phone must be a 10 digit number')
    if (!/^\d{10}$/.test(form.emergencyContact)) return setError('Emergency contact must be a 10 digit phone number')
    if (form.phone === form.emergencyContact) return setError('Emergency contact must be a different number from your own')
    if (!form.referralSource) return setError('Please tell us how you heard about us')
    setLoading(true)
    setError('')
    try {
      const res = await api('public_signup_submit', { code, ...form, name })
      setDone({ ref: res.ref, firstName: name.split(' ')[0], updated: !!res.updated })
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
        <h1 className="join-title">Perfect Study Space</h1>
        {branchName && <p style={{ color: 'var(--text-muted)' }}>{branchName} · New student sign-up</p>}
      </div>

      <div className="card login-card">
        {linkError ? (
          <p className="error-msg" data-testid="join-link-error">{linkError}</p>
        ) : !branchName ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : done ? (
          <div data-testid="join-done" style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.2rem', fontWeight: 700, color: '#4ade80' }}>
              {done.updated ? `Updated, ${done.firstName}!` : `Thanks ${done.firstName}!`}
            </p>
            <p style={{ margin: '0.75rem 0' }}>Please show this to the desk</p>
            <p className="mono" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.1em' }}>
              Ref #{done.ref}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              The desk will choose your plan and take the payment to finish your registration today.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="form-group">
              <label htmlFor="join-name">Full name *</label>
              <input id="join-name" value={form.name} onChange={set('name')} autoComplete="name" maxLength={80} required />
            </div>
            <div className="form-group">
              <label htmlFor="join-phone">Phone number *</label>
              <input id="join-phone" value={form.phone} onChange={set('phone')} inputMode="numeric" autoComplete="tel-national" placeholder="10 digits" required />
            </div>
            <div className="form-group">
              <label htmlFor="join-emergency">Emergency contact (another person's phone) *</label>
              <input id="join-emergency" value={form.emergencyContact} onChange={set('emergencyContact')} inputMode="numeric" placeholder="10 digits" required />
            </div>
            <div className="form-group">
              <label htmlFor="join-course">What are you preparing for?</label>
              <input id="join-course" value={form.course} onChange={set('course')} maxLength={80} placeholder="NEET PG, UPSC, CA, etc." />
            </div>
            <div className="form-group">
              <label htmlFor="join-source">How did you hear about us? *</label>
              <select id="join-source" value={form.referralSource} onChange={set('referralSource')} required>
                <option value="">Select an option</option>
                {REFERRAL_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {/* Anti-bot trap: hidden from people (and screen readers), filled in by form bots. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="join-website">Website</label>
              <input id="join-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? 'Sending…' : 'Submit'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
