// api/analyse-docs.js
// Analyses all uploaded docs for a subject → extracts exact exam format + topics
// Returns human-readable feedback card + structured scope for mock generation

import { redisGet, redisSet } from '../src/lib/redis.js'
import { requireAuth } from '../src/lib/clerk.js'

function sanitize(text) {
  if (!text) return ''
  return text
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\u0000/g, '')
    .slice(0, 18000)
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

async function callClaude(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })
  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error: ${response.status} ${err}`)
  }
  const data = await response.json()
  return data.content?.[0]?.text || ''
}

function extractJson(text) {
  // Try direct parse first
  try { return JSON.parse(text) } catch {}
  // Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) { try { return JSON.parse(fenced[1].trim()) } catch {} }
  // Extract first {...} block
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId
  try { userId = await requireAuth(req) } catch { return res.status(401).json({ error: 'Unauthorized' }) }

  try {
    const { subjectId } = await parseBody(req)
    if (!subjectId) return res.status(400).json({ error: 'subjectId required' })

    // Get all docs for this subject
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    if (docs.length === 0) return res.status(400).json({ error: 'No documents uploaded for this subject' })

    // Get subject info
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId) || {}

    // Separate past papers from notes/context (based on metadata flags or doc name heuristics)
    const pastPapers = docs.filter(d =>
      d.role === 'past_paper' ||
      /exam|test|paper|assessment|past/i.test(d.name || '') ||
      d.isPastPaper === true
    )
    const contextDocs = docs.filter(d =>
      !pastPapers.includes(d) &&
      (d.role === 'context' || d.role === 'notes' || !d.role)
    )

    // Build text sample from past papers (prioritised), fallback to all docs
    const primaryDocs = pastPapers.length > 0 ? pastPapers : docs
    let paperText = ''
    for (const doc of primaryDocs.slice(0, 4)) {
      const chunks = doc.chunks || []
      // Take first 3000 chars from each paper
      paperText += `\n\n=== DOCUMENT: ${doc.name || 'Untitled'} ===\n`
      paperText += chunks.slice(0, 8).join('\n').slice(0, 3000)
    }

    // Build topics text from ALL docs
    let allTopicsText = ''
    for (const doc of docs) {
      const chunks = doc.chunks || []
      allTopicsText += chunks.slice(0, 4).join('\n').slice(0, 1500) + '\n'
    }

    const systemPrompt = `You are an expert educational analyst. 
Analyse exam papers and educational documents to extract exact exam format specifications and comprehensive topic coverage.
You ALWAYS respond in valid JSON only. No preamble. No explanation outside the JSON.`

    const userPrompt = `Analyse these ${primaryDocs.length > 0 ? 'PAST EXAM PAPERS' : 'educational documents'} for a student.

${paperText.slice(0, 12000)}

${contextDocs.length > 0 ? `\n\nADDITIONAL CONTEXT DOCS:\n${allTopicsText.slice(0, 4000)}` : ''}

Extract and return this JSON structure EXACTLY:

