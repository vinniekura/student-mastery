import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams, useNavigate } from 'react-router-dom'

export default function SubjectDetail() {
  const { getToken } = useAuth()
  const { subjectId } = useParams()
  const navigate = useNavigate()

  const [subject, setSubject] = useState(null)
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState({})
  const [deleting, setDeleting] = useState({})

  const pastPaperRef = useRef()
  const contextRef = useRef()

  const ACCEPTED_TYPES = '.pdf,.docx,.txt,.jpg,.jpeg,.png'
  const MAX_FILE_SIZE = 15 * 1024 * 1024

  useEffect(() => {
    loadSubject()
    loadDocuments()
  }, [subjectId, getToken])

  const loadSubject = async () => {
    try {
      const token = await getToken()
      const res = await fetch(`/api/subjects?subjectId=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSubject(data.subject)
      }
    } catch (e) {
      console.error('Load subject error:', e)
    }
  }

  const loadDocuments = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const res = await fetch(`/api/docs?subjectId=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.docs || [])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const uploadFile = async (file, docType) => {
    if (!file) return

    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!ACCEPTED_TYPES.includes(ext)) {
      setError('Unsupported file type. Use PDF, DOCX, TXT, JPG, PNG')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File too large. Max 15MB.')
      return
    }

    setUploading(u => ({ ...u, [docType]: true }))
    setError('')

    try {
      const token = await getToken()
      const fd = new FormData()
      fd.append('file', file)
      fd.append('subjectId', subjectId)
      fd.append('docType', docType)

      const res = await fetch('/api/ingest-doc', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      // Reload documents
      await loadDocuments()
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(u => ({ ...u, [docType]: false }))
    }
  }

  const deleteDocument = async (docId) => {
    if (!window.confirm('Delete this document?')) return

    setDeleting(d => ({ ...d, [docId]: true }))
    try {
      const token = await getToken()
      const res = await fetch(`/api/docs?subjectId=${subjectId}&docId=${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        await loadDocuments()
      } else {
        const err = await res.json()
        setError(err.error || 'Delete failed')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(d => ({ ...d, [docId]: false }))
    }
  }

  const pastPapers = documents.filter(d => d.docType === 'past-paper' || (!d.docType && d.category !== 'context'))
  const contextDocs = documents.filter(d => d.docType === 'context')

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <button
          onClick={() => navigate('/subjects')}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            color: 'var(--teal2)'
          }}
        >
          ←
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>{subject?.name}</h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text3)', fontSize: 14 }}>
            {subject?.examBoard} • Year {subject?.year}
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12,
          background: 'var(--red-bg)',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 8,
          color: 'var(--red)',
          marginBottom: 20,
          fontSize: 13
        }}>
          {error}
        </div>
      )}

      {/* Upload Sections */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
        {/* Past Papers */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal2)' }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Past Exam Papers
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 'auto' }}>
              Format + topics
            </span>
          </div>

          <div
            onClick={() => !uploading['past-paper'] && pastPaperRef.current?.click()}
            style={{
              border: '2px dashed var(--teal2)',
              borderRadius: 10,
              padding: 20,
              textAlign: 'center',
              cursor: uploading['past-paper'] ? 'not-allowed' : 'pointer',
              background: 'var(--bg3)',
              marginBottom: 14,
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              if (!uploading['past-paper']) {
                e.currentTarget.style.borderColor = 'var(--teal)'
                e.currentTarget.style.background = 'rgba(14,165,233,0.05)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--teal2)'
              e.currentTarget.style.background = 'var(--bg3)'
            }}
          >
            {uploading['past-paper'] ? (
              <>
                <div style={{ fontSize: 20, marginBottom: 8 }}>⏳</div>
                <div style={{ fontSize: 12, color: 'var(--teal2)', fontWeight: 600 }}>Uploading...</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 20, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  Click to add past papers
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  PDF · DOCX · TXT · JPG · PNG · Max 15MB
                </div>
              </>
            )}
            <input
              ref={pastPaperRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadFile(file, 'past-paper')
                e.target.value = ''
              }}
              style={{ display: 'none' }}
            />
          </div>

          {/* Uploaded Past Papers List */}
          {pastPapers.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              <div style={{ marginBottom: 8, color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {pastPapers.length} uploaded
              </div>
              {pastPapers.map(doc => (
                <div
                  key={doc.id}
                  style={{
                    padding: 8,
                    background: 'var(--bg3)',
                    borderRadius: 6,
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--teal2)' }}>✓</span>
                    <span style={{ color: 'var(--text3)' }}>{doc.filename}</span>
                  </div>
                  <button
                    onClick={() => deleteDocument(doc.id)}
                    disabled={deleting[doc.id]}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--red)',
                      cursor: deleting[doc.id] ? 'not-allowed' : 'pointer',
                      padding: '2px 6px',
                      fontSize: 12
                    }}
                  >
                    {deleting[doc.id] ? '...' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Context Material */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed' }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Context Material
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 'auto' }}>
              Topics only
            </span>
          </div>

          <div
            onClick={() => !uploading['context'] && contextRef.current?.click()}
            style={{
              border: '2px dashed #7c3aed',
              borderRadius: 10,
              padding: 20,
              textAlign: 'center',
              cursor: uploading['context'] ? 'not-allowed' : 'pointer',
              background: 'var(--bg3)',
              marginBottom: 14,
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              if (!uploading['context']) {
                e.currentTarget.style.borderColor = '#a78bfa'
                e.currentTarget.style.background = 'rgba(124,58,237,0.05)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#7c3aed'
              e.currentTarget.style.background = 'var(--bg3)'
            }}
          >
            {uploading['context'] ? (
              <>
                <div style={{ fontSize: 20, marginBottom: 8 }}>⏳</div>
                <div style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>Uploading...</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 20, marginBottom: 8 }}>📚</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  Click to add notes/reference
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  OCR scans, textbooks, summaries
                </div>
              </>
            )}
            <input
              ref={contextRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadFile(file, 'context')
                e.target.value = ''
              }}
              style={{ display: 'none' }}
            />
          </div>

          {/* Uploaded Context Docs List */}
          {contextDocs.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              <div style={{ marginBottom: 8, color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {contextDocs.length} uploaded
              </div>
              {contextDocs.map(doc => (
                <div
                  key={doc.id}
                  style={{
                    padding: 8,
                    background: 'var(--bg3)',
                    borderRadius: 6,
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#7c3aed' }}>✓</span>
                    <span style={{ color: 'var(--text3)' }}>{doc.filename}</span>
                  </div>
                  <button
                    onClick={() => deleteDocument(doc.id)}
                    disabled={deleting[doc.id]}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--red)',
                      cursor: deleting[doc.id] ? 'not-allowed' : 'pointer',
                      padding: '2px 6px',
                      fontSize: 12
                    }}
                  >
                    {deleting[doc.id] ? '...' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button
          onClick={() => {
            if (pastPapers.length === 0) {
              setError('Upload at least one past paper to generate mocks')
              return
            }
            navigate(`/subjects/${subjectId}/mock-paper`)
          }}
          style={{
            padding: 14,
            borderRadius: 10,
            background: pastPapers.length > 0 ? 'var(--teal)' : 'var(--bg3)',
            border: 'none',
            color: pastPapers.length > 0 ? '#fff' : 'var(--text3)',
            cursor: pastPapers.length > 0 ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            fontSize: 14
          }}
        >
          📝 Generate Mock Papers
        </button>

        <button
          onClick={() => {
            if (contextDocs.length === 0) {
              setError('Upload context material to generate a quiz')
              return
            }
            navigate(`/subjects/${subjectId}/quiz`)
          }}
          style={{
            padding: 14,
            borderRadius: 10,
            background: contextDocs.length > 0 ? 'var(--purple)' : 'var(--bg3)',
            border: 'none',
            color: contextDocs.length > 0 ? '#fff' : 'var(--text3)',
            cursor: contextDocs.length > 0 ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            fontSize: 14
          }}
        >
          ⚡ Generate Quick Quiz
        </button>
      </div>

      {/* Helper text */}
      <div style={{ marginTop: 24, padding: 16, background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>💡 How this works:</div>
          <div style={{ marginBottom: 4 }}>
            <strong>Past Papers</strong> — Analyze format and difficulty. Generate 5 realistic mock papers.
          </div>
          <div>
            <strong>Context Material</strong> — Create quick quizzes from your notes, textbooks, and OCR scans.
          </div>
        </div>
      </div>
    </div>
  )
}
