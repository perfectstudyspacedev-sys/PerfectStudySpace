import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useSessionAlerts } from '../../hooks/useSessionAlerts'
import { useMessageAlerts } from '../../hooks/useMessageAlerts'
import { useTaskAlerts } from '../../hooks/useTaskAlerts'
import { usePendingSignups } from '../../hooks/usePendingSignups'
import { useFeatureFlags } from '../../hooks/useFeatureFlags'
import { api, COMBINED_HALL_ID } from '../../lib/api'
import { staffNavigation } from '../../lib/navigation'
import WorkspaceNavigation from './WorkspaceNavigation'
import BranchSwitcher from './BranchSwitcher'
import useDialogFocus from '../../hooks/useDialogFocus'

const TOAST_META = {
  end: { icon: '🔔', title: 'Session Ended', color: '#ff8888', bg: '#1a0000', border: '#ff4444', shadow: 'rgba(255,60,60,0.35)' },
  warn: { icon: '⏰', title: 'Time Almost Up', color: 'var(--accent)', bg: '#1a1200', border: '#ffb800', shadow: 'rgba(255,184,0,0.35)' },
  message: { icon: '💬', title: 'New Message', color: '#ffaa44', bg: '#1a1000', border: '#ff9500', shadow: 'rgba(255,149,0,0.35)' },
  cross_branch: { icon: '🔄', title: 'Cross-Branch Visit', color: '#a78bfa', bg: '#150f24', border: '#8b5cf6', shadow: 'rgba(139,92,246,0.35)' },
  task: { icon: '📋', title: 'New Task Assigned', color: '#4ade80', bg: '#0d1a0d', border: '#4ade80', shadow: 'rgba(74,222,128,0.35)' },
  new_enquiry: { icon: '📝', title: 'New Enquiry', color: '#38bdf8', bg: '#0a1a24', border: '#38bdf8', shadow: 'rgba(56,189,248,0.35)' },
  new_signup: { icon: '🆕', title: 'New Sign-up', color: '#f472b6', bg: '#1f0a17', border: '#f472b6', shadow: 'rgba(244,114,182,0.35)' },
  desk_alert: { icon: '⚠️', title: 'Needs the desk', color: '#ff8888', bg: '#1a0000', border: '#ff4444', shadow: 'rgba(255,60,60,0.35)' },
}

// Only the 4 most recent toasts stack up on screen — a burst of alerts (e.g. several
// sessions ending at once) would otherwise pile up and block the page underneath. Anything
// older stays fully accessible via the bell dropdown, which lists every toast regardless.
const MAX_VISIBLE_TOASTS = 4

function SessionToasts({ toasts, dismiss, dismissAll }) {
  if (toasts.length === 0) return null
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS)
  const hiddenCount = toasts.length - visible.length
  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      zIndex: 300, display: 'flex', flexDirection: 'column', gap: '0.5rem',
      alignItems: 'center', pointerEvents: 'none', width: '100%', maxWidth: 480,
    }}>
      {hiddenCount > 0 && (
        <p style={{ pointerEvents: 'none', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          +{hiddenCount} more in the bell 🔔
        </p>
      )}
      {visible.map(t => {
        const meta = TOAST_META[t.level] ?? TOAST_META.warn
        return (
          <div key={t.id} style={{
            pointerEvents: 'all',
            background: meta.bg,
            border: `1px solid ${meta.border}`,
            borderRadius: 8,
            padding: '0.75rem 1rem',
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            boxShadow: `0 4px 24px ${meta.shadow}`,
            animation: 'slideInToast 0.25s ease',
            width: '100%',
          }}>
            <span style={{ fontSize: '1.2rem' }}>{meta.icon}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: '0.9rem', color: meta.color }}>
                {meta.title}
              </p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                {t.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label={`Dismiss ${meta.title} notification`}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '1rem', padding: '0.2rem 0.4rem', lineHeight: 1,
              }}
            >✕</button>
          </div>
        )
      })}
      {toasts.length > 1 && (
        <button
          type="button"
          onClick={dismissAll}
          style={{
            pointerEvents: 'all',
            background: 'rgba(255,255,255,0.05)', border: '1px solid #333',
            color: 'var(--text-muted)', borderRadius: 999, padding: '0.3rem 0.75rem',
            cursor: 'pointer', fontSize: '0.75rem',
          }}
        >
          Dismiss all ({toasts.length})
        </button>
      )}
    </div>
  )
}

