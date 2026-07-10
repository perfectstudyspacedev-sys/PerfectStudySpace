import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { nowTimeStr, localTimeStrToISO, formatCurrency } from '../lib/utils'

// Fallback used only until live fee config loads from the backend.
const FALLBACK_FEES = { 3: 35, 4: 45, 5: 55, 6: 60, 7: 70, 8: 80, 9: 90, 12: 100 }
export const WALKIN_HOUR_OPTIONS = Object.keys(FALLBACK_FEES).map(Number)

// Walk-in modal — name/phone autocomplete + hourly booking, no page navigation
export default function WalkInModal({ branchId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState(3)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [startTime, setStartTime] = useState(nowTimeStr)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [nameMatches, setNameMatches] = useState([])
  const [fees, setFees] = useState(FALLBACK_FEES)

  useEffect(() => {
    api('list_fee_config').then(data => {
      const walkinRows = (data.config ?? []).filter(f => f.config_type === 'walkin')
      if (walkinRows.length) {
        const map = {}
        walkinRows.forEach(f => { map[f.max_hours] = Number(f.fee) })
        setFees(map)
        if (!(hours in map)) setHours(Number(Object.keys(map)[0]))
      }
    }).catch(() => { /* keep fallback */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hourOptions = Object.keys(fees).map(Number).sort((a, b) => a - b)
  const walkinFee = (h) => fees[h] ?? 0

  const lookupPhone = useCallback(async (p) => {
    if (p.length !== 10) return
    try {
      const { student } = await api('lookup_student', { phone: p })
      if (student?.name) {
        setName(student.name)
        setSelectedStudent(student)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (phone.length === 10) lookupPhone(phone)
  }, [phone, lookupPhone])

  useEffect(() => {
    if (selectedStudent && name === selectedStudent.name) return
    setSelectedStudent(null)
    if (!branchId || name.trim().length < 2) { setNameMatches([]); return }
    const id = setTimeout(() => {
      api('search_students_by_name', { branchId, query: name.trim() })
        .then(data => setNameMatches(data.students ?? []))
        .catch(() => setNameMatches([]))
    }, 250)
    return () => clearTimeout(id)
  }, [name, branchId, selectedStudent])

  const pickStudent = (s) => {
    setSelectedStudent(s)
    setName(s.name)
    setPhone(s.phone ?? '')
    setNameMatches([])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!/^\d{10}$/.test(phone)) return setError('Phone must be 10 digits')
    setLoading(true)
    setError('')
    try {
      const result = await api('create_walkin', {
        branchId, name, phone, hours, paymentMode,
        startTime: localTimeStrToISO(startTime),
      })
      setReceipt(result.booking)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        {receipt ? (
          <>
            <h2 style={{ color: 'var(--accent)' }}>Walk-in Confirmed</h2>
            <p><strong>{name}</strong></p>
            <p className="mono">{hours} hours · {formatCurrency(receipt.amount ?? walkinFee(hours))}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Payment: {paymentMode.toUpperCase()}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onDone}>Close</button>
              <button
                type="button" className="btn btn-primary"
                onClick={() => { setReceipt(null); setName(''); setPhone(''); setSelectedStudent(null) }}
              >New Walk-in</button>
            </div>
          </>
        ) : (
          <>
            <h2>Walk-in Booking</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your Full Name" autoComplete="off" autoFocus required />
                {selectedStudent && (
                  <p style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '0.3rem' }}>✓ Matched existing student</p>
                )}
                {nameMatches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                    background: '#141414', border: '1px solid #333', borderRadius: 4, marginTop: 2,
                    maxHeight: 180, overflowY: 'auto',
                  }}>
                    {nameMatches.map(s => (
                      <button
                        key={s.id} type="button" onClick={() => pickStudent(s)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.5rem 0.75rem',
                          background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '0.85rem', textAlign: 'left',
                        }}
                      >
                        <span>{s.name}</span>
                        <span className="mono" style={{ color: 'var(--text-muted)' }}>{s.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Phone Number</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" required />
              </div>
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Number of Hours</label>
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {hourOptions.map(h => (
                    <option key={h} value={h}>{h} hrs — {formatCurrency(walkinFee(h))}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Payment Mode</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
                    <button
                      key={value} type="button"
                      onClick={() => setPaymentMode(value)}
                      style={{
                        flex: 1, padding: '0.6rem',
                        border: `1px solid ${paymentMode === value ? 'var(--accent)' : '#333'}`,
                        borderRadius: 4,
                        background: paymentMode === value ? 'rgba(255,215,0,0.08)' : '#141414',
                        color: paymentMode === value ? 'var(--accent)' : 'var(--text-muted)',
                        cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                      }}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <p className="mono" style={{ marginBottom: '1rem', color: 'var(--accent)' }}>
                Bill: {formatCurrency(walkinFee(hours))}
              </p>
              {error && <p className="error-msg">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading || !branchId}>
                  {loading ? 'Registering…' : `Register — ${formatCurrency(walkinFee(hours))}`}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
