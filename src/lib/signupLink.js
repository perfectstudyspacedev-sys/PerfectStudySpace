// Share the working /join route on this deployment by default. A separate sign-up site can
// still be selected with VITE_SIGNUP_SITE_URL (join.<domain> supports short /<code> links).
const ENV_SIGNUP_SITE_URL = (import.meta.env.VITE_SIGNUP_SITE_URL ?? '').trim().replace(/\/+$/, '')

export function signupSiteUrl(location = window.location) {
  const fallback = `${location.origin}${isSignupHost(location.hostname) ? '' : '/join'}`
  if (!ENV_SIGNUP_SITE_URL) return fallback
  try {
    const url = new URL(ENV_SIGNUP_SITE_URL)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return fallback
    const path = url.pathname.replace(/\/+$/, '') || (isSignupHost(url.hostname) ? '' : '/join')
    return `${url.origin}${path}`
  } catch {
    return fallback
  }
}

export function signupLinkFor(code, location = window.location) {
  return `${signupSiteUrl(location)}/${encodeURIComponent(code)}`
}

// True when this page was opened on the sign-up address (join.<domain>): the app then shows
// only the sign-up form — no login page, and the staff screens are never loaded.
export function isSignupHost(hostname = window.location.hostname) {
  return hostname.startsWith('join.')
}

// Direct /join links must select the public app before the staff app/authentication loads.
// Keep older short links working if an origin without /join was shared previously.
export function usesPublicApp(pathname = window.location.pathname, hostname = window.location.hostname) {
  return isSignupHost(hostname)
    || /^\/(?:join|me|ask|r|verify|p)(?:\/|$)/.test(pathname)
    || /^\/[0-9a-z]{12}\/?$/.test(pathname)
}
