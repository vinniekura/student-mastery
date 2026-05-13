import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useState, useEffect } from 'react'

import LandingPage   from './pages/LandingPage'
import Dashboard     from './pages/Dashboard'
import Subjects      from './pages/Subjects'
import SubjectSetup  from './pages/SubjectSetup'
import SubjectHub    from './pages/SubjectHub'
import MockPaper     from './pages/MockPaper'
import Calendar      from './pages/Calendar'
import Settings      from './pages/Settings'
import P             from './components/ProtectedRoute'

// ── Theme ───────────────────────────────────────────────────────────────────
function useTheme() {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('sm-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sm-theme', theme)
  }, [theme])
  return [theme, setTheme]
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
const NAV = [
  { to: '/dashboard',  label: 'Home',        icon: '⌂' },
  { to: '/subjects',   label: 'Subjects',    icon: '◧' },
  { to: '/mock-paper', label: 'Mock Papers', icon: '◨' },
  { to: '/calendar',   label: 'Calendar',   icon: '◫' },
  { to: '/settings',   label: 'Settings',   icon: '◩' },
]

function Sidebar({ theme, setTheme }) {
  const { user, signOut } = useAuth()
  const initials = user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || '?'

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          Student Mastery
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Exam prep engine</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          className="nav-item"
          style={{ justifyContent: 'space-between' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{theme === 'dark' ? '☀' : '◑'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 6 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.firstName || 'Student'}
            </div>
            <button onClick={() => signOut()} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ── Mobile bottom nav ────────────────────────────────────────────────────────
function MobileNav() {
  const location = useLocation()
  return (
    <div className="mobile-nav">
      {NAV.slice(0, 5).map(n => {
        const active = location.pathname === n.to || location.pathname.startsWith(n.to + '/')
        return (
          <NavLink key={n.to} to={n.to} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '4px 12px', textDecoration: 'none' }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, color: active ? 'var(--accent)' : 'var(--text3)' }}>{n.label}</span>
          </NavLink>
        )
      })}
    </div>
  )
}

// ── Layout ───────────────────────────────────────────────────────────────────
function Layout({ children, theme, setTheme }) {
  return (
    <div className="app-shell">
      <Sidebar theme={theme} setTheme={setTheme} />
      <main className="main-content fade-in">
        {children}
      </main>
      <MobileNav />
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useTheme()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard"              element={<P><Layout theme={theme} setTheme={setTheme}><Dashboard /></Layout></P>} />
        <Route path="/subjects"               element={<P><Layout theme={theme} setTheme={setTheme}><Subjects /></Layout></P>} />
        <Route path="/subjects/new"           element={<P><Layout theme={theme} setTheme={setTheme}><SubjectSetup /></Layout></P>} />
        <Route path="/subjects/:subjectId"    element={<P><Layout theme={theme} setTheme={setTheme}><SubjectHub /></Layout></P>} />
        <Route path="/subjects/:subjectId/edit" element={<P><Layout theme={theme} setTheme={setTheme}><SubjectSetup /></Layout></P>} />
        <Route path="/mock-paper"             element={<P><Layout theme={theme} setTheme={setTheme}><MockPaper /></Layout></P>} />
        <Route path="/calendar"               element={<P><Layout theme={theme} setTheme={setTheme}><Calendar /></Layout></P>} />
        <Route path="/settings"               element={<P><Layout theme={theme} setTheme={setTheme}><Settings /></Layout></P>} />
        <Route path="*"                       element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
