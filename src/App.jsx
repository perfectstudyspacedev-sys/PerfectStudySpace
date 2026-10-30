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
import FlagsPage from './pages/FlagsPage'
import AnalystPage from './pages/AnalystPage'
import ApprovalsPage from './pages/ApprovalsPage'
import ChatRepliesPage from './pages/ChatRepliesPage'
import SendListPage from './pages/SendListPage'
import GrowthPage from './pages/GrowthPage'
import LearningPage from './pages/LearningPage'
import OverviewPage from './pages/OverviewPage'
import FoodQueuePage from './pages/FoodQueuePage'
import TicketsPage from './pages/TicketsPage'
import JoinPage from './pages/JoinPage'

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
          <Route path="/join/:code" element={<JoinPage />} />
          <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="membership" element={<MembershipPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="enquiries" element={<EnquiriesPage />} />
            <Route path="students/:id" element={<StudentProfilePage />} />
            <Route path="food-menu" element={<FoodMenuPage />} />
            <Route path="food-orders" element={<FoodQueuePage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="revenue" element={<OwnerRoute><RevenuePage /></OwnerRoute>} />
            <Route path="flags" element={<OwnerRoute><FlagsPage /></OwnerRoute>} />
            <Route path="analyst" element={<OwnerRoute><AnalystPage /></OwnerRoute>} />
            <Route path="approvals" element={<OwnerRoute><ApprovalsPage /></OwnerRoute>} />
            <Route path="chat-replies" element={<ChatRepliesPage />} />
            <Route path="send-list" element={<OwnerRoute><SendListPage /></OwnerRoute>} />
            <Route path="growth" element={<OwnerRoute><GrowthPage /></OwnerRoute>} />
            <Route path="learning" element={<OwnerRoute><LearningPage /></OwnerRoute>} />
            <Route path="overview" element={<OwnerRoute><OverviewPage /></OwnerRoute>} />
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
