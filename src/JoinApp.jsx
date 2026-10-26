import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import JoinPage from './pages/JoinPage'
import ReferralLink from './pages/ReferralLink'

const AskPage = lazy(() => import('./pages/AskPage.jsx'))
const VerifyCertificate = lazy(() => import('./pages/PublicStudyPages.jsx').then((m) => ({ default: m.VerifyCertificate })))
const ParentDigest = lazy(() => import('./pages/PublicStudyPages.jsx').then((m) => ({ default: m.ParentDigest })))

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
        {/* PSS-AI Phase 3: the enquiry chat (C9) and referral links (C10). */}
        <Route path="/ask" element={<Suspense fallback={null}><AskPage /></Suspense>} />
        <Route path="/r/:ref" element={<ReferralLink />} />
        {/* PSS-AI Phase 6: the certificate check (I33) and the family summary link (I34). */}
        <Route path="/verify/:id" element={<Suspense fallback={null}><VerifyCertificate /></Suspense>} />
        <Route path="/p/:token" element={<Suspense fallback={null}><ParentDigest /></Suspense>} />
        <Route path="/:code" element={<JoinPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<JoinPage />} />
      </Routes>
    </BrowserRouter>
  )
}
