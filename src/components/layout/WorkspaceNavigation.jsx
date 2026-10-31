import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { filterNavigation } from '../../lib/navigation'
import { lockBodyScroll } from '../../lib/bodyScroll'

export default function WorkspaceNavigation({ groups, open, onClose }) {
  const [query, setQuery] = useState('')
  const navRef = useRef(null)
  const location = useLocation()
  const visible = filterNavigation(groups, query)

  useEffect(() => { setQuery('') }, [location.pathname])
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 1023px)').matches) return undefined
    const previousFocus = document.activeElement
    const unlock = lockBodyScroll()
    navRef.current?.querySelector('input')?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const nodes = [...navRef.current.querySelectorAll('a,button,input')].filter(node => !node.disabled && node.getClientRects().length)
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const resize = () => { if (window.innerWidth >= 1024) onClose() }
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', resize)
    return () => {
      unlock()
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', resize)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open, onClose])

  return (
    <>
      {open && <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={onClose} />}
      <nav id="workspace-navigation" ref={navRef} className={`workspace-nav${open ? ' is-open' : ''}`} aria-label="Main navigation">
        <div className="workspace-nav-brand">
          <NavLink to="/" onClick={onClose} aria-label="Perfect Study Space dashboard">
            <img src="/pss-logo.png" alt="" width="38" height="38" />
            <span>Perfect Study Space<small>Operations workspace</small></span>
          </NavLink>
          <button type="button" className="nav-close" onClick={onClose} aria-label="Close navigation">×</button>
        </div>
        <div className="nav-search">
          <input type="search" placeholder="Find a page…" aria-label="Find a page" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="workspace-nav-scroll">
          {visible.map(group => (
            <section className="nav-group" key={group.label} aria-label={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(item => (
                <NavLink to={item.to} end={item.end} key={item.to} onClick={onClose}>
                  <span>{item.label}</span>
                  {item.badge > 0 && <span className="nav-count" data-testid="signup-nav-badge" title={`${item.badge} pending sign-ups`}>{item.badge}</span>}
                </NavLink>
              ))}
            </section>
          ))}
          {!visible.length && <p className="nav-empty">No pages match “{query}”.</p>}
        </div>
      </nav>
    </>
  )
}
