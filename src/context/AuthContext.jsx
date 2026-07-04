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
