import { useState, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'

export default function DocUploader({ subjectId, onSuccess }) {
  const { getToken } = useAuth()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [docType, setDocType] = useState('notes')
  const inputRef = useRef()

  const ACCEPTED = ['.pdf', '.docx', '.txt']
  const MAX_SIZE = 10 * 1024 * 1024

  async function uploadFile(file) {
    if (!file) return
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!ACCEPTED.includes(ext)) { setError(`Unsupported file type. Use ${ACCEPTED.join(', ')}`); return }
    if (file.size > MAX_SIZE) { setError('File too large. Max 10MB.'); return }

    setUploading(true)
    setError(null)
    setProgress(`Uploading ${file.name}...`)

    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('subjectId', subjectId)
      formData.append('docType', docType)

      const res = await fetch('/api/ingest-doc', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setProgress(`✓ ${data.chunkCount} chunks extracted from ${file.name}`)
      setTimeout(() => setProgress(null), 3000)
      onSuccess?.(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  function handleChange(e) {
    const file = e.target.files[0]
    if (file) uploadFile(file)
    e.target.value = ''
  }

  const typeBtn = (val, label, desc) => (
    <button
      onClick={() => setDocType(val)}
      style={{
        flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
        border: `1px solid ${docType === val ? 'var(--teal-border)' : 'var(--border)'}`,
        background: docType === val ? 'var(--teal-bg)' : 'var(--bg3)',
        transition: 'all .15s'
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: docType === val ? 'var(--teal2)' : 'var(--text)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: docType === val ? 'var(--teal2)' : 'var(--text3)', opacity: 0.8 }}>{desc}</div>
    </button>
  )

  return (
    <div>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {typeBtn('notes', 'Study notes', 'Used for quizzes')}
        {typeBtn('past-paper', 'Past paper', 'Used for mock exams')}
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? 'var(--teal2)' : 'var(--border2)'}`,
          borderRadius: 10, padding: '20px 16px', textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: dragging ? 'var(--teal-bg)' : 'var(--bg3)',
          transition: 'all .15s'
        }}
      >
        <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" onChange={handleChange} style={{ display: 'none' }} />
        <svg width="28" height="28" fill="none" viewBox="0 0 32 32" style={{ margin: '0 auto 8px' }}>
          <path d="M16 4v16M8 12l8-8 8 8" stroke="var(--teal2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M4 24v2a2 2 0 002 2h20a2 2 0 002-2v-2" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        {uploading ? (
          <div style={{ fontSize: 12, color: 'var(--teal2)' }}>{progress}</div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
              Drop {docType === 'past-paper' ? 'past paper' : 'notes'} here or click to browse
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>PDF, DOCX or TXT · Max 10MB</div>
          </>
        )}
      </div>

      {progress && !uploading && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--teal2)', padding: '6px 10px', background: 'var(--teal-bg)', borderRadius: 7, border: '1px solid var(--teal-border)' }}>
          {progress}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--red)', padding: '6px 10px', background: 'var(--red-bg)', borderRadius: 7 }}>
          {error}
        </div>
      )}
    </div>
  )
}
