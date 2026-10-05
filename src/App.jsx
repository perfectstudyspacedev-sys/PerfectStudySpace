import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Shell from './components/layout/Shell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import MembershipPage from './pages/MembershipPage'
import StudentsPage from './pages/StudentsPage'
import EnquiriesPage from './pages/EnquiriesPage'
import StudentProfilePage from './pages/StudentProfilePage'
import FoodMenuPage from './pages/FoodMenuPage'
import RevenuePage from './pages/RevenuePage'
import MessagesPage from './pages/MessagesPage'
import StaffPage from './pages/StaffPage'
import BranchSettingsPage from './pages/BranchSettingsPage'
import ReportsPage from './pages/ReportsPage'
import BookingsPage from './pages/BookingsPage'
import TasksPage from './pages/TasksPage'
import JoinPage from './pages/JoinPage'
import { signupSiteUrl } from './lib/signupLink'

// HSL — once the sign-up site has its own address, an old /join/<code> link on the staff site
// forwards there, so the form is never shown on the staff address.
function JoinRoute() {
  const base = signupSiteUrl()
  if (base) {
    const code = window.location.pathname.split('/').filter(Boolean)[1] ?? ''
    window.location.replace(`${base}/${code}`)
    return null
  }
  return <JoinPage />
}

function ProtectedRoute({ children }) {
  const { staff, loading } = useAuth()
  if (loading) return <p style={{ padding: '2rem', color: '#888' }}>Loading…</p>
  if (!staff) return <Navigate to="/login" replace />
  return children
}

function OwnerRoute({ children }) {
  const { isOwner } = useAuth()
  if (!isOwner) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* SSP: public self sign-up page, reached only by a branch's link — no login. */}
          <Route path="/join/:code" element={<JoinRoute />} />
          <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="membership" element={<MembershipPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="enquiries" element={<EnquiriesPage />} />
            <Route path="students/:id" element={<StudentProfilePage />} />
            <Route path="food-menu" element={<FoodMenuPage />} />
            <Route path="revenue" element={<OwnerRoute><RevenuePage /></OwnerRoute>} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="actions" element={<TasksPage />} />
            <Route path="settings/branches" element={<OwnerRoute><BranchSettingsPage /></OwnerRoute>} />
            <Route path="settings/staff" element={<OwnerRoute><StaffPage /></OwnerRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
