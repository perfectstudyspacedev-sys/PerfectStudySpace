import { afterEach, describe, expect, test, vi } from 'vitest'

const location = (url: string) => new URL(url)
const code = 'qjytnzthn7zk'
async function links(base = '') {
  vi.stubEnv('VITE_SIGNUP_SITE_URL', base)
  vi.resetModules()
  return import('../../src/lib/signupLink.js')
}
afterEach(() => vi.unstubAllEnvs())

describe('public self-sign-up links', () => {
  test('the Pages deployment and local development default to their own /join route', async () => {
    const { signupLinkFor } = await links()
    expect(signupLinkFor(code, location('https://perfectstudyspace.pages.dev')))
      .toBe(`https://perfectstudyspace.pages.dev/join/${code}`)
    expect(signupLinkFor(code, location('http://localhost:5173')))
      .toBe(`http://localhost:5173/join/${code}`)
  })
  test.each(['https://perfectstudyspace.pages.dev', 'https://perfectstudyspace.pages.dev/join/'])(
    'same-site configuration %s produces a working /join link', async (base) => {
      const { signupLinkFor } = await links(base)
      expect(signupLinkFor(code, location('https://perfectstudyspace.pages.dev')))
        .toBe(`https://perfectstudyspace.pages.dev/join/${code}`)
    },
  )
  test('dedicated join hosts retain short links and explicit /join URLs', async () => {
    let helpers = await links()
    expect(helpers.signupLinkFor(code, location('https://join.perfectstudyspace.in')))
      .toBe(`https://join.perfectstudyspace.in/${code}`)
    helpers = await links('https://join.perfectstudyspace.in/')
    expect(helpers.signupLinkFor(code, location('https://perfectstudyspace.pages.dev')))
      .toBe(`https://join.perfectstudyspace.in/${code}`)
    helpers = await links('https://join.perfectstudyspace.in/join/')
    expect(helpers.signupLinkFor(code, location('https://perfectstudyspace.pages.dev')))
      .toBe(`https://join.perfectstudyspace.in/join/${code}`)
  })
  test.each(['not-a-url', 'javascript:alert(1)', 'https://user:password@example.test'])(
    'invalid configuration %s falls back to the current deployment', async (base) => {
      const { signupLinkFor } = await links(base)
      expect(signupLinkFor(code, location('https://perfectstudyspace.pages.dev')))
        .toBe(`https://perfectstudyspace.pages.dev/join/${code}`)
    },
  )
  test('a code cannot introduce a new route or query string', async () => {
    const { signupLinkFor } = await links()
    expect(signupLinkFor('bad/code?r=other', location('https://perfectstudyspace.pages.dev')))
      .toBe('https://perfectstudyspace.pages.dev/join/bad%2Fcode%3Fr%3Dother')
  })
  test('signup, legacy short links, portal and referral paths select the public app', async () => {
    const { usesPublicApp } = await links('https://perfectstudyspace.pages.dev/join')
    for (const path of [`/join/${code}`, `/join/${code}/`, `/${code}`, '/me', '/me/login', '/ask', '/r/friend12', '/verify/cert', '/p/token']) {
      expect(usesPublicApp(path, 'perfectstudyspace.pages.dev'), path).toBe(true)
    }
    for (const path of ['/', '/login', '/membership', '/students', '/settings/branches', '/joinery', '/messages']) {
      expect(usesPublicApp(path, 'perfectstudyspace.pages.dev'), path).toBe(false)
    }
    expect(usesPublicApp('/', 'join.perfectstudyspace.in')).toBe(true)
  })
})
