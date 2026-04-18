import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

const COMPETITIVE_EXAMS = ['UCAT','GAMSAT','IELTS','SELECTIVE','AMC','OC']
const SOURCE_LABELS = {
  docs: { label: 'From your notes', color: 'var(--teal2)', bg: 'var(--teal-bg)', border: 'var(--teal-border)' },
  'past-paper': { label: 'From past papers', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', border: 'rgba(124,58,237,0.2)' },
  syllabus: { label: 'Syllabus', color: 'var(--text2)', bg: 'var(--bg3)', border: 'var(--border)' }
}

export default function MockPaper() {
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [subjectPapers, setSubjectPapers] = useState([])
  const [loadingPapers, setLoadingPapers] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [customInstructions, setCustomInstructions] = useState('')
  const [viewingPaper, setViewingPaper] = useState(null)
  const [showAnswers, setShowAnswers] = useState({})
  const [confirmReplace, setConfirmReplace] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [slotsExhausted, setSlotsExhausted] = useState(false)

  useEffect(() => {
    getToken().then(token => fetchSubjects(token))
  }, [])

  useEffect(() => {
    if (selectedSubjectId) loadSubjectPapers()
    setError(null)
    setSlotsExhausted(false)
  }, [selectedSubjectId])

  const selectedSubject = subjects.find(s => s.id === selectedSubjectId)
  const isCompetitive = selectedSubject && COMPETITIVE_EXAMS.includes(selectedSubject.examBoard?.toUpperCase())
  const readyPapers = subjectPapers.filter(p => p.status === 'ready')

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
    } finally { setLoadingPapers(false) }
  }

  async function generate(replaceSlot = null, forceNew = false) {
    setGenerating(true)
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
      if (!res.ok) throw new Error(data.error || 'Failed to generate')
      if (data.slotsExhausted) { setSlotsExhausted(true); return }
      await loadSubjectPapers()
      if (data.paper) {
        setViewingPaper({ paper: data.paper, sourceType: data.sourceType, slotNumber: data.slotNumber, topicsCovered: data.topicsCovered, subjectName: selectedSubject?.name })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
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

  function toggleAnswer(sIdx, qIdx) {
    setShowAnswers(a => ({ ...a, [`${sIdx}-${qIdx}`]: !a[`${sIdx}-${qIdx}`] }))
  }

  const sel = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', appearance: 'none' }

  if (viewingPaper) {
    const { paper, sourceType, slotNumber, topicsCovered } = viewingPaper
    const src = SOURCE_LABELS[sourceType] || SOURCE_LABELS.syllabus
    return (
      <div style={{ maxWidth: 860 }}>
        <style>{`@media print{.no-print{display:none!important}}`}</style>
        <div className="no-print" style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
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
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Mock paper generator</h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>Up to 5 papers per subject · Paper memory avoids repeating questions · Supports competitive exams</p>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Select subject</label>
            <select value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)} style={sel}>
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
              Mock papers — {readyPapers.length}/5 ready
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[1,2,3,4,5].map(slot => {
                const paper = readyPapers.find(p => p.slotNumber === slot)
                const isEmpty = !paper

                return (
                  <div key={slot} style={{
                    background: isEmpty ? 'var(--bg3)' : 'var(--bg2)',
                    border: `1px solid ${isEmpty ? 'var(--border)' : 'var(--border2)'}`,
                    borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: isEmpty ? 'var(--text3)' : 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mock {slot}</span>
                      {!isEmpty && <button onClick={() => deletePaper(paper.id)} disabled={deletingId === paper.id} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>}
                    </div>

                    {isEmpty ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Empty slot</div>
                        {!generating && readyPapers.length === slot - 1 && (
                          <button onClick={() => generate()} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer' }}>+ Generate</button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {new Date(paper.generatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </div>
                        {paper.topicsCovered?.length > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
                            {paper.topicsCovered.slice(0, 3).join(' · ')}{paper.topicsCovered.length > 3 ? ` +${paper.topicsCovered.length - 3}` : ''}
                          </div>
                        )}
                        {(() => { const s = SOURCE_LABELS[paper.sourceType] || SOURCE_LABELS.syllabus; return <div style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, display: 'inline-block', alignSelf: 'flex-start', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</div> })()}
                        <div style={{ display: 'flex', gap: 5, marginTop: 'auto' }}>
                          <button onClick={() => setViewingPaper({ ...paper, subjectName: selectedSubject?.name })} style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 7, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer' }}>View</button>
                          <button onClick={() => setConfirmReplace(slot)} disabled={generating} style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Redo</button>
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
              <div style={{ fontSize: 13, color: '#d97706' }}>Replace Mock {confirmReplace}? This cannot be undone.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmReplace(null)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => generate(confirmReplace)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, background: '#d97706', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Regenerate Mock {confirmReplace}</button>
              </div>
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-bg)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}

          {readyPapers.length < 5 && !slotsExhausted && (
            <button onClick={() => generate()} disabled={generating}
              style={{
                padding: '13px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: generating ? 'var(--bg3)' : 'var(--teal)',
                border: 'none', color: generating ? 'var(--text2)' : '#fff',
                cursor: generating ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, transition: 'all .15s'
              }}>
              {generating ? (
                <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--text2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />Writing your exam paper...</>
              ) : `Generate Mock ${readyPapers.length + 1}`}
            </button>
          )}

          {(slotsExhausted || readyPapers.length >= 5) && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>All 5 papers generated</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Use <strong>Redo</strong> on any slot — paper memory ensures fresh questions each time.</div>
            </div>
          )}

          {readyPapers.length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 10 }}>Topics covered across all papers</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[...new Set(readyPapers.flatMap(p => p.topicsCovered || []))].map(topic => (
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
