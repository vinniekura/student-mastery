import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

export default function MockPaper() {
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()
  const [selectedSubject, setSelectedSubject] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [paper, setPaper] = useState(null)
  const [pastPapers, setPastPapers] = useState([])
  const [loadingPast, setLoadingPast] = useState(true)
  const [showAnswers, setShowAnswers] = useState({})
  const [customInstructions, setCustomInstructions] = useState('')
  const [useWebScout, setUseWebScout] = useState(true)
  const [viewingPaper, setViewingPaper] = useState(null)

  useEffect(() => {
    getToken().then(async token => {
      await fetchSubjects(token)
      fetchPastPapers(token)
    })
  }, [])

  async function fetchPastPapers(token) {
    setLoadingPast(true)
    try {
      const res = await fetch('/api/papers', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setPastPapers(data.papers || [])
      }
    } finally {
      setLoadingPast(false)
    }
  }

  async function generate() {
    if (!selectedSubject) { setError('Please select a subject'); return }
    setGenerating(true)
    setError(null)
    setPaper(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/generate-mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subjectId: selectedSubject,
          includeWebScout: useWebScout,
          customInstructions
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate paper')
      setPaper(data)
      fetchPastPapers(token)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  function toggleAnswer(sIdx, qIdx) {
    const key = `${sIdx}-${qIdx}`
    setShowAnswers(a => ({ ...a, [key]: !a[key] }))
  }

  const displayPaper = viewingPaper?.paper || paper?.paper

  const sel = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg3)',
    color: 'var(--text)', fontSize: 13, cursor: 'pointer',
    appearance: 'none', WebkitAppearance: 'none'
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Mock paper generator</h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
          Generate a full exam paper calibrated to your subject, exam board, and year level
        </p>
      </div>

      {!displayPaper ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

          {/* Generator */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>Generate new paper</h2>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Subject</label>
              <select value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} style={sel}>
                <option value="">Select a subject...</option>
                {subjects.map(s => (
                  <option key={s.id} value={s.id}>{s.name} — {s.examBoard} Year {s.yearLevel}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>
                Custom instructions (optional)
              </label>
              <textarea
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                placeholder="e.g. Focus on calculus, include harder extended response questions..."
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg3)',
                  color: 'var(--text)', fontSize: 12, resize: 'vertical',
                  minHeight: 70, fontFamily: 'inherit'
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                onClick={() => setUseWebScout(v => !v)}
                style={{
                  width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
                  background: useWebScout ? 'var(--teal)' : 'var(--border2)',
                  position: 'relative', transition: 'background .2s', flexShrink: 0
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: useWebScout ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left .2s'
                }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Web scout fallback</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Search for past papers if no docs uploaded</div>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 10px', background: 'var(--red-bg)', borderRadius: 8, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button
              onClick={generate}
              disabled={generating || !selectedSubject}
              style={{
                width: '100%', padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: generating ? 'var(--bg3)' : 'var(--teal)',
                border: 'none', color: generating ? 'var(--text2)' : '#fff',
                cursor: (generating || !selectedSubject) ? 'not-allowed' : 'pointer',
                opacity: !selectedSubject ? 0.5 : 1, transition: 'all .15s'
              }}
            >
              {generating ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--text2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                  Generating paper... (30-60s)
                </span>
              ) : '📝 Generate mock paper'}
            </button>

            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

            {generating && (
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6 }}>
                Claude is writing your exam paper...<br/>
                Building sections, questions and marking criteria
              </div>
            )}
          </div>

          {/* Past papers */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>Previous papers</h2>
            {loadingPast ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading...</div>
            ) : pastPapers.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                No papers generated yet — create your first one
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastPapers.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setViewingPaper(p)}
                    style={{
                      padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                      background: 'var(--bg3)', border: '1px solid var(--border)',
                      transition: 'border-color .15s'
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'var(--teal-border)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
                      {p.subjectName}
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text3)' }}>
                      <span>{new Date(p.generatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span>·</span>
                      <span style={{ color: p.sourceType === 'docs' ? 'var(--teal2)' : p.sourceType === 'scout' ? 'var(--amber)' : 'var(--text3)' }}>
                        {p.sourceType === 'docs' ? 'From your notes' : p.sourceType === 'scout' ? 'Web scout' : 'Syllabus'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Paper viewer */
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
            <button
              onClick={() => { setPaper(null); setViewingPaper(null); setShowAnswers({}) }}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}
            >← Back</button>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                Source: {' '}
                <span style={{ color: (viewingPaper || paper)?.sourceType === 'docs' ? 'var(--teal2)' : (viewingPaper || paper)?.sourceType === 'scout' ? 'var(--amber)' : 'var(--text2)' }}>
                  {(viewingPaper || paper)?.sourceType === 'docs' ? 'Your uploaded notes' : (viewingPaper || paper)?.sourceType === 'scout' ? 'Web scout + syllabus' : 'Syllabus knowledge'}
                </span>
              </span>
            </div>
            <button
              onClick={() => window.print()}
              style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}
            >🖨 Print</button>
          </div>

          {/* Paper header */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, marginBottom: 16 }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                {displayPaper.examBoard} — Mock Examination
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{displayPaper.title || displayPaper.subject}</h2>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, fontSize: 13, color: 'var(--text2)' }}>
                <span>Total marks: <strong style={{ color: 'var(--text)' }}>{displayPaper.totalMarks}</strong></span>
                <span>Time: <strong style={{ color: 'var(--text)' }}>{displayPaper.timeAllowed}</strong></span>
              </div>
            </div>
            <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text2)', borderLeft: '3px solid var(--teal)', borderRadius: '0 8px 8px 0' }}>
              <strong>Instructions:</strong> {displayPaper.instructions}
            </div>
          </div>

          {/* Sections */}
          {(displayPaper.sections || []).map((section, sIdx) => (
            <div key={sIdx} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{section.name}</h3>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{section.instructions}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal2)', background: 'var(--teal-bg)', padding: '4px 12px', borderRadius: 20, border: '1px solid var(--teal-border)', whiteSpace: 'nowrap' }}>
                  {section.marks} marks
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {(section.questions || []).map((q, qIdx) => (
                  <div key={qIdx} style={{ paddingBottom: 16, borderBottom: qIdx < section.questions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: 'var(--bg3)',
                        border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text2)', flexShrink: 0
                      }}>{q.number}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, marginBottom: 8 }}>{q.question}</div>

                        {/* MCQ options */}
                        {q.options && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                            {q.options.map((opt, i) => (
                              <div key={i} style={{ fontSize: 13, color: 'var(--text2)', padding: '4px 0' }}>{opt}</div>
                            ))}
                          </div>
                        )}

                        {/* Short/extended answer space */}
                        {q.type !== 'mcq' && (
                          <div style={{
                            marginTop: 8, borderBottom: '1px solid var(--border2)',
                            height: q.type === 'extended' ? 120 : 40,
                            marginBottom: 4
                          }} />
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border)' }}>
                              {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                            </span>
                            {q.topic && (
                              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{q.topic}</span>
                            )}
                          </div>
                          <button
                            onClick={() => toggleAnswer(sIdx, qIdx)}
                            style={{ fontSize: 11, color: 'var(--teal2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            {showAnswers[`${sIdx}-${qIdx}`] ? 'Hide answer ↑' : 'Show answer ↓'}
                          </button>
                        </div>

                        {/* Answer reveal */}
                        {showAnswers[`${sIdx}-${qIdx}`] && (
                          <div style={{ marginTop: 10, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', borderRadius: 8, padding: '10px 14px' }}>
                            {q.answer && (
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal2)', marginBottom: q.markingCriteria ? 6 : 0 }}>
                                Answer: {q.answer}
                              </div>
                            )}
                            {q.markingCriteria && (
                              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
                                <strong>Marking criteria:</strong> {q.markingCriteria}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
