import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

const SOURCE_LABELS = {
  docs: { label: 'From your notes', color: 'var(--teal2)', bg: 'var(--teal-bg)', border: 'var(--teal-border)' },
  'past-paper': { label: 'From past papers', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', border: 'rgba(124,58,237,0.2)' },
  syllabus: { label: 'Syllabus', color: 'var(--text2)', bg: 'var(--bg3)', border: 'var(--border)' }
}

const STATUS_CONFIG = {
  queued:     { label: 'Queued',      sublabel: 'Starting soon...',      color: '#d97706', spin: false, pulse: true  },
  generating: { label: 'Generating',  sublabel: 'Writing your paper...', color: 'var(--teal2)', spin: true,  pulse: false },
  failed:     { label: 'Failed',      sublabel: 'Tap to retry',          color: 'var(--red)', spin: false, pulse: false },
  ready: null
}

function renderQuestionText(text, diagrams) {
  if (!text) return null
  const parts = []
  let remaining = text

  while (remaining.length > 0) {
    const svgStart  = remaining.indexOf('[SVG:')
    const refMatch  = remaining.match(/\[DIAGRAM_REF:(\d+)\]/)
    const diagStart = remaining.indexOf('[DIAGRAM:')
    const boldMatch = remaining.match(/\*\*Diagram:\*\*\s*([^\n]+)/)

    const candidates = [
      svgStart >= 0  ? { type: 'svg',  pos: svgStart }                          : null,
      refMatch       ? { type: 'ref',  pos: refMatch.index,  match: refMatch }   : null,
      diagStart >= 0 ? { type: 'diag', pos: diagStart }                          : null,
      boldMatch      ? { type: 'bold', pos: boldMatch.index, match: boldMatch }  : null,
    ].filter(Boolean)

    if (candidates.length === 0) { parts.push(<span key={parts.length}>{remaining}</span>); break }
    candidates.sort((a, b) => a.pos - b.pos)
    const first = candidates[0]
    if (first.pos > 0) parts.push(<span key={parts.length}>{remaining.slice(0, first.pos)}</span>)

    if (first.type === 'svg') {
      const svgEnd = remaining.indexOf(']', svgStart + 5)
      if (svgEnd === -1) { parts.push(<span key={parts.length}>{remaining}</span>); break }
      parts.push(<div key={parts.length} style={{ margin: '12px 0', padding: '16px', background: 'white', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}><div dangerouslySetInnerHTML={{ __html: remaining.slice(svgStart + 5, svgEnd) }} /></div>)
      remaining = remaining.slice(svgEnd + 1)

    } else if (first.type === 'ref') {
      const diagram = diagrams?.find(d => d.id === parseInt(first.match[1]))
      if (diagram?.svg) parts.push(<div key={parts.length} style={{ margin: '12px 0', padding: '16px', background: 'white', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}><div dangerouslySetInnerHTML={{ __html: diagram.svg }} /></div>)
      else if (diagram?.description) parts.push(<DiagramPlaceholder key={parts.length} desc={diagram.description} />)
      remaining = remaining.slice(first.match.index + first.match[0].length)

    } else if (first.type === 'diag') {
      const dEnd = remaining.indexOf(']', diagStart + 9)
      if (dEnd === -1) { parts.push(<span key={parts.length}>{remaining}</span>); break }
      parts.push(<DiagramPlaceholder key={parts.length} desc={remaining.slice(diagStart + 9, dEnd).trim()} />)
      remaining = remaining.slice(dEnd + 1)

    } else if (first.type === 'bold') {
      parts.push(<DiagramPlaceholder key={parts.length} desc={first.match[1].trim()} />)
      remaining = remaining.slice(first.match.index + first.match[0].length)
    }
  }
  return parts.length > 0 ? parts : text
}

function DiagramPlaceholder({ desc }) {
  return (
    <div style={{ margin: '10px 0', padding: '12px 16px', background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 16 }}>📐</span>
      <div><strong style={{ fontStyle: 'normal', color: 'var(--text)', display: 'block', marginBottom: 2 }}>Diagram:</strong>{desc}</div>
    </div>
  )
}

export default function MockPaper() {
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [subjectPapers, setSubjectPapers]   = useState([])
  const [loadingPapers, setLoadingPapers]   = useState(false)
  const [submitting, setSubmitting]         = useState(false)
  const [error, setError]                   = useState(null)
  const [customInstructions, setCustomInstructions] = useState('')
  const [viewingPaper, setViewingPaper]     = useState(null)
  const [showAnswers, setShowAnswers]       = useState({})
  const [confirmReplace, setConfirmReplace] = useState(null)
  const [deletingId, setDeletingId]         = useState(null)
  const [slotsExhausted, setSlotsExhausted] = useState(false)
  const [subjectDocs, setSubjectDocs]       = useState([])
  const [targetUnit, setTargetUnit]         = useState('')
  const [unitConfirmed, setUnitConfirmed]   = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    getToken().then(token => fetchSubjects(token))
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    clearInterval(pollRef.current)
    if (selectedSubjectId) { loadSubjectPapers(); loadSubjectDocs() }
    setError(null); setSlotsExhausted(false); setTargetUnit(''); setUnitConfirmed(false)
  }, [selectedSubjectId])

  useEffect(() => {
    const pending = subjectPapers.filter(p => p.status === 'queued' || p.status === 'generating')
    clearInterval(pollRef.current)
    if (pending.length > 0) {
      pollRef.current = setInterval(async () => {
        const token = await getToken()
        const res = await fetch(`/api/papers?subjectId=${selectedSubjectId}`, { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) { const data = await res.json(); setSubjectPapers(data.papers || []) }
      }, 8000)
    }
    return () => clearInterval(pollRef.current)
  }, [subjectPapers, selectedSubjectId])

  async function loadSubjectPapers() {
    setLoadingPapers(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/papers?subjectId=${selectedSubjectId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) { const data = await res.json(); setSubjectPapers(data.papers || []) }
    } finally { setLoadingPapers(false) }
  }

  async function loadSubjectDocs() {
    try {
      const token = await getToken()
      const res = await fetch(`/api/docs?subjectId=${selectedSubjectId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) { const data = await res.json(); setSubjectDocs(data.docs || []) }
    } catch {}
  }

  const availableUnits = [...new Set(subjectDocs.filter(d => d.docType === 'past-paper' && d.unit).map(d => d.unit))].sort()
  const hasUnitTaggedPapers = availableUnits.length > 0
  const needsUnitConfirmation = selectedSubjectId && hasUnitTaggedPapers && !unitConfirmed

  async function generate(replaceSlot = null, forceNew = false) {
    setSubmitting(true); setError(null); setSlotsExhausted(false); setConfirmReplace(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/generate-mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subjectId: selectedSubjectId, customInstructions, forceNew, replaceSlot, targetUnit: targetUnit || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to queue paper')
      if (data.slotsExhausted) { setSlotsExhausted(true); return }
      await loadSubjectPapers()
    } catch (e) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  async function deletePaper(paperId) {
    setDeletingId(paperId)
    try {
      const token = await getToken()
      await fetch(`/api/papers?subjectId=${selectedSubjectId}&paperId=${paperId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      await loadSubjectPapers()
    } finally { setDeletingId(null) }
  }

  function toggleAnswer(sIdx, qIdx) { setShowAnswers(a => ({ ...a, [`${sIdx}-${qIdx}`]: !a[`${sIdx}-${qIdx}`] })) }

  const sel = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', appearance: 'none' }

  // ── Paper viewer ─────────────────────────────────────────────────────────────
  if (viewingPaper) {
    const { paper, sourceType, slotNumber, topicsCovered } = viewingPaper
    const src = SOURCE_LABELS[sourceType] || SOURCE_LABELS.syllabus
    return (
      <div style={{ maxWidth: 900 }}>
        <style>{`@media print{.no-print{display:none!important}}`}</style>
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
          <button onClick={() => setViewingPaper(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: src.bg, color: src.color, border: `1px solid ${src.border}` }}>{src.label}</span>
            {paper.targetUnit && <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'var(--teal-bg)', color: 'var(--teal2)', border: '1px solid var(--teal-border)' }}>📚 {paper.targetUnit}</span>}
            {topicsCovered?.length > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{topicsCovered.slice(0, 5).join(' · ')}{topicsCovered.length > 5 ? ` +${topicsCovered.length - 5}` : ''}</span>}
          </div>
          <button onClick={() => window.print()} className="no-print" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>Print</button>
        </div>

        {/* Cover page */}
        <div style={{ background: 'var(--bg2)', border: '2px solid var(--border)', borderRadius: 14, padding: '36px 40px', marginBottom: 16 }}>
          <div style={{ textAlign: 'center', borderBottom: '3px double var(--border)', paddingBottom: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>Australian Capital Territory</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', marginBottom: 4 }}>{paper.coverPage?.school || 'Student Mastery'}</div>
          </div>
          <div style={{ width: 60, height: 3, background: 'var(--teal)', margin: '10px auto', borderRadius: 2 }} />
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginTop: 10 }}>{paper.subject} — Year {paper.yearLevel}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>{paper.examBoard} Mock Examination — Paper {slotNumber}</div>
          {paper.targetUnit && <div style={{ fontSize: 12, color: 'var(--teal2)', marginTop: 4, fontWeight: 600 }}>Scope: {paper.targetUnit}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '20px 0' }}>
            {[{ label: 'Total marks', value: paper.totalMarks }, { label: 'Time allowed', value: paper.timeAllowed }, { label: 'Permitted materials', value: paper.allowedMaterials || 'Scientific calculator, ruler' }].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {['Full name', 'Teacher', 'Class / Line', 'Date'].map(field => (
                <div key={field}><div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{field}</div><div style={{ borderBottom: '1px solid var(--border)', height: 28 }} /></div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '16px 20px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Instructions to candidates</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(paper.coverPage?.instructions || ['Write in black or blue pen', 'Scientific calculator permitted', 'Show all working for full marks', 'Marks are awarded for correct working, not just final answers']).map((inst, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{inst}</li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(paper.sections || []).map((s, i) => (
              <div key={i} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)' }}>{s.name} — {s.marks} marks</div>
            ))}
          </div>
        </div>

        {/* Sections */}
        {(paper.sections || []).map((section, sIdx) => (
          <div key={sIdx} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 28px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 14, borderBottom: '2px solid var(--border)' }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{section.name}</h2>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{section.instructions}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal2)', background: 'var(--teal-bg)', padding: '6px 16px', borderRadius: 20, border: '1px solid var(--teal-border)', whiteSpace: 'nowrap' }}>{section.marks} marks</div>
            </div>

            {(section.questions || []).map((q, qIdx) => (
              <div key={qIdx} style={{ paddingBottom: 24, marginBottom: 24, borderBottom: qIdx < section.questions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text2)', flexShrink: 0, marginTop: 2 }}>{q.number}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>{renderQuestionText(q.question, paper.diagrams)}</div>

                    {q.parts && q.parts.map((part, pIdx) => (
                      <div key={pIdx} style={{ marginLeft: 16, marginBottom: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>
                          <strong>{String.fromCharCode(97 + pIdx)})</strong>{' '}{renderQuestionText(part.question, paper.diagrams)}
                          <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>[{part.marks} {part.marks !== 1 ? 's' : ''}]</span>
                        </div>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 6, height: part.marks > 2 ? 80 : 44, background: 'var(--bg3)', marginBottom: 4 }} />
                      </div>
                    ))}

                    {q.options && !q.parts && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                        {q.options.map((opt, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text)', padding: '8px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' }}>{opt}</div>)}
                      </div>
                    )}

                    {q.type !== 'mcq' && !q.parts && <div style={{ border: '1px solid var(--border)', borderRadius: 8, height: q.type === 'extended' ? 120 : 60, background: 'var(--bg3)', marginBottom: 8 }} />}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 10px', borderRadius: 10, border: '1px solid var(--border)' }}>{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
                        {q.topic && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{q.topic}</span>}
                      </div>
                      <button onClick={() => toggleAnswer(sIdx, qIdx)} style={{ fontSize: 12, color: 'var(--teal2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        {showAnswers[`${sIdx}-${qIdx}`] ? 'Hide answer ↑' : 'Show answer ↓'}
                      </button>
                    </div>

                    {showAnswers[`${sIdx}-${qIdx}`] && (
                      <div style={{ marginTop: 10, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', borderRadius: 10, padding: '14px 18px' }}>
                        {q.answer && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal2)', marginBottom: 6 }}>Answer: {q.answer}</div>}
                        {q.workingOut && <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.8, marginBottom: 6, fontFamily: 'monospace', background: 'var(--bg3)', padding: '8px 12px', borderRadius: 6 }}>{q.workingOut}</div>}
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

  // ── Paper list view ───────────────────────────────────────────────────────────
  const readyPapers   = subjectPapers.filter(p => p.status === 'ready')
  const pendingPapers = subjectPapers.filter(p => p.status === 'queued' || p.status === 'generating')
  const selectedSubject = subjects.find(s => s.id === selectedSubjectId)

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
      <div style={{ marginBottom: 24 }}><h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Mock paper generator</h1></div>

      {/* Subject + custom instructions */}
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
            <input type="text" value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder="e.g. More quantum physics, harder extended response..." style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13 }} />
          </div>
        </div>
        {selectedSubject && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)', display: 'flex', gap: 12 }}>
            <span>{selectedSubject.state} · {selectedSubject.examBoard} · Year {selectedSubject.yearLevel}</span>
            {selectedSubject.extractedFormat && <span style={{ color: 'var(--teal2)' }}>✓ Format extracted from past papers</span>}
          </div>
        )}
      </div>

      {/* ── Unit scoping step ── only shows when past papers have unit tags */}
      {needsUnitConfirmation && (
        <div style={{ background: 'var(--bg2)', border: '2px solid var(--teal-border)', borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>📚 Which unit is this mock for?</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
            Your past papers are tagged by unit. Choose a unit to scope the mock — questions will only draw from that unit's content, not the whole course.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {availableUnits.map(u => {
              const docCount = subjectDocs.filter(d => d.unit === u).length
              return (
                <button key={u} onClick={() => setTargetUnit(u)} style={{ padding: '10px 20px', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontWeight: 600, background: targetUnit === u ? 'var(--teal)' : 'var(--bg3)', color: targetUnit === u ? '#fff' : 'var(--text)', border: targetUnit === u ? 'none' : '1px solid var(--border)' }}>
                  {u} <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>({docCount} doc{docCount !== 1 ? 's' : ''})</span>
                </button>
              )
            })}
            <button onClick={() => { setTargetUnit(''); setUnitConfirmed(true) }} style={{ padding: '10px 20px', borderRadius: 10, fontSize: 13, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)' }}>
              All units (whole course)
            </button>
          </div>

          {targetUnit && (
            <div style={{ background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', borderRadius: 10, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: 'var(--teal2)' }}>
              ✓ Mock will be scoped to <strong>{targetUnit}</strong> — using {subjectDocs.filter(d => d.unit === targetUnit).length} document{subjectDocs.filter(d => d.unit === targetUnit).length !== 1 ? 's' : ''} for that unit only.
            </div>
          )}

          <button onClick={() => setUnitConfirmed(true)} style={{ padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: 'var(--teal)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {targetUnit ? `Confirm — scope to ${targetUnit}` : 'Continue with all units'}
          </button>
        </div>
      )}

      {/* Active unit badge */}
      {unitConfirmed && targetUnit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--teal2)', fontWeight: 600 }}>📚 Scoped to: {targetUnit}</span>
          <button onClick={() => { setUnitConfirmed(false); setTargetUnit('') }} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>Change unit</button>
        </div>
      )}

      {selectedSubjectId && (unitConfirmed || !hasUnitTaggedPapers) && (
        <>
          {pendingPapers.length > 0 && (
            <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#d97706', marginBottom: 4 }}>{pendingPapers.map(p => `Mock ${p.slotNumber}`).join(', ')} {pendingPapers.length === 1 ? 'is' : 'are'} being generated</div>
              <div style={{ fontSize: 12, color: '#92400e' }}>Full exam papers take 2-5 minutes. Come back shortly — the slot will show "View" when ready.</div>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Mock papers — {readyPapers.length}/5 ready{pendingPapers.length > 0 && <span style={{ color: '#d97706', marginLeft: 8 }}>· {pendingPapers.length} generating</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[1,2,3,4,5].map(slot => {
                const paper    = subjectPapers.find(p => p.slotNumber === slot)
                const isEmpty  = !paper
                const status   = paper?.status
                const statusCfg = status ? STATUS_CONFIG[status] : null
                const isReady  = status === 'ready'
                const isPending = status === 'queued' || status === 'generating'
                const isFailed = status === 'failed'
                return (
                  <div key={slot} style={{ background: isEmpty ? 'var(--bg3)' : 'var(--bg2)', border: `1px solid ${isPending ? 'rgba(217,119,6,0.4)' : isEmpty ? 'var(--border)' : 'var(--border2)'}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: isPending ? '#d97706' : isEmpty ? 'var(--text3)' : 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mock {slot}</span>
                    {isEmpty && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Empty slot</div>}
                    {isEmpty && !submitting && readyPapers.length + pendingPapers.length === slot - 1 && (
                      <button onClick={() => generate()} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer' }}>+ Generate</button>
                    )}
                    {isPending && statusCfg && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        {statusCfg.spin ? <div style={{ width: 22, height: 22, border: '2px solid var(--teal-border)', borderTopColor: 'var(--teal2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} /> : <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#d97706', animation: 'pulse 1.5s infinite' }} />}
                        <div style={{ fontSize: 11, fontWeight: 600, color: statusCfg.color, textAlign: 'center' }}>{statusCfg.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>{statusCfg.sublabel}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>2-5 minutes</div>
                      </div>
                    )}
                    {isFailed && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center' }}>Generation failed</div>
                        <button onClick={() => deletePaper(paper.id).then(() => generate(slot))} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,0.3)', color: 'var(--red)', cursor: 'pointer' }}>Retry</button>
                      </div>
                    )}
                    {isReady && (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(paper.completedAt || paper.generatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                        {paper.targetUnit && <div style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--teal-bg)', color: 'var(--teal2)', border: '1px solid var(--teal-border)', display: 'inline-block', alignSelf: 'flex-start' }}>{paper.targetUnit}</div>}
                        {paper.topicsCovered?.length > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>{paper.topicsCovered.slice(0, 3).join(' · ')}{paper.topicsCovered.length > 3 ? ` +${paper.topicsCovered.length - 3}` : ''}</div>}
                        {(() => { const s = SOURCE_LABELS[paper.sourceType] || SOURCE_LABELS.syllabus; return <div style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, display: 'inline-block', alignSelf: 'flex-start', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</div> })()}
                        <div style={{ display: 'flex', gap: 5, marginTop: 'auto' }}>
                          <button onClick={() => setViewingPaper({ ...paper, subjectName: selectedSubject?.name })} style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 7, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer' }}>View</button>
                          <button onClick={() => setConfirmReplace(slot)} disabled={submitting} style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Redo</button>
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

          {readyPapers.length + pendingPapers.length < 5 && !slotsExhausted && (
            <button onClick={() => generate()} disabled={submitting} style={{ padding: '13px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: submitting ? 'var(--bg3)' : 'var(--teal)', border: 'none', color: submitting ? 'var(--text2)' : '#fff', cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              {submitting ? <><svg style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--text2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />Queuing...</> : `Generate Mock ${readyPapers.length + pendingPapers.length + 1}${targetUnit ? ` — ${targetUnit}` : ''}`}
            </button>
          )}

          {(slotsExhausted || readyPapers.length + pendingPapers.length >= 5) && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>All 5 papers generated</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Use <strong>Redo</strong> to regenerate any slot — paper memory ensures fresh questions.</div>
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
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Full exam papers · BSSS, NESA, VCAA formats · UCAT, GAMSAT, IELTS and more</div>
        </div>
      )}
    </div>
  )
}
