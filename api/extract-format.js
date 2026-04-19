import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const { url = '' } = req
  const qIndex = url.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
  const subjectId = params.get('subjectId')

  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  try {
    // Get past paper docs
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    const pastPapers = allDocs.filter(d => d.docType === 'past-paper')

    if (pastPapers.length === 0) {
      res.status(400).json({ error: 'No past papers uploaded. Upload a past paper first.' })
      return
    }

    // Get chunks from past papers
    const chunks = pastPapers.flatMap(d => d.chunks || [])
    let context = ''
    let charCount = 0
    for (const chunk of chunks) {
      if (charCount + chunk.length > 5000) break
      context += chunk + '\n\n'
      charCount += chunk.length
    }

    if (charCount < 50) {
      res.status(400).json({ error: 'Past papers have no extractable text. Make sure they are uploaded correctly.' })
      return
    }

    // Ask Claude to extract the exam format
    const prompt = `Analyse this exam paper content and extract the exact format/structure.

EXAM CONTENT:
${context}

Extract and return ONLY a JSON object describing the exam format:
{
  "totalMarks": <number>,
  "timeAllowed": "<string e.g. '3 hours'>",
  "sections": [
    {
      "name": "<section name>",
      "type": "<mcq|short|extended|mixed>",
      "marks": <number>,
      "questionCount": <number>,
      "marksPerQuestion": <number or null if varied>,
      "instructions": "<exact instructions from paper>",
      "hasFormulas": <true/false>,
      "hasDiagrams": <true/false>,
      "notes": "<any special requirements>"
    }
  ],
  "formulaSheet": <true/false>,
  "allowedMaterials": "<e.g. 'Scientific calculator, ruler'>",
  "questionStyle": "<brief description of question style>",
  "difficultyNotes": "<observations about difficulty level>"
}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }
        ]
      })
    })

    if (!claudeRes.ok) throw new Error(`Claude error: ${claudeRes.status}`)

    const data = await claudeRes.json()
    const raw = '{' + (data.content?.[0]?.text || '{}')

    let format
    try {
      const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
      format = JSON.parse(clean)
    } catch {
      throw new Error('Could not extract format from paper')
    }

    // Save format to subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const idx = subjects.findIndex(s => s.id === subjectId)
    if (idx >= 0) {
      subjects[idx].extractedFormat = format
      subjects[idx].formatExtractedAt = new Date().toISOString()
      await redisSet(`sm:subjects:${userId}`, subjects)
    }

    res.status(200).json({ ok: true, format })
  } catch (e) {
    console.error('extract-format error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
