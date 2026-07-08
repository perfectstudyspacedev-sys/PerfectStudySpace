import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

function getToken() {
  return sessionStorage.getItem('pss_token')
}

export async function api(action, payload = {}) {
  const token = getToken()

  const { data, error } = await supabase.functions.invoke('api', {
    body: { action, ...payload },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (error) {
    let message = error.message
    try {
      const ctx = error.context
      if (ctx && typeof ctx.clone === 'function') {
        const bodyText = await ctx.clone().text()
        if (bodyText) {
          const parsed = JSON.parse(bodyText)
          if (parsed?.error) message = parsed.error
        }
      }
    } catch { /* ignore */ }

    const lower = message.toLowerCase()
    if (lower.includes('invalid') && (lower.includes('login') || lower.includes('password') || lower.includes('credentials'))) {
      throw new Error('Invalid username or password')
    }
    if (lower.includes('no available desk') || lower.includes('no free desk')) {
      throw new Error('No available desk')
    }
    if (lower.includes('non-2xx')) {
      if (action === 'login') throw new Error('Invalid credentials')
      throw new Error('Something went wrong')
    }
    throw new Error(message)
  }

  if (data?.error) throw new Error(data.error)
  return data
}

export function setToken(token) {
  if (token) sessionStorage.setItem('pss_token', token)
  else sessionStorage.removeItem('pss_token')
}

export function getStoredStaff() {
  const raw = sessionStorage.getItem('pss_staff')
  if (!raw) return null
  try { return JSON.parse(raw) } catch {
    sessionStorage.removeItem('pss_staff')
    return null
  }
}

export function setStoredStaff(staff) {
  if (staff) sessionStorage.setItem('pss_staff', JSON.stringify(staff))
  else sessionStorage.removeItem('pss_staff')
}

export function getStoredBranchId() {
  return sessionStorage.getItem('pss_branch_id')
}

export function setStoredBranchId(branchId) {
  if (branchId) sessionStorage.setItem('pss_branch_id', branchId)
  else sessionStorage.removeItem('pss_branch_id')
}
