import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, RedirectToSignIn } from '@clerk/clerk-react'
import LandingPage from './pages/LandingPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Subjects from './pages/Subjects.jsx'
import SubjectSetup from './pages/SubjectSetup.jsx'
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
      <div style={{ textAlign: 'center', color: 'var(--text2)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        <div style={{ fontSize: 13 }}>Loading Student Mastery...</div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/subjects" element={
          <ProtectedRoute>
            <Layout>
              <Subjects />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/subjects/new" element={
          <ProtectedRoute>
            <Layout>
              <SubjectSetup />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/subjects/:subjectId/edit" element={
          <ProtectedRoute>
            <Layout>
              <SubjectSetup />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/calendar" element={
          <ProtectedRoute>
            <Layout>
              <Calendar />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute>
            <Layout>
              <Settings />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
