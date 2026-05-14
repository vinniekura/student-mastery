import { useState, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams } from 'react-router-dom'

export default function QuizGenerator() {
  const { getToken } = useAuth()
  const { subjectId } = useParams()
  
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [quiz, setQuiz] = useState(null)
  const [error, setError] = useState('')
  const [currentQ, setCurrentQ] = useState(0)
  const [answers, setAnswers] = useState({})
  const fileRef = useRef()

  const ACCEPTED_TYPES = '.pdf,.docx,.txt,.jpg,.jpeg,.png'

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')
    try {
      const token = await getToken()
      const fd = new FormData()
      fd.append('file', file)
      fd.append('subjectId', subjectId)
      fd.append('docType', 'study-material')

      const res = await fetch('/api/ingest-doc', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }

      // Now generate quiz
      await generateQuiz(file.name)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const generateQuiz = async (fileName) => {
    setGenerating(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/quick-quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          subjectId,
          fileName,
          questionType: 'mixed' // MCQ + flashcard mix
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Quiz generation failed')

      setQuiz(data.questions || [])
      setCurrentQ(0)
      setAnswers({})
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  // Quiz display
  if (quiz && quiz.length > 0) {
    const q = quiz[currentQ]
    const isAnswered = answers[currentQ] !== undefined
    const progress = Math.round(((currentQ + 1) / quiz.length) * 100)

    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
            Question {currentQ + 1} of {quiz.length}
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--teal2)', transition: 'width 0.3s' }} />
          </div>
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text)' }}>{q.question}</h3>

          {q.type === 'mcq' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {q.options?.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setAnswers({ ...answers, [currentQ]: opt })}
                  style={{
                    padding: 12,
                    border: answers[currentQ] === opt ? '2px solid var(--teal2)' : '1px solid var(--border)',
                    background: answers[currentQ] === opt ? 'var(--teal-bg)' : 'var(--bg3)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 14
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: 16, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Term</div>
              <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 16, fontWeight: 600 }}>{q.term}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Definition</div>
              <div style={{ fontSize: 14, color: 'var(--text)' }}>{q.definition}</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setCurrentQ(Math.max(0, currentQ - 1))}
            disabled={currentQ === 0}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              background: currentQ === 0 ? 'var(--bg3)' : 'var(--bg2)',
              border: '1px solid var(--border)',
              color: 'var(--text2)',
              cursor: currentQ === 0 ? 'not-allowed' : 'pointer'
            }}
          >
            ← Previous
          </button>

          {isAnswered && (
            <button
              onClick={() => setCurrentQ(Math.min(quiz.length - 1, currentQ + 1))}
              disabled={currentQ === quiz.length - 1}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 8,
                background: 'var(--teal)',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {currentQ === quiz.length - 1 ? '✓ Complete' : 'Next →'}
            </button>
          )}

          {!isAnswered && (
            <div style={{ flex: 1, padding: '10px 16px', textAlign: 'center', color: 'var(--text3)' }}>
              Answer the question to continue
            </div>
          )}
        </div>

        {currentQ === quiz.length - 1 && isAnswered && (
          <button
            onClick={() => {
              setQuiz(null)
              setAnswers({})
            }}
            style={{
              width: '100%',
              padding: '12px 16px',
              marginTop: 16,
              borderRadius: 8,
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              color: 'var(--text2)',
              cursor: 'pointer'
            }}
          >
            Generate Another Quiz
          </button>
        )}
      </div>
    )
  }

  // Upload screen
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>Quick Quiz Generator</h2>
      <p style={{ color: 'var(--text3)', marginBottom: '2rem' }}>
        Upload study material to instantly generate a quiz. Perfect for quick revision!
      </p>

      {error && (
        <div style={{ padding: 12, background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, color: 'var(--red)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) {
            const event = { target: { files: [file] } }
            handleUpload(event)
          }
        }}
        style={{
          border: '2px dashed var(--teal2)',
          borderRadius: 12,
          padding: 40,
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: 'var(--bg2)',
          transition: 'all 0.2s'
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          {uploading ? 'Uploading...' : 'Drop file here or click to browse'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          PDF, DOCX, TXT, or images (Max 15MB)
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
      </div>

      {generating && (
        <div style={{ marginTop: '2rem', textAlign: 'center', color: 'var(--teal2)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>✨</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Generating quiz...</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
            This usually takes 30-60 seconds
          </div>
        </div>
      )}
    </div>
  )
}
