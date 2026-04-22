import { useState, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'

export default function DocUploader({ subjectId, onSuccess, subject }) {
  const { getToken } = useAuth()
  const [draggingPrimary, setDraggingPrimary]   = useState(false)
  const [draggingContext, setDraggingContext]    = useState(false)
  const [uploadingPrimary, setUploadingPrimary] = useState(false)
  const [uploadingContext, setUploadingContext] = useState(false)
  const [error, setError]                       = useState(null)
  const [progressPrimary, setProgressPrimary]   = useState(null)
  const [progressContext, setProgressContext]   = useState(null)
  const primaryRef = useRef()
  const contextRef = useRef()

  const ACCEPTED = ['.pdf', '.docx', '.txt', '.jpg', '.jpeg', '.png']
  const MAX_SIZE  = 15 * 1024 * 1024

  async function uploadFile(file, docRole) {
    if (!file) return
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!ACCEPTED.includes(ext)) { setError(`Unsupported file type. Use PDF, DOCX, TXT, JPG, PNG`); return }
    if (file.size > MAX_SIZE) { setError('File too large. Max 15MB.'); return }
    setError(null)

    const isPrimary = docRole === 'past-paper'
    const setUploading = isPrimary ? setUploadingPrimary : setUploadingContext
    const setProgress  = isPrimary ? setProgressPrimary  : setProgressContext
    const isImage = ['.jpg','.jpeg','.png'].includes(ext)

    setUploading(true)
    setProgress(isImage ? `Reading handwriting in ${file.name}...` : `Uploading ${file.name}...`)

    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('subjectId', subjectId)
      formData.append('docType', docRole) // 'past-paper' or 'context'
      const res  = await fetch('/api/ingest-doc', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      const msg = data.ocrUsed
        ? `✓ Handwriting read — ${data.chunkCount} chunks from ${file.name}`
        : `✓ ${data.chunkCount} chunks extracted from ${file.name}`
      setProgress(msg)
      setTimeout(() => setProgress(null), 4000)
      onSuccess?.(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function makeDropZone(role, dragging, setDragging, uploading, progress, inputRef) {
    const isPrimary = role === 'past-paper'
    const color     = isPrimary ? 'var(--teal2)' : '#7c3aed'
    const bg        = isPrimary ? 'var(--teal-bg)' : 'rgba(124,58,237,0.06)'
    const border    = isPrimary ? 'var(--teal-border)' : 'rgba(124,58,237,0.25)'

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {isPrimary ? 'Past exam papers' : 'Context / reference material'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
            {isPrimary ? 'Defines format + topics' : 'Topics only — no format'}
          </div>
        </div>
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if(f) uploadFile(f, role) }}
          style={{
            border: `2px dashed ${dragging ? color : 'var(--border2)'}`,
            borderRadius: 10, padding: '16px', textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            background: dragging ? bg : 'var(--bg3)', transition: 'all .15s'
          }}
        >
          <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.jpg,.jpeg,.png" onChange={e => { const f=e.target.files[0]; if(f) uploadFile(f, role); e.target.value='' }} style={{ display: 'none' }} />
          {uploading ? (
            <div style={{ fontSize: 12, color }}>{progress}</div>
          ) : progress ? (
            <div style={{ fontSize: 12, color, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 8l4 4 8-8" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
              {progress}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Drop here or click to browse</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>PDF · DOCX · JPG · PNG · Max 15MB</div>
              {isPrimary && <div style={{ fontSize: 10, color, marginTop: 4 }}>📸 Handwritten notes accepted</div>}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {makeDropZone('past-paper', draggingPrimary, setDraggingPrimary, uploadingPrimary, progressPrimary, primaryRef)}
      {makeDropZone('context',    draggingContext,  setDraggingContext,  uploadingContext,  progressContext,  contextRef)}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)', padding: '6px 10px', background: 'var(--red-bg)', borderRadius: 7 }}>{error}</div>
      )}
    </div>
  )
}
