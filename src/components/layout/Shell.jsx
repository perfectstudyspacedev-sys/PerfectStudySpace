import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useSessionAlerts } from '../../hooks/useSessionAlerts'
import { useMessageAlerts } from '../../hooks/useMessageAlerts'
import { api } from '../../lib/api'

function BackgroundSketches() {
  return (
    <div className="bg-sketches" aria-hidden>
      <svg className="bg-sketch pool" width="90" height="90" viewBox="0 0 90 90" fill="none">
        <rect x="15" y="20" width="60" height="50" rx="4" stroke="#FFD700" strokeWidth="2" fill="none" opacity="0.5" />
        <line x1="25" y1="35" x2="65" y2="35" stroke="#FFD700" strokeWidth="1.5" opacity="0.4" />
        <line x1="25" y1="45" x2="55" y2="45" stroke="#FFD700" strokeWidth="1.5" opacity="0.4" />
      </svg>
      <svg className="bg-sketch snooker" width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="10" y="15" width="25" height="35" rx="2" stroke="#FFD700" strokeWidth="2" opacity="0.4" />
        <rect x="45" y="15" width="25" height="35" rx="2" stroke="#FFD700" strokeWidth="2" opacity="0.4" />
      </svg>
    </div>
  )
}

const TOAST_META = {
  end: { icon: '🔔', title: 'Session Ended', color: '#ff8888', bg: '#1a0000', border: '#ff4444', shadow: 'rgba(255,60,60,0.35)' },
  warn: { icon: '⏰', title: 'Time Almost Up', color: 'var(--accent)', bg: '#1a1200', border: '#ffb800', shadow: 'rgba(255,184,0,0.35)' },
  message: { icon: '💬', title: 'New Message', color: '#ffaa44', bg: '#1a1000', border: '#ff9500', shadow: 'rgba(255,149,0,0.35)' },
}

function SessionToasts({ toasts, dismiss, dismissAll }) {
  if (toasts.length === 0) return null
  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      zIndex: 300, display: 'flex', flexDirection: 'column', gap: '0.5rem',
      alignItems: 'center', pointerEvents: 'none', width: '100%', maxWidth: 480,
    }}>
      {toasts.map(t => {
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
  const warnCount = toasts.filter(t => t.level === 'warn').length
  const endCount = toasts.filter(t => t.level === 'end').length
  const messageCount = toasts.filter(t => t.level === 'message').length

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0.2rem', position: 'relative', lineHeight: 1 }}
        aria-label="Notifications"
      >
        🔔
        {(warnCount > 0 || endCount > 0 || messageCount > 0) && (
          <span style={{ position: 'absolute', top: -6, right: -10, display: 'flex', gap: 2 }}>
            {warnCount > 0 && (
              <span style={{
                background: '#ffb800', color: '#1a1200', borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.62rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{warnCount}</span>
            )}
            {endCount > 0 && (
              <span style={{
                background: '#ff4444', color: '#fff', borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.62rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{endCount}</span>
            )}
            {messageCount > 0 && (
              <span style={{
                background: '#ff9500', color: '#1a1000', borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.62rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{messageCount}</span>
            )}
          </span>
        )}
      </button>

      {open && (
        <div style={{
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
                  <button type="button" onClick={() => dismiss(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
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
  const { staff, logout, isOwner, branchId, selectBranch, branches, activeBranch } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const onCombinedHall = location.pathname.startsWith('/combined-hall')
  const session = useSessionAlerts(branchId)
  const messages = useMessageAlerts(branchId, staff?.id)
  const toasts = [...session.toasts, ...messages.toasts]
  const dismiss = (id) => { session.dismiss(id); messages.dismiss(id) }
  const dismissAll = () => { session.dismissAll(); messages.dismissAll() }
  const [sessionEnded, setSessionEnded] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleEndSession = async () => {
    try {
      await api('end_staff_session')
      setSessionEnded(true)
    } catch { /* ignore */ }
  }

  return (
    <div className="app-shell">
      <BackgroundSketches />
      <header className="topbar">
        <div className="topbar-left" role="button" tabIndex={0} onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <img src="/pss-logo.png" alt="" className="topbar-brand-logo-mobile" />
          <span className="nav-brand topbar-brand-text-mobile">Perfect Study Space</span>
        </div>

        <div className="topbar-brand" role="button" tabIndex={0} onClick={() => navigate('/')} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
          <img src="/pss-logo.png" alt="" className="topbar-brand-logo" />
          <span className="nav-brand" style={{ margin: 0 }}>Perfect Study Space</span>
        </div>

        <div className="topbar-info-row">
          <div className="topbar-branch-label">
            {isOwner && branches.length > 1 && (
              <div className="branch-switcher">
                <select
                  value={onCombinedHall ? '__combined_hall__' : (branchId || '')}
                  onChange={(e) => {
                    if (e.target.value === '__combined_hall__') {
                      navigate('/combined-hall')
                    } else {
                      selectBranch(e.target.value)
                      if (onCombinedHall) navigate('/')
                    }
                  }}
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                  <option value="__combined_hall__">🏢 Combined Hall</option>
                </select>
              </div>
            )}
            {!isOwner && activeBranch && (
              <span className="mono" style={{ fontSize: '1.1rem', color: 'var(--accent)' }}>{activeBranch.name}</span>
            )}
          </div>

          <div className="topbar-right">
            <NotificationBell toasts={toasts} dismiss={dismiss} dismissAll={dismissAll} />

            <span style={{
              display: 'inline-block',
              padding: '0.55rem 1.4rem', borderRadius: 30,
              background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.35)',
            }}>
              <span className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)', display: 'block', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                {staff?.displayName || staff?.username}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {staff?.role}
              </span>
            </span>
            {!isOwner && (
              <button
                type="button" className="btn btn-ghost"
                onClick={handleEndSession}
                disabled={sessionEnded}
                title="Mark that you're ending your session for the day"
              >
                {sessionEnded ? '✓ Session Ended' : 'End Session'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      <nav className="subnav">
        <div className="nav-links">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/bookings">Bookings</NavLink>
          <NavLink to="/membership">Membership</NavLink>
          <NavLink to="/students">Students</NavLink>
          <NavLink to="/enquiries">Enquiries</NavLink>
          <NavLink to="/food-menu">Food Menu</NavLink>
          {isOwner && <NavLink to="/revenue">Revenue</NavLink>}
          <NavLink to="/messages">Messages</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/actions">Actions</NavLink>
          {isOwner && (
            <>
              <NavLink to="/settings/branches">Branches</NavLink>
              <NavLink to="/settings/staff">Staff</NavLink>
            </>
          )}
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>

      <SessionToasts toasts={toasts} dismiss={dismiss} dismissAll={dismissAll} />
    </div>
  )
}
