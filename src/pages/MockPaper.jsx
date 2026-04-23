import { useState, useEffect, useCallback, useRef } from 'react'
import { useSubjectsStore } from '../store/subjects'

async function getToken() {
  try {
    const token = await window.Clerk.session.getToken()
    console.log('Token:', token?.substring(0, 30) + '...')
    return token
  } catch (e) {
    console.error('Token error:', e)
    return null
  }
}

export default function MockPaper() {
  const { subjects } = useSubjectsStore()
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [docs, setDocs] = useState([])
  const [error, setError] = useState(null)

  const loadDocs = useCallback(async (subjectId) => {
    if (!subjectId) return
    console.log('Loading docs for:', subjectId)
    try {
      const token = await getToken()
      if (!token) {
        console.error('No token!')
        setError('No token')
        return
      }
      const res = await fetch(`/api/docs?subjectId=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      console.log('Docs fetch status:', res.status)
      const data = await res.json()
      console.log('Docs response:', data)
      setDocs(data.docs || [])
      setError(null)
    } catch (e) {
      console.error('loadDocs error:', e)
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    if (selectedSubjectId) {
      loadDocs(selectedSubjectId)
    }
  }, [selectedSubjectId, loadDocs])

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Mock Papers</h1>
        <select
          value={selectedSubjectId}
          onChange={e => setSelectedSubjectId(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 text-white rounded-xl px-4 py-3"
        >
          <option value="">Choose subject</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {selectedSubjectId && (
          <div className="bg-slate-800 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-3">Documents</h3>
            {docs.length > 0 ? (
              <div className="space-y-1">
                {docs.map((d, i) => (
                  <div key={i} className="text-xs text-slate-400">📄 {d.name}</div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No documents</p>
            )}
            {error && <div className="text-red-400 text-sm mt-3">❌ {error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