function NotificationBell({ toasts, dismiss, dismissAll }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keydown)
    }
  }, [open])

  return (
    <div className="notification-wrap" ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0.2rem', position: 'relative', lineHeight: 1 }}
        aria-label="Notifications"
        aria-expanded={open} aria-controls={open ? popoverId : undefined}
      >
        🔔
        {toasts.length > 0 && <span className="notification-count" aria-hidden="true">{toasts.length > 99 ? '99+' : toasts.length}</span>}
      </button>

      {open && (
        <div className="notification-popover" id={popoverId} role="region" aria-label="Notifications" style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0,
          width: 'min(320px, calc(100vw - 2rem))', maxHeight: 360, overflowY: 'auto',
          background: '#141414', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
          zIndex: 400, padding: '0.5rem', boxSizing: 'border-box',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0.5rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Notifications</span>
            {toasts.length > 0 && (
              <button type="button" onClick={dismissAll} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}>
                Dismiss all
              </button>
            )}
          </div>
          {toasts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '0.5rem' }}>No notifications</p>
          ) : (
            toasts.map(t => {
              const meta = TOAST_META[t.level] ?? TOAST_META.warn
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem',
                  borderBottom: '1px solid #222',
                }}>
                  <span>{meta.icon}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.82rem', fontWeight: 600, color: meta.color }}>
                      {meta.title}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t.message}</p>
                  </div>
                  <button type="button" onClick={() => dismiss(t.id)} aria-label={`Dismiss ${meta.title} notification`} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export default function Shell() {
  const { staff, logout, isOwner, branchId, selectBranch, branches, activeBranch, isCombinedHall } = useAuth()
  const flags = useFeatureFlags()
  const navigate = useNavigate()
  // Neither hook has a meaningful single branch_id to filter on while Combined Hall is
  // selected — both already no-op on a falsy branchId, so this just borrows that guard
  // instead of sending the '__combined_hall__' sentinel to the backend as a branch filter.
  const session = useSessionAlerts(isCombinedHall ? null : branchId)
  // isOwner means owner-or-admin (see AuthContext) — either way, someone who oversees
  // every branch needs a system notice (new enquiry, cross-branch visit) regardless of
  // which single branch they currently have open, Combined Hall included.
  const messages = useMessageAlerts(isCombinedHall ? null : branchId, staff?.id, isOwner)
  // Task assignment doesn't depend on branch context (list_tasks allBranches:true sidesteps
  // it entirely — see the hook), so this one runs the same in Combined Hall as anywhere else.
  const taskAlerts = useTaskAlerts(staff?.id)
  // SSP N2: pending self sign-ups — the Membership tab badge here, and the list on the
  // Membership page (passed down through the Outlet context so there's a single poller).
  const signups = usePendingSignups(isCombinedHall ? null : branchId, isOwner, !!staff)
  const toasts = [...session.toasts, ...messages.toasts, ...taskAlerts.toasts]
  const dismiss = (id) => { session.dismiss(id); messages.dismiss(id); taskAlerts.dismiss(id) }
  const dismissAll = () => { session.dismissAll(); messages.dismissAll(); taskAlerts.dismissAll() }
  const [sessionEnded, setSessionEnded] = useState(false)
  const [endSessionModal, setEndSessionModal] = useState(false)
  const [endSessionPassword, setEndSessionPassword] = useState('')
  const [endSessionError, setEndSessionError] = useState('')
  const [endSessionLoading, setEndSessionLoading] = useState(false)
  const endSessionRef = useRef(null)
  useDialogFocus(endSessionRef, { onClose: () => setEndSessionModal(false), busy: endSessionLoading, enabled: endSessionModal })
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = useCallback(() => setNavOpen(false), [])
  const navigation = staffNavigation({ isOwner, flags, pendingSignups: signups.requests.length })

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const openEndSessionModal = () => {
    setEndSessionPassword('')
    setEndSessionError('')
    setEndSessionModal(true)
  }

  const confirmEndSession = async (e) => {
    e.preventDefault()
    setEndSessionLoading(true)
    setEndSessionError('')
    try {
      await api('end_staff_session', { password: endSessionPassword })
      setSessionEnded(true)
      setEndSessionModal(false)
      logout()
      navigate('/login')
    } catch (err) {
      setEndSessionError(err.message)
    } finally {
      setEndSessionLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <WorkspaceNavigation groups={navigation} open={navOpen} onClose={closeNav} />
      <header className="topbar">
        <button type="button" className="nav-toggle" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>☰</button>

        <div className="topbar-info-row">
          <div className="topbar-branch-label">
            <span className="workspace-eyebrow">Working branch</span>
            {isOwner && branches.length > 1 && (
              <BranchSwitcher
                  value={branchId || ''}
                  onChange={(next) => {
                    selectBranch(next)
                    // Combined Hall has no dedicated route anymore — every nav page renders
                    // a combined view when isCombinedHall is true. Only force a jump to
                    // Dashboard when *entering* Combined Hall (so it opens on the overview,
                    // as it always has); switching between two real branches keeps whatever
                    // page staff is already on, same as it's always worked.
                    if (next === COMBINED_HALL_ID) navigate('/')
                  }}
                  options={[
                    ...[...branches].sort((a, b) => (a.name === 'Ram Nagar' ? -1 : b.name === 'Ram Nagar' ? 1 : 0)).map(branch => ({ value: branch.id, label: branch.name })),
                    { value: COMBINED_HALL_ID, label: 'All branches' },
                  ]}
              />
            )}
            {(!isOwner || branches.length <= 1) && activeBranch && (
              <span className="mono" style={{ fontSize: '1.1rem', color: 'var(--accent)' }}>{activeBranch.name}</span>
            )}
          </div>

          <div className="topbar-right">
            <NotificationBell toasts={toasts} dismiss={dismiss} dismissAll={dismissAll} />

            <div className="staff-profile">
              <span className="staff-avatar" aria-hidden="true">{(staff?.displayName || staff?.username || 'P').slice(0, 1).toUpperCase()}</span>
              <span className="staff-profile-copy"><strong>{staff?.displayName || staff?.username}</strong><small>{staff?.role}</small></span>
            </div>
            {!isOwner && flags.loaded && !flags.retireStaffOps && (
              <button
                type="button" className="btn btn-ghost end-session-button"
                onClick={openEndSessionModal}
                disabled={sessionEnded}
                title="Mark that you're ending your session for the day"
              >
                {sessionEnded ? '✓ Session Ended' : 'End Session'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>Log out</button>
          </div>
        </div>
      </header>

      <main className="main-content" id="main-content" tabIndex={-1}>
        <Outlet context={{ signups }} />
      </main>

      <SessionToasts toasts={toasts} dismiss={dismiss} dismissAll={dismissAll} />

      {endSessionModal && (
        <div className="modal-overlay" onClick={endSessionLoading ? undefined : () => setEndSessionModal(false)}>
          <div ref={endSessionRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="end-session-title" tabIndex={-1} style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <h2 id="end-session-title">End Session</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              This logs you out immediately and locks your account for the rest of today — enter your password to confirm.
            </p>
            <form onSubmit={confirmEndSession}>
              <div className="form-group">
                <label htmlFor="end-session-password">Password</label>
                <input
                  id="end-session-password" data-initial-focus
                  type="password" value={endSessionPassword}
                  onChange={(e) => setEndSessionPassword(e.target.value)}
                  required
                />
              </div>
              {endSessionError && <p className="error-msg">{endSessionError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEndSessionModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-danger" disabled={endSessionLoading}>
                  {endSessionLoading ? 'Ending…' : 'End Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
