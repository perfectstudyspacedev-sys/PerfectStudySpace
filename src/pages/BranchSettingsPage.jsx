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

  const handleFeeUpdate = async (id, fee) => {
    await api('update_fee_config', { id, fee: Number(fee) })
    load()
    setMsg('Fee updated')
  }

  const walkinFees = feeConfig.filter(f => f.config_type === 'walkin')
  const membershipFees = feeConfig.filter(f => f.config_type === 'membership')

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
          <div className="seat-map">
            {seatMap.desks.map(d => (
              <div key={d.id} className={`seat-cell ${d.status}`} style={{ position: 'relative' }}>
                {d.label}
                {d.status === 'free' && (
                  <button type="button" onClick={() => handleRemoveDesk(d.id)} style={{
                    position: 'absolute', top: 2, right: 2, background: 'none', border: 'none',
                    color: '#ff6b6b', cursor: 'pointer', fontSize: '0.65rem',
                  }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Walk-in Fees</h3>
          {walkinFees.map(f => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span>Up to {f.max_hours} hrs</span>
              <input type="number" defaultValue={f.fee} style={{ width: 80 }} onBlur={(e) => handleFeeUpdate(f.id, e.target.value)} />
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Membership Fees</h3>
          {membershipFees.map(f => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span>{f.hours_per_day}h/day ({f.cabin_type})</span>
              <input type="number" defaultValue={f.fee} style={{ width: 80 }} onBlur={(e) => handleFeeUpdate(f.id, e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
