import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import JoinPage from './pages/JoinPage'

// The student portal (PSS-AI P2.1) is a separate file, downloaded only for /me pages.
const PortalRoutes = lazy(() => import('./portal/PortalRoutes.jsx'))

// HSL — everything served on join.<domain>: the student sign-up form, and since PSS-AI P2.1 the
// student portal under /me. Sign-up links look like https://join.perfectstudyspace.in/<code>;
// /me comes first (codes are 12 characters, so "me" never collides). Any other path shows "link
// no longer valid".
export default function JoinApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/me/*" element={<Suspense fallback={null}><PortalRoutes /></Suspense>} />
        <Route path="/:code" element={<JoinPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<JoinPage />} />
      </Routes>
    </BrowserRouter>
  )
}
