import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { isSignupHost } from './lib/signupLink'
import './styles/theme.css'

// HSL — on the sign-up address (join.<domain>) load only the sign-up form; the staff app (login,
// every staff screen) is a separate file that's never downloaded there.
const Root = isSignupHost()
  ? lazy(() => import('./JoinApp.jsx'))
  : lazy(() => import('./App.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
