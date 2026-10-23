import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getStudentToken, portalApi, setStudentToken } from '../lib/api'

// PSS-AI P2.1 — the student portal's frame: login guard, header with the inbox, bottom tabs, and
// the installable-app hooks (manifest and service worker, only on these pages).
export default function PortalLayout() {
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!getStudentToken()) { navigate('/me/login', { replace: true }); return undefined }
    const onUnauthorized = () => { setStudentToken(null); navigate('/me/login', { replace: true }) }
    window.addEventListener('pss:portal-unauthorized', onUnauthorized)
    portalApi('me_profile').then((r) => setName(r.profile?.name?.split(' ')[0] ?? '')).catch(() => {})
    portalApi('me_notifications').then((r) => setUnread(r.unread ?? 0)).catch(() => {})
    return () => window.removeEventListener('pss:portal-unauthorized', onUnauthorized)
  }, [navigate])

  useEffect(() => {
    // Installable app (PWA): the manifest link only on portal pages, so the sign-up form and the
    // staff site are not offered as an app.
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link')
      link.rel = 'manifest'
      link.href = '/manifest.webmanifest'
      document.head.appendChild(link)
    }
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/me/' }).catch(() => { /* the portal works without it */ })
    }
  }, [])

  const logout = async () => {
    try { await portalApi('me_logout') } catch { /* the token is dropped either way */ }
    setStudentToken(null)
    navigate('/me/login', { replace: true })
  }

  return (
    <div className="portal">
      <header className="portal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img src="/pss-logo.png" alt="" />
          <div>
            <div className="nav-brand" style={{ margin: 0, fontSize: '1.05rem' }}>Perfect Study Space</div>
            {name && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Hi {name}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <NavLink to="/me/inbox" className="btn btn-ghost" aria-label={`Inbox, ${unread} unread`} style={{ position: 'relative' }}>
            🔔{unread > 0 && <span className="portal-dot">{unread}</span>}
          </NavLink>
          <button type="button" className="btn btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      <main>
        <Outlet context={{ setUnread }} />
      </main>
      <nav className="portal-nav" aria-label="Portal">
        <NavLink to="/me" end><span className="icon" aria-hidden="true">🏠</span>Home</NavLink>
        <NavLink to="/me/pay"><span className="icon" aria-hidden="true">💳</span>Pay</NavLink>
        <NavLink to="/me/report"><span className="icon" aria-hidden="true">📈</span>Report</NavLink>
        <NavLink to="/me/chat"><span className="icon" aria-hidden="true">💬</span>Chat</NavLink>
        <NavLink to="/me/more"><span className="icon" aria-hidden="true">☰</span>More</NavLink>
      </nav>
    </div>
  )
}
