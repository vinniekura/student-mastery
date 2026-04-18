import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

const COMPETITIVE_EXAMS = ['UCAT','GAMSAT','IELTS','SELECTIVE','AMC','OC']
const SOURCE_LABELS = {
  docs: { label: 'From your notes', color: 'var(--teal2)', bg: 'var(--teal-bg)', border: 'var(--teal-border)' },
  scout: { label: 'Web scout', color: 'var(--amber)', bg: 'rgba(217,119,6,0.1)', border: 'rgba(217,119,6,0.3)' },
  syllabus: { label: 'Syllabus', color: 'var(--text2)', bg: 'var(--bg3)', border: 'var(--border)' }
}

export default function MockPaper() {
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [subjectPapers, setSubjectPapers] = useState([])
  const [loadingPapers, setLoadingPapers] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [customInstructions, setCustomInstructions] = useState('')
  const [viewingPaper, setViewingPaper] = useState(null)
  const [showAnswers, setShowAnswers] = useState({})
  const [confirmReplace, setConfirmReplace] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [slotsExhausted, setSlotsExhausted] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    getToken().then(token => fetchSubjects(token))
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    clearInterval(pollRef.current)
    if (selectedSubjectId) loadSubjectPapers()
  }, [selectedSubjectId])

  // Poll if any paper is generating — with 2-minute timeout
  useEffect(() => {
    const generatingPapers = subjectPapers.filter(p => p.status === 'generating')
    clearInterval(pollRef.current)
    if (generatingPapers.length > 0) {
      // Auto-mark as failed if generating for more than 2 minutes
      const now = Date.now()
      generatingPapers.forEach(p => {
        const age = now - new Date(p.generatedAt).getTime()
        if (age > 120000) {
          cancelGenerating(p.id)
        }
      })

      pollRef.current = setInterval(async () => {
        const token = await getToken()
        const res = await fetch(`/api/papers?subjectId=${selectedSubjectId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setSubjectPapers(data.papers || [])
        }
      }, 4000)
    }
    return () => clearInterval(pollRef.current)
  }, [subjectPapers, selectedSubjectId])

  const selectedSubject = subjects.find(s => s.id === selectedSubjectId)
  const isCompetitive = selectedSubject && COMPETITIVE_EXAMS.includes(selectedSubject.examBoard?.toUpperCase())
  const generatingSlots = subjectPapers.filter(p => p.status === 'generating').map(p => p.slotNumber)

  async function loadSubjectPapers() {
    setLoadingPapers(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/papers?subjectId=${selectedSubjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSubjectPapers(data.papers || [])
      }
    } finally {
      setLoadingPapers(false)
    }
  }

  async function generate(replaceSlot = null, forceNew = false) {
    setSubmitting(true)
    setError(null)
    setSlotsExhausted(false)
    setConfirmReplace(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/generate-mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subjectId: selectedSubjectId, customInstructions, forceNew, replaceSlot })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start generation')
      if (data.slotsExhausted) { setSlotsExhausted(true); return }
      // Reload to show the placeholder
      await loadSubjectPapers()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function deletePaper(paperId) {
    setDeletingId(paperId)
    try {
      const token = await getToken()
      await fetch(`/api/papers?subjectId=${selectedSubjectId}&paperId=${paperId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      })
      await loadSubjectPapers()
    } finally { setDeletingId(null) }
  }

  async function cancelGenerating(paperId) {
    try {
      const token = await getToken()
      await fetch(`/api/cancel-mock?subjectId=${selectedSubjectId}&paperId=${paperId}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      })
      await loadSubjectPapers()
    } catch (e) { console.error('cancel error:', e) }
  }

  function toggleAnswer(sIdx, qIdx) {
    const key = `${sIdx}-${qIdx}`
    setShowAnswers(a => ({ ...a, [key]: !a[key] }))
  }

  const sel = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', appearance: 'none' }

  // Paper viewer
  if (viewingPaper) {
    const { paper, sourceType, slotNumber, topicsCovered } = viewingPaper
    const src = SOURCE_LABELS[sourceType] || SOURCE_LABELS.syllabus
    return (
      <div style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
          <button onClick={() => { setViewingPaper(null); setShowAnswers({}) }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: src.bg, color: src.color, border: `1px solid ${src.border}` }}>{src.label}</span>
            {topicsCovered?.length > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Covers: {topicsCovered.slice(0, 4).join(' · ')}{topicsCovered.length > 4 ? ` +${topicsCovered.length - 4}` : ''}</span>}
          </div>
          <button onClick={() => window.print()} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>Print</button>
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 28px', marginBottom: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{paper.examBoard} — Mock Paper {slotNumber}</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>{paper.title}</h2>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 28, fontSize: 13, color: 'var(--text2)' }}>
              <span>Total marks: <strong style={{ color: 'var(--text)' }}>{paper.totalMarks}</strong></span>
              <span>Time: <strong style={{ color: 'var(--text)' }}>{paper.timeAllowed}</strong></span>
              <span>Sections: <strong style={{ color: 'var(--text)' }}>{paper.sections?.length}</strong></span>
            </div>
          </div>
          <div style={{ background: 'var(--bg3)', padding: '10px 14px', borderLeft: '3px solid var(--teal)', fontSize: 12, color: 'var(--text2)' }}>
            <strong>Instructions:</strong> {paper.instructions}
          </div>
        </div>

        {(paper.sections || []).map((section, sIdx) => (
          <div key={sIdx} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{section.name}</h3>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{section.instructions}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal2)', background: 'var(--teal-bg)', padding: '5px 14px', borderRadius: 20, border: '1px solid var(--teal-border)', whiteSpace: 'nowrap' }}>{section.marks} marks</div>
            </div>

            {(section.questions || []).map((q, qIdx) => (
              <div key={qIdx} style={{ paddingBottom: 18, marginBottom: 18, borderBottom: qIdx < section.questions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', gap: 14 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text2)', flexShrink: 0, marginTop: 2 }}>{q.number}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.7, marginBottom: 10 }}>{q.question}</div>
                    {q.options && <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>{q.options.map((opt, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', padding: '5px 10px', borderRadius: 6, background: 'var(--bg3)' }}>{opt}</div>)}</div>}
                    {q.type !== 'mcq' && <div style={{ border: '1px dashed var(--border2)', borderRadius: 8, padding: 12, marginBottom: 8, minHeight: q.type === 'extended' ? 100 : 44, background: 'var(--bg3)', color: 'var(--text3)', fontSize: 12 }}>{q.type === 'extended' ? 'Write your answer here...' : 'Answer:'}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 9px', borderRadius: 10, border: '1px solid var(--border)' }}>{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
                        {q.topic && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{q.topic}</span>}
                      </div>
                      <button onClick={() => toggleAnswer(sIdx, qIdx)} style={{ fontSize: 12, color: 'var(--teal2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        {showAnswers[`${sIdx}-${qIdx}`] ? 'Hide answer ↑' : 'Show answer ↓'}
                      </button>
                    </div>
                    {showAnswers[`${sIdx}-${qIdx}`] && (
                      <div style={{ marginTop: 10, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', borderRadius: 8, padding: '12px 16px' }}>
                        {q.answer && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal2)', marginBottom: q.markingCriteria ? 6 : 0 }}>Answer: {q.answer}</div>}
                        {q.markingCriteria && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}><strong>Marking criteria:</strong> {q.markingCriteria}</div>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
      `}</style>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Mock paper generator</h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>Up to 5 papers per subject · Paper memory avoids repeating questions · Papers generate in the background</p>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Select subject</label>
            <select value={selectedSubjectId} onChange={e => { setSelectedSubjectId(e.target.value); setError(null); setSlotsExhausted(false) }} style={sel}>
              <option value="">Choose a subject...</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name} — {s.examBoard} Year {s.yearLevel}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Custom focus (optional)</label>
            <input type="text" value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder="e.g. Focus on calculus, harder questions..." style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13 }} />
          </div>
        </div>
        {selectedSubject && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>{selectedSubject.state} · {selectedSubject.examBoard} · Year {selectedSubject.yearLevel}</span>
            {isCompetitive && <span style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.1)', padding: '2px 10px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.2)' }}>Competitive exam preset</span>}
          </div>
        )}
      </div>

      {selectedSubjectId && (
        <>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Mock papers — {subjectPapers.filter(p => p.status === 'ready').length}/5 ready
              {generatingSlots.length > 0 && <span style={{ color: 'var(--teal2)', marginLeft: 8, animation: 'pulse 1.5s infinite' }}>· Generating {generatingSlots.map(s => `Mock ${s}`).join(', ')}...</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[1,2,3,4,5].map(slot => {
                const paper = subjectPapers.find(p => p.slotNumber === slot)
                const isEmpty = !paper
                const isGenerating = paper?.status === 'generating'
                const isFailed = paper?.status === 'failed'
                const isReady = paper?.status === 'ready'

                return (
                  <div key={slot} style={{
                    background: isEmpty ? 'var(--bg3)' : 'var(--bg2)',
                    border: `1px solid ${isGenerating ? 'var(--teal-border)' : isEmpty ? 'var(--border)' : 'var(--border2)'}`,
                    borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: isEmpty ? 'var(--text3)' : 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mock {slot}</span>
                      {isReady && <button onClick={() => deletePaper(paper.id)} disabled={deletingId === paper.id} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>}
                    </div>

                    {isEmpty && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Empty slot</div>
                        {!submitting && subjectPapers.filter(p => p.status !== 'failed').length === slot - 1 && (
                          <button onClick={() => generate()} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer' }}>+ Generate</button>
                        )}
                      </div>
                    )}

                    {isGenerating && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, border: '2px solid var(--teal-border)', borderTopColor: 'var(--teal2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                        <div style={{ fontSize: 11, color: 'var(--teal2)', textAlign: 'center', animation: 'pulse 1.5s infinite' }}>Generating...</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>Usually 20-40s</div>
                        <button
                          onClick={() => cancelGenerating(paper.id)}
                          style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', cursor: 'pointer', marginTop: 4 }}
                        >Cancel</button>
                      </div>
                    )}

                    {isFailed && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center' }}>Failed</div>
                        <button onClick={() => generate(slot)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,0.3)', color: 'var(--red)', cursor: 'pointer' }}>Retry</button>
                      </div>
                    )}

                    {isReady && (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {new Date(paper.generatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </div>
                        {paper.topicsCovered?.length > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
                            {paper.topicsCovered.slice(0, 3).join(' · ')}{paper.topicsCovered.length > 3 ? ` +${paper.topicsCovered.length - 3}` : ''}
                          </div>
                        )}
                        {(() => { const s = SOURCE_LABELS[paper.sourceType] || SOURCE_LABELS.syllabus; return (
                          <div style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, display: 'inline-block', alignSelf: 'flex-start', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</div>
                        )})()}
                        <div style={{ display: 'flex', gap: 5, marginTop: 'auto' }}>
                          <button onClick={() => setViewingPaper({ ...paper, subjectName: selectedSubject?.name })} style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 7, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer' }}>View</button>
                          <button onClick={() => setConfirmReplace(slot)} disabled={submitting} style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Redo</button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {confirmReplace !== null && (
            <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, color: '#d97706' }}>Replace Mock {confirmReplace}? A new paper will be generated in the background.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmReplace(null)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => generate(confirmReplace)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, background: '#d97706', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Regenerate Mock {confirmReplace}</button>
              </div>
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-bg)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}

          {subjectPapers.filter(p => p.status !== 'failed').length < 5 && !slotsExhausted && (
            <button onClick={() => generate()} disabled={submitting || generatingSlots.length > 0} style={{
              padding: '13px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: (submitting || generatingSlots.length > 0) ? 'var(--bg3)' : 'var(--teal)',
              border: 'none', color: (submitting || generatingSlots.length > 0) ? 'var(--text2)' : '#fff',
              cursor: (submitting || generatingSlots.length > 0) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16
            }}>
              {submitting ? (
                <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--text2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />Starting...</>
              ) : generatingSlots.length > 0 ? (
                <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--teal-border)', borderTopColor: 'var(--teal2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />Generating in background...</>
              ) : `Generate Mock ${subjectPapers.filter(p => p.status !== 'failed').length + 1}`}
            </button>
          )}

          {(slotsExhausted || subjectPapers.filter(p => p.status === 'ready').length >= 5) && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>All 5 papers generated</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Use <strong>Redo</strong> to regenerate any paper — paper memory ensures fresh questions.</div>
            </div>
          )}

          {subjectPapers.filter(p => p.topicsCovered?.length > 0).length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 10 }}>Topics covered across all papers</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[...new Set(subjectPapers.flatMap(p => p.topicsCovered || []))].map(topic => (
                  <span key={topic} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)' }}>{topic}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!selectedSubjectId && (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: 'var(--bg2)', borderRadius: 14, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 6 }}>Select a subject to get started</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Supports all AU curriculum subjects + UCAT, GAMSAT, IELTS, AMC, Selective School</div>
        </div>
      )}
    </div>
  )
}
