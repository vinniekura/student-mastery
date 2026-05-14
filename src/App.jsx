import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { UserButton, useUser, SignIn } from '@clerk/clerk-react'
import Dashboard from './pages/Dashboard'
import SubjectHub from './pages/SubjectHub'
import MockPaper from './pages/MockPaper'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import './index.css'

// ─────────────────────────────────────────────────────────────────────────────
// INNER APP (inside BrowserRouter, can use hooks)
// ─────────────────────────────────────────────────────────────────────────────

const AppContent = () => {
  const { isSignedIn, user, isLoaded } = useUser()
  const navigate = useNavigate()
  const [darkMode, setDarkMode] = useState(true)

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate('/sign-in')
    }
  }, [isSignedIn, isLoaded, navigate])

  if (!isLoaded) {
    return <div className="loading">Loading authentication...</div>
  }

  if (!isSignedIn) {
    return <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
  }

  // Navigation items with emoji icons
  const navItems = [
    { path: '/dashboard', label: 'Home', icon: '🏠' },
    { path: '/subjects', label: 'Subjects', icon: '📚' },
    { path: '/mock-paper', label: 'Mock Papers', icon: '📝' },
    { path: '/calendar', label: 'Calendar', icon: '📅' },
    { path: '/settings', label: 'Settings', icon: '⚙️' }
  ]

  return (
    <div className={`app-layout ${darkMode ? 'dark' : 'light'}`}>
      {/* ─── SIDEBAR ─────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="app-title">Student Mastery</h1>
          <p className="app-subtitle">AI exam prep</p>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button 
            className="btn-dark-mode"
            onClick={() => setDarkMode(!darkMode)}
            title="Toggle dark mode"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </aside>

      {/* ─── MAIN CONTENT ────────────────────────────────────────────────── */}
      <main className="main-content">
        <Routes>
          <Route path="/sign-in" element={<SignIn routing="path" path="/sign-in" />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/subjects" element={<SubjectHub />} />
          <Route path="/subjects/:subjectId/mock-paper" element={<MockPaper />} />
          <Route path="/mock-paper" element={<SubjectHub />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTER APP (wraps everything with BrowserRouter)
// ─────────────────────────────────────────────────────────────────────────────

const App = () => {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export default App
