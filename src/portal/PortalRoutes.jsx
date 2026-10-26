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
import { PortalNext, PortalRefer, PortalRelease, PortalWaitlist } from './PortalGrow'
import { PortalCheckin, PortalFood, PortalProblem, PortalSeatPrefs } from './PortalSelf'
import { PortalBuddy, PortalCertificates, PortalCoach, PortalFamily, PortalFocus, PortalWrapped } from './PortalStudy'

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
        <Route path="release" element={<PortalRelease />} />
        <Route path="waitlist" element={<PortalWaitlist />} />
        <Route path="refer" element={<PortalRefer />} />
        <Route path="next" element={<PortalNext />} />
        <Route path="checkin" element={<PortalCheckin />} />
        <Route path="seats" element={<PortalSeatPrefs />} />
        <Route path="food" element={<PortalFood />} />
        <Route path="problem" element={<PortalProblem />} />
        <Route path="focus" element={<PortalFocus />} />
        <Route path="coach" element={<PortalCoach />} />
        <Route path="wrapped" element={<PortalWrapped />} />
        <Route path="buddy" element={<PortalBuddy />} />
        <Route path="certificates" element={<PortalCertificates />} />
        <Route path="family" element={<PortalFamily />} />
        <Route path="*" element={<PortalHome />} />
      </Route>
    </Routes>
  )
}
