import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { isSignupHost } from './lib/signupLink'
import './styles/theme.css'

// HSL — on the sign-up address (join.<domain>) load only the sign-up form; the staff app (login,
// every staff screen) is a separate file that's never downloaded there.
// PSS-AI P2.1: /me (the student portal) also loads the student app on any address, so it can be
// opened locally and from the staff site's address.
// Phase 3: /ask (the enquiry chat) and /r/<code> (referral links) too; Phase 6: /verify/<id>
// (certificate check) and /p/<token> (the family summary).
const path = window.location.pathname
const Root = isSignupHost() || path === '/me' || path.startsWith('/me/') || path === '/ask' || path.startsWith('/r/') || path.startsWith('/verify/') || path.startsWith('/p/')
  ? lazy(() => import('./JoinApp.jsx'))
  : lazy(() => import('./App.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
