import { Link } from 'react-router-dom'

// PSS-AI P2.1 — everything that does not fit in the bottom tabs.
const LINKS = [['/me/receipts', 'Receipts'], ['/me/hold', 'Hold & requests'], ['/me/inbox', 'Notices'], ['/me/privacy', 'Privacy']]

export default function PortalMore() {
  return (
    <div className="card">
      <ul className="portal-list">
        {LINKS.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link><span aria-hidden="true">›</span></li>)}
      </ul>
    </div>
  )
}
