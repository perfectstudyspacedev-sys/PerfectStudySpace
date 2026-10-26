import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatCurrency, formatDateTime, openWhatsApp } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

// PSS-AI Phase 4 (D10) — food orders from the portal, for whoever fills them: the kitchen, an
// outside vendor's login or the owner at a vending shelf. Delivering bills the order through the
// usual food bill (Food Pass, tab, cash or UPI). The owner's tab links menu items to stock, shows
// the demand forecast and the supplier order drafts (I20/I21).
const STATUS = { placed: 'New', accepted: 'Being made', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' }

function OrderCard({ o, onAct, busy }) {
  // A Food Pass with money on it is the only way to pay (the counter's rule); an empty one counts
  // as no pass. Cash or UPI is never offered on top of a pass — that would charge twice.
  const hasPass = o.foodPassBalance != null && o.foodPassBalance > 0
  const shortfall = hasPass && o.foodPassBalance < o.total ? Math.round((o.total - o.foodPassBalance) * 100) / 100 : 0
  const [mode, setMode] = useState('tab')
  const open = ['placed', 'accepted', 'ready'].includes(o.status)
  return (
    <div className="card" data-testid="food-order" style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong>{o.student ?? 'Student'}{o.desk ? ` · desk ${o.desk}` : ''}</strong>
        <span className="badge">{STATUS[o.status] ?? o.status}</span>
      </div>
      <p style={{ margin: '0.4rem 0' }}>{o.items.map((l) => `${l.quantity}× ${l.name}`).join(', ')} · <strong>{formatCurrency(o.total)}</strong></p>
      {o.note && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Note: {o.note}</p>}
      <p style={{ margin: '0.3rem 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatDateTime(o.at)}{!o.stillCheckedIn && open ? ' · no longer checked in' : ''}{o.cancelReason ? ` · ${o.cancelReason}` : ''}</p>
      {open && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' }}>
          {o.status === 'placed' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAct('update_food_order', { orderId: o.id, status: 'accepted' })}>Accept</button>}
          {o.status !== 'ready' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAct('update_food_order', { orderId: o.id, status: 'ready' })}>Ready</button>}
          {hasPass
            ? <span style={{ fontSize: '0.85rem' }} data-testid="food-pass-note">Food Pass {formatCurrency(o.foodPassBalance)}{shortfall ? ` — short by ${formatCurrency(shortfall)}, collected at checkout` : ''}</span>
            : (
              <select aria-label="How it is paid" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="tab">On their tab</option>
                <option value="cash">Cash now</option>
                <option value="upi">UPI now</option>
              </select>
            )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAct('deliver_food_order', { orderId: o.id, paymentMode: !hasPass && (mode === 'cash' || mode === 'upi') ? mode : null })}>Delivered</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { const reason = window.prompt('Why is it cancelled? (the student sees this)', 'Not available right now'); if (reason !== null) onAct('update_food_order', { orderId: o.id, status: 'cancelled', reason }) }}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function Orders({ branchId }) {
  const [view, setView] = useState('open')
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const load = useCallback(() => api('list_food_orders', { branchId, view }).then((r) => setOrders(r.orders ?? [])).catch((e) => setError(e.message)), [branchId, view])
  useEffect(() => {
    load()
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [load])
  const act = async (action, payload) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await api(action, payload)
      if (action === 'deliver_food_order' && r.bill) {
        setNotice(r.foodPassShortfall ? `Billed ${formatCurrency(r.bill.total)}: the Food Pass is short by ${formatCurrency(r.foodPassShortfall)} — it is collected at checkout.`
          : r.bill.paidFromPass ? `Paid ${formatCurrency(r.bill.total)} from the Food Pass (${formatCurrency(r.foodPassBalance)} left).`
          : r.bill.paid ? `Paid ${formatCurrency(r.bill.total)}.` : `${formatCurrency(r.bill.total)} is on their tab.`)
      }
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="period-toggle" style={{ marginBottom: '0.75rem' }}>
        {[['open', 'To do'], ['done', 'Done today']].map(([v, l]) => <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)}>{l}</button>)}
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {notice && <p className="success-msg" role="status" data-testid="food-notice">{notice}</p>}
      {!orders ? <p>Loading…</p> : orders.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No orders {view === 'open' ? 'waiting' : 'today'}.</p> : orders.map((o) => <OrderCard key={`${o.id}-${o.status}`} o={o} onAct={act} busy={busy} />)}
    </>
  )
}

function Stock({ branchId }) {
  const [data, setData] = useState(null)
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  const [got, setGot] = useState({})
  const load = useCallback(async () => {
    setError('')
    try {
      const [f, s] = await Promise.all([api('get_food_forecast', { branchId }), api('list_supplier_orders', { branchId })])
      setData(f); setOrders(s.orders ?? [])
    } catch (e) { setError(e.message) }
  }, [branchId])
  useEffect(() => { load() }, [load])
  const act = async (action, payload) => { setError(''); try { await api(action, payload); await load() } catch (e) { setError(e.message) } }
  if (!data) return error ? <p className="error-msg">{error}</p> : <p>Loading…</p>
  // One chat per supplier, each opened by its own click (a browser lets one click open one tab).
  const bySupplier = (o) => {
    const byPhone = new Map()
    for (const l of o.items) byPhone.set(l.supplierPhone ?? '', [...(byPhone.get(l.supplierPhone ?? '') ?? []), l])
    return byPhone
  }
  const sendTo = (phone, lines) => openWhatsApp(phone, `Hello, please send for Perfect Study Space:\n${lines.map((l) => `• ${l.name}: ${l.order}`).join('\n')}\nThank you.\n— Team Perfect Study Space`)
  return (
    <>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Supplier orders</h3>
        {orders.filter((o) => ['draft', 'sent'].includes(o.status)).length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nothing to order right now. A draft appears each night when stock runs short of {data.leadDays} days of expected use.</p>}
        {orders.filter((o) => ['draft', 'sent'].includes(o.status)).map((o) => (
          <div key={o.id} data-testid="supplier-order" style={{ borderTop: '1px solid #222', padding: '0.6rem 0' }}>
            <strong>{o.status === 'draft' ? 'Draft' : 'Sent'}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>· {formatDateTime(o.updated_at ?? o.created_at)}</span>
            <table className="data-table" style={{ marginTop: '0.4rem' }}>
              <thead><tr><th>Item</th><th>In stock</th><th>Needed</th><th>Order</th><th>Arrived</th></tr></thead>
              <tbody>{o.items.map((l) => (
                <tr key={l.inventoryItemId}><td>{l.name}</td><td>{l.have}</td><td>{l.need}</td><td>{l.order}</td>
                  <td><input type="number" min={0} style={{ width: 70 }} aria-label={`${l.name} arrived`} value={got[`${o.id}:${l.inventoryItemId}`] ?? l.order} onChange={(e) => setGot({ ...got, [`${o.id}:${l.inventoryItemId}`]: e.target.value })} /></td></tr>
              ))}</tbody>
            </table>
            {o.status === 'draft' && bySupplier(o).has('') && (
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No supplier phone for {bySupplier(o).get('').map((l) => l.name).join(', ')} — order these yourself, or add the supplier's phone in the menu-item links below.</p>
            )}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              {o.status === 'draft' && [...bySupplier(o)].filter(([phone]) => phone).map(([phone, lines]) => (
                <button key={phone} type="button" className="btn btn-ghost" onClick={() => sendTo(phone, lines)}>💬 WhatsApp {phone} ({lines.length} item{lines.length === 1 ? '' : 's'})</button>
              ))}
              {o.status === 'draft' && <button type="button" className="btn btn-primary" onClick={() => act('update_supplier_order', { orderId: o.id, status: 'sent' })}>Mark as sent</button>}
              <button type="button" className="btn btn-ghost" onClick={() => act('update_supplier_order', { orderId: o.id, status: 'received', received: o.items.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: Number(got[`${o.id}:${l.inventoryItemId}`] ?? l.order) })) })}>Received — add to stock</button>
              <button type="button" className="btn btn-ghost" onClick={() => act('update_supplier_order', { orderId: o.id, status: 'discarded' })}>Discard</button>
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Stock</h3>
        <table className="data-table">
          <thead><tr><th>Item</th><th>In stock</th><th>Used a day</th><th>Lasts</th><th>Supplier</th></tr></thead>
          <tbody>{data.inventory.map((i) => (
            <tr key={i.id}><td>{i.name}</td><td>{i.have}</td><td>{i.perDay || '—'}</td><td>{i.daysLeft == null ? '—' : `${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'}`}</td><td className="mono">{i.supplierPhone ?? '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Menu items and the stock they use</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Expected sales for the next {data.days.length} days come from the same weekdays over the last {data.weeks} weeks.</p>
        <table className="data-table">
          <thead><tr><th>Menu item</th><th>Next 7 days</th><th>Uses stock</th><th>Packets each</th><th>Supplier phone</th><th /></tr></thead>
          <tbody>{data.items.map((m) => <StockLink key={m.id} m={m} inventory={data.inventory} onSave={(p) => act('set_food_item_stock_link', p)} />)}</tbody>
        </table>
      </div>
    </>
  )
}

function StockLink({ m, inventory, onSave }) {
  const [inv, setInv] = useState(m.inventoryItemId ?? '')
  const [per, setPer] = useState(String(m.perUnit ?? 1))
  const [phone, setPhone] = useState(inventory.find((i) => i.id === m.inventoryItemId)?.supplierPhone ?? '')
  return (
    <tr>
      <td>{m.name}</td>
      <td style={{ fontSize: '0.8rem' }}>{m.next.reduce((a, b) => a + b, 0).toFixed(0)}</td>
      <td><select aria-label={`Stock used by ${m.name}`} value={inv} onChange={(e) => setInv(e.target.value)}><option value="">— none —</option>{inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></td>
      <td><input type="number" min={1} max={100} style={{ width: 60 }} aria-label={`Packets per ${m.name}`} value={per} onChange={(e) => setPer(e.target.value)} /></td>
      <td><input inputMode="numeric" style={{ width: 120 }} aria-label="Supplier phone" placeholder="10 digits" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} disabled={!inv} /></td>
      <td><button type="button" className="btn btn-ghost" onClick={() => onSave({ itemId: m.id, inventoryItemId: inv || null, perUnit: Number(per) || 1, ...(inv ? { supplierPhone: phone } : {}) })}>Save</button></td>
    </tr>
  )
}

export default function FoodQueuePage() {
  const { branchId, isOwner, isCombinedHall } = useAuth()
  const flags = useFeatureFlags()
  const tabs = [flags.foodOrders && ['orders', 'Orders'], isOwner && flags.foodStock && ['stock', 'Stock & suppliers']].filter(Boolean)
  const [tab, setTab] = useState(null)
  const current = tab && tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0]
  return (
    <>
      <div className="page-header"><h1>Food orders</h1></div>
      {!tabs.length ? <p style={{ color: 'var(--text-muted)' }}>Food ordering is not switched on.</p>
        : isCombinedHall || !branchId ? <p style={{ color: 'var(--text-muted)' }}>Choose a branch at the top to see its food orders.</p> : (
          <>
            {tabs.length > 1 && (
              <div role="tablist" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={current === k} className={`btn ${current === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{label}</button>)}
              </div>
            )}
            {current === 'orders' ? <Orders branchId={branchId} /> : <Stock branchId={branchId} />}
          </>
        )}
    </>
  )
}
