import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, RedirectToSignIn } from '@clerk/clerk-react'
import LandingPage from './pages/LandingPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Subjects from './pages/Subjects.jsx'
import SubjectSetup from './pages/SubjectSetup.jsx'
import SubjectHub from './pages/SubjectHub.jsx'
import MockPaper from './pages/MockPaper.jsx'
import Calendar from './pages/Calendar.jsx'
import Settings from './pages/Settings.jsx'
import Layout from './components/Layout.jsx'

function ProtectedRoute({ children }) {
  const { isSignedIn, isLoaded } = useAuth()
  if (!isLoaded) return <LoadingScreen />
  if (!isSignedIn) return <RedirectToSignIn />
  return children
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>Loading Student Mastery...</div>
    </div>
  )
}

function P({ children }) {
  return <ProtectedRoute><Layout>{children}</Layout></ProtectedRoute>
}

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
