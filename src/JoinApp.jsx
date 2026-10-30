import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import JoinPage from './pages/JoinPage'
import ReferralLink from './pages/ReferralLink'

const AskPage = lazy(() => import('./pages/AskPage.jsx'))
const VerifyCertificate = lazy(() => import('./pages/PublicStudyPages.jsx').then((m) => ({ default: m.VerifyCertificate })))
const ParentDigest = lazy(() => import('./pages/PublicStudyPages.jsx').then((m) => ({ default: m.ParentDigest })))

// The student portal (PSS-AI P2.1) is a separate file, downloaded only for /me pages.
const PortalRoutes = lazy(() => import('./portal/PortalRoutes.jsx'))

// Public student pages on any deployment, including same-origin /join/<code> links.
// Dedicated join.<domain> hosts and previously shared short /<code> links also work.
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
