// Minimal hover tooltip for trend charts — just the point's label (bold) and value,
// no colored legend square/name prefix, matching the clean look used across the app's
// area charts (Daily Revenue, Attendance Trend, Registrations Trend, etc).
export function chartTooltip({ formatLabel = (l) => l, formatValue }) {
  return function ChartTooltipContent({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null
    return (
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 6, padding: '0.5rem 0.75rem', minWidth: 90 }}>
        <p style={{ color: '#fff', fontWeight: 700, fontSize: '0.82rem', marginBottom: 4 }}>{formatLabel(label)}</p>
        <p style={{ color: '#fff', fontSize: '0.82rem' }}>{formatValue(payload[0].value)}</p>
      </div>
    )
  }
}
