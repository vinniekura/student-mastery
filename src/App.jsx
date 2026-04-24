import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import Dashboard from './pages/Dashboard'
import Subjects from './pages/Subjects'
import SubjectSetup from './pages/SubjectSetup'
import SubjectHub from './pages/SubjectHub'
import MockPaper from './pages/MockPaper'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import P from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<P><Dashboard /></P>} />
        <Route path="/subjects" element={<P><Subjects /></P>} />
        <Route path="/subjects/new" element={<P><SubjectSetup /></P>} />
        <Route path="/subjects/:subjectId" element={<P><SubjectHub /></P>} />
        <Route path="/subjects/:subjectId/edit" element={<P><SubjectSetup /></P>} />
        <Route path="/mock-paper" element={<P><MockPaper /></P>} />
        <Route path="/calendar" element={<P><Calendar /></P>} />
        <Route path="/settings" element={<P><Settings /></P>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
