import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { exportToCSV, formatDate, formatDateTime, openWhatsApp } from '../lib/utils'

const STATUSES = ['new', 'contacted', 'trial_session', 'converted', 'dropped']
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', trial_session: 'Trial Session', converted: 'Converted', dropped: 'Dropped' }
const STATUS_BADGE = { new: 'badge-new', contacted: 'badge-pending', trial_session: 'badge-trial', converted: 'badge-active', dropped: 'badge-inactive' }
const STATUS_RANK = { dropped: -1, new: 0, contacted: 1, trial_session: 2, converted: 3 }
const SOURCE_LABEL = {
  walk_in: 'Walk-in', phone_call: 'Phone Call', referral: 'Referral',
  instagram: 'Instagram', google_search: 'Google Search', website_form: 'Website Form',
}
const ACT_ICON = { note: '📝', call: '📞', email: '✉️', whatsapp: '💬', status_change: '🔄' }
const PER_PAGE = 10

function normalizePhone(phone) {
  if (!phone) return ''
  return phone.replace(/\D/g, '').slice(-10)
}
function dupKey(enq) {
  const ph = normalizePhone(enq.phone)
  return ph || (enq.email ? enq.email.toLowerCase().trim() : '')
}
function findDuplicateGroups(list) {
  const map = new Map()
  list.forEach(e => {
    const key = dupKey(e)
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(e)
  })
  return [...map.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length)
}
function fmtDT(d) {
  return formatDateTime(d)
}
function fmtDate(d) {
  return formatDate(d)
}

