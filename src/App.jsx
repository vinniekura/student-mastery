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
const Icon = {
  home:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>,
  subjects: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
  mock:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  sun:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  logout:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
}

const NAV = [
  { to: '/dashboard',  label: 'Home',        icon: Icon.home },
  { to: '/subjects',   label: 'Subjects',    icon: Icon.subjects },
  { to: '/mock-paper', label: 'Mock Papers', icon: Icon.mock },
  { to: '/calendar',   label: 'Calendar',   icon: Icon.calendar },
  { to: '/settings',   label: 'Settings',   icon: Icon.settings },
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
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{n.icon}</span>
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
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {theme === 'dark' ? Icon.sun : Icon.moon}
          </span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        {/* Sign out */}
        <button onClick={() => signOut()} className="nav-item">
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{Icon.logout}</span>
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
            {n.icon}
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
