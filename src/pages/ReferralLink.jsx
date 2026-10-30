import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'

// PSS-AI Phase 3 — a referral link (/r/<code>, C10) opens the branch's current sign-up form with
// the channel filled in. The link survives a new sign-up link; the owner can switch it off.
export default function ReferralLink() {
  const { ref } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    api('public_referral_info', { ref })
      .then((r) => navigate(`/join/${encodeURIComponent(r.code)}?r=${encodeURIComponent(r.ref)}`, { replace: true }))
      .catch((e) => setError(e.message || 'This link is not active.'))
  }, [ref, navigate])
  return (
    <div className="login-page join-page">
      <div className="card login-card">{error ? <p className="error-msg">{error}</p> : <p style={{ color: 'var(--text-muted)' }}>Opening…</p>}</div>
    </div>
  )
}
