import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const { subjectId, questionCount = 5, questionType = 'mcq', topicFocus } = await parseBody(req)
    if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

    // Get subject info
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) { res.status(404).json({ error: 'Subject not found' }); return }

    // Get ingested docs
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []

    // Build context from doc chunks (take first 6000 chars worth)
    let context = ''
    if (docs.length > 0) {
      const allChunks = docs.flatMap(d => d.chunks || [])
      let charCount = 0
      const selectedChunks = []
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 6000) break
        selectedChunks.push(chunk)
        charCount += chunk.length
      }
      context = selectedChunks.join('\n\n')
    }

    // Build prompt
    const topicLine = topicFocus ? `Focus specifically on: ${topicFocus}.` : ''
    const topics = (subject.topics || []).map(t => t.name).join(', ')

    const typeInstructions = {
      mcq: 'Multiple choice questions with 4 options (A, B, C, D). Mark the correct answer.',
      short: 'Short answer questions requiring 1-3 sentence responses.',
      flashcard: 'Flashcard-style questions with a term/concept on one side and definition/explanation on the other.'
    }

    const prompt = context
      ? `You are a ${subject.examBoard} exam tutor for ${subject.name} (Year ${subject.yearLevel}, ${subject.state}).

Generate exactly ${questionCount} ${typeInstructions[questionType] || typeInstructions.mcq}

Use the following study material as your primary source:
---
${context}
---

${topicLine}
Topics covered in this subject: ${topics || 'general course content'}

Return ONLY a JSON array with this exact structure (no markdown, no explanation):
[
  {
    "question": "...",
    "type": "${questionType}",
    ${questionType === 'mcq' ? '"options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A",' : ''}
    ${questionType === 'flashcard' ? '"term": "...", "definition": "...",' : ''}
    ${questionType === 'short' ? '"sampleAnswer": "...",' : ''}
    "explanation": "...",
    "topic": "..."
  }
]`
      : `You are a ${subject.examBoard} exam tutor for ${subject.name} (Year ${subject.yearLevel}, ${subject.state}).

Generate exactly ${questionCount} ${typeInstructions[questionType] || typeInstructions.mcq}

Topics: ${topics || subject.name + ' general content'}
${topicLine}
Exam board: ${subject.examBoard}
Year level: ${subject.yearLevel}

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "question": "...",
    "type": "${questionType}",
    ${questionType === 'mcq' ? '"options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A",' : ''}
    ${questionType === 'flashcard' ? '"term": "...", "definition": "...",' : ''}
    ${questionType === 'short' ? '"sampleAnswer": "...",' : ''}
    "explanation": "...",
    "topic": "..."
  }
]`

    // Call Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      throw new Error(`Claude API error: ${claudeRes.status} ${err}`)
    }

    const claudeData = await claudeRes.json()
    const raw = claudeData.content?.[0]?.text || '[]'

    // Parse JSON from Claude response
    let questions = []
    try {
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      questions = JSON.parse(clean)
    } catch {
      throw new Error('Failed to parse quiz questions from Claude response')
    }

    // Save quiz attempt to Redis
    const quizKey = `sm:quiz:${userId}`
    const existing = await redisGet(quizKey) || []
    const quizRecord = {
      id: Date.now().toString(36),
      subjectId,
      subjectName: subject.name,
      questionType,
      questionCount: questions.length,
      questions,
      createdAt: new Date().toISOString(),
      sourceType: docs.length > 0 ? 'docs' : 'syllabus'
    }
    existing.unshift(quizRecord)
    // Keep last 50 quizzes
    await redisSet(quizKey, existing.slice(0, 50))

    res.status(200).json({
      ok: true,
      quizId: quizRecord.id,
      questions,
      sourceType: quizRecord.sourceType
    })

  } catch (e) {
    console.error('quick-quiz error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
