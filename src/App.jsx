import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useState } from 'react'
import LandingPage from './pages/LandingPage'
import Dashboard from './pages/Dashboard'
import Subjects from './pages/Subjects'
import SubjectSetup from './pages/SubjectSetup'
import SubjectHub from './pages/SubjectHub'
import MockPaper from './pages/MockPaper'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import P from './components/ProtectedRoute'

// ── Sidebar Layout ─────────────────────────────────────────────────────────────
function Layout({ children }) {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const navItems = [
    { path: '/dashboard',  label: 'Dashboard',    icon: '◈' },
    { path: '/subjects',   label: 'Subjects',      icon: '≡' },
    { path: '/mock-paper', label: 'Mock papers',   icon: '📄' },
    { path: '/calendar',   label: 'Calendar',      icon: '📅' },
    { path: '/settings',   label: 'Settings',      icon: '⚙' },
  ]

  const active = (path) => location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <div style={{ width: 200, background: 'var(--bg2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100 }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Student</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--teal2)', letterSpacing: '-0.3px' }}>Mastery</div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
                fontSize: 13, fontWeight: active(item.path) ? 600 : 400,
                color: active(item.path) ? 'var(--teal2)' : 'var(--text2)',
                background: active(item.path) ? 'var(--teal-bg)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {user && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.firstName || user.emailAddresses?.[0]?.emailAddress?.split('@')[0]}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.emailAddresses?.[0]?.emailAddress}
              </div>
            </div>
          )}
          <button onClick={() => signOut()} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, marginLeft: 200, padding: '32px 40px', maxWidth: 'calc(100vw - 200px)' }}>
        {children}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard"              element={<P><Layout><Dashboard /></Layout></P>} />
        <Route path="/subjects"               element={<P><Layout><Subjects /></Layout></P>} />
        <Route path="/subjects/new"           element={<P><Layout><SubjectSetup /></Layout></P>} />
        <Route path="/subjects/:subjectId"    element={<P><Layout><SubjectHub /></Layout></P>} />
        <Route path="/subjects/:subjectId/edit" element={<P><Layout><SubjectSetup /></Layout></P>} />
        <Route path="/mock-paper"             element={<P><Layout><MockPaper /></Layout></P>} />
        <Route path="/calendar"               element={<P><Layout><Calendar /></Layout></P>} />
        <Route path="/settings"               element={<P><Layout><Settings /></Layout></P>} />
        <Route path="*"                       element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
