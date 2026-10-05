// HSL — the self sign-up link given to students. On the live site it always uses its own address
// (join.perfectstudyspace.in) so the staff site's address never appears in a student's link.
// VITE_SIGNUP_SITE_URL can override it; only local testing (localhost) keeps this site's /join/.
const DEFAULT_SIGNUP_SITE_URL = 'https://join.perfectstudyspace.in'
const ENV_SIGNUP_SITE_URL = (import.meta.env.VITE_SIGNUP_SITE_URL ?? '').trim().replace(/\/+$/, '')

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.local')
}

// The sign-up site's base address, or '' when the sign-up page is served by this site (local testing).
export function signupSiteUrl(hostname = window.location.hostname) {
  if (ENV_SIGNUP_SITE_URL) return ENV_SIGNUP_SITE_URL
  return isLocalHost(hostname) ? '' : DEFAULT_SIGNUP_SITE_URL
}

export function signupLinkFor(code) {
  const base = signupSiteUrl()
  return base ? `${base}/${code}` : `${window.location.origin}/join/${code}`
}

// True when this page was opened on the sign-up address (join.<domain>): the app then shows
// only the sign-up form — no login page, and the staff screens are never loaded.
export function isSignupHost(hostname = window.location.hostname) {
  return hostname.startsWith('join.')
}
