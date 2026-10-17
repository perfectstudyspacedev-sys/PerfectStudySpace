import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Sentinel stored in the same slot as a real branch id (pss_branch_id) to mean "Combined
// Hall is selected" — reusing that one slot means persistence-across-reload, the branch
// switcher, and every page's branchId check all work with zero extra state to keep in sync.
export const COMBINED_HALL_ID = '__combined_hall__'

function getToken() {
  return sessionStorage.getItem('pss_token')
}

// A fresh Idempotency-Key. Forms whose submit can be retried (payments, checkout, renewals) keep
// one per submit with useRetryKey(), so a retry after a lost reply is answered from the server's
// record instead of running twice. Other calls send no key.
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

// Thrown errors carry the HTTP status when the server answered (err.status); a network failure
// has none.
export async function api(action, payload = {}, { idempotencyKey } = {}) {
  const token = getToken()

  const { data, error } = await supabase.functions.invoke('api', {
    body: { action, ...payload },
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  })

  if (error) {
    const status = typeof error.context?.status === 'number' ? error.context.status : undefined
    const fail = (msg) => Object.assign(new Error(msg), { status })
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
      throw fail('Invalid username or password')
    }
    if (lower.includes('no available desk') || lower.includes('no free desk')) {
      throw fail('No available desk')
    }
    // A 401 mid-session means the account was deactivated, or its day's session was ended
    // (by the owner, or by the staff member themselves via End Session) since this tab
    // logged in — force it back to the login screen immediately instead of leaving the
    // page silently broken. Not raised for the login action itself (wrong credentials).
    if (action !== 'login' && lower === 'unauthorized') {
      window.dispatchEvent(new Event('pss:unauthorized'))
      throw fail('Your session has ended — please log in again')
    }
    if (lower.includes('non-2xx')) {
      if (action === 'login') throw fail('Invalid credentials')
      throw fail('Something went wrong')
    }
    throw fail(message)
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
