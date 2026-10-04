import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/utils'

const ROW_BTN = { fontSize: '0.8rem', padding: '0.35rem 0.8rem' }
const OFF = { opacity: 0.35, cursor: 'not-allowed' }

// SSP N2 / A1–A4 — students who filled in the branch's self sign-up link, oldest first.
// Approve pre-fills New Registration (and locks the entry for this staff member); Deny deletes it.
export default function PendingSignupsPanel({ requests, branchId, activeSignupId, busyId, error, onApprove, onDeny }) {
  const [linkMsg, setLinkMsg] = useState('')

  const copyLink = async () => {
    setLinkMsg('')
    try {
      const { code } = await api('get_signup_link', { branchId })
      if (!code) return setLinkMsg("This branch's link hasn't been created yet — the owner can create it on the Branches page.")
      const url = `${window.location.origin}/join/${code}`
      try {
        await navigator.clipboard.writeText(url)
        setLinkMsg(`Copied: ${url}`)
      } catch {
        setLinkMsg(`Link: ${url}`)
      }
    } catch (e) {
      setLinkMsg(e.message)
    }
  }

  return (
    <div className="card" data-testid="pending-signups">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h3 style={{ color: 'var(--accent)', margin: 0 }}>
          Pending sign-ups {requests.length > 0 && <span className="mono">({requests.length})</span>}
        </h3>
        <button type="button" className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={copyLink}>Copy sign-up link</button>
      </div>
      {linkMsg && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', wordBreak: 'break-all' }}>{linkMsg}</p>}
      {error && <p className="error-msg" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      {requests.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          No one is waiting. Students who fill in the sign-up link appear here (oldest first) until the end of the day.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {requests.map((r) => {
            const otherBranch = r.branchId !== branchId
            const lockedByOther = !!r.handledBy && !r.handledByMe
            const isActive = r.id === activeSignupId
            const approveBlocked = otherBranch || lockedByOther || !!r.activeMember
            return (
              <div
                key={r.id} data-signup-ref={r.ref}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                  padding: '0.55rem 0.7rem', borderRadius: 6,
                  border: `1px solid ${isActive ? 'var(--accent)' : '#2a2a2a'}`, background: isActive ? 'rgba(255,215,0,0.06)' : '#121212',
                }}
              >
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>#{r.ref}</span>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span className="mono">{r.phone}</span> · {formatDateTime(r.createdAt)}
                    {r.branchName && otherBranch && <> · {r.branchName}</>}
                  </div>
                  {r.activeMember && (
                    <div style={{ fontSize: '0.75rem', color: '#ff8888', marginTop: '0.2rem' }}>
                      Already a member{r.activeMember.branch ? ` at ${r.activeMember.branch}` : ''} until {formatDate(r.activeMember.endDate)} — use Renew on{' '}
                      <Link to={`/students/${r.activeMember.studentId}`} style={{ color: 'var(--accent)' }}>their profile</Link>, then Deny this.
                    </div>
                  )}
                  {lockedByOther && <div style={{ fontSize: '0.75rem', color: '#ffaa44', marginTop: '0.2rem' }}>Being handled by {r.handledBy}</div>}
                  {otherBranch && !r.activeMember && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Sent to {r.branchName} — switch to that branch to register.</div>}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button" className="btn btn-primary"
                    style={{ ...ROW_BTN, ...((approveBlocked || busyId === r.id) && !isActive ? OFF : null) }}
                    disabled={approveBlocked || isActive || busyId === r.id}
                    onClick={() => onApprove(r)}
                  >{isActive ? 'In the form' : 'Approve'}</button>
                  <button
                    type="button" className="btn btn-ghost"
                    style={{ ...ROW_BTN, ...(lockedByOther || busyId === r.id ? OFF : null) }}
                    disabled={lockedByOther || busyId === r.id}
                    onClick={() => onDeny(r)}
                  >Deny</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}