import { NavLink, useNavigate } from 'react-router-dom'
import { useUser, useClerk } from '@clerk/clerk-react'
import { useState } from 'react'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: DashIcon },
  { to: '/subjects', label: 'Subjects', icon: SubjectIcon },
  { to: '/calendar', label: 'Calendar', icon: CalIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon }
]

export default function Layout({ children }) {
  const { user } = useUser()
  const { signOut } = useClerk()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: 'var(--bg2)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
        flexShrink: 0,
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 100
      }}>
        {/* Logo */}
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--teal-bg)', border: '1px solid var(--teal-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
                <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="var(--teal2)" strokeWidth="1.5" strokeLinejoin="round"/>
                <circle cx="8" cy="8" r="2" fill="var(--teal2)"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Student</div>
              <div style={{ fontSize: 11, color: 'var(--teal2)', marginTop: -2 }}>Mastery</div>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ padding: '16px 10px', flex: 1 }}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8,
              marginBottom: 2,
              textDecoration: 'none',
              fontSize: 14, fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--text)' : 'var(--text2)',
              background: isActive ? 'var(--bg3)' : 'transparent',
              transition: 'all .15s'
            })}>
              <Icon active={false} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '16px 12px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'var(--teal-bg)', border: '1px solid var(--teal-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600, color: 'var(--teal2)', flexShrink: 0
            }}>
              {user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || '?'}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.firstName || 'Student'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.emailAddresses?.[0]?.emailAddress || ''}
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut(() => navigate('/'))}
            style={{
              width: '100%', padding: '7px 0', borderRadius: 7,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
              transition: 'all .15s'
            }}
            onMouseOver={e => e.target.style.borderColor = 'var(--border2)'}
            onMouseOut={e => e.target.style.borderColor = 'var(--border)'}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ marginLeft: 220, flex: 1, padding: '32px', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  )
}

// Icon components
function DashIcon() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
    <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
}

function SubjectIcon() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
    <path d="M2 3h12M2 8h12M2 13h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
}

function CalIcon() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
    <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
}

function SettingsIcon() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
    <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M11.5 4.5l1.4-1.4M3.1 12.9l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
}