export default function EnquiriesPage() {
  const { branchId, isOwner } = useAuth()
  const [enquiries, setEnquiries] = useState([])
  const [loading, setLoading] = useState(true)
  const [errBanner, setErrBanner] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [dayFilter, setDayFilter] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [dupMode, setDupMode] = useState(false)

  const [drawerEnq, setDrawerEnq] = useState(null)
  const [activities, setActivities] = useState([])
  const [followups, setFollowups] = useState([])

  const [mergeGroup, setMergeGroup] = useState(null)
  const [mergePrimary, setMergePrimary] = useState('')
  const [merging, setMerging] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', phone: '', email: '', source: 'walk_in', message: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const [emailModal, setEmailModal] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [savedFilters, setSavedFilters] = useState([])
  const [showTodayPanel, setShowTodayPanel] = useState(true)
  const [todayFollowups, setTodayFollowups] = useState({ overdue: [], today: [] })

  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  const [statusDrop, setStatusDrop] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [intType, setIntType] = useState('note')
  const [intNote, setIntNote] = useState('')
  const [fuNote, setFuNote] = useState('')
  const [fuDue, setFuDue] = useState('')

  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200)
  }, [])

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    setErrBanner(false)
    try {
      const { enquiries: data } = await api('list_enquiries', { branchId })
      setEnquiries(data ?? [])
    } catch (e) {
      console.error(e)
      setErrBanner(true)
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { load() }, [load])

  const loadTodayFollowups = useCallback(async () => {
    if (!branchId) return
    try {
      const { followups: open } = await api('list_open_enquiry_followups', { branchId })
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
      const overdue = (open ?? []).filter(f => new Date(f.due_at) < todayStart)
      const dueToday = (open ?? []).filter(f => { const d = new Date(f.due_at); return d >= todayStart && d <= todayEnd })
      setTodayFollowups({ overdue, today: dueToday })
    } catch { /* non-critical */ }
  }, [branchId])

  useEffect(() => { loadTodayFollowups() }, [loadTodayFollowups])

  useEffect(() => {
    try { setSavedFilters(JSON.parse(localStorage.getItem('pss_enq_saved_filters') || '[]')) } catch { setSavedFilters([]) }
  }, [])

  useEffect(() => { setNotesDraft(drawerEnq?.notes || '') }, [drawerEnq?.id])

  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest?.('.status-drop') || e.target.closest?.('.badge')) return
      setStatusDrop(null)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  useEffect(() => {
    if (!statusDrop) return
    const close = () => setStatusDrop(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [statusDrop])

  const openStatusDrop = (e, key) => {
    e.stopPropagation()
    const trigger = e.currentTarget
    setStatusDrop(d => {
      if (d && d.key === key) return null
      const r = trigger.getBoundingClientRect()
      const estHeight = STATUSES.length * 38 + 10
      const openUpward = r.bottom + estHeight > window.innerHeight
      return {
        key,
        top: openUpward ? r.top - estHeight - 6 : r.bottom + 6,
        left: Math.min(r.left, window.innerWidth - 176),
      }
    })
  }

  const persistSavedFilters = (list) => {
    setSavedFilters(list)
    localStorage.setItem('pss_enq_saved_filters', JSON.stringify(list))
  }

  const dupGroups = useMemo(() => findDuplicateGroups(enquiries), [enquiries])
  const dupIds = useMemo(() => new Set(dupGroups.flat().map(e => e.id)), [dupGroups])

  const filtered = useMemo(() => {
    if (dupMode) {
      const ordered = dupGroups.flat()
      const order = new Map(ordered.map((e, i) => [e.id, i]))
      return enquiries.filter(e => dupIds.has(e.id)).sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    }
    const q = search.trim().toLowerCase()
    const cutoff = dayFilter ? new Date(Date.now() - dayFilter * 86400000) : null
    const fromDate = dateFrom ? new Date(dateFrom) : null
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null
    return enquiries.filter(e => {
      const created = new Date(e.created_at)
      if (cutoff && created < cutoff) return false
      if (fromDate && created < fromDate) return false
      if (toDate && created > toDate) return false
      if (statusFilter && (e.status || 'new') !== statusFilter) return false
      if (sourceFilter && e.source !== sourceFilter) return false
      if (q) {
        const hay = [e.name, e.email, e.phone, e.source, e.message].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enquiries, search, statusFilter, sourceFilter, dayFilter, dateFrom, dateTo, dupMode, dupGroups, dupIds])

  useEffect(() => { setPage(0) }, [search, statusFilter, sourceFilter, dayFilter, dateFrom, dateTo, dupMode])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  const stats = useMemo(() => {
    const todayStr = new Date().toDateString()
    return {
      total: enquiries.length,
      today: enquiries.filter(e => new Date(e.created_at).toDateString() === todayStr).length,
      pending: enquiries.filter(e => !e.status || e.status === 'new' || e.status === 'contacted' || e.status === 'trial_session').length,
      converted: enquiries.filter(e => e.status === 'converted').length,
    }
  }, [enquiries])

  const patch = async (id, fields) => {
    await api('update_enquiry', { id, fields })
    setEnquiries(list => list.map(e => e.id === id ? { ...e, ...fields } : e))
  }
  const logActivity = async (enquiryId, type, note) => {
    try { await api('add_enquiry_activity', { enquiryId, type, note }) } catch { /* non-critical */ }
  }
  const refreshActivities = async (id) => {
    try { const { activities: acts } = await api('list_enquiry_activities', { enquiryId: id }); return acts ?? [] } catch { return [] }
  }

  const changeStatus = async (id, status) => {
    const enq = enquiries.find(e => e.id === id)
    const oldStatus = enq?.status || 'new'
    await patch(id, { status })
    if (oldStatus !== status) await logActivity(id, 'status_change', `Status changed: ${STATUS_LABEL[oldStatus]} → ${STATUS_LABEL[status]}`)
    setStatusDrop(null)
    if (drawerEnq?.id === id) setDrawerEnq(e => ({ ...e, status }))
    showToast(`${enq?.name || 'Enquiry'} → ${STATUS_LABEL[status]}`, 'ok')
  }

  const doRemoveOne = async (id) => {
    await api('delete_enquiries', { id })
    setEnquiries(list => list.filter(e => e.id !== id))
    setSelected(s => { const n = new Set(s); n.delete(id); return n })
    if (drawerEnq?.id === id) setDrawerEnq(null)
    showToast('Enquiry deleted', 'err')
  }

  const removeOne = (id) => {
    setConfirmDialog({
      message: 'Delete this enquiry? This cannot be undone.',
      onConfirm: () => doRemoveOne(id),
    })
  }

  const toggleCheck = (id, checked) => {
    setSelected(s => { const n = new Set(s); checked ? n.add(id) : n.delete(id); return n })
  }
  const toggleAllOnPage = (checked) => {
    setSelected(s => { const n = new Set(s); pageRows.forEach(r => checked ? n.add(r.id) : n.delete(r.id)); return n })
  }
  const clearSelection = () => setSelected(new Set())

  const bulkSetStatus = async (status) => {
    const ids = [...selected]
    await Promise.all(ids.map(id => patch(id, { status })))
    showToast(`${ids.length} enquir${ids.length > 1 ? 'ies' : 'y'} → ${STATUS_LABEL[status]}`, 'ok')
    clearSelection()
  }
  const doBulkDelete = async () => {
    const ids = [...selected]
    await api('delete_enquiries', { ids })
    setEnquiries(list => list.filter(e => !ids.includes(e.id)))
    clearSelection()
    showToast(`${ids.length} enquiries deleted`, 'err')
  }

  const bulkDelete = () => {
    if (!selected.size) return
    setConfirmDialog({
      message: `Delete ${selected.size} enquir${selected.size > 1 ? 'ies' : 'y'}? This cannot be undone.`,
      onConfirm: doBulkDelete,
    })
  }
  const handleExport = (useSelected) => {
    const data = useSelected && selected.size ? enquiries.filter(e => selected.has(e.id)) : filtered
    if (!data.length) { showToast('No enquiries to export', 'info'); return }
    exportToCSV(
      `enquiries-${branchId?.slice(0, 8)}.csv`,
      ['Name', 'Phone', 'Email', 'Source', 'Message', 'Status', 'Notes', 'Received'],
      data.map(e => [e.name, e.phone, e.email, SOURCE_LABEL[e.source] || e.source, e.message, STATUS_LABEL[e.status || 'new'], e.notes, e.created_at]),
    )
    showToast(`Exported ${data.length} enquiries`, 'ok')
  }

  const saveCurrentFilter = () => {
    if (!search && !statusFilter && !sourceFilter && !dayFilter && !dateFrom && !dateTo) {
      showToast('No active filter to save', 'info'); return
    }
    const parts = []
    if (search) parts.push(`"${search}"`)
    if (statusFilter) parts.push(STATUS_LABEL[statusFilter])
    if (sourceFilter) parts.push(SOURCE_LABEL[sourceFilter])
    if (dayFilter) parts.push(`${dayFilter}d`)
    if (dateFrom || dateTo) parts.push(`${dateFrom || ''}→${dateTo || ''}`)
    const label = parts.join(' · ') || 'Filter'
    persistSavedFilters([...savedFilters, { label, search, statusFilter, sourceFilter, dayFilter, dateFrom, dateTo }])
    showToast(`Filter saved: ${label}`, 'ok')
  }
  const applySavedFilter = (idx) => {
    const f = savedFilters[idx]
    if (!f) return
    setSearch(f.search || ''); setStatusFilter(f.statusFilter || ''); setSourceFilter(f.sourceFilter || '')
    setDayFilter(f.dayFilter || 0); setDateFrom(f.dateFrom || ''); setDateTo(f.dateTo || '')
    showToast(`Filter applied: ${f.label}`, 'info')
  }
  const removeSavedFilter = (idx) => persistSavedFilters(savedFilters.filter((_, i) => i !== idx))

  const openDrawer = async (id) => {
    const enq = enquiries.find(e => e.id === id)
    if (!enq) return
    setAddOpen(false)
    setMergeGroup(null)
    setDrawerEnq(enq)
    try {
      const [{ activities: acts }, { followups: fus }] = await Promise.all([
        api('list_enquiry_activities', { enquiryId: id }),
        api('list_enquiry_followups', { enquiryId: id }),
      ])
      setActivities(acts ?? [])
      setFollowups(fus ?? [])
    } catch { setActivities([]); setFollowups([]) }
  }
  const closeDrawer = () => { setDrawerEnq(null); setActivities([]); setFollowups([]) }

  const saveNotes = async () => {
    if (!drawerEnq) return
    await patch(drawerEnq.id, { notes: notesDraft })
    await logActivity(drawerEnq.id, 'note', 'Notes updated')
    setActivities(await refreshActivities(drawerEnq.id))
    showToast('Notes saved', 'ok')
  }
  const logInteraction = async () => {
    if (!drawerEnq || !intNote.trim()) { showToast('Enter a note', 'info'); return }
    await logActivity(drawerEnq.id, intType, intNote.trim())
    setIntNote('')
    setActivities(await refreshActivities(drawerEnq.id))
    showToast('Interaction logged', 'ok')
  }
  const addFollowUp = async () => {
    if (!drawerEnq) return
    if (!fuDue) { showToast('Select a date/time', 'err'); return }
    try {
      await api('add_enquiry_followup', { enquiryId: drawerEnq.id, note: fuNote || 'Follow up', dueAt: new Date(fuDue).toISOString() })
      setFuNote(''); setFuDue('')
      const { followups: fus } = await api('list_enquiry_followups', { enquiryId: drawerEnq.id })
      setFollowups(fus ?? [])
      await logActivity(drawerEnq.id, 'note', `Follow-up scheduled for ${fuDue}`)
      setActivities(await refreshActivities(drawerEnq.id))
      loadTodayFollowups()
      showToast('Follow-up scheduled', 'ok')
    } catch { showToast('Failed to save follow-up', 'err') }
  }
  const toggleFollowUp = async (id, done) => {
    try {
      await api('update_enquiry_followup', { id, fields: { done } })
      setFollowups(list => list.map(f => f.id === id ? { ...f, done } : f))
      loadTodayFollowups()
    } catch { showToast('Failed to update follow-up', 'err') }
  }

  const openMergeModal = (enqId) => {
    const group = dupGroups.find(g => g.some(e => e.id === enqId))
    if (!group) return
    const suggested = group.reduce((best, e) => (STATUS_RANK[e.status || 'new'] ?? 0) > (STATUS_RANK[best.status || 'new'] ?? 0) ? e : best, group[0])
    setDrawerEnq(null)
    setAddOpen(false)
    setMergeGroup(group)
    setMergePrimary(suggested.id)
  }
  const closeMergeModal = () => { setMergeGroup(null); setMergePrimary(''); setMerging(false) }

  const confirmMerge = async () => {
    if (!mergeGroup || !mergePrimary) return
    const primary = mergeGroup.find(e => e.id === mergePrimary)
    const others = mergeGroup.filter(e => e.id !== mergePrimary)
    setMerging(true)
    try {
      const nonDropped = mergeGroup.filter(e => (e.status || 'new') !== 'dropped')
        .sort((a, b) => (STATUS_RANK[b.status || 'new'] ?? 0) - (STATUS_RANK[a.status || 'new'] ?? 0))
      const bestStatus = nonDropped[0] ? (nonDropped[0].status || 'new') : 'dropped'
      const earliest = mergeGroup.reduce((d, e) => { const t = new Date(e.created_at); return t < d ? t : d }, new Date(primary.created_at))
      const notesParts = mergeGroup.map(e => (e.notes || '').trim()).filter(Boolean)
      const uniqueNotes = [...new Set(notesParts)].join('\n---\n')
      const allSources = mergeGroup.map(e => SOURCE_LABEL[e.source] || e.source).filter(Boolean)
      const actNote = `Merged ${mergeGroup.length} duplicate enquiries (sources: ${[...new Set(allSources)].join(', ')}) on ${fmtDate(new Date())}`

      await api('update_enquiry', {
        id: primary.id,
        fields: { status: bestStatus, notes: uniqueNotes || primary.notes || null, message: primary.message || null, created_at: earliest.toISOString() },
      })
      await logActivity(primary.id, 'note', actNote)
      await Promise.all(others.map(o => logActivity(primary.id, 'merged_snapshot', JSON.stringify({
        name: o.name, phone: o.phone, email: o.email, source: o.source, message: o.message, notes: o.notes, status: o.status, created_at: o.created_at,
      }))))
      const deletedIds = others.map(o => o.id)
      await api('delete_enquiries', { ids: deletedIds })
      setEnquiries(list => list
        .filter(e => !deletedIds.includes(e.id))
        .map(e => e.id === primary.id ? { ...e, status: bestStatus, notes: uniqueNotes || primary.notes, created_at: earliest.toISOString() } : e))
      setSelected(s => { const n = new Set(s); deletedIds.forEach(id => n.delete(id)); return n })
      closeMergeModal()
      showToast(`Merged ${mergeGroup.length} records into 1`, 'ok')
    } catch (e) {
      console.error(e)
      showToast('Merge failed — see console', 'err')
      setMerging(false)
    }
  }

  const submitAdd = async () => {
    if (!addForm.name.trim()) { setAddError('Name is required'); return }
    if (addForm.phone && addForm.phone.length !== 10) { setAddError('Phone number must be 10 digits'); return }
    setAddSaving(true); setAddError('')
    try {
      const { enquiry } = await api('create_enquiry', { branchId, ...addForm })
      setEnquiries(list => [enquiry, ...list])
      setAddOpen(false)
      setAddForm({ name: '', phone: '', email: '', source: 'walk_in', message: '' })
      showToast('Enquiry added', 'ok')
    } catch (e) {
      setAddError(e.message)
    } finally {
      setAddSaving(false)
    }
  }

  const waLink = (phone, name) => {
    openWhatsApp(phone, `Hi ${name}, this is Perfect Study Space — following up on your enquiry. How can we help you?`)
  }
  const openEmailModal = (enq) => {
    setEmailModal({
      enquiryId: enq.id, to: enq.email || '', subject: 'Your Perfect Study Space Enquiry',
      body: `Hi ${enq.name || ''},\n\nThank you for reaching out to Perfect Study Space. We received your enquiry and our team will get back to you shortly.\n\nWarm regards,\nPerfect Study Space Team`,
    })
  }
  const sendEmail = () => {
    if (!emailModal) return
    const { to, subject, body, enquiryId } = emailModal
    if (!to || !subject || !body) { showToast('Please fill all fields', 'err'); return }
    const a = document.createElement('a')
    a.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    a.style.display = 'none'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    logActivity(enquiryId, 'email', `Email drafted to ${to}: ${subject}`)
    showToast('Opened in your mail client', 'ok')
    setEmailModal(null)
  }

  const liveDupGroup = drawerEnq ? dupGroups.find(g => g.some(e => e.id === drawerEnq.id)) : null

  if (!branchId) return <p>Loading…</p>

  return (
    <>
      <div className="page-header">
        <h1>Enquiries</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {isOwner && <button type="button" className="btn btn-ghost" onClick={() => handleExport(false)}>Export CSV</button>}
          <button type="button" className="btn btn-primary" onClick={() => { setDrawerEnq(null); setMergeGroup(null); setAddOpen(true); setAddError('') }}>+ Add Enquiry</button>
        </div>
      </div>

      {errBanner && (
        <div className="card" style={{ borderColor: '#662222', background: 'rgba(255,60,60,0.06)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: '#ff8888', fontSize: '0.85rem' }}>⚠ Could not load enquiries.</span>
          <button type="button" className="btn btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      <div className="stats-row">
        <div className="card stat-card"><div className="value">{stats.total}</div><div className="label">Total Enquiries</div></div>
        <div className="card stat-card"><div className="value">{stats.today}</div><div className="label">New Today</div></div>
        <div className="card stat-card"><div className="value">{stats.pending}</div><div className="label">Needs Attention</div></div>
        <div className="card stat-card"><div className="value">{stats.converted}</div><div className="label">Converted</div></div>
      </div>

      {showTodayPanel && (todayFollowups.overdue.length + todayFollowups.today.length > 0) && (
        <div className="card" style={{ marginBottom: '1.2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ color: 'var(--accent)' }}>Today's Follow-ups</h3>
            <button type="button" className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '0.3rem 0.7rem' }} onClick={() => setShowTodayPanel(false)}>Dismiss</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[...todayFollowups.overdue, ...todayFollowups.today].map(f => {
              const isOverdue = todayFollowups.overdue.includes(f)
              const enq = enquiries.find(e => e.id === f.enquiry_id)
              return (
                <div key={f.id} onClick={() => openDrawer(f.enquiry_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', borderRadius: 8, cursor: 'pointer',
                    background: isOverdue ? 'rgba(255,70,70,0.05)' : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${isOverdue ? 'rgba(255,70,70,0.2)' : 'rgba(255,255,255,0.05)'}`,
                  }}>
                  <span style={{ fontWeight: 600, flex: 1, fontSize: '0.85rem' }}>{enq?.name || 'Enquiry'}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.note || 'Follow up'}</span>
                  <span style={{ fontSize: '0.7rem', color: isOverdue ? '#ff8888' : 'var(--ghost)', whiteSpace: 'nowrap' }}>{isOverdue ? '⚠ ' : ''}{fmtDT(f.due_at)}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem', flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); toggleFollowUp(f.id, true) }}
                  >
                    ✓ Complete
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {savedFilters.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          {savedFilters.map((f, i) => (
            <span key={i} className="sf-chip" onClick={() => applySavedFilter(i)}>
              {f.label}
              <span className="sf-chip-x" onClick={(e) => { e.stopPropagation(); removeSavedFilter(i) }}>✕</span>
            </span>
          ))}
        </div>
      )}

      {dupIds.size > 0 && (
        <button type="button" className={`dup-chip${dupMode ? ' active' : ''}`} onClick={() => setDupMode(d => !d)} style={{ marginBottom: '0.8rem' }}>
          ⚠ Duplicates ({dupIds.size})
        </button>
      )}

      <div className="filters">
        <input placeholder="Search name, email, phone, source…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All Sources</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="date-pills">
          {[[7, '7d'], [30, '30d'], [0, 'All']].map(([d, label]) => (
            <button key={label} type="button" className={`date-pill${dayFilter === d ? ' active' : ''}`} onClick={() => setDayFilter(d)}>{label}</button>
          ))}
        </div>
        <input type="date" className="dr-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From" />
        <input type="date" className="dr-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To" />
        <button type="button" className="btn btn-ghost" onClick={saveCurrentFilter} style={{ fontSize: '0.78rem' }}>+ Save Filter</button>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
            {loading ? <p>Loading…</p> : filtered.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No enquiries found. Try adjusting your filters, or add one.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox" onChange={(e) => toggleAllOnPage(e.target.checked)}
                        checked={pageRows.length > 0 && pageRows.every(r => selected.has(r.id))} />
                    </th>
                    <th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Source</th><th>Message</th><th>Status</th><th>Received</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const st = row.status || 'new'
                    const isDup = dupIds.has(row.id)
                    const fresh = Date.now() - new Date(row.created_at).getTime() < 86400000
                    return (
                      <tr key={row.id} style={isDup ? { background: 'rgba(245,158,11,0.03)', borderLeft: '3px solid #f5a623' } : undefined}>
                        <td><input type="checkbox" checked={selected.has(row.id)} onChange={(e) => toggleCheck(row.id, e.target.checked)} /></td>
                        <td className="mono">{page * PER_PAGE + i + 1}</td>
                        <td>
                          {fresh && <span title="New today" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginRight: 6, boxShadow: '0 0 8px rgba(255,215,0,0.6)' }} />}
                          <span style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => openDrawer(row.id)}>{row.name}</span>
                        </td>
                        <td className="mono">{row.phone || '—'}</td>
                        <td>{row.email || '—'}</td>
                        <td>{SOURCE_LABEL[row.source] || row.source || '—'}</td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.message || ''}>{row.message || '—'}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[st]} cap`} style={{ cursor: 'pointer' }} onClick={(e) => openStatusDrop(e, row.id)}>{STATUS_LABEL[st]} ▾</span>
                        </td>
                        <td className="mono" style={{ fontSize: '0.78rem' }}>{fmtDT(row.created_at)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button type="button" className="act-btn" title="View" onClick={() => openDrawer(row.id)}>👁</button>
                            {isDup && <button type="button" className="act-btn merge-btn" title="Merge duplicates" onClick={() => openMergeModal(row.id)}>⇄</button>}
                            {row.phone && <button type="button" className="act-btn wa" title="WhatsApp" onClick={() => waLink(row.phone, row.name)}>💬</button>}
                            <button type="button" className="act-btn del" title="Delete" onClick={() => removeOne(row.id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button type="button" className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</button>
              <span className="pag-info">Page {page + 1} of {totalPages} · {filtered.length} enquiries</span>
              <button type="button" className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next →</button>
            </div>
          )}

      {selected.size > 0 && (
        <div className="bulk-bar show">
          <div className="bulk-left">
            <span className="bulk-count">{selected.size} selected</span>
            <button type="button" className="btn btn-ghost" onClick={(e) => openStatusDrop(e, '__bulk__')}>Set Status ▾</button>
            {isOwner && <button type="button" className="btn btn-ghost" onClick={() => handleExport(true)}>Export CSV</button>}
            <button type="button" className="btn btn-danger" onClick={bulkDelete}>Delete</button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={clearSelection}>✕ Clear</button>
        </div>
      )}

      {/* ─── Add Enquiry Modal ─── */}
      {addOpen && (
        <div className="modal-overlay" onClick={() => setAddOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Enquiry</h2>
            <div className="form-group"><label>Name</label><input value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="form-group">
              <label>Phone</label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={addForm.phone}
                onChange={(e) => setAddForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
              />
            </div>
            <div className="form-group"><label>Email</label><input value={addForm.email} onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="form-group">
              <label>Source</label>
              <select value={addForm.source} onChange={(e) => setAddForm(f => ({ ...f, source: e.target.value }))}>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Message</label><textarea rows={3} value={addForm.message} onChange={(e) => setAddForm(f => ({ ...f, message: e.target.value }))} placeholder="What are they looking for?" /></div>
            {addError && <p className="error-msg">{addError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={addSaving} onClick={submitAdd}>{addSaving ? 'Saving…' : 'Add Enquiry'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Confirm Dialog ─── */}
      {confirmDialog && (
        <div className="modal-overlay" style={{ zIndex: 300 }} onClick={() => setConfirmDialog(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>Are you sure?</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => { const { onConfirm } = confirmDialog; setConfirmDialog(null); onConfirm() }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Merge Modal ─── */}
      {mergeGroup && (
        <div className="modal-overlay" onClick={closeMergeModal}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2>Merge Duplicate Enquiries</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Select the <strong style={{ color: 'var(--text)' }}>primary</strong> record to keep. Others will be merged into it and deleted.
            </p>
            {mergeGroup.map(g => (
              <label key={g.id} className={`merge-card${mergePrimary === g.id ? ' selected' : ''}`}>
                <input type="radio" name="merge-primary" checked={mergePrimary === g.id} onChange={() => setMergePrimary(g.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#fff' }}>{g.name || '—'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.phone || ''}{g.phone && g.email ? ' · ' : ''}{g.email || ''}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{SOURCE_LABEL[g.source] || g.source || '—'} · {fmtDT(g.created_at)}</div>
                  <span className={`badge ${STATUS_BADGE[g.status || 'new']} cap`} style={{ marginTop: '0.4rem', display: 'inline-block' }}>{STATUS_LABEL[g.status || 'new']}</span>
                </div>
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeMergeModal}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={merging} onClick={confirmMerge}>{merging ? 'Merging…' : 'Confirm Merge'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Email Modal (opens on top of the drawer) ─── */}
      {emailModal && (
        <div className="modal-overlay" style={{ zIndex: 150 }} onClick={() => setEmailModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Send Email</h2>
            <div className="form-group"><label>To</label><input type="email" value={emailModal.to} onChange={(e) => setEmailModal(m => ({ ...m, to: e.target.value }))} /></div>
            <div className="form-group"><label>Subject</label><input value={emailModal.subject} onChange={(e) => setEmailModal(m => ({ ...m, subject: e.target.value }))} /></div>
            <div className="form-group"><label>Message</label><textarea rows={6} value={emailModal.body} onChange={(e) => setEmailModal(m => ({ ...m, body: e.target.value }))} /></div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEmailModal(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={sendEmail}>Send Email →</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Detail Drawer ─── */}
      {drawerEnq && (
        <div className="modal-overlay" onClick={closeDrawer}>
          <div className="modal drawer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drw-head">
              <div>
                <div className="drw-title">{drawerEnq.name || '—'}</div>
                <div className="drw-sub">{drawerEnq.email || drawerEnq.phone || '—'}</div>
              </div>
              <button type="button" className="drw-close" onClick={closeDrawer}>✕</button>
            </div>

            {liveDupGroup && liveDupGroup.length > 1 && (
              <div className="tabs" style={{ padding: '0 0.25rem' }}>
                {liveDupGroup.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(g => (
                  <button key={g.id} type="button" className={g.id === drawerEnq.id ? 'active' : ''} onClick={() => openDrawer(g.id)}>
                    {SOURCE_LABEL[g.source] || g.source || 'Enquiry'} · {fmtDate(g.created_at)}
                  </button>
                ))}
              </div>
            )}

            <div className="drw-body">
              <div className="drw-info-grid">
                <div className="drw-field">
                  <div className="drw-lbl">Status</div>
                  <span className={`badge ${STATUS_BADGE[drawerEnq.status || 'new']} cap`} style={{ cursor: 'pointer' }} onClick={(e) => openStatusDrop(e, 'drawer')}>{STATUS_LABEL[drawerEnq.status || 'new']} ▾</span>
                </div>
                <div className="drw-field"><div className="drw-lbl">Source</div><div className="drw-val">{SOURCE_LABEL[drawerEnq.source] || drawerEnq.source || '—'}</div></div>
                <div className="drw-field"><div className="drw-lbl">Phone</div><div className="drw-val">{drawerEnq.phone || '—'}</div></div>
                <div className="drw-field"><div className="drw-lbl">Email</div><div className="drw-val">{drawerEnq.email || '—'}</div></div>
              </div>

              {drawerEnq.message && (
                <div className="drw-field" style={{ marginTop: '0.5rem' }}>
                  <div className="drw-lbl">Message</div>
                  <div className="drw-val" style={{ whiteSpace: 'pre-wrap' }}>{drawerEnq.message}</div>
                </div>
              )}

              <div className="drw-hr" />
              <div className="drw-lbl" style={{ marginBottom: '0.5rem' }}>Internal Notes</div>
              <textarea className="drw-notes" rows={3} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Add private notes about this enquiry…" />
              <button type="button" className="btn btn-ghost" style={{ marginTop: '0.5rem' }} onClick={saveNotes}>Save Notes</button>

              <div className="drw-hr" />
              <div className="drw-lbl" style={{ marginBottom: '0.5rem' }}>Add Interaction</div>
              <div className="ai-row">
                <select className="ai-select" value={intType} onChange={(e) => setIntType(e.target.value)}>
                  <option value="note">📝 Note</option>
                  <option value="call">📞 Call</option>
                  <option value="email">✉️ Email</option>
                  <option value="whatsapp">💬 WhatsApp</option>
                </select>
                <input className="ai-note-input" value={intNote} onChange={(e) => setIntNote(e.target.value)} placeholder="What happened?…" />
                <button type="button" className="btn btn-primary" onClick={logInteraction}>Log</button>
              </div>

              <div className="drw-hr" />
              <div className="drw-lbl" style={{ marginBottom: '0.5rem' }}>Activity Timeline</div>
              <div className="activity-feed">
                <div className="activity-item">
                  <div>Enquiry received</div>
                  <div className="time">{fmtDT(drawerEnq.created_at)}</div>
                </div>
                {activities.filter(a => a.type !== 'merged_snapshot').map(a => (
                  <div key={a.id} className="activity-item">
                    <div>{ACT_ICON[a.type] || '•'} {a.note || a.type}</div>
                    <div className="time">{fmtDT(a.created_at)}</div>
                  </div>
                ))}
              </div>

              <div className="drw-hr" />
              <div className="drw-lbl" style={{ marginBottom: '0.5rem' }}>Follow-up Tasks</div>
              <div className="fu-form">
                <input type="datetime-local" className="fu-input" value={fuDue} onChange={(e) => setFuDue(e.target.value)} />
                <input type="text" className="fu-input" value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="What to do?" />
                <button type="button" className="btn btn-primary" onClick={addFollowUp}>+ Add</button>
              </div>
              <div className="fu-list">
                {followups.length === 0 ? <p style={{ fontSize: '0.75rem', color: 'var(--ghost)', padding: '0.4rem 0' }}>No follow-ups scheduled.</p> : followups.map(f => (
                  <div key={f.id} className={`fu-item${f.done ? ' done-item' : ''}`}>
                    <input type="checkbox" className="fu-check" checked={f.done} onChange={(e) => toggleFollowUp(f.id, e.target.checked)} />
                    <span className="fu-note">{f.note || 'Follow up'}</span>
                    <span className="fu-time">{fmtDT(f.due_at)}</span>
                  </div>
                ))}
              </div>

              {activities.filter(a => a.type === 'merged_snapshot').length > 0 && (
                <>
                  <div className="drw-hr" />
                  <div className="drw-lbl" style={{ marginBottom: '0.5rem' }}>Merged Records (read-only)</div>
                  {activities.filter(a => a.type === 'merged_snapshot').map((a, i) => {
                    let snap = null
                    try { snap = JSON.parse(a.note) } catch { /* ignore */ }
                    if (!snap) return null
                    return (
                      <div key={a.id} className="card" style={{ marginBottom: '0.6rem', padding: '0.85rem 1rem' }}>
                        <p className="snap-notice">⚠ Merged on {fmtDT(a.created_at)}</p>
                        <div className="snap-info-grid">
                          <div className="snap-field"><div className="snap-lbl">Name</div><div className="snap-val">{snap.name || '—'}</div></div>
                          <div className="snap-field"><div className="snap-lbl">Phone</div><div className="snap-val">{snap.phone || '—'}</div></div>
                          <div className="snap-field"><div className="snap-lbl">Email</div><div className="snap-val">{snap.email || '—'}</div></div>
                          <div className="snap-field"><div className="snap-lbl">Source</div><div className="snap-val">{SOURCE_LABEL[snap.source] || snap.source || '—'}</div></div>
                        </div>
                        {snap.message && <div className="snap-msg" style={{ marginTop: '0.5rem' }}>{snap.message}</div>}
                      </div>
                    )
                  })}
                </>
              )}
            </div>

            <div className="drw-actions">
              {drawerEnq.phone && <button type="button" className="drw-btn drw-wa" onClick={() => waLink(drawerEnq.phone, drawerEnq.name)}>💬 WhatsApp</button>}
              {drawerEnq.email && <button type="button" className="drw-btn drw-book" style={{ color: 'var(--accent)', borderColor: 'rgba(255,215,0,0.25)' }} onClick={() => openEmailModal(drawerEnq)}>✉ Email</button>}
              <button type="button" className="drw-btn drw-book" onClick={() => changeStatus(drawerEnq.id, 'converted')}>✓ Mark Converted</button>
              <button type="button" className="drw-btn drw-arch" onClick={() => changeStatus(drawerEnq.id, 'dropped')}>Drop</button>
            </div>
          </div>
        </div>
      )}

      <div className="enq-toast-container">
        {toasts.map(t => <div key={t.id} className={`enq-toast ${t.type}`}>{t.message}</div>)}
      </div>

      {statusDrop && createPortal(
        <div className="status-drop" style={{ position: 'fixed', top: statusDrop.top, left: statusDrop.left }}>
          {STATUSES.map(s => (
            <div
              key={s}
              className="status-opt"
              onClick={() => {
                if (statusDrop.key === '__bulk__') bulkSetStatus(s)
                else if (statusDrop.key === 'drawer') { if (drawerEnq) changeStatus(drawerEnq.id, s) }
                else changeStatus(statusDrop.key, s)
                setStatusDrop(null)
              }}
            >
              {STATUS_LABEL[s]}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
