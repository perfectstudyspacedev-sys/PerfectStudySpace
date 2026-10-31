const locks = new WeakMap()

// A navigation drawer and a dialog can overlap; only the last close unlocks scrolling.
export function lockBodyScroll(body = document.body) {
  let state = locks.get(body)
  if (!state) {
    state = { count: 0, previous: body.style.overflow }
    locks.set(body, state)
  }
  state.count++
  body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    if (--state.count === 0) {
      body.style.overflow = state.previous
      locks.delete(body)
    }
  }
}
