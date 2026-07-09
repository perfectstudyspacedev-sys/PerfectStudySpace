import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, todayISO, paymentModeLabel, formatDateTime } from '../lib/utils'

export default function FoodMenuPage() {
  const { branchId, isOwner } = useAuth()
  const [foodItems, setFoodItems] = useState([])
  const [tab, setTab] = useState('menu')
  const [bills, setBills] = useState([])
  const [billFilter, setBillFilter] = useState('today')

  // Menu management state
  const [newItemName, setNewItemName] = useState('')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [menuSaving, setMenuSaving] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [menuSuccess, setMenuSuccess] = useState('')

  const load = useCallback(async () => {
    const data = await api('list_food_items', { branchId })
    setFoodItems((data.items ?? []).filter(i => i.is_active))
  }, [branchId])

  const loadBills = useCallback(async () => {
    const today = todayISO()
    let dateFrom = today, dateTo = today
    if (billFilter === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      dateFrom = d.toISOString().slice(0, 10)
    } else if (billFilter === 'month') {
      const d = new Date()
      dateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    }
    const data = await api('list_food_bills', { branchId, dateFrom, dateTo })
    setBills(data.bills ?? [])
  }, [branchId, billFilter])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'history') loadBills() }, [tab, loadBills])

  const handleAddMenuItem = async (e) => {
    e.preventDefault()
    if (!newItemName.trim() || !newItemPrice) return setMenuError('Name and price are required')
    setMenuSaving(true)
    setMenuError('')
    setMenuSuccess('')
    try {
      await api('create_food_item', { branchId, name: newItemName.trim(), price: Number(newItemPrice) })
      setNewItemName('')
      setNewItemPrice('')
      setMenuSuccess(`"${newItemName.trim()}" added to menu`)
      load()
    } catch (err) {
      setMenuError(err.message)
    } finally {
      setMenuSaving(false)
    }
  }

  const toggleItemActive = async (item) => {
    try {
      await api('update_food_item', { itemId: item.id, isActive: !item.is_active })
      load()
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="page-header"><h1>Food Menu</h1></div>
      <div className="tabs">
        <button type="button" className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>Manage Menu</button>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'menu' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {isOwner && (
            <div className="card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Add New Item</h3>
              <form onSubmit={handleAddMenuItem}>
                <div className="form-group">
                  <label>Item Name</label>
                  <input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="e.g. Masala Chai" required />
                </div>
                <div className="form-group">
                  <label>Price (₹)</label>
                  <input type="number" min="1" value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} placeholder="20" required />
                </div>
                {menuError && <p className="error-msg">{menuError}</p>}
                {menuSuccess && <p style={{ color: '#4ade80', fontSize: '0.85rem' }}>{menuSuccess}</p>}
                <button type="submit" className="btn btn-primary" disabled={menuSaving}>
                  {menuSaving ? 'Adding…' : 'Add to Menu'}
                </button>
              </form>
            </div>
          )}
          <div className="card">
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Current Menu</h3>
            {!isOwner && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                Only the owner can add or change menu items.
              </p>
            )}
            {foodItems.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No items yet.</p>}
            {foodItems.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div>
                  <span>{item.name}</span>
                  <span className="mono" style={{ color: 'var(--accent)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{formatCurrency(item.price)}</span>
                </div>
                {isOwner && (
                  <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={() => toggleItemActive(item)}>
                    {item.is_active ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="period-toggle" style={{ marginBottom: '1rem' }}>
            {['today', 'week', 'month'].map(f => (
              <button key={f} type="button" className={billFilter === f ? 'active' : ''} onClick={() => setBillFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Mode</th></tr></thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id}>
                  <td className="mono">{formatDateTime(b.created_at)}</td>
                  <td>{b.student_name ?? b.student_phone ?? '-'}</td>
                  <td>{b.food_bill_items?.map(i => `${i.name}×${i.quantity}`).join(', ')}</td>
                  <td className="mono">{formatCurrency(b.total)}</td>
                  <td>{paymentModeLabel(b.payment_mode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
