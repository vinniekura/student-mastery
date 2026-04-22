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

function sanitizeText(text) {
  if (!text) return ''
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

// Detect if a document is a handwritten solution/answer sheet — should be ignored
function isHandwrittenSolution(filename, chunks) {
  const name = (filename || '').toLowerCase()
  const solutionKeywords = ['solution', 'answer', 'marking', 'mark scheme', 'worked', 'model answer']
  if (solutionKeywords.some(k => name.includes(k))) return true
  // Check first chunk for solution indicators
  const firstChunk = (chunks?.[0] || '').toLowerCase()
  const solutionPhrases = [
    'test solution', 'mid unit solution', 'unit solution',
    'question 1\na)', 'question 1\n(a)',
    'marking guide', 'sample answer', 'suggested answer'
  ]
  return solutionPhrases.some(p => firstChunk.includes(p))
}

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const url = req.url || ''
  const qIdx = url.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
  const subjectId = params.get('subjectId')
  const action    = params.get('action')
  const method    = req.method

  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  const docsKey  = `sm:docs:${userId}:${subjectId}`
  const scopeKey = `sm:scope:${userId}:${subjectId}`

  try {

    if (method === 'GET' && !action) {
      const docs = await redisGet(docsKey) || []
      res.status(200).json({ docs: docs.map(({ chunks, ...rest }) => rest) })
      return
    }

    if (method === 'GET' && action === 'scope') {
      const scope = await redisGet(scopeKey) || null
      res.status(200).json({ scope })
      return
    }

    if (method === 'DELETE' && params.get('docId')) {
      const docs = await redisGet(docsKey) || []
      await redisSet(docsKey, docs.filter(d => d.id !== params.get('docId')))
      res.status(200).json({ ok: true })
      return
    }

    if (method === 'DELETE' && action === 'scope') {
      await redisSet(scopeKey, null)
      res.status(200).json({ ok: true })
      return
    }

    if (method === 'POST' && action === 'scope') {
      const body = await parseBody(req)
      if (!body.confirmedScope) { res.status(400).json({ error: 'confirmedScope required' }); return }
      const scope = { ...body.confirmedScope, confirmedAt: new Date().toISOString(), confirmed: true }
      await redisSet(scopeKey, scope)
      res.status(200).json({ scope })
      return
    }

    if (method === 'POST' && action === 'analyse') {
      const allDocs = await redisGet(docsKey) || []
      if (allDocs.length === 0) {
        res.status(400).json({ error: 'No documents uploaded yet. Upload past papers or notes first.' })
        return
      }

      const subjects = await redisGet(`sm:subjects:${userId}`) || []
      const subject  = subjects.find(s => s.id === subjectId) || {}

      // Filter out handwritten solution sheets — only use question papers
      const questionDocs = allDocs.filter(d => !isHandwrittenSolution(d.filename, d.chunks))
      const ignoredDocs  = allDocs.filter(d => isHandwrittenSolution(d.filename, d.chunks))

      if (ignoredDocs.length > 0) {
        console.log(`Ignoring ${ignoredDocs.length} solution/handwriting docs: ${ignoredDocs.map(d=>d.filename).join(', ')}`)
      }

      const docsToAnalyse = questionDocs.length > 0 ? questionDocs : allDocs

      // Sample text — prioritise question paper content
      let docSamples = ''
      let totalChars = 0
      const MAX_CHARS = 3000

      for (const doc of docsToAnalyse) {
        const label = `\n--- ${sanitizeText(doc.filename)} ---\n`
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

      const docSummary = docsToAnalyse.map(d =>
        `• ${sanitizeText(d.filename)} (${d.chunkCount || 0} sections)`
      ).join('\n')

      const ignoredSummary = ignoredDocs.length > 0
        ? `\nIgnored as solution/handwriting sheets: ${ignoredDocs.map(d=>sanitizeText(d.filename)).join(', ')}`
        : ''

      const prompt = `You are analysing a student's uploaded exam papers to extract the exam scope and format for mock paper generation.

SUBJECT INFO: ${subject.name || 'Unknown'} | ${subject.examBoard || 'Unknown'} | Year ${subject.yearLevel || '?'} | ${subject.state || 'ACT'}

QUESTION PAPERS ANALYSED (${docsToAnalyse.length} total):
${docSummary}${ignoredSummary}

DOCUMENT CONTENT SAMPLE:
${docSamples}

Analyse the question papers and extract:

1. TERM / PERIOD — what assessment period these papers cover

2. EXAM TYPE — unit test, final exam, mid-unit test, assignment, UCAT, GAMSAT, etc.

3. EXAM FORMAT — CRITICAL: look very carefully at the actual structure:
   - Does this paper have Multiple Choice questions? (Look for A. B. C. D. options)
   - Does this paper have ONLY long answer / multi-part questions like (a)(b)(c)(d)?
   - What are the actual section names (if any)?
   - Total marks, time allowed

4. SPECIFIC SUB-TOPICS — list every specific concept, technique, formula tested.
   Rules:
   - One item per distinct question type
   - Include the specific method/formula in the name
   - Aim for 8-15 specific items
   BAD: ["Probability", "Statistics"] — too broad
   GOOD: ["Uniform continuous distribution — P(X<k)", "Binomial distribution B(n,p)", "Poisson approximation to binomial", "Normal distribution — standardising Z=(X-μ)/σ", "Central limit theorem — sample means", "Hypothesis testing — p-value", "Confidence intervals — 95% CI", "Expected value E(X) and Var(X) for continuous distributions"]

5. DIFFICULTY PROFILE — cognitive level, steps per problem, working required

6. CONFIDENCE in this analysis

IMPORTANT FORMAT DETECTION:
- If you see questions structured as "Question 1. [N Marks]" with parts (a)(b)(c) → hasMCQ: false, sectionType: "long-answer-only"
- If you see "1. A. B. C. D." style questions → hasMCQ: true
- Specialist Maths, Statistics, English, Law, GAMSAT Section 2 → almost always long-answer-only
- Physics, Chemistry BSSS → usually has MCQ section

Return ONLY valid JSON, no markdown:
{
  "subject": "Specialist Mathematics",
  "levelDescription": "Year 12 BSSS ACT",
  "term": "SMO5 Statistics and Statistics Extension",
  "termOptions": ["SMO5 Statistics", "SMO4", "SMO3", "Semester 1", "Semester 2"],
  "examType": "mid unit test",
  "examTypeOptions": ["unit test", "mid unit test", "final exam", "assignment", "UCAT", "GAMSAT", "IELTS"],
  "hasMCQ": false,
  "sectionType": "long-answer-only",
  "topics": [
    "Uniform continuous distribution — P(X<k) and E(X)",
    "Probability density function — finding constants and sketching f(x)",
    "Cumulative distribution function F(x) — defining and using",
    "Binomial distribution B(n,p) — calculating exact probabilities",
    "Poisson distribution Po(λ) — approximation and exact probabilities",
    "Normal distribution — standardising Z=(X-μ)/σ and finding P(X<k)",
    "Central limit theorem — distribution of sample means",
    "Expected value E(aX+b) and Variance Var(aX+b)",
    "Percentiles — finding x given P(X<x)=p",
    "Hypothesis testing — null hypothesis, p-value, conclusion"
  ],
  "format": {
    "totalMarks": 77,
    "timeMins": 55,
    "sections": ["Long answer questions — 77 marks total"],
    "questionStructure": "Multi-part questions with (a)(b)(c)(d) sub-parts. Marks shown in [N Marks] format.",
    "noMCQ": true
  },
  "curriculum": "BSSS",
  "difficultyProfile": {
    "level": "standard",
    "description": "Multi-step probability calculations, sketch graphs, define CDF. Mix of recall and application.",
    "cognitiveLevel": "apply",
    "stepsPerCalculation": "2-4",
    "workingRequired": true,
    "marksPerQuestion": "9-14"
  },
  "ignoredDocs": ["download (64).pdf", "download (65).pdf"],
  "confidence": "high",
  "confidenceReason": "Two question papers clearly show Statistics unit with probability distributions, no MCQ section",
  "summaryLine": "SMO5 Statistics · Mid Unit Test · BSSS · 55 min · 77 marks · Long answer only"
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
          max_tokens: 1400,
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
        docCount: docsToAnalyse.length,
        docNames: docsToAnalyse.map(d => sanitizeText(d.filename)),
        ignoredDocNames: ignoredDocs.map(d => sanitizeText(d.filename)),
        analysedAt: new Date().toISOString(),
        confirmed: false  // must be confirmed by user before generating
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
