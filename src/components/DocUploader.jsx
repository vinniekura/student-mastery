import { useState, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'

const ACCEPTED = '.pdf,.docx,.txt,.jpg,.jpeg,.png'
const MAX_SIZE  = 15 * 1024 * 1024

export default function DocUploader({ subjectId, docs = [], onSuccess, onDelete }) {
  const { getToken } = useAuth()
  const [uploading, setUploading] = useState({})
  const [progress, setProgress]   = useState({})
  const [error, setError]         = useState(null)
  const primaryRef = useRef()
  const contextRef = useRef()

  async function uploadFile(file, role) {
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!ACCEPTED.includes(ext)) { setError(`Unsupported type: ${ext}`); return }
    if (file.size > MAX_SIZE)    { setError('File too large — max 15 MB'); return }
    setError(null)

    const key = `${role}-${file.name}`
    setUploading(u => ({ ...u, [key]: true }))
    setProgress(p => ({ ...p, [key]: file.name }))
    try {
      const token = await getToken()
      const fd    = new FormData()
      fd.append('file', file)
      fd.append('subjectId', subjectId)
      fd.append('docType', role)
      const res  = await fetch('/api/ingest-doc', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onSuccess?.(data)
      setProgress(p => ({ ...p, [key]: null }))
    } catch(e) {
      setError(e.message)
    } finally {
      setUploading(u => ({ ...u, [key]: false }))
    }
  }

  async function handleFiles(files, role) {
    // Support multiple files
    for (const file of Array.from(files)) {
      await uploadFile(file, role)
    }
  }

  const primaryDocs = docs.filter(d => d.docType !== 'context')
  const contextDocs = docs.filter(d => d.docType === 'context')

  function DropZone({ role, label, hint, inputRef, color }) {
    const [dragging, setDragging] = useState(false)
    const isUploading = Object.entries(uploading).some(([k, v]) => k.startsWith(role) && v)

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 'auto' }}>{hint}</div>
        </div>

        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onClick={() => !isUploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files, role) }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            onChange={e => { handleFiles(e.target.files, role); e.target.value = '' }}
            style={{ display: 'none' }}
          />
          {isUploading ? (
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: color, borderRadius: '50%', animation: 'spin .7s linear infinite', display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />
              Uploading...
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
                Drop files here or click to browse
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>PDF · DOCX · TXT · JPG · PNG · Multiple files OK</div>
            </>
          )}
        </div>

        {/* Uploaded docs for this role */}
        {(role === 'past-paper' ? primaryDocs : contextDocs).map(doc => (
          <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginTop: 6, background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.filename || doc.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {doc.chunkCount || 0} sections · {doc.charCount ? Math.round(doc.charCount / 1000) + 'k chars' : ''}
              </div>
            </div>
            <button
              onClick={() => onDelete?.(doc.id)}
              style={{ flexShrink: 0, padding: '3px 8px', borderRadius: 5, background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', fontSize: 12, cursor: 'pointer' }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DropZone role="past-paper" label="Past exam papers"         hint="Defines format + topics" inputRef={primaryRef} color="var(--accent)" />
      <DropZone role="context"    label="Reference material"        hint="Topics only"             inputRef={contextRef} color="var(--purple)" />
      {error && (
        <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-bg)', borderRadius: 8, border: '1px solid var(--red-border)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