{
  "subjectName": "detected subject name",
  "examType": "unit test | end of term exam | end of year exam | assignment | other",
  "examBoard": "BSSS | VCAA | NESA | WACE | SACE | QCE | IB | other",
  "duration": "e.g. 60 minutes",
  "totalMarks": 100,
  "hasMCQ": true,
  "pastPapersFound": ${pastPapers.length},
  "totalDocsAnalysed": ${docs.length},
  "sections": [
    {
      "name": "Section A",
      "type": "Multiple Choice",
      "questionCount": 20,
      "marksPerQuestion": 1,
      "totalMarks": 20,
      "timeAllocation": "20 minutes",
      "instructions": "exact wording of instructions if found"
    },
    {
      "name": "Section B",
      "type": "Short Answer",
      "questionCount": 5,
      "marksPerQuestion": 10,
      "totalMarks": 50,
      "timeAllocation": "40 minutes",
      "instructions": "exact wording of instructions if found"
    }
  ],
  "topics": [
    {
      "name": "Topic name",
      "subtopics": ["subtopic 1", "subtopic 2"],
      "frequency": "appears in 3/4 papers",
      "priority": "high | medium | low"
    }
  ],
  "detectedDiagramTypes": ["free-body diagram", "circuit diagram", "graph"],
  "confidence": "high | medium | low",
  "confidenceReason": "Found 3 complete past papers with clear section structure",
  "warnings": ["any issues found e.g. handwritten solution sheets detected and filtered"]
}`

    const raw = await callClaude(systemPrompt, userPrompt)
    const scope = extractJson(raw)

    if (!scope) {
      return res.status(500).json({ error: 'Could not parse document structure. Please try again.' })
    }

    // Build human-readable feedback
    const feedback = buildHumanFeedback(scope, docs, pastPapers, contextDocs)

    // Save scope to Redis
    const scopeRecord = {
      ...scope,
      subjectId,
      analysedAt: new Date().toISOString(),
      confirmed: false,
      feedback
    }
    await redisSet(`sm:scope:${userId}:${subjectId}`, scopeRecord)

    return res.status(200).json({ ok: true, scope: scopeRecord, feedback })

  } catch (e) {
    console.error('analyse-docs error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}

function buildHumanFeedback(scope, allDocs, pastPapers, contextDocs) {
  const lines = []

  // What I found
  if (pastPapers.length > 0) {
    lines.push(`I found **${pastPapers.length} past exam paper${pastPapers.length > 1 ? 's' : ''}** and ${contextDocs.length} supporting document${contextDocs.length !== 1 ? 's' : ''}.`)
  } else {
    lines.push(`I found **${allDocs.length} document${allDocs.length !== 1 ? 's' : ''}** (no past papers detected — I'll use these as topic reference).`)
  }

  // Subject and exam type
  if (scope.subjectName) {
    lines.push(`This looks like **${scope.subjectName}** — a **${scope.examType || 'exam'}**${scope.examBoard && scope.examBoard !== 'other' ? ` (${scope.examBoard})` : ''}.`)
  }

  // Duration and marks
  if (scope.duration || scope.totalMarks) {
    const parts = []
    if (scope.duration) parts.push(scope.duration)
    if (scope.totalMarks) parts.push(`${scope.totalMarks} marks total`)
    lines.push(`The exam runs for **${parts.join(', ')}**.`)
  }

  // Sections breakdown
  if (scope.sections && scope.sections.length > 0) {
    lines.push(`I detected **${scope.sections.length} section${scope.sections.length !== 1 ? 's' : ''}**:`)
    for (const s of scope.sections) {
      lines.push(`• **${s.name}** — ${s.questionCount} ${s.type} question${s.questionCount !== 1 ? 's' : ''} (${s.totalMarks} marks)${s.instructions ? ` — "*${s.instructions.slice(0, 80)}*"` : ''}`)
    }
  }

  // Topics
  const highPriority = (scope.topics || []).filter(t => t.priority === 'high').map(t => t.name)
  const allTopics = (scope.topics || []).map(t => t.name)
  if (highPriority.length > 0) {
    lines.push(`The **most heavily tested topics** are: ${highPriority.slice(0, 5).join(', ')}.`)
  }
  lines.push(`I'll generate questions covering **${allTopics.length} topic${allTopics.length !== 1 ? 's' : ''}** across all mock papers.`)

  // Diagrams
  if (scope.detectedDiagramTypes && scope.detectedDiagramTypes.length > 0) {
    lines.push(`I noticed diagrams in the papers: **${scope.detectedDiagramTypes.join(', ')}** — I'll include similar ones in your mocks.`)
  }

  // Confidence
  if (scope.confidence === 'low') {
    lines.push(`⚠️ My confidence is **low** — ${scope.confidenceReason || 'limited paper content found'}. Please review the format below before generating.`)
  } else if (scope.confidence === 'medium') {
    lines.push(`🟡 Confidence is **medium** — ${scope.confidenceReason || 'some format details inferred'}. Check the section counts below.`)
  } else {
    lines.push(`✅ Confidence is **high** — ${scope.confidenceReason || 'clear exam structure detected'}.`)
  }

  // Warnings
  if (scope.warnings && scope.warnings.length > 0) {
    for (const w of scope.warnings) {
      lines.push(`ℹ️ ${w}`)
    }
  }

  lines.push(`Review the format below and adjust anything before generating your first mock paper.`)

  return lines.join('\n\n')
}
