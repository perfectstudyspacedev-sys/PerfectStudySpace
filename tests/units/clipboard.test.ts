import { afterEach, expect, test, vi } from 'vitest'
import { copyText } from '../../src/lib/clipboard.js'

afterEach(() => vi.unstubAllGlobals())
test('reports success only after the clipboard write completes', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  expect(await copyText('https://example.test/link')).toBe(true)
  expect(writeText).toHaveBeenCalledWith('https://example.test/link')
})
test('permission rejection becomes a handled failure for fallback UI', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('permission denied')) } })
  expect(await copyText('private link')).toBe(false)
})
test('unsupported browsers return failure rather than pretend to copy', async () => {
  vi.stubGlobal('navigator', {})
  expect(await copyText('private link')).toBe(false)
})
