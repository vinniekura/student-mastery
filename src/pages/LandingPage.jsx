import { SignInButton, SignUpButton, useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isLoaded && isSignedIn) navigate('/dashboard')
  }, [isSignedIn, isLoaded])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>

      {/* Logo mark */}
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: 'var(--teal-bg)', border: '1px solid var(--teal-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 24
      }}>
        <svg width="28" height="28" fill="none" viewBox="0 0 28 28">
          <path d="M14 3L25 9.5V18.5L14 25L3 18.5V9.5L14 3Z" stroke="var(--teal2)" strokeWidth="2" strokeLinejoin="round"/>
          <circle cx="14" cy="14" r="3.5" fill="var(--teal2)"/>
        </svg>
      </div>

      {/* Headline */}
      <h1 style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)', textAlign: 'center', marginBottom: 12, letterSpacing: -0.5 }}>
        Student Mastery
      </h1>
      <p style={{ fontSize: 16, color: 'var(--text2)', textAlign: 'center', maxWidth: 420, lineHeight: 1.6, marginBottom: 40 }}>
        Your AI-powered study companion. Generate mock exams, track progress, and ace every assessment — from HSC to uni.
      </p>

      {/* CTA buttons */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 48 }}>
        <SignUpButton mode="modal">
          <button style={{
            padding: '12px 28px', borderRadius: 10, fontSize: 15, fontWeight: 600,
            background: 'var(--teal)', border: 'none', color: '#fff', cursor: 'pointer',
            transition: 'opacity .15s'
          }}
          onMouseOver={e => e.target.style.opacity = '0.85'}
          onMouseOut={e => e.target.style.opacity = '1'}
          >
            Get started free
          </button>
        </SignUpButton>
        <SignInButton mode="modal">
          <button style={{
            padding: '12px 28px', borderRadius: 10, fontSize: 15, fontWeight: 500,
            background: 'transparent', border: '1px solid var(--border2)',
            color: 'var(--text)', cursor: 'pointer', transition: 'all .15s'
          }}
          onMouseOver={e => e.target.style.borderColor = 'var(--teal-border)'}
          onMouseOut={e => e.target.style.borderColor = 'var(--border2)'}
          >
            Sign in
          </button>
        </SignInButton>
      </div>

      {/* Feature pills */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560 }}>
        {[
          'Mock exam generator',
          'Past paper scout',
          'Quick quizzes',
          'Smart calendar',
          'Progress heatmap',
          'Daily digest email',
          'HSC · VCE · QCE · IB',
          'TutorMastery linked'
        ].map(f => (
          <span key={f} style={{
            padding: '5px 12px', borderRadius: 20,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            color: 'var(--text2)', fontSize: 12
          }}>{f}</span>
        ))}
      </div>

      {/* Footer */}
      <p style={{ marginTop: 48, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
        Part of the{' '}
        <a href="https://datamastery.com.au" style={{ color: 'var(--teal2)', textDecoration: 'none' }}>
          Data Mastery
        </a>
        {' '}suite · Built by H2K Group
      </p>
    </div>
  )
}
