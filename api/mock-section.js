// api/mock-section.js
// Generates ONE section of a mock paper per invocation.
// Called by QStash — runs in its own Vercel function with full 300s budget.
// After completing, chains the next section via QStash.
// When all sections done, chains mock-assemble.js to combine everything.
//
// Budget per invocation:
//   - 1 Claude call (Haiku for MCQ batches, Sonnet for short/extended)
//   - Max tokens: 4000 output
//   - Wall time: ~30-90s depending on section size
//   - Well within Vercel 300s + QStash 300s limits

import { redisGet, redisSet } from './lib/redis.js'

// ── Utilities ─────────────────────────────────────────────────────────────────

function sanitize(text) {
  if (!text) return ''
  return text
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\u0000/g, '')
    .slice(0, 20000)
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => { body += c.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function extractJson(text) {
  try { return JSON.parse(text) } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) { try { return JSON.parse(fenced[1].trim()) } catch {} }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  return null
}

function getBaseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

async function dispatchToQStash(url, payload) {
  const res = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(url)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
      'Content-Type': 'application/json',
      'Upstash-Timeout': '300'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`QStash dispatch failed: ${res.status} ${err}`)
  }
  return true
}

async function updatePaperProgress(userId, paperId, update) {
  const key = `sm:papers:${userId}`
  const papers = await redisGet(key) || []
  const idx = papers.findIndex(p => p.id === paperId)
  if (idx !== -1) {
    Object.assign(papers[idx], update)
    await redisSet(key, papers)
  }
}

// ── Claude caller ─────────────────────────────────────────────────────────────

