import { formatDate } from '../lib/utils'

// RSP R2 — tells staff which kind of renewal this is before they fill anything in. The kind
// comes from renewalInfo() (same rule the server enforces in renew_membership).
const STYLES = {
  early: { background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.35)', color: '#4ade80' },
  grace: { background: 'rgba(255,170,68,0.08)', border: '1px solid rgba(255,170,68,0.35)', color: '#ffaa44' },
  late: { background: 'rgba(255,255,255,0.04)', border: '1px solid #333', color: 'var(--text)' },
}

export default function RenewalKindBanner({ renewal, endDate }) {
  if (!renewal) return null
  const text = renewal.kind === 'early'
    ? <>Early renewal — the new period starts <strong>{formatDate(renewal.startDate)}</strong>, the day after the current plan ends ({formatDate(endDate)}). Same plan; the student keeps every remaining day.</>
    : renewal.kind === 'grace'
      ? <>Grace-period renewal — the plan ended {formatDate(endDate)}. The new period starts <strong>{formatDate(renewal.startDate)}</strong>; grace days count as used.</>
      : <>The plan ended {formatDate(endDate)}, more than 10 days ago. The new period starts today (it can be backdated, but not before {formatDate(renewal.minStart)}).</>
  return (
    <div data-renewal-kind={renewal.kind} style={{ ...STYLES[renewal.kind], borderRadius: 6, padding: '0.55rem 0.7rem', fontSize: '0.8rem', marginBottom: '1rem', lineHeight: 1.4 }}>
      {text}
    </div>
  )
}
