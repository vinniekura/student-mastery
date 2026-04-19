import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'
import DocUploader from '../components/DocUploader.jsx'
import QuizEngine from '../components/QuizEngine.jsx'

export default function SubjectHub() {
  const { subjectId } = useParams()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()

  const [docs, setDocs] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [generatingQuiz, setGeneratingQuiz] = useState(false)
  const [quizConfig, setQuizConfig] = useState({ count: 5, type: 'mcq', topic: '' })
  const [quizError, setQuizError] = useState(null)
  const [deletingDoc, setDeletingDoc] = useState(null)
  const [extractingFormat, setExtractingFormat] = useState(false)
  const [formatExtracted, setFormatExtracted] = useState(!!subject?.extractedFormat)

  const subject = subjects.find(s => s.id === subjectId)

  useEffect(() => {
    getToken().then(token => {
      fetchSubjects(token)
      fetchDocs(token)
    })
  }, [subjectId])

  async function fetchDocs(token) {
    setLoadingDocs(true)
    try {
      const res = await fetch(`/api/docs?subjectId=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setDocs(data.docs || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingDocs(false)
    }
  }

  async function handleUploadSuccess(data) {
    const token = await getToken()
    fetchDocs(token)
  }

  async function deleteDoc(docId) {
    setDeletingDoc(docId)
    try {
      const token = await getToken()
      const res = await fetch(`/api/docs?subjectId=${subjectId}&docId=${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setDocs(d => d.filter(doc => doc.id !== docId))
    } finally {
      setDeletingDoc(null)
    }
  }

  async function extractFormat() {
    setExtractingFormat(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/extract-format?subjectId=${subjectId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to extract format')
      setFormatExtracted(true)
    } catch (e) {
      console.error('Format extraction error:', e.message)
    } finally {
      setExtractingFormat(false)
    }
  }

  async function generateQuiz() {
    setGeneratingQuiz(true)
    setQuizError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/quick-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subjectId,
          questionCount: quizConfig.count,
          questionType: quizConfig.type,
          topicFocus: quizConfig.topic || undefined
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate quiz')
      setActiveQuiz({ ...data, subjectName: subject?.name })
    } catch (e) {
      setQuizError(e.message)
    } finally {
      setGeneratingQuiz(false)
    }
  }

  const sel = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, cursor: 'pointer'
  }

  if (!subject) return (
    <div style={{ color: 'var(--text2)', padding: 32 }}>
      Loading subject...
    </div>
  )

  if (activeQuiz) return (
    <div style={{ maxWidth: 680 }}>
      <button onClick={() => setActiveQuiz(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13, marginBottom: 24 }}>
        ← Back to hub
      </button>
      <QuizEngine quiz={activeQuiz} onClose={() => setActiveQuiz(null)} />
    </div>
  )

  return (
    <div style={{ maxWidth: 780 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button onClick={() => navigate('/subjects')} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>
          ← Subjects
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{subject.name}</h1>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--teal-bg)', color: 'var(--teal2)', border: '1px solid var(--teal-border)', fontWeight: 600 }}>{subject.examBoard}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {subject.state} · Year {subject.yearLevel} · {(subject.topics || []).length} topics
          </div>
        </div>
        <Link to={`/subjects/${subjectId}/edit`} style={{
          fontSize: 12, color: 'var(--text2)', textDecoration: 'none',
          padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)'
        }}>Edit subject</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Documents panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>
              Study materials
            </h2>
            <DocUploader subjectId={subjectId} onSuccess={handleUploadSuccess} />

            <div style={{ marginTop: 16 }}>
              {loadingDocs ? (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading documents...</div>
              ) : docs.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '12px 0' }}>
                  No documents yet — upload your notes or past papers above
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {docs.map(doc => (
                    <div key={doc.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)'
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.filename}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                          <span style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                            background: doc.docType === 'past-paper' ? 'rgba(124,58,237,0.1)' : 'var(--teal-bg)',
                            color: doc.docType === 'past-paper' ? '#7c3aed' : 'var(--teal2)',
                            border: `1px solid ${doc.docType === 'past-paper' ? 'rgba(124,58,237,0.2)' : 'var(--teal-border)'}`
                          }}>
                            {doc.docType === 'past-paper' ? 'Past paper' : 'Study notes'}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {doc.chunkCount} chunks · {Math.round(doc.charCount / 1000)}k chars
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteDoc(doc.id)}
                        disabled={deletingDoc === doc.id}
                        style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, padding: '0 4px', marginLeft: 8, flexShrink: 0 }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          {/* Extract format button — shows when past papers uploaded */}
          {docs.filter(d => d.docType === 'past-paper').length > 0 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: formatExtracted ? 'var(--teal-bg)' : 'var(--bg3)', borderRadius: 8, border: `1px solid ${formatExtracted ? 'var(--teal-border)' : 'var(--border)'}` }}>
              {formatExtracted ? (
                <div style={{ fontSize: 12, color: 'var(--teal2)' }}>
                  ✓ Exam format extracted — mocks will mirror your past papers
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6 }}>Analyse past paper format for better mocks</div>
                  <button
                    onClick={extractFormat}
                    disabled={extractingFormat}
                    style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, background: 'var(--teal)', border: 'none', color: '#fff', cursor: extractingFormat ? 'not-allowed' : 'pointer', opacity: extractingFormat ? 0.7 : 1 }}
                  >
                    {extractingFormat ? 'Analysing...' : 'Analyse format'}
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
        </div>

        {/* Quick quiz panel */}
        <div>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>
              Quick quiz
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>Question type</label>
                <select value={quizConfig.type} onChange={e => setQuizConfig(c => ({ ...c, type: e.target.value }))} style={sel}>
                  <option value="mcq">Multiple choice</option>
                  <option value="short">Short answer</option>
                  <option value="flashcard">Flashcards</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>Number of questions</label>
                <select value={quizConfig.count} onChange={e => setQuizConfig(c => ({ ...c, count: Number(e.target.value) }))} style={sel}>
                  {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} questions</option>)}
                </select>
              </div>
              {(subject.topics || []).length > 0 && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>Focus topic (optional)</label>
                  <select value={quizConfig.topic} onChange={e => setQuizConfig(c => ({ ...c, topic: e.target.value }))} style={sel}>
                    <option value="">All topics</option>
                    {subject.topics.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
              {(() => {
                const notes = docs.filter(d => d.docType === 'notes' || !d.docType)
                const papers = docs.filter(d => d.docType === 'past-paper')
                if (notes.length > 0) return `Using ${notes.length} study note${notes.length !== 1 ? 's' : ''} as source`
                if (papers.length > 0) return `No study notes — using ${papers.length} past paper${papers.length !== 1 ? 's' : ''} as fallback`
                return 'No documents — generating from syllabus knowledge'
              })()}
            </div>

            {quizError && (
              <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 10px', background: 'var(--red-bg)', borderRadius: 8, marginBottom: 10 }}>
                {quizError}
              </div>
            )}

            <button
              onClick={generateQuiz}
              disabled={generatingQuiz}
              style={{
                width: '100%', padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: generatingQuiz ? 'var(--bg3)' : 'var(--purple)',
                border: 'none', color: generatingQuiz ? 'var(--text2)' : '#fff',
                cursor: generatingQuiz ? 'not-allowed' : 'pointer', transition: 'all .15s'
              }}
            >
              {generatingQuiz ? 'Generating quiz...' : '⚡ Generate quiz'}
            </button>
          </div>

          {/* Topics quick reference */}
          {(subject.topics || []).length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginTop: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Topics</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {subject.topics.map(t => (
                  <span key={t.id} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)' }}>
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