async function callClaude(model, systemPrompt, userPrompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ── Diagram builders (inline — no imports needed) ─────────────────────────────

function pickDiagram(questionJson) {
  const t = questionJson.toLowerCase()
  if (t.includes('free-body') || (t.includes('force') && t.includes('object'))) return buildFreeBody()
  if (t.includes('circuit') || t.includes('resistor') || t.includes('voltage')) return buildCircuit()
  if (t.includes('wave') || t.includes('oscillat') || t.includes('sinusoid')) return buildWave()
  if (t.includes('electric field') || t.includes('parallel plate')) return buildParallelPlates()
  if (t.includes('velocity') || t.includes('acceleration') || t.includes('v-t') || t.includes('x-t')) return buildGraph()
  if (t.includes('vector') || t.includes('component') || t.includes('resolv')) return buildVector()
  return null
}

function buildFreeBody() {
  return `<svg viewBox="0 0 200 200" width="180" height="180" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0d9488"/></marker></defs><rect x="80" y="80" width="40" height="40" fill="#334155" stroke="#0d9488" stroke-width="1.5" rx="4"/><text x="100" y="104" fill="#e2e8f0" font-size="9" text-anchor="middle">m</text><line x1="100" y1="80" x2="100" y2="30" stroke="#0d9488" stroke-width="2" marker-end="url(#ah)"/><text x="112" y="52" fill="#e2e8f0" font-size="9">N</text><line x1="100" y1="120" x2="100" y2="170" stroke="#0d9488" stroke-width="2" marker-end="url(#ah)"/><text x="108" y="152" fill="#e2e8f0" font-size="9">W</text><line x1="120" y1="100" x2="168" y2="100" stroke="#0d9488" stroke-width="2" marker-end="url(#ah)"/><text x="148" y="93" fill="#e2e8f0" font-size="9">F</text></svg>`
}

function buildCircuit() {
  return `<svg viewBox="0 0 240 180" width="220" height="165" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ca" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0d9488"/></marker></defs><rect x="30" y="30" width="180" height="120" fill="none" stroke="#0d9488" stroke-width="2" rx="4"/><line x1="30" y1="90" x2="30" y2="70" stroke="#0d9488" stroke-width="2"/><line x1="20" y1="70" x2="40" y2="70" stroke="#0d9488" stroke-width="2.5"/><line x1="25" y1="62" x2="35" y2="62" stroke="#0d9488" stroke-width="1.5"/><text x="8" y="70" fill="#0d9488" font-size="10">+</text><polyline points="115,30 120,20 126,30 132,20 138,30 144,20 150,30" fill="none" stroke="#0d9488" stroke-width="2"/><text x="133" y="14" fill="#e2e8f0" font-size="9" text-anchor="middle">R</text><circle cx="210" cy="90" r="12" fill="none" stroke="#0d9488" stroke-width="2"/><line x1="204" y1="84" x2="216" y2="96" stroke="#0d9488" stroke-width="1.5"/><line x1="216" y1="84" x2="204" y2="96" stroke="#0d9488" stroke-width="1.5"/><text x="120" y="168" fill="#94a3b8" font-size="9" text-anchor="middle">Circuit Diagram</text></svg>`
}

function buildWave() {
  const pts = Array.from({ length: 81 }, (_, i) => `${i * 3 + 10},${80 - Math.sin(i * 0.157) * 38}`).join(' ')
  return `<svg viewBox="0 0 260 160" width="240" height="148" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg"><line x1="10" y1="80" x2="250" y2="80" stroke="#475569" stroke-width="1" stroke-dasharray="4"/><line x1="10" y1="15" x2="10" y2="148" stroke="#475569" stroke-width="1.5"/><line x1="10" y1="148" x2="250" y2="148" stroke="#475569" stroke-width="1.5"/><polyline points="${pts}" fill="none" stroke="#0d9488" stroke-width="2"/><text x="130" y="160" fill="#94a3b8" font-size="8" text-anchor="middle">Position (m)</text><text x="130" y="12" fill="#e2e8f0" font-size="9" text-anchor="middle">Transverse Wave</text></svg>`
}

function buildParallelPlates() {
  return `<svg viewBox="0 0 220 160" width="200" height="148" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ea" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#f59e0b"/></marker></defs><rect x="20" y="20" width="180" height="12" fill="#334155" stroke="#0d9488" stroke-width="1.5" rx="2"/><rect x="20" y="128" width="180" height="12" fill="#334155" stroke="#0d9488" stroke-width="1.5" rx="2"/><text x="8" y="30" fill="#0d9488" font-size="12">+</text><text x="8" y="140" fill="#ef4444" font-size="12">−</text>${[55,95,135,175].map(x => `<line x1="${x}" y1="32" x2="${x}" y2="128" stroke="#f59e0b" stroke-width="1.5" marker-end="url(#ea)" stroke-dasharray="6,2"/>`).join('')}<text x="110" y="154" fill="#94a3b8" font-size="9" text-anchor="middle">Uniform Electric Field ↓</text></svg>`
}

function buildGraph() {
  return `<svg viewBox="0 0 240 180" width="220" height="165" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg"><line x1="40" y1="20" x2="40" y2="155" stroke="#475569" stroke-width="1.5"/><line x1="40" y1="155" x2="225" y2="155" stroke="#475569" stroke-width="1.5"/><line x1="40" y1="60" x2="130" y2="60" stroke="#0d9488" stroke-width="2.5"/><line x1="130" y1="60" x2="220" y2="120" stroke="#0d9488" stroke-width="2" stroke-dasharray="5,3"/><text x="132" y="172" fill="#94a3b8" font-size="9" text-anchor="middle">Time (s)</text><text x="12" y="90" fill="#94a3b8" font-size="8" text-anchor="middle" transform="rotate(-90,12,90)">v (m/s)</text><text x="132" y="14" fill="#e2e8f0" font-size="9" text-anchor="middle">v–t graph</text></svg>`
}

function buildVector() {
  return `<svg viewBox="0 0 200 180" width="180" height="165" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg"><defs><marker id="va" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0d9488"/></marker></defs><line x1="30" y1="150" x2="185" y2="150" stroke="#475569" stroke-width="1"/><line x1="30" y1="20" x2="30" y2="150" stroke="#475569" stroke-width="1"/><line x1="30" y1="150" x2="160" y2="60" stroke="#0d9488" stroke-width="2.5" marker-end="url(#va)"/><line x1="30" y1="150" x2="160" y2="150" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4"/><line x1="160" y1="150" x2="160" y2="60" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4"/><text x="95" y="165" fill="#94a3b8" font-size="9" text-anchor="middle">Fx</text><text x="172" y="110" fill="#94a3b8" font-size="9">Fy</text><text x="82" y="98" fill="#0d9488" font-size="11" font-weight="bold">F</text></svg>`
}

// ── Section generators ─────────────────────────────────────────────────────────

async function generateMCQSection(section, scope, context) {
  const subjectName = scope.subjectName || 'the subject'
  const examBoard = scope.examBoard || ''
  const questionCount = section.questionCount || 20
  const marksEach = section.marksPerQuestion || 1
  const topics = (scope.topics || []).map(t => typeof t === 'string' ? t : t.name)

  // For large MCQ sections (>15 Qs), split into two Claude calls of ~10 Qs each
  // to stay comfortably within token limits
  const BATCH_SIZE = 12

  if (questionCount <= BATCH_SIZE) {
    return await _mcqBatch(section, scope, context, topics, 1, questionCount, questionCount)
  }

  // Multi-batch: split topic list across batches
  const batch1Count = Math.ceil(questionCount / 2)
  const batch2Count = questionCount - batch1Count
  const topics1 = topics.slice(0, Math.ceil(topics.length / 2))
  const topics2 = topics.slice(Math.floor(topics.length / 2))

  const [b1, b2] = await Promise.all([
    _mcqBatch(section, scope, context, topics1.length ? topics1 : topics, 1, batch1Count, questionCount),
    _mcqBatch(section, scope, context, topics2.length ? topics2 : topics, batch1Count + 1, batch2Count, questionCount)
  ])

  const combined = {
    sectionName: section.name,
    sectionType: 'Multiple Choice',
    instructions: section.instructions || `Answer ALL ${questionCount} questions. Each question is worth ${marksEach} mark.`,
    questions: [
      ...(b1?.questions || []),
      ...(b2?.questions || [])
    ]
  }
  // Re-number
  combined.questions.forEach((q, i) => { q.number = i + 1 })
  return combined
}

async function _mcqBatch(section, scope, context, topics, startNum, count, totalForSection) {
  const subjectName = scope.subjectName || 'the subject'
  const examBoard = scope.examBoard || ''
  const marksEach = section.marksPerQuestion || 1
  const topicList = topics.join(', ')

  const prompt = `You are writing a ${subjectName} ${examBoard} exam.

SECTION: ${section.name} — Multiple Choice
Generate EXACTLY ${count} multiple choice questions (numbered ${startNum} to ${startNum + count - 1}).
Each question is worth ${marksEach} mark.
${section.instructions ? `Instructions: ${section.instructions}` : ''}

TOPICS to cover (distribute evenly — do NOT cluster on one topic):
${topicList}

REFERENCE MATERIAL (use for accurate content):
${context.slice(0, 3500)}

Return ONLY this JSON (no preamble, no explanation):
{
  "sectionName": "${section.name}",
  "sectionType": "Multiple Choice",
  "instructions": "${section.instructions || `Answer ALL ${totalForSection} questions. Each question is worth ${marksEach} mark.`}",
  "questions": [
    {
      "number": ${startNum},
      "topic": "exact topic name",
      "stem": "Clear question text ending with a question mark or colon",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "A",
      "marks": ${marksEach},
      "explanation": "Why this answer is correct (1 sentence)"
    }
  ]
}`

  // Use Haiku for MCQ — fast and cheap, good for factual Q generation
  const raw = await callClaude(
    'claude-haiku-4-5-20251001',
    'You write exam questions. Return ONLY valid JSON. No markdown. No explanation.',
    prompt,
    3500
  )
  return extractJson(raw)
}

async function generateShortAnswerSection(section, scope, context) {
  const subjectName = scope.subjectName || 'the subject'
  const examBoard = scope.examBoard || ''
  const questionCount = section.questionCount || 5
  const totalMarks = section.totalMarks || 50
  const marksPerQ = Math.round(totalMarks / questionCount)
  const topics = (scope.topics || []).map(t => typeof t === 'string' ? t : t.name)
  const topicList = topics.join(', ')

  const prompt = `You are writing a ${subjectName} ${examBoard} exam.

SECTION: ${section.name} — Short Answer
Generate EXACTLY ${questionCount} short answer questions.
Total marks for this section: ${totalMarks} marks (~${marksPerQ} marks per question).
${section.instructions ? `Instructions: ${section.instructions}` : ''}

TOPICS (distribute evenly across all questions — one distinct topic per question):
${topicList}

REFERENCE MATERIAL:
${context.slice(0, 4000)}

IMPORTANT:
- Each question must have 2–4 lettered parts (a, b, c, d)
- Parts must build from easier to harder within each question
- Include a "context" field (scenario, diagram description, or data table) for each question
- Mark allocation per part must add up to the question total
- Where relevant, add "diagramType": one of: "free-body", "circuit", "wave", "parallel-plates", "graph", "vector"

Return ONLY this JSON:
{
  "sectionName": "${section.name}",
  "sectionType": "Short Answer",
  "instructions": "${section.instructions || `Answer ALL ${questionCount} questions.`}",
  "questions": [
    {
      "number": 1,
      "topic": "exact topic name",
      "context": "A 2 kg block is placed on a rough surface with coefficient of friction 0.3...",
      "diagramType": "free-body",
      "parts": [
        {
          "part": "a",
          "question": "Calculate the frictional force acting on the block.",
          "marks": 3,
          "markingCriteria": [
            "Correct formula: f = μN (1 mark)",
            "Correct substitution: f = 0.3 × 2 × 9.8 (1 mark)",
            "Correct answer: 5.88 N (1 mark)"
          ]
        }
      ],
      "totalMarks": ${marksPerQ}
    }
  ]
}`

  // Use Sonnet for short answer — needs more reasoning
  const raw = await callClaude(
    'claude-sonnet-4-20250514',
    'You write exam questions. Return ONLY valid JSON. No markdown fences. No preamble.',
    prompt,
    4500
  )
  return extractJson(raw)
}

async function generateExtendedSection(section, scope, context) {
  const subjectName = scope.subjectName || 'the subject'
  const examBoard = scope.examBoard || ''
  const questionCount = section.questionCount || 2
  const totalMarks = section.totalMarks || 30
  const topics = (scope.topics || []).map(t => typeof t === 'string' ? t : t.name)
  const topicList = topics.join(', ')

  const prompt = `You are writing a ${subjectName} ${examBoard} exam.

SECTION: ${section.name} — Extended Response
Generate EXACTLY ${questionCount} extended response question(s).
Total marks: ${totalMarks} marks.
${section.instructions ? `Instructions: ${section.instructions}` : ''}

TOPICS: ${topicList}

REFERENCE MATERIAL:
${context.slice(0, 3500)}

Extended response questions require synthesis, multi-step reasoning, and evaluation.
Each question should have 3–5 parts (a, b, c...) of increasing complexity.

Return ONLY this JSON:
{
  "sectionName": "${section.name}",
  "sectionType": "Extended Response",
  "instructions": "${section.instructions || 'Answer all parts. Show all working. Marks are awarded for method and reasoning.'}",
  "questions": [
    {
      "number": 1,
      "topic": "topic name",
      "context": "Rich scenario or stimulus text with data...",
      "parts": [
        {
          "part": "a",
          "question": "Detailed question part requiring extended reasoning...",
          "marks": 8,
          "markingCriteria": [
            "Correct identification of relevant principle (2 marks)",
            "Correct mathematical approach (2 marks)",
            "Correct calculation with units (2 marks)",
            "Logical conclusion (2 marks)"
          ]
        }
      ],
      "totalMarks": ${Math.round(totalMarks / questionCount)}
    }
  ]
}`

  const raw = await callClaude(
    'claude-sonnet-4-20250514',
    'You write exam questions. Return ONLY valid JSON. No markdown. No preamble.',
    prompt,
    4000
  )
  return extractJson(raw)
}

// ── Main handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Verify QStash signature (prevents external calls)
  // In production, verify: require('@upstash/qstash/nextjs').verifySignatureEdge
  // For now, trust internal calls

  let body
  try { body = await parseBody(req) } catch { return res.status(400).json({ error: 'Invalid body' }) }

  const { paperId, userId, subjectId, sectionIndex, sectionsTotal, sections } = body

  if (!paperId || !userId || !subjectId || sectionIndex === undefined) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // Immediately ACK to QStash (must respond within 30s or QStash retries)
  res.status(200).json({ ok: true, processing: `section ${sectionIndex + 1} of ${sectionsTotal}` })

  // All work happens after the response (Vercel continues async)
  try {
    const section = sections[sectionIndex]
    const sType = (section.type || '').toLowerCase()

    // Update progress
    const progressPct = Math.round(10 + (sectionIndex / sectionsTotal) * 75)
    await updatePaperProgress(userId, paperId, {
      progress: progressPct,
      statusMsg: `Generating ${section.name} (${sectionIndex + 1}/${sectionsTotal})…`
    })

    // Get scope + docs
    const scope = await redisGet(`sm:scope:${userId}:${subjectId}`) || {}
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []

    // Build context string (keep small — ~4000 chars from past papers only)
    let context = ''
    const pastPapers = docs.filter(d => d.role === 'past_paper')
    const sourceDocs = pastPapers.length > 0 ? pastPapers : docs
    for (const doc of sourceDocs.slice(0, 3)) {
      context += (doc.chunks || []).slice(0, 5).map(sanitize).join('\n') + '\n'
    }

    // Generate this section
    let sectionData = null
    try {
      if (sType.includes('multiple choice') || sType.includes('mcq')) {
        sectionData = await generateMCQSection(section, scope, context)
      } else if (sType.includes('extended') || sType.includes('essay')) {
        sectionData = await generateExtendedSection(section, scope, context)
      } else {
        sectionData = await generateShortAnswerSection(section, scope, context)
      }
    } catch (genErr) {
      console.error(`Section ${sectionIndex} generation error:`, genErr.message)
      sectionData = {
        sectionName: section.name,
        sectionType: section.type,
        instructions: section.instructions || '',
        questions: [],
        error: genErr.message
      }
    }

    // Inject SVG diagrams
    if (sectionData?.questions) {
      for (const q of sectionData.questions) {
        const diagramFn = q.diagramType ? {
          'free-body': buildFreeBody,
          'circuit': buildCircuit,
          'wave': buildWave,
          'parallel-plates': buildParallelPlates,
          'graph': buildGraph,
          'vector': buildVector
        }[q.diagramType] : null

        if (diagramFn) {
          q.diagramSvg = diagramFn()
        } else {
          const auto = pickDiagram(JSON.stringify(q))
          if (auto) q.diagramSvg = auto
        }
      }
    }

    // Save section result to Redis (partial paper storage)
    const sectionKey = `sm:paper-section:${userId}:${paperId}`
    const existing = await redisGet(sectionKey) || {}
    existing[sectionIndex] = sectionData
    await redisSet(sectionKey, existing, 3600) // 1hr TTL — cleaned up after assembly

    // Chain next step via QStash
    const baseUrl = getBaseUrl()

    if (sectionIndex + 1 < sectionsTotal) {
      // Chain next section
      await dispatchToQStash(`${baseUrl}/api/mock-section`, {
        paperId,
        userId,
        subjectId,
        sectionIndex: sectionIndex + 1,
        sectionsTotal,
        sections
      })

      await updatePaperProgress(userId, paperId, {
        progress: progressPct + Math.round(75 / sectionsTotal),
        statusMsg: `${section.name} done — starting ${sections[sectionIndex + 1].name}…`
      })
    } else {
      // All sections done — chain assembler
      await dispatchToQStash(`${baseUrl}/api/mock-assemble`, {
        paperId,
        userId,
        subjectId,
        sectionsTotal,
        sections
      })

      await updatePaperProgress(userId, paperId, {
        progress: 88,
        statusMsg: 'All sections done — assembling paper…'
      })
    }

  } catch (e) {
    console.error('mock-section fatal error:', e.message)
    await updatePaperProgress(userId, paperId, {
      status: 'error',
      error: e.message
    })
  }
}
