import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, todayISO, paymentModeLabel, formatDateTime } from '../lib/utils'

function billDateRange(billFilter) {
  const today = todayISO()
  let dateFrom = today
  if (billFilter === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7)
    dateFrom = d.toISOString().slice(0, 10)
  } else if (billFilter === 'month') {
    const d = new Date()
    dateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  return { dateFrom, dateTo: today }
}

function branchNamesUnion(...lists) {
  const names = new Set()
  for (const list of lists) {
    for (const row of list) names.add(row.branches?.name ?? 'Unknown Branch')
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

// ── Combined Hall — read-only, every branch's menu, order history, inventory, and inventory
// activity at once. Adding/editing items, adding inventory, and availing packets all stay
// single-branch (each is tied to one specific item/branch) — switch to a real branch from
// the dropdown to act on any of them.
function CombinedFoodMenu() {
  const [items, setItems] = useState(null)
  const [bills, setBills] = useState(null)
  const [inventory, setInventory] = useState(null)
  const [logs, setLogs] = useState(null)
  const [billFilter, setBillFilter] = useState('today')
  const [error, setError] = useState('')
  const [branchFilter, setBranchFilter] = useState(null) // null = every branch

  const loadItems = useCallback(async () => {
    try {
      const data = await api('list_food_items', { allBranches: true })
      setItems(data.items ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadBills = useCallback(async () => {
    try {
      const { dateFrom, dateTo } = billDateRange(billFilter)
      const data = await api('list_food_bills', { allBranches: true, dateFrom, dateTo })
      setBills(data.bills ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [billFilter])

  const loadInventory = useCallback(async () => {
    try {
      const data = await api('list_inventory_items', { allBranches: true })
      setInventory(data.items ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      const data = await api('list_inventory_log', { allBranches: true })
      setLogs(data.logs ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])
  useEffect(() => { loadBills() }, [loadBills])
  useEffect(() => { loadInventory() }, [loadInventory])
  useEffect(() => { loadLogs() }, [loadLogs])

  const loaded = items && bills && inventory && logs
  const allBranchNames = loaded ? branchNamesUnion(items, bills, inventory, logs) : []
  const visibleBranchNames = branchFilter ? allBranchNames.filter(name => name === branchFilter) : allBranchNames

  return (
    <>
      <div className="page-header"><h1>Food Menu — Combined Hall</h1></div>
      {error && <p className="error-msg" style={{ marginBottom: '1rem' }}>{error}</p>}

      {!loaded ? <p>Loading…</p> : (
        <>
          {allBranchNames.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button type="button" className={`btn ${branchFilter === null ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }} onClick={() => setBranchFilter(null)}>
                All Branches
              </button>
              {allBranchNames.map(name => (
                <button
                  key={name} type="button"
                  className={`btn ${branchFilter === name ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                  onClick={() => setBranchFilter(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {visibleBranchNames.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No branches to show.</p>
          ) : (
            <>
              <div className="card" style={{ marginBottom: '1.25rem' }}>
                <h2 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Menu</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {visibleBranchNames.map(branchName => {
                    const branchItems = items.filter(i => (i.branches?.name ?? 'Unknown Branch') === branchName)
                    return (
                      <div key={branchName}>
                        <h3 style={{ fontSize: '0.9rem', color: '#a78bfa', marginBottom: '0.5rem' }}>{branchName} — {branchItems.length} item{branchItems.length === 1 ? '' : 's'}</h3>
                        {branchItems.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No items yet.</p>
                        ) : (
                          <table className="data-table">
                            <thead><tr><th>Item</th><th>Price</th></tr></thead>
                            <tbody>
                              {branchItems.map(item => (
                                <tr key={item.id}>
                                  <td>{item.name}</td>
                                  <td className="mono">{formatCurrency(item.price)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  <h2 style={{ color: 'var(--accent)' }}>Order History</h2>
                  <div className="period-toggle">
                    {['today', 'week', 'month'].map(f => (
                      <button key={f} type="button" className={billFilter === f ? 'active' : ''} onClick={() => setBillFilter(f)}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {visibleBranchNames.map(branchName => {
                    const branchBills = bills.filter(b => (b.branches?.name ?? 'Unknown Branch') === branchName)
                    return (
                      <div key={branchName}>
                        <h3 style={{ fontSize: '0.9rem', color: '#a78bfa', marginBottom: '0.5rem' }}>{branchName} — {branchBills.length} order{branchBills.length === 1 ? '' : 's'}</h3>
                        {branchBills.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No orders in this period.</p>
                        ) : (
                          <table className="data-table">
                            <thead><tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Mode</th></tr></thead>
                            <tbody>
                              {branchBills.map(b => (
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
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card" style={{ marginBottom: '1.25rem' }}>
                <h2 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Inventory</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {visibleBranchNames.map(branchName => {
                    const branchInventory = inventory.filter(i => (i.branches?.name ?? 'Unknown Branch') === branchName)
                    return (
                      <div key={branchName}>
                        <h3 style={{ fontSize: '0.9rem', color: '#a78bfa', marginBottom: '0.5rem' }}>{branchName} — {branchInventory.length} item{branchInventory.length === 1 ? '' : 's'}</h3>
                        {branchInventory.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No inventory logged yet.</p>
                        ) : (
                          <table className="data-table">
                            <thead><tr><th>Item</th><th>Current Stock</th></tr></thead>
                            <tbody>
                              {branchInventory.map(item => {
                                const lowStock = item.quantity <= 5
                                return (
                                  <tr key={item.id}>
                                    <td>{item.name}</td>
                                    <td className="mono" style={{ color: lowStock ? '#ff8888' : '#4ade80', fontWeight: 700 }}>
                                      {item.quantity}{lowStock ? ' ⚠' : ''}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card">
                <h2 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Inventory Activity</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {visibleBranchNames.map(branchName => {
                    const branchLogs = logs.filter(l => (l.branches?.name ?? 'Unknown Branch') === branchName)
                    return (
                      <div key={branchName}>
                        <h3 style={{ fontSize: '0.9rem', color: '#a78bfa', marginBottom: '0.5rem' }}>{branchName} — {branchLogs.length}</h3>
                        {branchLogs.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No activity yet.</p>
                        ) : (
                          <table className="data-table">
                            <thead><tr><th>Date</th><th>Item</th><th>Action</th><th>Quantity</th><th>By</th></tr></thead>
                            <tbody>
                              {branchLogs.map(log => (
                                <tr key={log.id}>
                                  <td className="mono" style={{ fontSize: '0.82rem' }}>{formatDateTime(log.created_at)}</td>
                                  <td>{log.inventory_items?.name ?? '—'}</td>
                                  <td>
                                    <span style={{
                                      padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                                      background: log.action === 'add' ? 'rgba(74,222,128,0.12)' : 'rgba(255,150,0,0.12)',
                                      color: log.action === 'add' ? '#4ade80' : '#ffaa44',
                                    }}>
                                      {log.action === 'add' ? 'Added' : 'Availed'}
                                    </span>
                                  </td>
                                  <td className="mono">{log.action === 'add' ? '+' : '−'}{log.quantity}</td>
                                  <td style={{ fontSize: '0.82rem' }}>{log.staff?.display_name || log.staff?.username || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

export default function FoodMenuPage() {
  const { branchId, isOwner, isCombinedHall } = useAuth()
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

  // Inventory — fully separate from the food menu (see 045_inventory_items). Owner/admin
  // types any item name + a packet quantity; it upserts by name, no link to the menu at all.
  const [inventoryItems, setInventoryItems] = useState([])
  const [addItemName, setAddItemName] = useState('')
  const [addQuantity, setAddQuantity] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  // Staff "Avail" — a per-item counter (default 1) so 2+ packets can be marked used at once,
  // not just one click per packet.
  const [availCounts, setAvailCounts] = useState({})
  const [availSavingId, setAvailSavingId] = useState(null)
  const [availError, setAvailError] = useState('')

  const availCount = (itemId) => availCounts[itemId] ?? 1
  const setAvailCount = (itemId, value) => setAvailCounts(prev => ({ ...prev, [itemId]: value }))

  const load = useCallback(async () => {
    if (isCombinedHall) return
    const data = await api('list_food_items', { branchId })
    setFoodItems((data.items ?? []).filter(i => i.is_active))
  }, [branchId, isCombinedHall])

  const loadBills = useCallback(async () => {
    if (isCombinedHall) return
    const { dateFrom, dateTo } = billDateRange(billFilter)
    const data = await api('list_food_bills', { branchId, dateFrom, dateTo })
    setBills(data.bills ?? [])
  }, [branchId, billFilter, isCombinedHall])

  const loadInventory = useCallback(async () => {
    if (isCombinedHall || !branchId) return
    const data = await api('list_inventory_items', { branchId })
    setInventoryItems(data.items ?? [])
  }, [branchId, isCombinedHall])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadInventory() }, [loadInventory])
  // Staff see menu + history combined on one screen (no tabs), so history always needs
  // to be loaded; owners still only load it lazily when they switch to the History tab.
  useEffect(() => { if (!isOwner || tab === 'history') loadBills() }, [isOwner, tab, loadBills])

  if (isCombinedHall) return <CombinedFoodMenu />

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

  const handleAddInventory = async (e) => {
    e.preventDefault()
    const addNum = Number(addQuantity)
    const typedName = addItemName.trim()
    if (!typedName) return setAddError('Enter an item name')
    if (!(addNum > 0)) return setAddError('Enter a quantity greater than 0')
    setAddSaving(true)
    setAddError('')
    setAddSuccess('')
    try {
      await api('add_inventory_item', { branchId, name: typedName, addQuantity: addNum })
      setAddSuccess(`Added ${addNum} packet${addNum === 1 ? '' : 's'} to ${typedName}`)
      setAddItemName('')
      setAddQuantity('')
      loadInventory()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAddSaving(false)
    }
  }

  const handleAvail = async (item) => {
    const qty = availCount(item.id)
    setAvailSavingId(item.id)
    setAvailError('')
    try {
      await api('avail_inventory_item', { itemId: item.id, quantity: qty })
      setAvailCount(item.id, 1)
      loadInventory()
    } catch (err) {
      setAvailError(err.message)
    } finally {
      setAvailSavingId(null)
    }
  }

  return (
    <>
      <div className="page-header"><h1>Food Menu</h1></div>
      {isOwner && (
        <div className="tabs">
          <button type="button" className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>Manage Menu</button>
          <button type="button" className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory</button>
          <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
        </div>
      )}

      {(!isOwner || tab === 'menu') && (
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

      {isOwner && tab === 'inventory' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Add Inventory</h3>
              <form onSubmit={handleAddInventory}>
                <div className="form-group">
                  <label>Item Name</label>
                  <input
                    type="text" value={addItemName}
                    onChange={(e) => setAddItemName(e.target.value)}
                    placeholder="e.g. Tea Packets" required
                  />
                </div>
                <div className="form-group">
                  <label>Packet Quantity</label>
                  <input
                    type="number" min="1" value={addQuantity}
                    onChange={(e) => setAddQuantity(e.target.value)}
                    placeholder="e.g. 50" required
                  />
                </div>
                {addError && <p className="error-msg">{addError}</p>}
                {addSuccess && <p style={{ color: '#4ade80', fontSize: '0.85rem' }}>{addSuccess}</p>}
                <button type="submit" className="btn btn-primary" disabled={addSaving}>
                  {addSaving ? 'Adding…' : 'Add Inventory'}
                </button>
              </form>
            </div>

            <div className="card">
              <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Current Inventory</h3>
              {inventoryItems.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No inventory logged yet — add some from the left.</p>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Item</th><th>Current Stock</th></tr></thead>
                  <tbody>
                    {inventoryItems.map(item => {
                      const lowStock = item.quantity <= 5
                      return (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td className="mono" style={{ color: lowStock ? '#ff8888' : '#4ade80', fontWeight: 700 }}>
                            {item.quantity}{lowStock ? ' ⚠' : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Inventory Activity Log</h3>
            <InventoryLog branchId={branchId} />
          </div>
        </>
      )}

      {!isOwner && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>Inventory</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Used some packets? Set how many and tap Avail — the owner tracks stock levels from this.
          </p>
          {availError && <p className="error-msg" style={{ marginBottom: '0.75rem' }}>{availError}</p>}
          {inventoryItems.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No inventory logged yet.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Item</th><th>Current Stock</th><th>Quantity</th><th></th></tr></thead>
              <tbody>
                {inventoryItems.map(item => {
                  const outOfStock = item.quantity <= 0
                  const count = availCount(item.id)
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="mono" style={{ color: outOfStock ? '#ff8888' : undefined }}>{item.quantity}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <button
                            type="button" className="btn btn-ghost" style={{ padding: '0.2rem 0.6rem', fontSize: '0.9rem' }}
                            disabled={outOfStock || count <= 1}
                            onClick={() => setAvailCount(item.id, Math.max(1, count - 1))}
                          >−</button>
                          <span className="mono" style={{ minWidth: 24, textAlign: 'center' }}>{count}</span>
                          <button
                            type="button" className="btn btn-ghost" style={{ padding: '0.2rem 0.6rem', fontSize: '0.9rem' }}
                            disabled={outOfStock || count >= item.quantity}
                            onClick={() => setAvailCount(item.id, Math.min(item.quantity, count + 1))}
                          >+</button>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button" className="btn btn-primary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                          disabled={outOfStock || availSavingId === item.id}
                          title={outOfStock ? 'Out of stock' : undefined}
                          onClick={() => handleAvail(item)}
                        >
                          {availSavingId === item.id ? '…' : `Avail ${count}`}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(!isOwner || tab === 'history') && (
        <div className="card" style={{ marginTop: !isOwner ? '1rem' : 0 }}>
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

// ── Inventory Activity Log — every add/avail event for this branch, newest first. Lives on
// its own so the Inventory tab's data-load doesn't block on it (and vice versa).
function InventoryLog({ branchId }) {
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!branchId) return
    setError('')
    try {
      const data = await api('list_inventory_log', { branchId })
      setLogs(data.logs ?? [])
    } catch (err) {
      setError(err.message)
    }
  }, [branchId])

  useEffect(() => { load() }, [load])

  if (error) return <p className="error-msg">{error}</p>
  if (!logs) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
  if (logs.length === 0) return <p style={{ color: 'var(--text-muted)' }}>No activity yet — adding or availing inventory will show up here.</p>

  return (
    <table className="data-table">
      <thead><tr><th>Date</th><th>Item</th><th>Action</th><th>Quantity</th><th>By</th></tr></thead>
      <tbody>
        {logs.map(log => (
          <tr key={log.id}>
            <td className="mono" style={{ fontSize: '0.82rem' }}>{formatDateTime(log.created_at)}</td>
            <td>{log.inventory_items?.name ?? '—'}</td>
            <td>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                background: log.action === 'add' ? 'rgba(74,222,128,0.12)' : 'rgba(255,150,0,0.12)',
                color: log.action === 'add' ? '#4ade80' : '#ffaa44',
              }}>
                {log.action === 'add' ? 'Added' : 'Availed'}
              </span>
            </td>
            <td className="mono">{log.action === 'add' ? '+' : '−'}{log.quantity}</td>
            <td style={{ fontSize: '0.82rem' }}>{log.staff?.display_name || log.staff?.username || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
