import { useCallback, useRef } from 'react'
import { newIdempotencyKey } from '../lib/api'

// PSS-AI P0.6 — one Idempotency-Key per submit of a money form (payment, checkout, renewal).
// The key is kept while the outcome is unknown — a network failure, a server error, or the
// server saying the first try is still running (409) — so pressing the button again cannot
// charge twice. Once the server has answered (success or a refusal), the next submit gets a
// new key.
//   const withRetryKey = useRetryKey()
//   await withRetryKey((idempotencyKey) => api('record_payment', payload, { idempotencyKey }))
export function useRetryKey() {
  const keyRef = useRef(null)
  return useCallback(async (send) => {
    keyRef.current ??= newIdempotencyKey()
    try {
      const res = await send(keyRef.current)
      keyRef.current = null
      return res
    } catch (err) {
      const answered = typeof err?.status === 'number' && err.status < 500 && err.status !== 409
      if (answered) keyRef.current = null
      throw err
    }
  }, [])
}
