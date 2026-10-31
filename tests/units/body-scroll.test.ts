import { describe, expect, test } from 'vitest'
import { lockBodyScroll } from '../../src/lib/bodyScroll.js'

describe('overlapping navigation and dialog scroll locks', () => {
  test('closing either overlay first keeps the remaining overlay locked', () => {
    for (const reverse of [false, true]) {
      const body = { style: { overflow: 'auto' } }
      const navigation = lockBodyScroll(body), dialog = lockBodyScroll(body)
      expect(body.style.overflow).toBe('hidden')
      const [first, last] = reverse ? [dialog, navigation] : [navigation, dialog]
      first()
      expect(body.style.overflow).toBe('hidden')
      first()
      expect(body.style.overflow).toBe('hidden')
      last()
      expect(body.style.overflow).toBe('auto')
    }
  })
  test('restores an existing hidden state and handles a later independent overlay', () => {
    const body = { style: { overflow: 'hidden' } }
    lockBodyScroll(body)()
    expect(body.style.overflow).toBe('hidden')
    body.style.overflow = ''
    lockBodyScroll(body)()
    expect(body.style.overflow).toBe('')
  })
})
