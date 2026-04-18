import { useState } from 'react'

export default function QuizEngine({ quiz, onClose }) {
  const { questions = [], subjectName, sourceType } = quiz
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState({})
  const [revealed, setRevealed] = useState({})
  const [finished, setFinished] = useState(false)

  const q = questions[current]
  const isMCQ = q?.type === 'mcq'
  const isFlashcard = q?.type === 'flashcard'
  const isShort = q?.type === 'short'

  function selectAnswer(ans) {
    if (answers[current] !== undefined) return
    setAnswers(a => ({ ...a, [current]: ans }))
    setRevealed(r => ({ ...r, [current]: true }))
  }

  function next() {
    if (current < questions.length - 1) {
      setCurrent(c => c + 1)
    } else {
      setFinished(true)
    }
  }

  function prev() {
    if (current > 0) setCurrent(c => c - 1)
  }

  // Score calculation
  const score = questions.reduce((acc, q, i) => {
    if (q.type === 'mcq' && answers[i] === q.answer) return acc + 1
    return acc
  }, 0)
  const mcqTotal = questions.filter(q => q.type === 'mcq').length

  if (finished) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 0' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--teal2)', marginBottom: 8 }}>
            {mcqTotal > 0 ? `${score}/${mcqTotal}` : '✓'}
          </div>
          <div style={{ fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>
            {mcqTotal > 0 ? `${Math.round(score / mcqTotal * 100)}% correct` : 'Quiz complete'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>{subjectName} · {questions.length} questions</div>
        </div>

        {/* Review */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {questions.map((q, i) => {
            const correct = q.type === 'mcq' ? answers[i] === q.answer : null
            return (
              <div key={i} style={{
                background: 'var(--bg2)', borderRadius: 10, padding: '14px 16px',
                border: `1px solid ${correct === true ? 'var(--teal-border)' : correct === false ? 'rgba(220,38,38,0.3)' : 'var(--border)'}`
              }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Q{i + 1} · {q.topic}</div>
                <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>{q.question}</div>
                {q.type === 'mcq' && (
                  <div style={{ fontSize: 12 }}>
                    <span style={{ color: 'var(--teal2)' }}>Correct: {q.answer}</span>
                    {answers[i] && answers[i] !== q.answer && (
                      <span style={{ color: 'var(--red)', marginLeft: 12 }}>Your answer: {answers[i]}</span>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, fontStyle: 'italic' }}>{q.explanation}</div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => { setCurrent(0); setAnswers({}); setRevealed({}); setFinished(false) }}
            style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--teal)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Retake quiz
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 20px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {subjectName} · {sourceType === 'docs' ? 'From your notes' : 'From syllabus'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{current + 1} / {questions.length}</div>
      </div>
      <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, marginBottom: 24 }}>
        <div style={{ height: '100%', background: 'var(--teal)', borderRadius: 2, width: `${((current + 1) / questions.length) * 100}%`, transition: 'width .3s' }} />
      </div>

      {/* Question */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {q?.topic} · {isMCQ ? 'Multiple choice' : isFlashcard ? 'Flashcard' : 'Short answer'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', lineHeight: 1.5 }}>
          {isFlashcard ? q?.term : q?.question}
        </div>
      </div>

      {/* MCQ options */}
      {isMCQ && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {(q?.options || []).map((opt, i) => {
            const letter = opt.split('.')[0]
            const selected = answers[current] === letter
            const isCorrect = revealed[current] && letter === q.answer
            const isWrong = revealed[current] && selected && letter !== q.answer
            return (
              <button key={i} onClick={() => selectAnswer(letter)} style={{
                padding: '12px 16px', borderRadius: 10, textAlign: 'left', fontSize: 14, cursor: revealed[current] ? 'default' : 'pointer',
                background: isCorrect ? 'var(--teal-bg)' : isWrong ? 'var(--red-bg)' : selected ? 'var(--bg3)' : 'var(--bg2)',
                border: `1px solid ${isCorrect ? 'var(--teal-border)' : isWrong ? 'rgba(220,38,38,0.3)' : 'var(--border)'}`,
                color: isCorrect ? 'var(--teal2)' : isWrong ? 'var(--red)' : 'var(--text)',
                transition: 'all .15s'
              }}>
                {opt}
              </button>
            )
          })}
        </div>
      )}

      {/* Flashcard reveal */}
      {isFlashcard && (
        <div>
          {!revealed[current] ? (
            <button onClick={() => setRevealed(r => ({ ...r, [current]: true }))}
              style={{ width: '100%', padding: '14px', borderRadius: 10, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', color: 'var(--teal2)', cursor: 'pointer', fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
              Reveal answer
            </button>
          ) : (
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '16px', marginBottom: 16, border: '1px solid var(--teal-border)' }}>
              <div style={{ fontSize: 12, color: 'var(--teal2)', marginBottom: 6 }}>Definition</div>
              <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>{q?.definition}</div>
            </div>
          )}
        </div>
      )}

      {/* Short answer */}
      {isShort && (
        <div style={{ marginBottom: 16 }}>
          {!revealed[current] ? (
            <button onClick={() => setRevealed(r => ({ ...r, [current]: true }))}
              style={{ padding: '10px 18px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>
              Show sample answer
            </button>
          ) : (
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '16px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Sample answer</div>
              <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>{q?.sampleAnswer}</div>
            </div>
          )}
        </div>
      )}

      {/* Explanation */}
      {revealed[current] && q?.explanation && (
        <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {q.explanation}
        </div>
      )}

      {/* Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={prev} disabled={current === 0}
          style={{ padding: '9px 18px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', cursor: current === 0 ? 'not-allowed' : 'pointer', opacity: current === 0 ? 0.4 : 1, fontSize: 13 }}>
          ← Previous
        </button>
        <button onClick={next} disabled={isMCQ && !revealed[current]}
          style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--teal)', border: 'none', color: '#fff', cursor: (isMCQ && !revealed[current]) ? 'not-allowed' : 'pointer', opacity: (isMCQ && !revealed[current]) ? 0.5 : 1, fontSize: 13, fontWeight: 500 }}>
          {current === questions.length - 1 ? 'Finish →' : 'Next →'}
        </button>
      </div>
    </div>
  )
}
