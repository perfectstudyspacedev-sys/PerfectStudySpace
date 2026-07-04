import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, uploadPhoto } from '../lib/api'
import { formatCurrency, getMultiMonthDiscount, todayISO } from '../lib/utils'

const TEMP_PACKAGES = [
  { hours: 2, fee: 500 }, { hours: 3, fee: 650 }, { hours: 4, fee: 800 },
  { hours: 5, fee: 1000 }, { hours: 6, fee: 1250 }, { hours: 8, fee: 1500 },
]
const PERM_PACKAGES = [
  { hours: 12, fee: 2100 }, { hours: 13, fee: 2200 }, { hours: 14, fee: 2300 },
  { hours: 15, fee: 2400 }, { hours: 24, fee: 2500 },
]
const REFERRAL_OPTIONS = [
  { value: 'google_search', label: 'Google Search' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'word_of_mouth', label: 'Word of Mouth' },
  { value: 'flex', label: 'Flex (Banner/Hoarding)' },
]

// ── Active Members tab ─────────────────────────────────────────────────────
function ActiveMembersTab({ branchId }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [search, setSearch] = useState('')
  const [pillFilter, setPillFilter] = useState(null)
  const [renewModal, setRenewModal] = useState(null)
  const [renewMonths, setRenewMonths] = useState(1)
  const [renewPayMode, setRenewPayMode] = useState('cash')
  const [renewPayType, setRenewPayType] = useState('full')
  const [renewAdvance, setRenewAdvance] = useState('')
  const [closeModal, setCloseModal] = useState(null)
  const [closeSummary, setCloseSummary] = useState(null)
  const [closeLoading, setCloseLoading] = useState(false)

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const data = await api('list_active_memberships', { branchId })
      setMembers(data.members ?? [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [branchId])

  useEffect(() => { load() }, [load])

  const handleHold = async (membershipId) => {
    setActionLoading(membershipId + ':hold')
    try {
      await api('pause_membership', { membershipId })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleResume = async (membershipId) => {
    setActionLoading(membershipId + ':resume')
    try {
      await api('resume_membership', { membershipId })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const openCloseModal = async (membershipId, studentName) => {
    setCloseModal({ membershipId, studentName })
    setCloseSummary(null)
    try {
      const summary = await api('get_membership_closure_summary', { membershipId })
      setCloseSummary(summary)
    } catch { /* ignore */ }
  }

  const confirmClose = async () => {
    if (!closeModal) return
    setCloseLoading(true)
    try {
      await api('close_membership', { membershipId: closeModal.membershipId })
      setCloseModal(null)
      load()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setCloseLoading(false)
    }
  }

  const handleRenewSubmit = async () => {
    if (!renewModal) return
    setActionLoading(renewModal.membershipId + ':renew')
    try {
      await api('renew_membership', {
        membershipId: renewModal.membershipId,
        monthsPaid: renewMonths,
        paymentMode: renewPayMode,
        advanceAmount: renewPayType === 'partial' ? Number(renewAdvance) || null : null,
      })
      setRenewModal(null)
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const today = todayISO()

  const filtered = (search.trim()
    ? members.filter(m =>
        m.student_name?.toLowerCase().includes(search.toLowerCase()) ||
        m.student_phone?.includes(search))
    : members
  ).filter(m => {
    if (!pillFilter) return true
    if (pillFilter === 'expired') return m.end_date < today
    if (pillFilter === 'active') return m.end_date >= today
    return m.end_date >= today && m.category === pillFilter
  }).sort((a, b) => {
    // expired first, then by end_date
    const aExp = a.end_date < today
    const bExp = b.end_date < today
    if (aExp && !bExp) return -1
    if (!aExp && bExp) return 1
    return a.end_date.localeCompare(b.end_date)
  })

  const expiringSoon = members.filter(m => {
    if (m.end_date < today) return false
    const daysLeft = Math.ceil((new Date(m.end_date) - new Date()) / 86_400_000)
    return daysLeft <= 3
  })

  // Compute renewal fee for the renewal modal
  const renewPkg = renewModal
    ? (renewModal.category === 'permanent' ? PERM_PACKAGES : TEMP_PACKAGES)
        .find(p => p.hours === renewModal.hoursPerDay) ?? TEMP_PACKAGES[0]
    : null
  const renewDiscount = renewMonths >= 6 ? 10 : renewMonths >= 3 ? 5 : renewMonths >= 2 ? 2 : 0
  const renewGross = renewPkg ? renewPkg.fee * renewMonths : 0
  const renewTotal = renewGross * (1 - renewDiscount / 100)
  const renewAdvanceNum = Number(renewAdvance) || 0
  const renewRemaining = renewPayType === 'partial' ? Math.max(renewTotal - renewAdvanceNum, 0) : 0

  return (
    <div className="card">
      {/* Expiry reminder banner */}
      {expiringSoon.length > 0 && (
        <div style={{ marginBottom: '1rem', background: 'rgba(255,150,0,0.07)', border: '1px solid rgba(255,150,0,0.3)', borderRadius: 6, padding: '0.65rem 1rem' }}>
          <span style={{ color: '#ffaa44', fontWeight: 700, fontSize: '0.85rem' }}>
            ⚠ {expiringSoon.length} membership{expiringSoon.length > 1 ? 's' : ''} expiring within 3 days:
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginLeft: 8 }}>
            {expiringSoon.map(m => m.student_name).join(', ')}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { key: 'active', label: 'Active', count: members.filter(m => m.end_date >= today).length, color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.25)' },
            { key: 'temporary', label: 'Temporary', count: members.filter(m => m.end_date >= today && m.category === 'temporary').length, color: 'var(--accent)', bg: 'rgba(255,215,0,0.08)', border: 'rgba(255,215,0,0.25)' },
            { key: 'permanent', label: 'Permanent', count: members.filter(m => m.end_date >= today && m.category === 'permanent').length, color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.25)' },
            { key: 'expired', label: 'Pending (Expired)', count: members.filter(m => m.end_date < today).length, color: '#ff8888', bg: 'rgba(255,60,60,0.08)', border: 'rgba(255,60,60,0.25)' },
          ].map(({ key, label, count, color, bg, border }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPillFilter(f => f === key ? null : key)}
              style={{
                padding: '2px 10px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, background: bg, color, cursor: 'pointer',
                border: `1px solid ${pillFilter === key ? color : border}`,
                boxShadow: pillFilter === key ? `0 0 0 1px ${color}` : 'none',
              }}
            >
              {count} {label}
            </button>
          ))}
          {pillFilter && (
            <button type="button" onClick={() => setPillFilter(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}>
              ✕ Clear filter
            </button>
          )}
        </div>
        <input
          placeholder="Search name / phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '0.4rem 0.6rem', background: '#141414', border: '1px solid #333', borderRadius: 4, color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.85rem', width: 200 }}
        />
      </div>

      {loading ? <p>Loading…</p> : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No memberships found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Plan</th>
              <th>Expires</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const isExpired = m.end_date < today
              const daysLeft = Math.ceil((new Date(m.end_date) - new Date()) / 86_400_000)
              const expiringSoonRow = !isExpired && daysLeft <= 3
              return (
                <tr key={m.membership_id} style={{ background: isExpired ? 'rgba(255,60,60,0.07)' : undefined }}>
                  <td>
                    <Link to={`/students/${m.student_id}`} style={{ color: isExpired ? '#ff8888' : 'var(--accent)' }}>{m.student_name}</Link>
                    <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.student_phone}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.85rem' }}>{m.category} · {m.hours_per_day}h/day</span>
                    {m.cabin_no && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cabin {m.cabin_no}</div>}
                  </td>
                  <td className="mono" style={{ fontSize: '0.85rem', color: isExpired ? '#ff8888' : undefined }}>
                    {m.end_date}
                    {isExpired && (
                      <div style={{ color: '#ff6b6b', fontSize: '0.7rem', fontWeight: 700 }}>EXPIRED</div>
                    )}
                    {expiringSoonRow && (
                      <div style={{ color: '#ffaa44', fontSize: '0.7rem', fontWeight: 700 }}>{daysLeft}d left</div>
                    )}
                  </td>
                  <td>
                    {m.fee_due > 0 ? (
                      <span style={{ color: '#ff8c42', fontWeight: 700, fontSize: '0.85rem' }}>
                        {formatCurrency(m.fee_due)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                  <td>
                    {isExpired ? (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700, background: 'rgba(255,60,60,0.15)', color: '#ff8888' }}>
                        EXPIRED
                      </span>
                    ) : m.is_paused ? (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700, background: 'rgba(255,150,0,0.15)', color: '#ffaa44' }}>
                        ON HOLD
                      </span>
                    ) : (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700, background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {isExpired ? (
                        <>
                          <button
                            type="button"
                            style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.4)', color: 'var(--accent)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                            disabled={actionLoading === m.membership_id + ':renew'}
                            onClick={() => { setRenewModal({ membershipId: m.membership_id, studentName: m.student_name, category: m.category, hoursPerDay: m.hours_per_day }); setRenewMonths(1); setRenewPayMode('cash'); setRenewPayType('full'); setRenewAdvance('') }}
                          >↺ Renew</button>
                          <button
                            type="button"
                            style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.4)', color: '#ff8888', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                            disabled={actionLoading === m.membership_id + ':close'}
                            onClick={() => openCloseModal(m.membership_id, m.student_name)}
                          >✕ Close</button>
                        </>
                      ) : m.is_paused ? (
                        <button
                          type="button" className="btn btn-primary"
                          style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                          disabled={actionLoading === m.membership_id + ':resume'}
                          onClick={() => handleResume(m.membership_id)}
                        >▶ Resume</button>
                      ) : (
                        <button
                          type="button"
                          style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', background: 'rgba(255,150,0,0.08)', border: '1px solid rgba(255,150,0,0.4)', color: '#ffaa44', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                          disabled={actionLoading === m.membership_id + ':hold'}
                          onClick={() => handleHold(m.membership_id)}
                        >⏸ Hold</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Renew modal */}
      {renewModal && (
        <div className="modal-overlay" onClick={() => setRenewModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Renew Membership</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{renewModal.studentName}</p>

            <div className="form-group">
              <label>Months</label>
              <select value={renewMonths} onChange={(e) => setRenewMonths(Number(e.target.value))}>
                {[1, 2, 3, 6].map(m => (
                  <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}{(m >= 2 ? [2, 5, 10][m <= 2 ? 0 : m <= 3 ? 1 : 2] : 0) > 0 ? ` (${[0, 0, 2, 5, 0, 0, 10][m]}% off)` : ''}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Payment Mode</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[{ value: 'cash', label: '💵 Cash' }, { value: 'upi', label: '📱 UPI' }].map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setRenewPayMode(value)}
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${renewPayMode === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: renewPayMode === value ? 'rgba(255,215,0,0.08)' : '#141414', color: renewPayMode === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Payment Type</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[{ value: 'full', label: 'Full' }, { value: 'partial', label: 'Partial' }].map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setRenewPayType(value)}
                    style={{ flex: 1, padding: '0.5rem', border: `1px solid ${renewPayType === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: renewPayType === value ? 'rgba(255,215,0,0.08)' : '#141414', color: renewPayType === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {renewPayType === 'partial' && (
              <div className="form-group">
                <label>Advance Amount (₹)</label>
                <input type="number" value={renewAdvance} onChange={(e) => setRenewAdvance(e.target.value)} placeholder="Amount paid now" min={0} max={renewTotal} />
              </div>
            )}

            <div className="card" style={{ marginBottom: '1rem', background: 'rgba(255,215,0,0.05)' }}>
              <p className="mono">Total: {formatCurrency(renewTotal)}</p>
              {renewPayType === 'partial' && renewAdvanceNum > 0 && (
                <>
                  <p className="mono" style={{ color: '#4ade80' }}>Paid now: {formatCurrency(renewAdvanceNum)}</p>
                  <p className="mono" style={{ color: '#ff8c42', fontWeight: 700 }}>Remaining: {formatCurrency(renewRemaining)}</p>
                </>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenewModal(null)}>Cancel</button>
              <button type="button" className="btn btn-primary"
                disabled={actionLoading === renewModal.membershipId + ':renew'}
                onClick={handleRenewSubmit}
              >Confirm Renewal</button>
            </div>
          </div>
        </div>
      )}

      {/* Close membership — blocks closing until membership + locker dues are cleared */}
      {closeModal && (
        <div className="modal-overlay" onClick={() => setCloseModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Close Membership</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{closeModal.studentName}</p>

            {!closeSummary ? (
              <p>Checking pending dues…</p>
            ) : (
              <div className="card" style={{ marginBottom: '1rem', background: closeSummary.canClose ? 'rgba(74,222,128,0.05)' : 'rgba(255,60,60,0.05)' }}>
                <p className="mono">Membership pending: {formatCurrency(closeSummary.membershipDue)}</p>
                {closeSummary.locker && <p className="mono">Locker pending: {formatCurrency(closeSummary.lockerDue)}</p>}
                <p className="mono" style={{ fontWeight: 700, marginTop: '0.4rem', color: closeSummary.canClose ? '#4ade80' : '#ff8888' }}>
                  Total pending: {formatCurrency(closeSummary.totalDue)}
                </p>
                {!closeSummary.canClose && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Everything must be cleared before this membership can be closed. Record the pending payment(s) from the student's profile page first.
                  </p>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCloseModal(null)}>Cancel</button>
              <button
                type="button" className="btn btn-primary"
                disabled={!closeSummary?.canClose || closeLoading}
                onClick={confirmClose}
              >
                {closeLoading ? 'Closing…' : 'Confirm Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── New Membership form ────────────────────────────────────────────────────
function NewMembershipForm({ branchId, onCreated }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [emergencyContact, setEmergencyContact] = useState('')
  const [referralSource, setReferralSource] = useState('')
  const [course, setCourse] = useState('')
  const [category, setCategory] = useState('temporary')
  const [hoursPerDay, setHoursPerDay] = useState(4)
  const [monthsPaid, setMonthsPaid] = useState(1)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [paymentType, setPaymentType] = useState('full')
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [withLocker, setWithLocker] = useState(false)
  const [lockerNo, setLockerNo] = useState('')
  const [lockerStatus, setLockerStatus] = useState(null)
  const [aadhaarFile, setAadhaarFile] = useState(null)
  const [photoFile, setPhotoFile] = useState(null)
  const [aadhaarPreview, setAadhaarPreview] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [receipt, setReceipt] = useState(null)

  useEffect(() => {
    if (!branchId) return
    api('get_locker_status', { branchId })
      .then(setLockerStatus)
      .catch(() => setLockerStatus(null))
  }, [branchId])

  const packages = category === 'permanent' ? PERM_PACKAGES : TEMP_PACKAGES

  useEffect(() => {
    const pkg = packages[0]
    if (pkg) setHoursPerDay(pkg.hours)
  }, [category])

  const [selectedStudent, setSelectedStudent] = useState(null)
  const [nameMatches, setNameMatches] = useState([])

  const lookupPhone = useCallback(async (p) => {
    if (p.length !== 10) return
    try {
      const { student } = await api('lookup_student', { phone: p })
      if (student?.name) {
        setName(student.name)
        setSelectedStudent(student)
      }
      if (student?.course) setCourse(student.course)
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

  useEffect(() => {
    if (withLocker && lockerStatus?.availableNumbers?.length && !lockerNo) {
      setLockerNo(lockerStatus.availableNumbers[0])
    }
  }, [withLocker, lockerStatus, lockerNo])

  const monthlyFee = packages.find(p => p.hours === hoursPerDay)?.fee ?? 0
  const discount = getMultiMonthDiscount(monthsPaid)
  const gross = monthlyFee * monthsPaid
  const total = gross * (1 - discount / 100)
  const lockerExtra = withLocker ? 200 : 0
  const grandTotal = total + lockerExtra
  const advanceNum = Number(advanceAmount) || 0
  const amountPaid = paymentType === 'full' ? grandTotal : paymentType === 'partial' ? advanceNum : 0
  const amountRemaining = Math.max(grandTotal - amountPaid, 0)

  const handleFile = (file, setPreview, setFile) => {
    if (!file) return
    setFile(file)
    setPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!/^\d{10}$/.test(phone)) return setError('Phone must be 10 digits')
    if (name.trim().split(/\s+/).length < 2) return setError('Please enter the full name (first and last name)')
    if (!/^\d{10}$/.test(emergencyContact)) return setError('Emergency contact must be a 10 digit phone number')
    if (!referralSource) return setError('Please select how the student heard about us')
    if (!aadhaarFile) return setError('Aadhaar photo is required')
    if (paymentType === 'partial' && (advanceNum <= 0 || advanceNum >= grandTotal)) {
      return setError('Partial payment must be more than ₹0 and less than the total — use Full Paid or Full Pending otherwise')
    }
    setLoading(true)
    setError('')
    try {
      let aadhaarPhotoUrl = null
      let photoUrl = null
      try {
        aadhaarPhotoUrl = await uploadPhoto(aadhaarFile, 'aadhaar')
      } catch {
        setError('Failed to upload Aadhaar photo — please try again')
        setLoading(false)
        return
      }
      if (photoFile) {
        try { photoUrl = await uploadPhoto(photoFile, 'photos') } catch { /* skip */ }
      }
      const result = await api('create_membership', {
        branchId, name, phone, category, hoursPerDay, monthsPaid,
        paymentMode, aadhaarPhotoUrl, photoUrl, course,
        emergencyContact, referralSource,
        withLocker, lockerNo: withLocker ? lockerNo : null,
        advanceAmount: paymentType === 'full' ? null : paymentType === 'partial' ? advanceNum : 0,
      })
      setReceipt({ ...result, name, total: grandTotal, amountPaid, amountRemaining })
      onCreated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (receipt) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <h1 style={{ color: 'var(--accent)' }}>Membership Created</h1>
        <p><strong>{receipt.name}</strong></p>
        {receipt.cabinNo && <p>Cabin: {receipt.cabinNo}</p>}
        <p className="mono">Total: {formatCurrency(receipt.total)}</p>
        {receipt.amountRemaining > 0 && (
          <>
            <p className="mono" style={{ color: '#4ade80' }}>Paid: {formatCurrency(receipt.amountPaid)}</p>
            <p className="mono" style={{ color: '#ff8c42', fontWeight: 700, fontSize: '1.05rem' }}>
              Balance Due: {formatCurrency(receipt.amountRemaining)}
            </p>
          </>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={() => setReceipt(null)}>New Membership</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/students')}>View Students</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <form onSubmit={handleSubmit}>
        <div className="form-group" style={{ position: 'relative' }}>
          <label>Full Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter the full name" autoComplete="off" required />
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
          <label>Phone Number *</label>
          <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setSelectedStudent(null) }} required />
        </div>
        <div className="form-group">
          <label>Emergency Contact (10-digit phone) *</label>
          <input
            value={emergencyContact}
            onChange={(e) => setEmergencyContact(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="Contact in case of emergency"
            required
          />
        </div>
        <div className="form-group">
          <label>How did you hear about us? *</label>
          <select value={referralSource} onChange={(e) => setReferralSource(e.target.value)} required>
            <option value="">Select an option</option>
            {REFERRAL_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Course (NEET PG, UPSC, CA, etc.)</label>
          <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="What are they preparing for?" />
        </div>
        <div className="form-group">
          <label>Aadhaar Photo *</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <label className="btn btn-ghost" style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>
              📷 Take Photo
              <input
                type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files[0], setAadhaarPreview, setAadhaarFile)}
              />
            </label>
            <label className="btn btn-ghost" style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>
              🖼 Choose from Gallery
              <input
                type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files[0], setAadhaarPreview, setAadhaarFile)}
              />
            </label>
          </div>
          {!aadhaarFile && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Required</p>}
          {aadhaarPreview && <img src={aadhaarPreview} alt="Aadhaar" className="photo-preview" style={{ marginTop: '0.5rem' }} />}
        </div>
        <div className="form-group">
          <label>Member Photo</label>
          <input type="file" accept="image/*" capture="user" onChange={(e) => handleFile(e.target.files[0], setPhotoPreview, setPhotoFile)} />
          {photoPreview && <img src={photoPreview} alt="Member" className="photo-preview" style={{ marginTop: '0.5rem' }} />}
        </div>
        <div className="form-group">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="temporary">Temporary (floating seat)</option>
            <option value="permanent">Permanent (fixed cabin)</option>
          </select>
        </div>
        <div className="form-group">
          <label>Hours per Day</label>
          <select value={hoursPerDay} onChange={(e) => setHoursPerDay(Number(e.target.value))}>
            {packages.map(p => (
              <option key={p.hours} value={p.hours}>{p.hours} hrs/day — {formatCurrency(p.fee)}/mo</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Months Paid Upfront</label>
          <select value={monthsPaid} onChange={(e) => setMonthsPaid(Number(e.target.value))}>
            {[1, 2, 3, 6].map(m => (
              <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}{getMultiMonthDiscount(m) ? ` (${getMultiMonthDiscount(m)}% off)` : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Locker</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button" onClick={() => setWithLocker(false)}
              style={{
                flex: 1, padding: '0.6rem', border: `1px solid ${!withLocker ? 'var(--accent)' : '#333'}`,
                borderRadius: 4, background: !withLocker ? 'rgba(255,215,0,0.08)' : '#141414',
                color: !withLocker ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem',
              }}
            >🕓 Avail Later</button>
            <button
              type="button" onClick={() => setWithLocker(true)}
              disabled={lockerStatus != null && lockerStatus.available <= 0}
              style={{
                flex: 1, padding: '0.6rem', border: `1px solid ${withLocker ? 'var(--accent)' : '#333'}`,
                borderRadius: 4, background: withLocker ? 'rgba(255,215,0,0.08)' : '#141414',
                color: withLocker ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem',
                opacity: (lockerStatus != null && lockerStatus.available <= 0) ? 0.4 : 1,
              }}
            >🔐 Avail Now</button>
          </div>

          {lockerStatus && (
            <p style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: lockerStatus.available > 0 ? 'var(--text-muted)' : '#ff8888' }}>
              {lockerStatus.available > 0 ? `${lockerStatus.available} of ${lockerStatus.capacity} lockers available at this branch` : 'No lockers available at this branch right now'}
            </p>
          )}

          {withLocker ? (
            <div style={{ marginTop: '0.6rem', padding: '0.75rem', background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: 6 }}>
              <label style={{ fontSize: '0.8rem' }}>Locker Number</label>
              <select value={lockerNo} onChange={(e) => setLockerNo(e.target.value)}>
                {(lockerStatus?.availableNumbers ?? []).map(n => <option key={n} value={n}>Locker {n}</option>)}
              </select>
              <p style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>₹100/mo + ₹100 refundable deposit</p>
            </div>
          ) : (
            <p style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              No locker charged now — one can be added anytime later from the student's profile page.
            </p>
          )}
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
        <div className="form-group">
          <label>Payment Status</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { value: 'full', label: '✓ Full Paid' },
              { value: 'partial', label: '½ Partial Pending' },
              { value: 'pending', label: '✕ Full Pending' },
            ].map(({ value, label }) => (
              <button key={value} type="button" onClick={() => setPaymentType(value)}
                style={{ flex: 1, padding: '0.6rem', border: `1px solid ${paymentType === value ? 'var(--accent)' : '#333'}`, borderRadius: 4, background: paymentType === value ? 'rgba(255,215,0,0.08)' : '#141414', color: paymentType === value ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
              >{label}</button>
            ))}
          </div>
        </div>
        {paymentType === 'partial' && (
          <div className="form-group">
            <label>Advance Amount (₹)</label>
            <input
              type="number"
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(e.target.value)}
              placeholder="Amount paid now"
              min={0}
              max={grandTotal}
            />
          </div>
        )}
        <div className="card" style={{ marginBottom: '1rem', background: 'rgba(255,215,0,0.05)' }}>
          <p className="mono">Monthly: {formatCurrency(monthlyFee)} × {monthsPaid} = {formatCurrency(gross)}</p>
          {discount > 0 && <p className="mono" style={{ color: '#4ade80' }}>Discount: {discount}% (−{formatCurrency(gross - total)})</p>}
          {withLocker && <p className="mono">Locker: +{formatCurrency(lockerExtra)}</p>}
          <p className="mono" style={{ color: 'var(--accent)', fontSize: '1.1rem', marginTop: '0.5rem' }}>
            Total: {formatCurrency(grandTotal)}
          </p>
          {paymentType === 'pending' && (
            <p className="mono" style={{ color: '#ff8c42', fontWeight: 700 }}>
              Fully pending: {formatCurrency(amountRemaining)} due
            </p>
          )}
          {paymentType === 'partial' && (
            <>
              <p className="mono" style={{ color: '#4ade80' }}>Paid now: {formatCurrency(amountPaid)}</p>
              <p className="mono" style={{ color: '#ff8c42', fontWeight: 700 }}>
                Remaining: {formatCurrency(amountRemaining)}
              </p>
            </>
          )}
        </div>
        {error && <p className="error-msg">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading || !branchId}>
          {loading ? 'Creating…' : 'Create Membership'}
        </button>
      </form>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function MembershipPage() {
  const { branchId } = useAuth()
  const [tab, setTab] = useState('active')

  return (
    <>
      <div className="page-header"><h1>Membership</h1></div>
      <div className="tabs">
        <button type="button" className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Active Members</button>
        <button type="button" className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>New Registration</button>
      </div>

      {tab === 'active' && <ActiveMembersTab branchId={branchId} />}
      {tab === 'new' && <NewMembershipForm branchId={branchId} onCreated={() => setTab('active')} />}
    </>
  )
}
