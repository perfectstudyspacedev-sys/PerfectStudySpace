import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { portalApi } from '../lib/api'

// PSS-AI P2.1 — everything that does not fit in the bottom tabs. Phase 3 and 4 pages show when the
// owner has switched them on (me_profile's features).
const LINKS = [['/me/receipts', 'Receipts'], ['/me/hold', 'Hold & requests'], ['/me/inbox', 'Notices'], ['/me/privacy', 'Privacy']]
const PHASE3 = [
  ['foodOrders', '/me/food', 'Order food to your seat'], ['tickets', '/me/problem', 'Report a problem'], ['seatPrefs', '/me/seats', 'Where you like to sit'],
  ['hourRelease', '/me/release', 'Not coming in? Release your hours'], ['waitlist', '/me/waitlist', 'Your own cabin (waitlist)'], ['referral', '/me/refer', 'Bring a friend & cashbacks'], ['nextExam', '/me/next', 'Your next exam'],
]

export default function PortalMore() {
  const [features, setFeatures] = useState({})
  useEffect(() => { portalApi('me_profile').then((r) => setFeatures(r.features ?? {})).catch(() => {}) }, [])
  const links = [...PHASE3.filter(([f]) => features[f]).map(([, to, label]) => [to, label]), ...LINKS]
  return (
    <div className="card">
      <ul className="portal-list">
        {links.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link><span aria-hidden="true">›</span></li>)}
      </ul>
    </div>
  )
}
