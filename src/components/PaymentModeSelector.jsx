// Shared cash/UPI/split payment-mode picker. `total` is the amount this payment covers —
// when "Split" is chosen, cash + UPI must add up to exactly that. Parent components read
// the mode via `value.mode` and, only when mode === 'split', `value.cashAmount`/`value.upiAmount`;
// for 'cash'/'upi' those two fields are irrelevant and the whole amount goes through as-is.
export default function PaymentModeSelector({ value, onChange, total }) {
  const { mode, cashAmount, upiAmount } = value
  const numTotal = Number(total) || 0
  const cash = Number(cashAmount) || 0
  const upi = Number(upiAmount) || 0
  const remainder = Math.round((numTotal - cash - upi) * 100) / 100

  const setMode = (m) => {
    if (m === 'split') onChange({ mode: m, cashAmount: numTotal, upiAmount: 0 })
    else onChange({ mode: m, cashAmount: '', upiAmount: '' })
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {[
          { value: 'cash', label: '💵 Cash' },
          { value: 'upi', label: '📱 UPI' },
          { value: 'split', label: '🔀 Split' },
        ].map(({ value: v, label }) => (
          <button
            key={v} type="button" onClick={() => setMode(v)}
            style={{
              flex: 1, padding: '0.5rem',
              border: `1px solid ${mode === v ? 'var(--accent)' : '#333'}`,
              borderRadius: 999, background: mode === v ? 'rgba(255,215,0,0.08)' : '#141414',
              color: mode === v ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
            }}
          >{label}</button>
        ))}
      </div>
      {mode === 'split' && (
        <div style={{ marginTop: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Cash (₹)</label>
              <input
                type="number" min={0} value={cashAmount}
                onChange={(e) => onChange({ mode, cashAmount: e.target.value, upiAmount: upiAmount })}
              />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>UPI (₹)</label>
              <input
                type="number" min={0} value={upiAmount}
                onChange={(e) => onChange({ mode, cashAmount: cashAmount, upiAmount: e.target.value })}
              />
            </div>
          </div>
          {remainder !== 0 && (
            <p style={{ fontSize: '0.78rem', color: '#ff8888', marginTop: '0.35rem' }}>
              {remainder > 0 ? `₹${remainder} not yet assigned` : `₹${Math.abs(remainder)} over the total`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function isSplitValid(value, total) {
  if (value.mode !== 'split') return true
  const numTotal = Number(total) || 0
  const cash = Number(value.cashAmount) || 0
  const upi = Number(value.upiAmount) || 0
  return Math.round((cash + upi) * 100) === Math.round(numTotal * 100)
}
