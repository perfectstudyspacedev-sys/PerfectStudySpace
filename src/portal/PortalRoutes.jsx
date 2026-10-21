import { Route, Routes } from 'react-router-dom'
import PortalLayout from './PortalLayout'
import PortalLogin from './PortalLogin'
import PortalSetup from './PortalSetup'
import PortalHome from './PortalHome'
import PortalPay from './PortalPay'
import PortalReport from './PortalReport'
import PortalHold from './PortalHold'
import PortalReceipts from './PortalReceipts'
import PortalInbox from './PortalInbox'
import PortalPrivacy from './PortalPrivacy'
import PortalMore from './PortalMore'
import PortalChat from './PortalChat'

// PSS-AI P2.1 — the student portal under /me on the student site (loaded only for /me pages).
export default function PortalRoutes() {
  return (
    <Routes>
      <Route path="login" element={<PortalLogin />} />
      <Route path="setup" element={<PortalSetup />} />
      <Route element={<PortalLayout />}>
        <Route index element={<PortalHome />} />
        <Route path="pay" element={<PortalPay />} />
        <Route path="report" element={<PortalReport />} />
        <Route path="hold" element={<PortalHold />} />
        <Route path="receipts" element={<PortalReceipts />} />
        <Route path="inbox" element={<PortalInbox />} />
        <Route path="privacy" element={<PortalPrivacy />} />
        <Route path="chat" element={<PortalChat />} />
        <Route path="more" element={<PortalMore />} />
        <Route path="*" element={<PortalHome />} />
      </Route>
    </Routes>
  )
}
