// HSL — the self sign-up link given to students. In production it lives on its own address
// (VITE_SIGNUP_SITE_URL, e.g. https://join.perfectstudyspace.in) so the staff site's address
// never appears in a student's link. Without that setting (local testing) it stays on this site.
const SIGNUP_SITE_URL = (import.meta.env.VITE_SIGNUP_SITE_URL ?? '').trim().replace(/\/+$/, '')

export function signupLinkFor(code) {
  return SIGNUP_SITE_URL ? `${SIGNUP_SITE_URL}/${code}` : `${window.location.origin}/join/${code}`
}

// Same address as an absolute base, or '' when the sign-up page is served by this site.
export function signupSiteUrl() {
  return SIGNUP_SITE_URL
}

// True when this page was opened on the sign-up address (join.<domain>): the app then shows
// only the sign-up form — no login page, and the staff screens are never loaded.
export function isSignupHost(hostname = window.location.hostname) {
  return hostname.startsWith('join.')
}
