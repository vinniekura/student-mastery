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

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// Extract JSON from Claude response robustly
function extractJson(text) {
  // Try direct parse first
  try { return JSON.parse(text.trim()) } catch {}

  // Strip markdown code blocks
  const stripped = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim()
  try { return JSON.parse(stripped) } catch {}

  // Find first { ... } block
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }

  throw new Error('Could not extract JSON from response')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const { subjectId, customInstructions = '' } = await parseBody(req)
    if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

    // Get subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) { res.status(404).json({ error: 'Subject not found' }); return }

    const { name, state, examBoard, yearLevel, topics = [], paperFormat = {} } = subject
    const {
      sections = ['Multiple choice', 'Short answer', 'Extended response'],
      totalMarks = 100,
      timeLimitMins = 180
    } = paperFormat

    // Get ingested docs
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    let docContext = ''
    let sourceType = 'syllabus'

    if (docs.length > 0) {
      const allChunks = docs.flatMap(d => d.chunks || [])
      let charCount = 0
      const selected = []
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 6000) break
        selected.push(chunk)
        charCount += chunk.length
      }
      if (charCount > 100) {
        docContext = selected.join('\n\n')
        sourceType = 'docs'
      }
    }

    const topicsList = topics.length > 0
      ? topics.map(t => t.name).join(', ')
      : `General ${name} content`

    const marksPerSection = Math.floor(totalMarks / sections.length)

    const prompt = `You are an expert ${examBoard} exam writer for ${name}, Year ${yearLevel}, ${state}.

Create a realistic mock exam paper. Return ONLY valid JSON, no other text.
${docContext ? `\nBase questions on this study material:\n---\n${docContext.slice(0, 4000)}\n---\n` : ''}
${customInstructions ? `\nExtra instructions: ${customInstructions}\n` : ''}

Return this exact JSON structure:
{
  "title": "${name} Mock Exam",
  "examBoard": "${examBoard}",
  "subject": "${name}",
  "yearLevel": "${yearLevel}",
  "totalMarks": ${totalMarks},
  "timeAllowed": "${timeLimitMins} minutes",
  "instructions": "Answer ALL questions. Write answers in spaces provided.",
  "sections": [
    {
      "name": "${sections[0] || 'Section A'}",
      "type": "mcq",
      "marks": ${marksPerSection},
      "instructions": "Circle the correct answer.",
      "questions": [
        {
          "number": 1,
          "question": "Question text here",
          "marks": 2,
          "type": "mcq",
          "options": ["A. Option 1", "B. Option 2", "C. Option 3", "D. Option 4"],
          "answer": "B",
          "markingCriteria": "Award 2 marks for correct answer.",
          "topic": "${topicsList.split(',')[0]?.trim() || name}"
        }
      ]
    }
  ]
}

Rules:
- Generate ${sections.length} sections matching: ${sections.join(', ')}
- Each section needs 3-5 questions appropriate to its type
- Topics to cover: ${topicsList}
- Match real ${examBoard} exam style and difficulty for Year ${yearLevel}
- Return ONLY the JSON object, nothing else`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          },
          {
            role: 'assistant',
            content: '{'  // Prime Claude to start with JSON
          }
        ]
      })
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      throw new Error(`Claude API error: ${claudeRes.status}`)
    }

    const claudeData = await claudeRes.json()
    // The response continues from our '{'  primer
    const raw = '{' + (claudeData.content?.[0]?.text || '{}')

    let paper
    try {
      paper = extractJson(raw)
    } catch {
      // Last resort — build a basic paper structure
      throw new Error('Paper generation failed — please try again')
    }

    // Ensure required fields
    if (!paper.sections || !Array.isArray(paper.sections)) {
      throw new Error('Invalid paper structure returned')
    }

    // Save to Redis
    const paperRecord = {
      id: genId(),
      subjectId,
      subjectName: name,
      generatedAt: new Date().toISOString(),
      sourceType,
      docCount: docs.length,
      paper
    }

    const paperKey = `sm:papers:${userId}`
    const existing = await redisGet(paperKey) || []
    existing.unshift(paperRecord)
    await redisSet(paperKey, existing.slice(0, 20))

    res.status(200).json({
      ok: true,
      paperId: paperRecord.id,
      paper,
      sourceType
    })

  } catch (e) {
    console.error('generate-mock error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
