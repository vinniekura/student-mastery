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

// Web scout — search for past papers via Claude's web search tool
async function webScout(subject) {
  const query = `${subject.examBoard} ${subject.name} Year ${subject.yearLevel} past exam questions sample paper`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for ${query}. Find 3-5 example exam questions for ${subject.name} (${subject.examBoard}, Year ${subject.yearLevel}). Return a brief summary of question styles and 2-3 actual example questions you find.`
      }]
    })
  })

  if (!res.ok) return null
  const data = await res.json()
  const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n')
  return text || null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const {
      subjectId,
      includeWebScout = true,
      customInstructions = ''
    } = await parseBody(req)

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

    // Get ingested docs for context
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    let docContext = ''
    if (docs.length > 0) {
      const allChunks = docs.flatMap(d => d.chunks || [])
      let charCount = 0
      const selected = []
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 8000) break
        selected.push(chunk)
        charCount += chunk.length
      }
      docContext = selected.join('\n\n')
    }

    // Web scout fallback if no useful docs
    let scoutContext = ''
    let sourceType = 'syllabus'

    if (docContext.length > 200) {
      sourceType = 'docs'
    } else if (includeWebScout) {
      sourceType = 'scout'
      try {
        const scouted = await webScout(subject)
        if (scouted) scoutContext = scouted
      } catch (e) {
        console.log('Web scout failed, continuing without:', e.message)
      }
    }

    const contextSection = docContext
      ? `\n\nUSE THE FOLLOWING STUDY MATERIAL AS YOUR PRIMARY SOURCE:\n---\n${docContext}\n---\n`
      : scoutContext
      ? `\n\nUSE THE FOLLOWING REFERENCE MATERIAL TO INFORM QUESTION STYLE:\n---\n${scoutContext}\n---\n`
      : ''

    const topicsList = topics.length > 0
      ? topics.map(t => t.name).join(', ')
      : `General ${name} content`

    const sectionsDesc = sections.map((s, i) => {
      const marksPerSection = Math.round(totalMarks / sections.length)
      return `Section ${i + 1}: ${s} (${marksPerSection} marks)`
    }).join('\n')

    const prompt = `You are an expert ${examBoard} exam paper writer for ${name}, Year ${yearLevel}, ${state}, Australia.

Create a complete, realistic mock exam paper that closely matches the style, difficulty, and format of actual ${examBoard} exams.
${contextSection}
EXAM SPECIFICATIONS:
- Subject: ${name}
- Exam board: ${examBoard}
- Year level: ${yearLevel}
- State: ${state}
- Total marks: ${totalMarks}
- Time allowed: ${timeLimitMins} minutes
- Topics to cover: ${topicsList}
- Sections: 
${sectionsDesc}
${customInstructions ? `\nAdditional instructions: ${customInstructions}\n` : ''}

CRITICAL REQUIREMENTS:
1. Match the EXACT question style of real ${examBoard} ${name} papers
2. Use appropriate difficulty for Year ${yearLevel} ${state} students
3. Include realistic mark allocations per question
4. For extended response, include the marking criteria
5. Questions must be specific, detailed and exam-ready — not generic

Return a JSON object with this EXACT structure (no markdown, no explanation outside JSON):
{
  "title": "${name} — Mock Exam",
  "examBoard": "${examBoard}",
  "subject": "${name}",
  "yearLevel": "${yearLevel}",
  "totalMarks": ${totalMarks},
  "timeAllowed": "${timeLimitMins} minutes",
  "instructions": "Answer ALL questions. Write your answers in the spaces provided.",
  "sections": [
    {
      "name": "Section name",
      "type": "mcq|short|extended",
      "marks": 30,
      "instructions": "Section-specific instructions",
      "questions": [
        {
          "number": 1,
          "question": "Full question text",
          "marks": 2,
          "type": "mcq|short|extended",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "answer": "B",
          "markingCriteria": "Award 1 mark for... Award 2 marks for...",
          "topic": "Topic name"
        }
      ]
    }
  ]
}`

    // Generate with Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      throw new Error(`Claude API error: ${claudeRes.status} ${err}`)
    }

    const claudeData = await claudeRes.json()
    const raw = claudeData.content?.[0]?.text || '{}'

    let paper
    try {
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      paper = JSON.parse(clean)
    } catch {
      throw new Error('Failed to parse paper from Claude response')
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
    await redisSet(paperKey, existing.slice(0, 20)) // keep last 20

    res.status(200).json({
      ok: true,
      paperId: paperRecord.id,
      paper,
      sourceType,
      docCount: docs.length
    })

  } catch (e) {
    console.error('generate-mock error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
