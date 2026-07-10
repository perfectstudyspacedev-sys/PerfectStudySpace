import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api, setToken, setStoredStaff, getStoredStaff, getStoredBranchId, setStoredBranchId } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(getStoredStaff)
  const [branchId, setBranchId] = useState(getStoredBranchId)
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  const loadBranches = useCallback(async () => {
    if (!getStoredStaff()) return
    try {
      const data = await api('list_branches')
      const list = data.branches ?? []
      setBranches(list)
      const stored = getStoredBranchId()
      const defaultId = staff?.branchId || list[0]?.id
      if (!stored && defaultId) {
        setBranchId(defaultId)
        setStoredBranchId(defaultId)
      }
    } catch { /* ignore */ }
  }, [staff?.branchId])

  useEffect(() => {
    setLoading(false)
  }, [])

  useEffect(() => {
    if (staff) loadBranches()
  }, [staff, loadBranches])

  const login = useCallback(async (username, password) => {
    const data = await api('login', { username, password })
    setToken(data.token)
    const s = data.staff
    setStoredStaff(s)
    setStaff(s)
    if (s.branchId) {
      setBranchId(s.branchId)
      setStoredBranchId(s.branchId)
    }
    return s
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setStoredStaff(null)
    setStoredBranchId(null)
    setStaff(null)
    setBranchId(null)
    setBranches([])
  }, [])

  // If any API call comes back Unauthorized mid-session (account deactivated, or the
  // day's session was ended — by the owner or by the staff member themselves), log out
  // immediately instead of leaving the page silently broken.
  useEffect(() => {
    const handler = () => logout()
    window.addEventListener('pss:unauthorized', handler)
    return () => window.removeEventListener('pss:unauthorized', handler)
  }, [logout])

  // Re-syncs this staff member's own profile (display name, branch reassignment, etc.)
  // periodically and whenever the tab regains focus — so an owner's edit shows up in an
  // already-open session promptly, without requiring the staff member to log out first.
  useEffect(() => {
    if (!staff) return
    const refresh = async () => {
      try {
        const data = await api('whoami')
        setStoredStaff(data.staff)
        setStaff(data.staff)
        // Staff (not owner, who picks a branch manually) follow their assigned branch —
        // if the owner reassigns them, their active working branch should follow too.
        if (data.staff.role !== 'owner' && data.staff.branchId && data.staff.branchId !== getStoredBranchId()) {
          setBranchId(data.staff.branchId)
          setStoredBranchId(data.staff.branchId)
        }
      } catch { /* handled globally via pss:unauthorized if the session is actually invalid */ }
    }
    const interval = setInterval(refresh, 45_000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [staff?.id])

  const selectBranch = useCallback((id) => {
    setBranchId(id)
    setStoredBranchId(id)
  }, [])

  const isOwner = staff?.role === 'owner'
  const activeBranch = branches.find(b => b.id === branchId) ?? null

  return (
    <AuthContext.Provider value={{
      staff, loading, login, logout, isOwner,
      branchId, selectBranch, branches, activeBranch,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
