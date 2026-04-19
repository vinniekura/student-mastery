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

function extractJson(text) {
  try { return JSON.parse(text.trim()) } catch {}
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  try { return JSON.parse(stripped) } catch {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  throw new Error('Could not parse analysis response')
}

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const url = req.url || ''
  const qIdx = url.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
  const subjectId = params.get('subjectId')

  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  const method = req.method

  // ── GET: return saved scope ───────────────────────────────────────────────
  if (method === 'GET') {
    const scope = await redisGet(`sm:scope:${userId}:${subjectId}`) || null
    res.status(200).json({ scope })
    return
  }

  // ── POST: run analysis then save ──────────────────────────────────────────
  if (method === 'POST') {
    try {
      const body = await parseBody(req)
      // If confirming a manually edited scope, just save and return
      if (body.confirmedScope) {
        const scope = { ...body.confirmedScope, confirmedAt: new Date().toISOString(), confirmed: true }
        await redisSet(`sm:scope:${userId}:${subjectId}`, scope)
        res.status(200).json({ scope })
        return
      }

      // Load all docs for this subject
      const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
      if (allDocs.length === 0) {
        res.status(400).json({ error: 'No documents uploaded yet. Upload past papers or notes first.' })
        return
      }

      // Load subject metadata for context
      const subjects = await redisGet(`sm:subjects:${userId}`) || []
      const subject = subjects.find(s => s.id === subjectId) || {}

      // Build a sample of text from all docs (cap at 4000 chars to stay cheap)
      let docSamples = ''
      let totalChars = 0
      const MAX_CHARS = 4000

      for (const doc of allDocs) {
        const chunks = doc.chunks || []
        const docLabel = `\n--- Document: ${doc.filename} (${doc.docType || 'notes'}) ---\n`
        docSamples += docLabel
        totalChars += docLabel.length

        for (const chunk of chunks) {
          if (totalChars + chunk.length > MAX_CHARS) break
          docSamples += chunk + '\n'
          totalChars += chunk.length
        }
        if (totalChars >= MAX_CHARS) break
      }

      const docSummary = allDocs.map(d =>
        `• ${d.filename} — ${d.docType || 'notes'}${d.unit ? ` (tagged: ${d.unit})` : ''}`
      ).join('\n')

      const prompt = `You are analysing a student's uploaded study documents to determine the scope for a mock exam.

SUBJECT: ${subject.name || 'Unknown'} | BOARD: ${subject.examBoard || 'Unknown'} | YEAR: ${subject.yearLevel || 'Unknown'} | STATE: ${subject.state || 'ACT'}

DOCUMENTS UPLOADED (${allDocs.length} total):
${docSummary}

DOCUMENT CONTENT SAMPLE:
${docSamples}

Analyse ALL the documents together and determine:
1. What TERM or assessment period they collectively cover (Term 1, Term 2, Semester 1, etc.)
2. What TOPICS are covered across all documents
3. What TYPE of exam they are preparing for (unit test, final exam, UCAT, GAMSAT, IELTS, etc.)
4. The likely EXAM FORMAT (marks, time, section types)
5. How CONFIDENT you are in this analysis (high/medium/low)

For competitive exams (UCAT, GAMSAT, IELTS, UCAT, AMC, selective), identify the specific sections/modules.
For school exams, identify the term/semester and specific unit content.

Return ONLY valid JSON, no markdown:
{
  "term": "Term 1",
  "termOptions": ["Term 1", "Term 2", "Term 3", "Term 4"],
  "topics": ["Electric fields", "Magnetic fields", "Gravitational fields", "Capacitors", "RC circuits"],
  "examType": "unit test",
  "examTypeOptions": ["unit test", "final exam", "assignment", "UCAT", "GAMSAT", "IELTS"],
  "format": {
    "totalMarks": 61,
    "timeMins": 60,
    "sections": ["10 MCQ (10 marks)", "10 short answer (51 marks)"]
  },
  "curriculum": "BSSS",
  "confidence": "high",
  "confidenceReason": "All 3 documents clearly reference Unit 3a Fields content with consistent topic coverage",
  "summaryLine": "Term 1 · Unit 3a Fields · BSSS · 60 min unit test"
}`

      // Call Claude — small model, low tokens, cheap
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',  // cheapest — this is just metadata extraction
          max_tokens: 800,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: '{' }
          ]
        })
      })

      if (!claudeRes.ok) {
        const err = await claudeRes.text()
        throw new Error(`Claude API error: ${claudeRes.status} ${err.slice(0, 100)}`)
      }

      const claudeData = await claudeRes.json()
      const raw = '{' + (claudeData.content?.[0]?.text || '{}')
      const analysis = extractJson(raw)

      // Save as unconfirmed scope (student still needs to confirm)
      const scope = {
        ...analysis,
        docCount: allDocs.length,
        docNames: allDocs.map(d => d.filename),
        analysedAt: new Date().toISOString(),
        confirmed: false
      }

      await redisSet(`sm:scope:${userId}:${subjectId}`, scope)
      res.status(200).json({ scope })

    } catch (e) {
      console.error('analyse-docs error:', e.message)
      res.status(500).json({ error: e.message })
    }
    return
  }

  // ── DELETE: clear saved scope ─────────────────────────────────────────────
  if (method === 'DELETE') {
    await redisSet(`sm:scope:${userId}:${subjectId}`, null)
    res.status(200).json({ ok: true })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
