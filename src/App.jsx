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

// ── Theme ────────────────────────────────────────────────────────────────────
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

// ── Icons (simple SVG — no dependency needed) ────────────────────────────────
// Simple emoji icons — render perfectly everywhere, no JSX object issues
const NAV = [
  { to: '/dashboard',  label: 'Home',        icon: '🏠' },
  { to: '/subjects',   label: 'Subjects',    icon: '📚' },
  { to: '/mock-paper', label: 'Mock Papers', icon: '📝' },
  { to: '/calendar',   label: 'Calendar',   icon: '📅' },
  { to: '/settings',   label: 'Settings',   icon: '⚙️' },
]

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ theme, setTheme }) {
  const { user, signOut } = useAuth()
  const name     = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'Student'
  const email    = user?.emailAddresses?.[0]?.emailAddress || ''
  const initials = name[0]?.toUpperCase() || 'S'

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Student Mastery
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>AI exam prep</div>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/dashboard'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom controls */}
      <div style={{ padding: '8px 8px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          className="nav-item"
        >
          <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        {/* Sign out */}
        <button onClick={() => signOut()} className="nav-item">
          <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>↩</span>
          Sign out
        </button>

        {/* User pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginTop: 4, background: 'var(--bg3)', borderRadius: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--teal-bg)', color: 'var(--teal2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ── Mobile bottom nav ─────────────────────────────────────────────────────────
function MobileNav() {
  const location = useLocation()
  return (
    <div className="mobile-nav">
      {NAV.map(n => {
        const active = location.pathname === n.to || (n.to !== '/dashboard' && location.pathname.startsWith(n.to))
        return (
          <NavLink key={n.to} to={n.to} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '4px 16px', textDecoration: 'none', color: active ? 'var(--teal2)' : 'var(--text3)' }}>
            <span style={{ fontSize: 18 }}>{n.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{n.label}</span>
          </NavLink>
        )
      })}
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────
function Layout({ children, theme, setTheme }) {
  return (
    <div className="app-shell">
      <Sidebar theme={theme} setTheme={setTheme} />
      <main className="main-content">
        {children}
      </main>
      <MobileNav />
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useTheme()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                          element={<LandingPage />} />
        <Route path="/dashboard"                 element={<P><Layout theme={theme} setTheme={setTheme}><Dashboard /></Layout></P>} />
        <Route path="/subjects"                  element={<P><Layout theme={theme} setTheme={setTheme}><Subjects /></Layout></P>} />
        <Route path="/subjects/new"              element={<P><Layout theme={theme} setTheme={setTheme}><SubjectSetup /></Layout></P>} />
        <Route path="/subjects/:subjectId"       element={<P><Layout theme={theme} setTheme={setTheme}><SubjectHub /></Layout></P>} />
        <Route path="/subjects/:subjectId/edit"  element={<P><Layout theme={theme} setTheme={setTheme}><SubjectSetup /></Layout></P>} />
        <Route path="/mock-paper"                element={<P><Layout theme={theme} setTheme={setTheme}><MockPaper /></Layout></P>} />
        <Route path="/calendar"                  element={<P><Layout theme={theme} setTheme={setTheme}><Calendar /></Layout></P>} />
        <Route path="/settings"                  element={<P><Layout theme={theme} setTheme={setTheme}><Settings /></Layout></P>} />
        <Route path="*"                          element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
