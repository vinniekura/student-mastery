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

    // GET /api/docs?subjectId=X — list docs without chunks
    if (method === 'GET' && !action) {
      const docs = await redisGet(docsKey) || []
      res.status(200).json({ docs: docs.map(({ chunks, ...rest }) => rest) })
      return
    }

    // GET /api/docs?subjectId=X&action=scope — get saved scope
    if (method === 'GET' && action === 'scope') {
      const scope = await redisGet(scopeKey) || null
      res.status(200).json({ scope })
      return
    }

    // DELETE /api/docs?subjectId=X&docId=Y — delete one doc
    if (method === 'DELETE' && params.get('docId')) {
      const docs = await redisGet(docsKey) || []
      await redisSet(docsKey, docs.filter(d => d.id !== params.get('docId')))
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

    // POST /api/docs?subjectId=X&action=analyse — analyse all uploaded docs
    if (method === 'POST' && action === 'analyse') {
      const allDocs = await redisGet(docsKey) || []
      if (allDocs.length === 0) {
        res.status(400).json({ error: 'No documents uploaded yet. Upload past papers or notes first.' })
        return
      }

      const subjects = await redisGet(`sm:subjects:${userId}`) || []
      const subject  = subjects.find(s => s.id === subjectId) || {}

      // Sample text from all docs — sanitize every chunk
      let docSamples = ''
      let totalChars = 0
      const MAX_CHARS = 3000

      for (const doc of allDocs) {
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

      const docSummary = allDocs.map(d =>
        `• ${sanitizeText(d.filename)} (${d.chunkCount || 0} sections, ${d.charCount || 0} chars)`
      ).join('\n')

      const prompt = `You are analysing a student's uploaded study documents to extract the exam scope for mock paper generation.

SUBJECT INFO: ${subject.name || 'Unknown'} | ${subject.examBoard || 'Unknown'} | Year ${subject.yearLevel || '?'} | ${subject.state || 'ACT'}

DOCUMENTS UPLOADED (${allDocs.length} total):
${docSummary}

DOCUMENT CONTENT:
${docSamples}

Analyse ALL documents together. Extract:

1. TERM / PERIOD — what assessment period do these docs cover (Term 1, Semester 1, etc.)

2. EXAM TYPE — unit test, final exam, assignment, UCAT, GAMSAT, IELTS, AMC, bar exam, etc.

3. EXAM FORMAT — total marks, time allowed, section structure

4. SPECIFIC SUB-TOPICS — this is the most important field.
   List every SPECIFIC concept, technique, theorem, formula, or skill that appears as a distinct question type.
   Rules:
   - One item per distinct question type — NOT broad headings
   - Include the specific method or formula in the name
   - Aim for 8-15 specific items
   - Read the actual questions carefully — every distinct question type becomes its own topic

   BAD examples (too broad, useless for gap tracking):
   ["Magnetic fields", "Calculus", "Algebra", "Statistics"]

   GOOD examples — Physics:
   ["Electric field strength E=V/d and force F=qE",
    "Charged particle acceleration through potential difference ΔKE=qV",
    "Kinetic energy of charged particles in eV and joules",
    "Magnetic force on moving charges F=qvB",
    "Circular motion of charged particles — radius r=mv/qB",
    "Velocity selector — crossed E and B fields v=E/B",
    "Solenoids — magnetic field B=μ₀NI/L",
    "DC motors and torque on current-carrying loops",
    "Force between parallel current-carrying wires F/L=μ₀I₁I₂/2πd",
    "Gravitational field strength g=GM/r²",
    "Orbital mechanics — circular orbit v=√(GM/r)",
    "Gravitational potential energy and escape velocity"]

   GOOD examples — Mathematics:
   ["Integration by substitution",
    "Integration by parts",
    "Product rule and chain rule differentiation",
    "Newton's method for root finding",
    "Matrix multiplication and inverse 2×2",
    "Eigenvalues and eigenvectors",
    "Geometric series — sum to infinity",
    "Binomial theorem expansion",
    "Normal distribution — finding P(X < k)",
    "Hypothesis testing — t-test and p-values",
    "Complex numbers in polar form — de Moivre's theorem",
    "Proof by mathematical induction"]

   GOOD examples — Law:
   ["Formation of contract — offer and acceptance",
    "Promissory estoppel — elements and application",
    "Negligence — duty of care Donoghue v Stevenson",
    "Causation — but-for test and remoteness",
    "Equitable remedies — specific performance vs damages",
    "Statutory interpretation — purposive approach"]

   GOOD examples — GAMSAT Section 3:
   ["Enzyme kinetics — Michaelis-Menten equation",
    "Acid-base equilibrium — Henderson-Hasselbalch",
    "Genetics — Hardy-Weinberg equilibrium",
    "Thermodynamics — Gibbs free energy ΔG=ΔH-TΔS",
    "Electrochemistry — cell potential and Nernst equation",
    "Optics — lens equation and magnification"]

5. DIFFICULTY PROFILE — analyse the actual questions:
   - Cognitive level: recall / apply / analyse / evaluate
   - Steps per calculation: 1-2 / 2-3 / 3-5
   - Working required: yes/no
   - Marks per question: typical range

6. CONFIDENCE — how confident you are in this analysis and why

Return ONLY valid JSON, no markdown, no explanation:
{
  "subject": "Physics",
  "levelDescription": "Year 12 BSSS ACT",
  "term": "Term 1",
  "termOptions": ["Term 1", "Term 2", "Term 3", "Term 4"],
  "examType": "unit test",
  "examTypeOptions": ["unit test", "final exam", "assignment", "UCAT", "GAMSAT", "IELTS", "AMC", "bar exam", "CPA"],
  "topics": [
    "Electric field strength E=V/d and force F=qE",
    "Charged particle acceleration through potential difference",
    "Magnetic force on moving charges F=qvB",
    "Circular motion of charged particles r=mv/qB",
    "Velocity selector v=E/B",
    "Gravitational field strength g=GM/r²",
    "Orbital mechanics circular orbit v=√(GM/r)"
  ],
  "format": {
    "totalMarks": 61,
    "timeMins": 60,
    "sections": ["Section A: 10 MCQ (10 marks)", "Section B: Short answer (51 marks)"]
  },
  "curriculum": "BSSS",
  "difficultyProfile": {
    "level": "standard",
    "description": "Multi-step calculations with working required. Mix of recall MCQ and application short answer.",
    "cognitiveLevel": "apply",
    "stepsPerCalculation": "2-4",
    "workingRequired": true,
    "marksPerQuestion": "1-5"
  },
  "confidence": "high",
  "confidenceReason": "Two past papers clearly show Fields unit content with electric, magnetic and gravitational questions",
  "summaryLine": "Term 1 · Fields · BSSS · 60 min unit test"
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
          max_tokens: 1200,
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
