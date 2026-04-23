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
      <div className="space-y-2">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-slate-300 leading-relaxed">{line}</p>
        ))}
      </div>
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
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button onClick={onConfirm} className="flex-1 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
          ✅ Looks correct — Generate Mock Paper
        </button>
        <button onClick={() => setEditing(!editing)} className="px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2.5 rounded-xl transition-colors text-sm">
          ✏️ Edit Format
        </button>
      </div>
    </div>
  )
}

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
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch('/api/ingest-doc', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })
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
              'bg-red-950 text-red-300'
            }`}>
              <span>{r.status === 'ok' ? '✅' : '❌'}</span>
              <div><span className="font-medium">{r.filename}</span><span className="block opacity-70">{r.message}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PaperViewer({ paper, onClose }) {
  const [showAnswers, setShowAnswers] = useState(false)
  if (!paper) return null
  const sections = paper.sections || []
  return (
    <div className="fixed inset-0 bg-slate-950 z-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{paper.title || 'Mock Examination'}</h1>
            <p className="text-sm text-slate-400 mt-2">{paper.instructions}</p>
          </div>
          <button onClick={onClose} className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg">✕ Close</button>
        </div>
        <CoverageBar coverage={paper.coverage} />
        <div className="mt-4 space-y-4">
          {sections.map((s, i) => (
            <div key={i} className="bg-slate-800 rounded-xl p-4">
              <h2 className="text-lg font-bold text-white mb-2">{s.sectionName}</h2>
              {s.instructions && <p className="text-sm text-slate-400 mb-3">{s.instructions}</p>}
              <div className="space-y-3">
                {(s.questions || []).map((q, qi) => (
                  <div key={qi} className="bg-slate-750 rounded-lg p-3">
                    <p className="text-sm text-white font-medium">Q{qi + 1}: {q.stem || q.question}</p>
                    <p className="text-xs text-slate-400 mt-1">{q.marks || q.totalMarks} marks</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MockPaper() {
  const { subjects, fetchSubjects } = useSubjectsStore()
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [docs, setDocs] = useState([])
  const [scope, setScope] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [papers, setPapers] = useState([])
  const [analysing, setAnalysing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingProgress, setGeneratingProgress] = useState(0)
  const [generatingMsg, setGeneratingMsg] = useState('')
  const [viewingPaper, setViewingPaper] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  // Load subjects on mount
  useEffect(() => {
    const loadSubjects = async () => {
      try {
        const token = await window.Clerk?.session?.getToken()
        if (token) await fetchSubjects(token)
      } catch (e) {
        console.error('Failed to load subjects:', e)
      }
    }
    loadSubjects()
  }, [fetchSubjects])

  // Load docs and papers when subject changes
  useEffect(() => {
    if (selectedSubjectId) {
      loadDocs(selectedSubjectId)
      loadPapers(selectedSubjectId)
      setScope(null)
      setFeedback(null)
    }
  }, [selectedSubjectId])

  const loadDocs = useCallback(async (subjectId) => {
    if (!subjectId) return
    try {
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch(`/api/docs?subjectId=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      setDocs(data.docs || [])
    } catch (e) {
      console.error('loadDocs error:', e)
    }
  }, [])

  const loadPapers = useCallback(async (subjectId) => {
    if (!subjectId) return
    try {
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch(`/api/papers?subjectId=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      setPapers(Array.isArray(data.papers) ? data.papers : (Array.isArray(data) ? data : []))
    } catch (e) {
      console.error('loadPapers error:', e)
    }
  }, [])

  const handleAnalyse = async () => {
    if (!selectedSubjectId) return
    setAnalysing(true)
    setError(null)
    try {
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch('/api/analyse-docs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        },
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
    const confirmedScope = { ...scope, confirmed: true }
    setScope(confirmedScope)
    try {
      const token = await window.Clerk?.session?.getToken()
      await fetch('/api/scope', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ subjectId: selectedSubjectId, scope: confirmedScope })
      })
    } catch {}
  }

  const handleGenerate = async () => {
    if (!selectedSubjectId || !scope?.confirmed) return
    setGenerating(true)
    setGeneratingProgress(5)
    setGeneratingMsg('Starting paper generation…')
    setError(null)

    try {
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch('/api/generate-mock', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ subjectId: selectedSubjectId })
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || 'Generation failed')
        setGenerating(false)
        return
      }

      const paperId = data.paperId
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts++
        try {
          const token = await window.Clerk?.session?.getToken()
          const pollRes = await fetch(`/api/papers?subjectId=${selectedSubjectId}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          const pollData = await pollRes.json()
          const paperList = Array.isArray(pollData.papers) ? pollData.papers : []
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
        if (attempts > 60) {
          clearInterval(pollRef.current)
          setGenerating(false)
          setError('Generation timed out.')
        }
      }, 5000)
    } catch (e) {
      setError(e.message)
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Mock Papers</h1>
          <p className="text-slate-400 text-sm mt-1">Upload past papers and notes — I'll generate mock exams that match your real exam format exactly.</p>
        </div>

        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider font-medium block mb-2">Select Subject</label>
          <select
            value={selectedSubjectId}
            onChange={e => setSelectedSubjectId(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded-xl px-4 py-3 text-sm"
          >
            <option value="">— Choose a subject —</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {selectedSubjectId && (
          <>
            <div className="bg-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="font-semibold text-white">Upload Documents</h3>
              <UploadArea subjectId={selectedSubjectId} onUploadComplete={() => loadDocs(selectedSubjectId)} />
              {docs.length > 0 && (
                <div className="space-y-1">
                  {docs.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-750 px-3 py-1.5 rounded-lg">
                      <span>{d.role === 'past_paper' ? '📄' : '📝'}</span>
                      <span className="flex-1 truncate">{d.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {docs.length > 0 && !feedback && (
              <button
                onClick={handleAnalyse}
                disabled={analysing}
                className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold py-3 rounded-2xl transition-colors"
              >
                {analysing ? 'Analysing…' : '🔍 Analyse my documents'}
              </button>
            )}

            {error && <div className="bg-red-950 border border-red-700 text-red-300 rounded-xl p-3 text-sm">❌ {error}</div>}

            {feedback && scope && !scope.confirmed && (
              <FeedbackCard feedback={feedback} scope={scope} onConfirm={handleConfirmScope} onEdit={() => {}} />
            )}

            {scope?.confirmed && (
              <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-semibold text-white">Format confirmed ✅</p>
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
                      <div className="h-2 bg-teal-500 rounded-full transition-all" style={{ width: `${generatingProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {papers.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-white">Generated Papers</h3>
                {papers.map((p, i) => (
                  <div key={i} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{p.paper?.title || 'Mock Paper'}</p>
                      <p className="text-xs text-slate-400">{p.coverage?.percentage}% coverage</p>
                    </div>
                    {p.status === 'complete' && p.paper && (
                      <button
                        onClick={() => setViewingPaper(p.paper)}
                        className="text-sm px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-lg"
                      >
                        View
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {viewingPaper && <PaperViewer paper={viewingPaper} onClose={() => setViewingPaper(null)} />}
    </div>
  )
}
