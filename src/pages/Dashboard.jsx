import { useEffect } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import { useSubjectsStore } from '../store/subjects.js'

export default function Dashboard() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const { subjects, loading, fetchSubjects } = useSubjectsStore()

  useEffect(() => {
    getToken().then(token => fetchSubjects(token))
  }, [])

  const today = new Date()
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.firstName || 'there'

  // Derive upcoming events from subjects
  const upcoming = subjects.flatMap(s => [
    ...(s.examDates || []).map(e => ({ ...e, subjectName: s.name, type: 'exam', color: 'var(--red)', bg: 'var(--red-bg)' })),
    ...(s.assignmentDueDates || []).map(a => ({ ...a, subjectName: s.name, type: 'assignment', color: 'var(--amber)', bg: 'var(--amber-bg)' }))
  ])
    .filter(e => new Date(e.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5)

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
          {greeting}, {firstName}
        </h1>
        <p style={{ color: 'var(--text2)', fontSize: 14 }}>
          {today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 32 }}>
        {[
          { label: 'Subjects', value: subjects.length, color: 'var(--teal)' },
          { label: 'Upcoming exams', value: upcoming.filter(e => e.type === 'exam').length, color: 'var(--red)' },
          { label: 'Assignments due', value: upcoming.filter(e => e.type === 'assignment').length, color: 'var(--amber)' },
          { label: 'Mock papers', value: 0, color: 'var(--purple)' }
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '16px'
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Subjects panel */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>My subjects</h2>
            <Link to="/subjects/new" style={{
              fontSize: 12, color: 'var(--teal2)', textDecoration: 'none',
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--teal-border)',
              background: 'var(--teal-bg)'
            }}>+ Add</Link>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading...</div>
          ) : subjects.length === 0 ? (
            <EmptyState
              message="No subjects yet"
              action="Add your first subject to get started"
              to="/subjects/new"
              cta="Set up a subject"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {subjects.slice(0, 5).map(s => (
                <Link key={s.id} to={`/subjects/${s.id}/edit`} style={{ textDecoration: 'none' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    transition: 'border-color .15s', cursor: 'pointer'
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--border2)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                        {s.examBoard} · Year {s.yearLevel} · {s.state}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {(s.topics || []).length} topics
                    </div>
                  </div>
                </Link>
              ))}
              {subjects.length > 5 && (
                <Link to="/subjects" style={{ fontSize: 12, color: 'var(--teal2)', textDecoration: 'none', textAlign: 'center', padding: 8 }}>
                  View all {subjects.length} subjects →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Upcoming panel */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Coming up</h2>
            <Link to="/calendar" style={{ fontSize: 12, color: 'var(--teal2)', textDecoration: 'none' }}>Calendar →</Link>
          </div>

          {upcoming.length === 0 ? (
            <EmptyState
              message="No upcoming events"
              action="Add exam and assignment dates in your subjects"
              to="/subjects"
              cta="Go to subjects"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcoming.map((e, i) => {
                const daysUntil = Math.ceil((new Date(e.date) - today) / (1000 * 60 * 60 * 24))
                return (
                  <div key={i} style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 10,
                          background: e.bg, color: e.color, fontWeight: 600
                        }}>
                          {e.type === 'exam' ? 'EXAM' : 'DUE'}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{e.title}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.subjectName}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: daysUntil <= 7 ? 'var(--red)' : daysUntil <= 14 ? 'var(--amber)' : 'var(--text2)' }}>
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {new Date(e.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { label: 'Generate mock paper', desc: 'AI-powered exam from your notes', to: '/subjects', color: 'var(--teal)' },
            { label: 'Quick quiz', desc: 'Test yourself in 5 minutes', to: '/subjects', color: 'var(--purple)' },
            { label: 'Add subject', desc: 'Set up a new subject', to: '/subjects/new', color: 'var(--amber)' },
            { label: 'View calendar', desc: 'See all upcoming dates', to: '/calendar', color: 'var(--text2)' }
          ].map(a => (
            <Link key={a.label} to={a.to} style={{ textDecoration: 'none' }}>
              <div style={{
                padding: '14px 16px', borderRadius: 'var(--radius)',
                background: 'var(--bg2)', border: '1px solid var(--border)',
                transition: 'border-color .15s', cursor: 'pointer', height: '100%'
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--border2)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: a.color, marginBottom: 4 }}>{a.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{a.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ message, action, to, cta }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>{message}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>{action}</div>
      <Link to={to} style={{
        fontSize: 12, color: 'var(--teal2)', textDecoration: 'none',
        padding: '6px 14px', borderRadius: 8,
        background: 'var(--teal-bg)', border: '1px solid var(--teal-border)'
      }}>{cta}</Link>
    </div>
  )
}
