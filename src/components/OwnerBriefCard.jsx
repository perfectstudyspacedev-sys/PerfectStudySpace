import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI P1.8 — the owner analyst's morning brief (written at 07:00 IST from yesterday's figures),
// for owner and admin only, while pssai_analyst is on. Written by AI from the app's own reports:
// it changes nothing, and the figures on the Revenue and Reports pages stay the reference.
export default function OwnerBriefCard() {
  const { isOwner } = useAuth()
  const { analyst } = useFeatureFlags()
  const [brief, setBrief] = useState(null)

  useEffect(() => {
    if (!isOwner || !analyst) return undefined
    let live = true
    api('get_owner_brief')
      .then((res) => { if (live) setBrief(res?.brief ?? null) })
      .catch(() => { /* optional card; the dashboard works without it */ })
    return () => { live = false }
  }, [isOwner, analyst])

  if (!isOwner || !analyst || !brief) return null
  return (
    <div className="card" data-testid="owner-brief" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.4rem' }}>Morning brief</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
        {formatDate(brief.brief_date)} · written by AI from the app&apos;s reports — check figures on Revenue before acting
      </p>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.55, margin: 0 }}>{brief.body}</p>
      <p style={{ marginTop: '0.75rem', marginBottom: 0, fontSize: '0.85rem' }}>
        <Link to="/analyst">Ask the analyst a question →</Link>
      </p>
    </div>
  )
}
