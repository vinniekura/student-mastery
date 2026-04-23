// src/pages/MockPaper.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSubjectsStore } from '../store/subjects'

// ── Helpers ────────────────────────────────────────────────────────────────────

function SectionBadge({ type }) {
  const t = (type || '').toLowerCase()
  const color = t.includes('multiple') || t.includes('mcq') ? 'bg-teal-900 text-teal-300' :
    t.includes('extended') || t.includes('essay') ? 'bg-purple-900 text-purple-300' :
    'bg-blue-900 text-blue-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{type}</span>
}

function CoverageBar({ coverage }) {
  if (!coverage) return null
  const pct = coverage.percentage || 0
  const color = pct >= 80 ? 'bg-teal-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="mt-4 p-4 bg-slate-800 rounded-xl">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-slate-300 font-medium">Topic Coverage</span>
        <span className={`text-sm font-bold ${pct >= 80 ? 'text-teal-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>{pct}%</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-400 mt-1">{coverage.covered}/{coverage.total} topics covered</p>
      {coverage.uncoveredTopics && coverage.uncoveredTopics.length > 0 && (
        <p className="text-xs text-slate-500 mt-1">Missing: {coverage.uncoveredTopics.slice(0, 4).join(', ')}{coverage.uncoveredTopics.length > 4 ? '…' : ''}</p>
      )}
    </div>
  )
}

// ── Human Feedback Card ────────────────────────────────────────────────────────

function FeedbackCard({ feedback, scope, onConfirm, onEdit }) {
  const [editing, setEditing] = useState(false)
  const [editedScope, setEditedScope] = useState(scope)

  if (!feedback) return null

  const lines = feedback.split('\n\n').filter(Boolean)

  return (
    <div className="bg-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-sm">🔍</div>
        <h3 className="text-white font-semibold">Document Analysis</h3>
      </div>

      {/* Human-readable feedback */}
      <div className="space-y-2">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-slate-300 leading-relaxed" dangerouslySetInnerHTML={{
            __html: line.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>')
          }} />
        ))}
      </div>

      {/* Format preview */}
      {scope?.sections && scope.sections.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Detected Format</p>
          <div className="space-y-2">
            {scope.sections.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-700 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <SectionBadge type={s.type} />
                  <span className="text-sm text-white">{s.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-teal-400">{s.questionCount} questions</span>
                  <span className="text-xs text-slate-400 ml-2">({s.totalMarks} marks)</span>
                </div>
              </div>
            ))}
          </div>
          {scope.duration && (
            <p className="text-xs text-slate-400">⏱ Duration: <strong className="text-slate-300">{scope.duration}</strong> · Total marks: <strong className="text-slate-300">{scope.totalMarks || '—'}</strong></p>
          )}
        </div>
      )}

      {/* Topics preview */}
      {scope?.topics && scope.topics.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Topics ({scope.topics.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {scope.topics.map((t, i) => {
              const name = typeof t === 'string' ? t : t.name
              const priority = typeof t === 'object' ? t.priority : 'medium'
              return (
                <span key={i} className={`text-xs px-2 py-0.5 rounded-full border ${
                  priority === 'high' ? 'border-teal-500 text-teal-300 bg-teal-950' :
                  'border-slate-600 text-slate-400 bg-slate-800'
                }`}>{name}</span>
              )
            })}
          </div>
        </div>
      )}

      {/* Confidence warning */}
      {scope?.confidence === 'low' && (
        <div className="bg-yellow-950 border border-yellow-700 rounded-lg p-3">
          <p className="text-xs text-yellow-300">⚠️ Low confidence — please review the format above and adjust before generating.</p>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          onClick={onConfirm}
          className="flex-1 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
        >
          ✅ Looks correct — Generate Mock Paper
        </button>
        <button
          onClick={() => setEditing(!editing)}
          className="px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          ✏️ Edit Format
        </button>
      </div>

      {/* Edit panel */}
      {editing && (
        <EditScopePanel scope={editedScope} onSave={(updated) => { setEditedScope(updated); onEdit(updated); setEditing(false) }} onCancel={() => setEditing(false)} />
      )}
    </div>
  )
}

function EditScopePanel({ scope, onSave, onCancel }) {
  const [sections, setSections] = useState(scope?.sections || [])
  const [topics, setTopics] = useState((scope?.topics || []).map(t => typeof t === 'string' ? t : t.name).join(', '))
  const [duration, setDuration] = useState(scope?.duration || '')

  return (
    <div className="border border-slate-600 rounded-xl p-4 space-y-4 bg-slate-850">
      <h4 className="text-sm font-semibold text-white">Edit Exam Format</h4>

      {/* Sections editor */}
      <div className="space-y-2">
        <p className="text-xs text-slate-400 font-medium">Sections</p>
        {sections.map((s, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              className="flex-1 bg-slate-700 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600"
              value={s.name}
              onChange={e => { const ns = [...sections]; ns[i] = { ...ns[i], name: e.target.value }; setSections(ns) }}
              placeholder="Section name"
            />
            <input
              className="w-24 bg-slate-700 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600"
              type="number"
              value={s.questionCount}
              onChange={e => { const ns = [...sections]; ns[i] = { ...ns[i], questionCount: parseInt(e.target.value) || 0 }; setSections(ns) }}
              placeholder="# Qs"
            />
            <span className="text-xs text-slate-400">Qs</span>
          </div>
        ))}
      </div>

      {/* Duration */}
      <div>
        <p className="text-xs text-slate-400 font-medium mb-1">Duration</p>
        <input
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600"
          value={duration}
          onChange={e => setDuration(e.target.value)}
          placeholder="e.g. 60 minutes"
        />
      </div>

      {/* Topics */}
      <div>
        <p className="text-xs text-slate-400 font-medium mb-1">Topics (comma-separated)</p>
        <textarea
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 resize-none"
          rows={3}
          value={topics}
          onChange={e => setTopics(e.target.value)}
          placeholder="Electric fields, Magnetic fields, Capacitors..."
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onSave({
            ...scope,
            sections,
            duration,
            topics: topics.split(',').map(t => ({ name: t.trim(), priority: 'medium' })).filter(t => t.name)
          })}
          className="flex-1 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Save Changes
        </button>
        <button onClick={onCancel} className="px-4 bg-slate-700 text-slate-300 text-sm py-2 rounded-lg">Cancel</button>
      </div>
    </div>
  )
}

// ── Paper Viewer ───────────────────────────────────────────────────────────────

function PaperViewer({ paper, onClose }) {
  const [showAnswers, setShowAnswers] = useState(false)
  const [activeSection, setActiveSection] = useState(0)

  if (!paper) return null

  const sections = paper.sections || []

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{paper.title || 'Mock Examination'}</h1>
            <div className="flex gap-3 mt-2 flex-wrap">
              {paper.examBoard && <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">{paper.examBoard}</span>}
              {paper.duration && <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">⏱ {paper.duration}</span>}
              {paper.totalMarks && <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">📊 {paper.totalMarks} marks</span>}
            </div>
            {paper.instructions && <p className="text-sm text-slate-400 mt-2">{paper.instructions}</p>}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowAnswers(!showAnswers)}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              {showAnswers ? '🙈 Hide answers' : '🔑 Show answers'}
            </button>
            <button onClick={onClose} className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg">✕ Close</button>
          </div>
        </div>

        {/* Coverage bar */}
        <CoverageBar coverage={paper.coverage} />

        {/* Section tabs */}
        {sections.length > 1 && (
          <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
            {sections.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveSection(i)}
                className={`flex-shrink-0 text-sm px-4 py-1.5 rounded-full transition-colors ${activeSection === i ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                {s.sectionName || s.name || `Section ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Active section */}
        {sections.length > 0 && (
          <SectionViewer section={sections[activeSection]} showAnswers={showAnswers} />
        )}
      </div>
    </div>
  )
}

function SectionViewer({ section, showAnswers }) {
  if (!section) return null
  const questions = section.questions || []

  return (
    <div className="mt-4 space-y-4">
      {/* Section header */}
      <div className="bg-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold text-white">{section.sectionName}</h2>
          <SectionBadge type={section.sectionType} />
        </div>
        {section.instructions && <p className="text-sm text-slate-400">{section.instructions}</p>}
        {section.error && <p className="text-sm text-red-400 mt-1">⚠️ {section.error}</p>}
      </div>

      {/* Questions */}
      {questions.map((q, qi) => (
        <QuestionCard key={qi} question={q} number={qi + 1} showAnswers={showAnswers} sectionType={section.sectionType} />
      ))}

      {questions.length === 0 && !section.error && (
        <p className="text-slate-500 text-sm text-center py-8">No questions generated for this section.</p>
      )}
    </div>
  )
}

function QuestionCard({ question, number, showAnswers, sectionType }) {
  const isMCQ = (sectionType || '').toLowerCase().includes('multiple')

  return (
    <div className="bg-slate-800 rounded-xl p-4 space-y-3">
      {/* Question header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-teal-400">{number}</span>
          <div>
            {question.topic && <span className="text-xs text-slate-500">{question.topic}</span>}
            {question.context && <p className="text-sm text-slate-400 mt-1 italic">{question.context}</p>}
          </div>
        </div>
        <span className="flex-shrink-0 text-xs text-slate-400">{question.marks || question.totalMarks} marks</span>
      </div>

      {/* Diagram */}
      {question.diagramSvg && (
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: question.diagramSvg }} />
      )}

      {/* MCQ format */}
      {isMCQ && question.stem && (
        <div className="space-y-2">
          <p className="text-sm text-white font-medium">{question.stem}</p>
          {question.options && Object.entries(question.options).map(([key, val]) => (
            <div key={key} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm ${showAnswers && question.answer === key ? 'bg-teal-900 border border-teal-600 text-teal-200' : 'bg-slate-750 border border-slate-700 text-slate-300'}`}>
              <span className="font-bold text-teal-400 flex-shrink-0">{key}.</span>
              <span>{val}</span>
            </div>
          ))}
          {showAnswers && (
            <div className="bg-slate-700 rounded-lg px-3 py-2">
              <p className="text-xs text-teal-400 font-medium">Answer: {question.answer}</p>
              {question.explanation && <p className="text-xs text-slate-400 mt-1">{question.explanation}</p>}
            </div>
          )}
        </div>
      )}

      {/* Short/extended answer format */}
      {!isMCQ && question.parts && (
        <div className="space-y-3">
          {question.parts.map((part, pi) => (
            <div key={pi} className="pl-3 border-l-2 border-slate-700">
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-teal-400 flex-shrink-0">({part.part})</span>
                <div className="flex-1">
                  <p className="text-sm text-white">{part.question}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{part.marks} mark{part.marks !== 1 ? 's' : ''}</p>
                  {showAnswers && part.markingCriteria && (
                    <div className="mt-2 bg-slate-700 rounded-lg p-2">
                      <p className="text-xs text-teal-400 font-medium mb-1">Marking criteria:</p>
                      <ul className="space-y-0.5">
                        {part.markingCriteria.map((c, ci) => (
                          <li key={ci} className="text-xs text-slate-400">• {c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No parts, just question text */}
      {!isMCQ && !question.parts && question.question && (
        <p className="text-sm text-white">{question.question}</p>
      )}
    </div>
  )
}

// ── Upload Area ────────────────────────────────────────────────────────────────

function UploadArea({ subjectId, onUploadComplete }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])
  const fileRef = useRef()

  const handleFiles = async (files) => {
    if (!files.length) return
    setUploading(true)
    setResults([])

    const formData = new FormData()
    formData.append('subjectId', subjectId)
    for (const f of files) formData.append('files', f)

    try {
      const res = await fetch('/api/ingest-doc', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.ok) {
        setResults(data.results || [])
        onUploadComplete(data)
      } else {
        setResults([{ filename: 'Upload', status: 'error', message: data.error || 'Upload failed' }])
      }
    } catch (e) {
      setResults([{ filename: 'Upload', status: 'error', message: e.message }])
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles([...e.dataTransfer.files]) }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${dragging ? 'border-teal-400 bg-teal-950' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800'}`}
      >
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" className="hidden" onChange={e => handleFiles([...e.target.files])} />
        {uploading ? (
          <div className="space-y-2">
            <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-400">Processing files…</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-3xl">📄</p>
            <p className="text-sm font-medium text-white">Drop files here or click to browse</p>
            <p className="text-xs text-slate-500">PDF, DOCX, TXT, JPG, PNG · Past papers & notes welcome</p>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg ${
              r.status === 'ok' ? 'bg-teal-950 text-teal-300' :
              r.status === 'filtered' ? 'bg-slate-800 text-slate-400' :
              r.status === 'warning' ? 'bg-yellow-950 text-yellow-300' :
              'bg-red-950 text-red-300'
            }`}>
              <span className="flex-shrink-0">{r.status === 'ok' ? '✅' : r.status === 'filtered' ? '🔍' : r.status === 'warning' ? '⚠️' : '❌'}</span>
              <div>
                <span className="font-medium">{r.filename}</span>
                {r.role && <span className="ml-2 opacity-70">({r.role.replace('_', ' ')})</span>}
                <span className="block opacity-70">{r.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main MockPaper Page ────────────────────────────────────────────────────────

export default function MockPaper() {
  const { subjects, loadSubjects } = useSubjectsStore()
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [docs, setDocs] = useState([])
  const [scope, setScope] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingProgress, setGeneratingProgress] = useState(0)
  const [generatingMsg, setGeneratingMsg] = useState('')
  const [viewingPaper, setViewingPaper] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => { loadSubjects() }, [])

  const loadDocs = useCallback(async (subjectId) => {
    if (!subjectId) return
    try {
      const res = await fetch(`/api/docs?subjectId=${subjectId}`)
      const data = await res.json()
      setDocs(data.docs || [])
      // Load scope if exists
      const scopeRes = await fetch(`/api/scope?subjectId=${subjectId}`)
      if (scopeRes.ok) {
        const scopeData = await scopeRes.json()
        if (scopeData.scope) {
          setScope(scopeData.scope)
          setFeedback(scopeData.scope.feedback || null)
        } else {
          setScope(null)
          setFeedback(null)
        }
      }
    } catch (e) {
      console.error('loadDocs error:', e)
    }
  }, [])

  const loadPapers = useCallback(async (subjectId) => {
    if (!subjectId) return
    try {
      const res = await fetch(`/api/papers?subjectId=${subjectId}`)
      const data = await res.json()
      if (Array.isArray(data.papers)) {
        setPapers(data.papers)
      } else if (Array.isArray(data)) {
        setPapers(data)
      }
    } catch (e) {
      console.error('loadPapers error:', e)
    }
  }, [])

  useEffect(() => {
    if (selectedSubjectId) {
      loadDocs(selectedSubjectId)
      loadPapers(selectedSubjectId)
      setScope(null)
      setFeedback(null)
    }
  }, [selectedSubjectId])

  const handleSubjectChange = (id) => {
    setSelectedSubjectId(id)
    setError(null)
    setGenerating(false)
    if (pollRef.current) clearInterval(pollRef.current)
  }

  const handleUploadComplete = (data) => {
    loadDocs(selectedSubjectId)
    setScope(null)
    setFeedback(null)
    if (data.needsAnalysis) {
      setError(null)
    }
  }

  const handleAnalyse = async () => {
    if (!selectedSubjectId) return
    setAnalysing(true)
    setError(null)
    setFeedback(null)
    setScope(null)
    try {
      const res = await fetch('/api/analyse-docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: selectedSubjectId })
      })
      const data = await res.json()
      if (data.ok) {
        setScope(data.scope)
        setFeedback(data.feedback)
      } else {
        setError(data.error || 'Analysis failed')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setAnalysing(false)
    }
  }

  const handleConfirmScope = async () => {
    if (!scope) return
    // Mark scope as confirmed
    const confirmedScope = { ...scope, confirmed: true }
    setScope(confirmedScope)
    // Save confirmed scope
    try {
      await fetch('/api/scope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: selectedSubjectId, scope: confirmedScope })
      })
    } catch {}
  }

  const handleEditScope = (updatedScope) => {
    setScope({ ...updatedScope, confirmed: false })
  }

  const handleGenerate = async () => {
    if (!selectedSubjectId || !scope?.confirmed) return
    setGenerating(true)
    setGeneratingProgress(5)
    setGeneratingMsg('Starting paper generation…')
    setError(null)

    try {
      const res = await fetch('/api/generate-mock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: selectedSubjectId })
      })
      const data = await res.json()

      if (!data.ok) {
        setError(data.error || 'Generation failed')
        setGenerating(false)
        return
      }

      const paperId = data.paperId
      if (!paperId) {
        setError('No paper ID returned')
        setGenerating(false)
        return
      }

      // Poll for completion
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts++
        try {
          const pollRes = await fetch(`/api/papers?subjectId=${selectedSubjectId}`)
          const pollData = await pollRes.json()
          const paperList = Array.isArray(pollData.papers) ? pollData.papers : (Array.isArray(pollData) ? pollData : [])
          const paper = paperList.find(p => p.id === paperId)

          if (paper) {
            setGeneratingProgress(paper.progress || attempts * 5)
            setGeneratingMsg(paper.statusMsg || 'Generating…')

            if (paper.status === 'complete') {
              clearInterval(pollRef.current)
              setGenerating(false)
              setPapers(paperList)
              setViewingPaper(paper.paper)
            } else if (paper.status === 'error') {
              clearInterval(pollRef.current)
              setGenerating(false)
              setError(paper.error || 'Generation failed')
            }
          }
        } catch {}

        if (attempts > 60) { // 5 min timeout
          clearInterval(pollRef.current)
          setGenerating(false)
          setError('Generation timed out. Please try again.')
        }
      }, 5000)

    } catch (e) {
      setError(e.message)
      setGenerating(false)
    }
  }

  const selectedSubject = subjects.find(s => s.id === selectedSubjectId)

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Mock Papers</h1>
          <p className="text-slate-400 text-sm mt-1">Upload past papers and notes — I'll generate mock exams that match your real exam format exactly.</p>
        </div>

        {/* Subject selector */}
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider font-medium block mb-2">Select Subject</label>
          <select
            value={selectedSubjectId}
            onChange={e => handleSubjectChange(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-500"
          >
            <option value="">— Choose a subject —</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {selectedSubjectId && (
          <>
            {/* Upload area */}
            <div className="bg-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">Upload Documents</h3>
                {docs.length > 0 && <span className="text-xs text-slate-400">{docs.length} file{docs.length !== 1 ? 's' : ''} uploaded</span>}
              </div>
              <p className="text-xs text-slate-500">Upload past exam papers AND/OR notes. Past papers define the format; notes add topics. Solution sheets are automatically filtered out.</p>
              <UploadArea subjectId={selectedSubjectId} onUploadComplete={handleUploadComplete} />

              {/* Uploaded files list */}
              {docs.length > 0 && (
                <div className="space-y-1">
                  {docs.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-750 px-3 py-1.5 rounded-lg">
                      <span>{d.role === 'past_paper' ? '📄' : '📝'}</span>
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="text-slate-600">{d.chunkCount} chunks</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Analyse button */}
            {docs.length > 0 && !feedback && (
              <button
                onClick={handleAnalyse}
                disabled={analysing}
                className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
              >
                {analysing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Analysing your documents…
                  </>
                ) : (
                  '🔍 Analyse my documents'
                )}
              </button>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-950 border border-red-700 text-red-300 rounded-xl p-3 text-sm">
                ❌ {error}
              </div>
            )}

            {/* Feedback card */}
            {feedback && scope && !scope.confirmed && (
              <FeedbackCard
                feedback={feedback}
                scope={scope}
                onConfirm={handleConfirmScope}
                onEdit={handleEditScope}
              />
            )}

            {/* Re-analyse button if scope was confirmed */}
            {scope?.confirmed && (
              <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Format confirmed ✅</p>
                    <p className="text-xs text-slate-400">{scope.sections?.length || 0} sections · {scope.topics?.length || 0} topics · {scope.duration || 'timed exam'}</p>
                  </div>
                  <button
                    onClick={() => { setScope({ ...scope, confirmed: false }) }}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Edit
                  </button>
                </div>

                {/* Generate button */}
                {!generating ? (
                  <button
                    onClick={handleGenerate}
                    className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    🎓 Generate Mock Paper
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>{generatingMsg}</span>
                      <span>{generatingProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div className="h-2 bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${generatingProgress}%` }} />
                    </div>
                    <p className="text-xs text-slate-500 text-center">This takes 2–4 minutes. You can leave this screen open.</p>
                  </div>
                )}
              </div>
            )}

            {/* Papers history */}
            {papers.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-white">Generated Papers</h3>
                {papers.filter(p => !p.subjectId || p.subjectId === selectedSubjectId).map((p, i) => (
                  <div key={i} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{p.paper?.title || p.subjectName || 'Mock Paper'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {p.completedAt ? new Date(p.completedAt).toLocaleDateString() : 'In progress'}
                        {p.coverage && ` · ${p.coverage.percentage}% topic coverage`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {p.status === 'complete' && p.paper && (
                        <button
                          onClick={() => setViewingPaper(p.paper)}
                          className="text-sm px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-lg transition-colors"
                        >
                          View
                        </button>
                      )}
                      {(p.status === 'generating' || p.status === 'queued') && (
                        <span className="text-xs text-yellow-400 flex items-center gap-1">
                          <div className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full animate-spin" />
                          Generating…
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Paper viewer overlay */}
      {viewingPaper && <PaperViewer paper={viewingPaper} onClose={() => setViewingPaper(null)} />}
    </div>
  )
}
