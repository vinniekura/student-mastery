import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

export default function Calendar() {
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()
  const [view, setView] = useState('list') // 'list' | 'month'
  const [filterType, setFilterType] = useState('all')

  useEffect(() => {
    getToken().then(token => fetchSubjects(token))
  }, [])

  // Flatten all events from all subjects
  const allEvents = subjects.flatMap(s => [
    ...(s.examDates || []).map(e => ({
      ...e, subjectName: s.name, subjectId: s.id,
      type: 'exam', color: 'var(--red)', bg: 'var(--red-bg)', label: 'EXAM'
    })),
    ...(s.assignmentDueDates || []).map(a => ({
      ...a, subjectName: s.name, subjectId: s.id,
      type: 'assignment', color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'DUE'
    }))
  ])
    .filter(e => filterType === 'all' || e.type === filterType)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const upcoming = allEvents.filter(e => new Date(e.date) >= today)
  const past = allEvents.filter(e => new Date(e.date) < today)

  function daysUntil(dateStr) {
    const d = new Date(dateStr)
    d.setHours(0, 0, 0, 0)
    return Math.ceil((d - today) / (1000 * 60 * 60 * 24))
  }

  function urgencyColor(days) {
    if (days <= 3) return 'var(--red)'
    if (days <= 14) return 'var(--amber)'
    return 'var(--text2)'
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Calendar</h1>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
            {upcoming.length} upcoming event{upcoming.length !== 1 ? 's' : ''}
          </p>
        </div>
        {/* Filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'exam', 'assignment'].map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
              background: filterType === t ? 'var(--teal-bg)' : 'var(--bg2)',
              border: `1px solid ${filterType === t ? 'var(--teal-border)' : 'var(--border)'}`,
              color: filterType === t ? 'var(--teal2)' : 'var(--text2)',
              fontWeight: filterType === t ? 600 : 400
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {allEvents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>No events yet</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Add exam and assignment dates in your subject settings</div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Upcoming
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcoming.map((e, i) => {
                  const days = daysUntil(e.date)
                  return (
                    <div key={i} style={{
                      background: 'var(--bg2)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', padding: '14px 18px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        {/* Date block */}
                        <div style={{
                          width: 44, height: 44, borderRadius: 8,
                          background: e.bg, border: `1px solid ${e.color}22`,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', flexShrink: 0
                        }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: e.color, lineHeight: 1 }}>
                            {new Date(e.date).getDate()}
                          </div>
                          <div style={{ fontSize: 10, color: e.color, lineHeight: 1, marginTop: 2 }}>
                            {new Date(e.date).toLocaleDateString('en-AU', { month: 'short' }).toUpperCase()}
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: e.bg, color: e.color, fontWeight: 700 }}>
                              {e.label}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{e.title}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{e.subjectName}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: urgencyColor(days) }}>
                          {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}
                        </div>
                        {e.type === 'exam' && e.durationMins && (
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.durationMins} min</div>
                        )}
                        {e.type === 'assignment' && e.weight && (
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.weight}% weight</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Past
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: 0.5 }}>
                {past.slice().reverse().map((e, i) => (
                  <div key={i} style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '10px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: e.bg, color: e.color, fontWeight: 600 }}>{e.label}</span>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{e.title}</span>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>· {e.subjectName}</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {new Date(e.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
