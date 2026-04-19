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

// Strip control characters that break JSON serialization
function sanitizeText(text) {
  if (!text) return ''
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')  // control chars except \t \n \r
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const url = req.url || ''
  const qIdx = url.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
  const subjectId = params.get('subjectId')
  const action = params.get('action')
  const method = req.method

  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  const docsKey  = `sm:docs:${userId}:${subjectId}`
  const scopeKey = `sm:scope:${userId}:${subjectId}`

  try {

    // GET /api/docs?subjectId=X — list docs (no chunks)
    if (method === 'GET' && !action) {
      const docs = await redisGet(docsKey) || []
      const summary = docs.map(({ chunks, ...rest }) => rest)
      res.status(200).json({ docs: summary })
      return
    }

    // GET /api/docs?subjectId=X&action=scope — get saved scope
    if (method === 'GET' && action === 'scope') {
      const scope = await redisGet(scopeKey) || null
      res.status(200).json({ scope })
      return
    }

    // DELETE /api/docs?subjectId=X&docId=Y — delete a doc
    if (method === 'DELETE' && params.get('docId')) {
      const docId = params.get('docId')
      const docs = await redisGet(docsKey) || []
      await redisSet(docsKey, docs.filter(d => d.id !== docId))
      res.status(200).json({ ok: true })
      return
    }

    // DELETE /api/docs?subjectId=X&action=scope — clear scope
    if (method === 'DELETE' && action === 'scope') {
      await redisSet(scopeKey, null)
      res.status(200).json({ ok: true })
      return
    }

    // POST /api/docs?subjectId=X&action=scope — confirm scope
    if (method === 'POST' && action === 'scope') {
      const body = await parseBody(req)
      if (!body.confirmedScope) { res.status(400).json({ error: 'confirmedScope required' }); return }
      const scope = { ...body.confirmedScope, confirmedAt: new Date().toISOString(), confirmed: true }
      await redisSet(scopeKey, scope)
      res.status(200).json({ scope })
      return
    }

    // POST /api/docs?subjectId=X&action=analyse — run analysis across all docs
    if (method === 'POST' && action === 'analyse') {
      const allDocs = await redisGet(docsKey) || []
      if (allDocs.length === 0) {
        res.status(400).json({ error: 'No documents uploaded yet. Upload past papers or notes first.' })
        return
      }

      const subjects = await redisGet(`sm:subjects:${userId}`) || []
      const subject = subjects.find(s => s.id === subjectId) || {}

      // Sample text from all docs — sanitize every chunk
      let docSamples = ''
      let totalChars = 0
      const MAX_CHARS = 3000

      for (const doc of allDocs) {
        const label = `\n--- ${sanitizeText(doc.filename)} (${doc.docType || 'notes'}) ---\n`
        docSamples += label
        totalChars += label.length

        for (const chunk of (doc.chunks || [])) {
          const clean = sanitizeText(chunk)
          if (!clean) continue
          if (totalChars + clean.length > MAX_CHARS) break
          docSamples += clean + '\n'
          totalChars += clean.length
        }
        if (totalChars >= MAX_CHARS) break
      }

      const docSummary = allDocs.map(d =>
        `• ${sanitizeText(d.filename)} — ${d.docType || 'notes'} (${d.chunkCount || 0} chunks)`
      ).join('\n')

      const prompt = `You are analysing a student's uploaded study documents to determine the scope for a mock exam.

SUBJECT: ${subject.name || 'Unknown'} | BOARD: ${subject.examBoard || 'Unknown'} | YEAR: ${subject.yearLevel || 'Unknown'} | STATE: ${subject.state || 'ACT'}

DOCUMENTS UPLOADED (${allDocs.length} total):
${docSummary}

DOCUMENT CONTENT SAMPLE:
${docSamples}

Analyse ALL the documents together and determine:
1. What TERM or assessment period they collectively cover (Term 1, Term 2, Term 3, Term 4, Semester 1, Semester 2)
2. What TOPICS are covered across all documents — be specific, list individual physics/subject topics
3. What TYPE of exam (unit test, final exam, assignment, UCAT, GAMSAT, IELTS)
4. The EXAM FORMAT (total marks, time in minutes, section types)
5. How CONFIDENT you are (high/medium/low) and why

Return ONLY valid JSON, no markdown:
{
  "term": "Term 1",
  "termOptions": ["Term 1", "Term 2", "Term 3", "Term 4"],
  "topics": ["Electric fields and charged particle energy", "Magnetic fields", "Gravitational fields"],
  "examType": "unit test",
  "examTypeOptions": ["unit test", "final exam", "assignment", "UCAT", "GAMSAT", "IELTS"],
  "format": {
    "totalMarks": 61,
    "timeMins": 60,
    "sections": ["10 MCQ (10 marks)", "10 short answer (51 marks)"]
  },
  "curriculum": "BSSS",
  "confidence": "high",
  "confidenceReason": "Both documents clearly show Unit 3a Fields content with electric, magnetic and gravitational field questions",
  "summaryLine": "Term 1 · Unit 3a Fields · BSSS · 60 min unit test"
}`

      // Call Claude haiku — cheapest and fast enough for analysis
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: '{' }
          ]
        })
      })

      if (!claudeRes.ok) {
        const err = await claudeRes.text()
        throw new Error(`Claude API error: ${claudeRes.status} ${err.slice(0, 200)}`)
      }

      const claudeData = await claudeRes.json()
      const raw = '{' + (claudeData.content?.[0]?.text || '{}')
      const analysis = extractJson(raw)

      const scope = {
        ...analysis,
        docCount: allDocs.length,
        docNames: allDocs.map(d => sanitizeText(d.filename)),
        analysedAt: new Date().toISOString(),
        confirmed: false
      }

      await redisSet(scopeKey, scope)
      res.status(200).json({ scope })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })

  } catch (e) {
    console.error('docs error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
