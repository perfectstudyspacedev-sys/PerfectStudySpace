import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency } from '../lib/utils'

export default function BranchSettingsPage() {
  const { isOwner, branches, selectBranch } = useAuth()
  const [selectedBranch, setSelectedBranch] = useState('')
  const [seatMap, setSeatMap] = useState(null)
  const [newDeskLabel, setNewDeskLabel] = useState('')
  const [feeConfig, setFeeConfig] = useState([])
  const [feeEdits, setFeeEdits] = useState({})
  const [savingFees, setSavingFees] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!selectedBranch) return
    const [seats, fees] = await Promise.all([
      api('get_seat_map', { branchId: selectedBranch }),
      api('list_fee_config'),
    ])
    setSeatMap(seats)
    setFeeConfig(fees.config ?? [])
  }, [selectedBranch])

  useEffect(() => {
    if (branches.length && !selectedBranch) setSelectedBranch(branches[0].id)
  }, [branches, selectedBranch])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const map = {}
    feeConfig.forEach(f => { map[f.id] = String(f.fee) })
    setFeeEdits(map)
  }, [feeConfig])

  if (!isOwner) return <Navigate to="/" replace />

  const handleAddDesk = async () => {
    if (!newDeskLabel.trim()) return
    await api('add_desk', { branchId: selectedBranch, label: newDeskLabel.trim() })
    setNewDeskLabel('')
    load()
    setMsg('Desk added')
  }

  const handleRemoveDesk = async (deskId) => {
    if (!confirm('Remove this desk?')) return
    try {
      await api('remove_desk', { deskId })
      load()
      setMsg('Desk removed')
    } catch (e) {
      setMsg(e.message)
    }
  }

  const handleFeeInputChange = (id, value) => setFeeEdits(prev => ({ ...prev, [id]: value }))

  const saveFees = async (rows) => {
    setSavingFees(true)
    setMsg('')
    try {
      const changed = rows.filter(f => Number(feeEdits[f.id]) !== Number(f.fee) && feeEdits[f.id] !== '')
      if (!changed.length) {
        setMsg('No changes to save')
        return
      }
      await Promise.all(changed.map(f => api('update_fee_config', { id: f.id, fee: Number(feeEdits[f.id]) })))
      await load()
      setMsg(`${changed.length} fee${changed.length > 1 ? 's' : ''} updated — new memberships will use the updated rates`)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setSavingFees(false)
    }
  }

  const walkinFees = feeConfig.filter(f => f.config_type === 'walkin')
  const membershipFees = feeConfig.filter(f => f.config_type === 'membership')
  const tempFees = membershipFees.filter(f => f.cabin_type === 'temporary').sort((a, b) => a.hours_per_day - b.hours_per_day)
  const permFees = membershipFees.filter(f => f.cabin_type === 'permanent').sort((a, b) => a.hours_per_day - b.hours_per_day)

  return (
    <>
      <div className="page-header"><h1>Branch & Desk Settings</h1></div>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <label>Branch</label>
        <select value={selectedBranch} onChange={(e) => { setSelectedBranch(e.target.value); selectBranch(e.target.value) }}>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.desk_count} desks)</option>)}
        </select>
      </div>

      {msg && <p style={{ color: 'var(--accent)', marginBottom: '1rem' }}>{msg}</p>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Manage Desks</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input placeholder="New desk label (e.g. C31)" value={newDeskLabel} onChange={(e) => setNewDeskLabel(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={handleAddDesk}>Add Desk</button>
        </div>
        {seatMap && (
          <div className="desk-manage-grid">
            {seatMap.desks.map(d => (
              <div key={d.id} className={`desk-chip ${d.status}`}>
                {d.label}
                {d.status === 'free' && (
                  <button type="button" className="desk-chip-remove" onClick={() => handleRemoveDesk(d.id)} title="Remove desk">×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Walk-in Fees</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
            {walkinFees.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#141414', border: '1px solid #2c2c2c', borderRadius: 6 }}>
                <span style={{ fontSize: '0.88rem' }}>Up to {f.max_hours} hrs</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>₹</span>
                  <input
                    type="number" value={feeEdits[f.id] ?? ''} style={{ width: 90 }}
                    onChange={(e) => handleFeeInputChange(f.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-primary" disabled={savingFees} onClick={() => saveFees(walkinFees)}>
            {savingFees ? 'Saving…' : 'Save Walk-in Fees'}
          </button>
        </div>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Membership Fees</h3>

          <h4 style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Temporary (floating seat)</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {tempFees.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#141414', border: '1px solid #2c2c2c', borderRadius: 6 }}>
                <span style={{ fontSize: '0.88rem' }}>{f.hours_per_day}h/day</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>₹</span>
                  <input
                    type="number" value={feeEdits[f.id] ?? ''} style={{ width: 90 }}
                    onChange={(e) => handleFeeInputChange(f.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <h4 style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Permanent (fixed cabin)</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {permFees.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#141414', border: '1px solid #2c2c2c', borderRadius: 6 }}>
                <span style={{ fontSize: '0.88rem' }}>{f.hours_per_day}h/day</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>₹</span>
                  <input
                    type="number" value={feeEdits[f.id] ?? ''} style={{ width: 90 }}
                    onChange={(e) => handleFeeInputChange(f.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-primary" disabled={savingFees} onClick={() => saveFees(membershipFees)}>
            {savingFees ? 'Saving…' : 'Save Membership Fees'}
          </button>
        </div>
      </div>
    </>
  )
}
