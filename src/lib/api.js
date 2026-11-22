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

// Writes (payments, renewals, check-in/out, food bills, lockers, ...) carry an
// Idempotency-Key, so the api runs each one once even if it arrives twice. An identical
// write while the same one is still in flight (a double click) does not send a second
// request at all: it gets the first one's result. Reads, login and the public sign-up
// page are not affected.
const inFlightWrites = new Map()
function isWriteAction(action) {
  return !/^(get_|list_|lookup_|search_|public_|poll_|export_)/.test(action) && !['whoami', 'login', 'batch'].includes(action)
}

// Several READ actions in one request (api action "batch"), answers in the same order.
// Like Promise.all over separate api() calls: if any part failed, its message is thrown.
export async function apiBatch(calls) {
  const { results } = await api('batch', { calls: calls.map(([action, payload]) => ({ action, ...(payload ?? {}) })) })
  return results.map((r) => {
    if (r.status !== 200 || r.body?.error) throw new Error(r.body?.error ?? 'Something went wrong')
    return r.body
  })
}

export function api(action, payload = {}) {
  if (!isWriteAction(action)) return callApi(action, payload)
  const signature = `${action}\n${JSON.stringify(payload)}`
  const running = inFlightWrites.get(signature)
  if (running) return running
  const promise = callApi(action, payload, crypto.randomUUID())
    .finally(() => inFlightWrites.delete(signature))
  inFlightWrites.set(signature, promise)
  return promise
}

async function callApi(action, payload, idempotencyKey) {
  const token = getToken()

  const { data, error } = await supabase.functions.invoke('api', {
    body: { action, ...payload },
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
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
    // A 401 mid-session means the account was deactivated, or its day's session was ended
    // (by the owner, or by the staff member themselves via End Session) since this tab
    // logged in — force it back to the login screen immediately instead of leaving the
    // page silently broken. Not raised for the login action itself (wrong credentials).
    if (action !== 'login' && lower === 'unauthorized') {
      window.dispatchEvent(new Event('pss:unauthorized'))
      throw new Error('Your session has ended — please log in again')
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
