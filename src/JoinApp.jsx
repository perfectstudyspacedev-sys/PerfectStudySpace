import { BrowserRouter, Routes, Route } from 'react-router-dom'
import JoinPage from './pages/JoinPage'

// HSL — everything served on join.<domain>: only the student sign-up form. Links look like
// https://join.perfectstudyspace.in/<code>; any other path shows "link no longer valid".
export default function JoinApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/:code" element={<JoinPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<JoinPage />} />
      </Routes>
    </BrowserRouter>
  )
}
