import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

export default function Subjects() {
  const { getToken } = useAuth()
  const { subjects, loading, fetchSubjects, deleteSubject } = useSubjectsStore()

  useEffect(() => {
    getToken().then(token => fetchSubjects(token))
  }, [])

  async function handleDelete(e, subjectId, name) {
    e.preventDefault()
    if (!confirm(`Remove ${name}? This will also delete all documents and papers for this subject.`)) return
    const token = await getToken()
    await deleteSubject(token, subjectId)
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Subjects</h1>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
            {subjects.length} subject{subjects.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <Link to="/subjects/new" style={{
          padding: '9px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: 'var(--teal)', color: '#fff', textDecoration: 'none',
          border: 'none', cursor: 'pointer'
        }}>+ Add subject</Link>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading subjects...</div>
      ) : subjects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No subjects yet</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
            Add your first subject to start generating mock papers and quizzes
          </p>
          <Link to="/subjects/new" style={{
            padding: '9px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: 'var(--teal)', color: '#fff', textDecoration: 'none'
          }}>Set up a subject</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {subjects.map(s => (
            <Link key={s.id} to={`/subjects/${s.id}/edit`} style={{ textDecoration: 'none' }}>
              <div style={{
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'border-color .15s', cursor: 'pointer'
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--teal-border)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{s.name}</h3>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--teal-bg)', color: 'var(--teal2)', border: '1px solid var(--teal-border)', fontWeight: 600 }}>
                      {s.examBoard}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text3)' }}>
                    <span>{s.state} · Year {s.yearLevel}</span>
                    <span>{(s.topics || []).length} topics</span>
                    <span>{(s.examDates || []).length} exams</span>
                    <span>{(s.assignmentDueDates || []).length} assignments</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {/* Next exam countdown */}
                  {s.examDates?.length > 0 && (() => {
                    const next = s.examDates.filter(e => new Date(e.date) >= new Date()).sort((a, b) => new Date(a.date) - new Date(b.date))[0]
                    if (!next) return null
                    const days = Math.ceil((new Date(next.date) - new Date()) / (1000 * 60 * 60 * 24))
                    return (
                      <div style={{ textAlign: 'right', marginRight: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: days <= 14 ? 'var(--red)' : 'var(--text2)' }}>
                          {days}d
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>next exam</div>
                      </div>
                    )
                  })()}

                  <button
                    onClick={e => handleDelete(e, s.id, s.name)}
                    style={{
                      background: 'none', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '5px 10px', color: 'var(--text3)',
                      cursor: 'pointer', fontSize: 11
                    }}
                  >Remove</button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
