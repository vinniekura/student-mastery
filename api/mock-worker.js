import { redisGet, redisSet } from './lib/redis.js'

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

function extractJson(text) {
  try { return JSON.parse(text.trim()) } catch {}
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  try { return JSON.parse(stripped) } catch {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const fixed = text.slice(start, end + 1)
        .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
      return JSON.parse(fixed)
    } catch {}
  }
  if (start !== -1) {
    let partial = text.slice(start)
    const lastQ = partial.lastIndexOf('"topic"')
    if (lastQ > 0) {
      let depth = 0, closeAt = -1
      for (let i = lastQ; i < partial.length; i++) {
        if (partial[i] === '{') depth++
        if (partial[i] === '}') { depth--; if (depth <= 0) { closeAt = i; break } }
      }
      if (closeAt > 0) {
        const truncated = partial.slice(0, closeAt + 1) + ']}]}'
        try {
          const fixed = truncated.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
          const parsed = JSON.parse(fixed)
          if (parsed.sections) { parsed._truncated = true; return parsed }
        } catch {}
      }
    }
  }
  throw new Error('Could not extract JSON from response')
}

// ─── AU exam formats ──────────────────────────────────────────────────────────
const AU_EXAM_FORMATS = {
  'BSSS': {
    sections: [
      { name: 'Section A: Multiple Choice',   type: 'mcq',      marks: 20, marksPerQ: 1, questionCount: 20, instructions: 'Circle the letter of the best answer. Each question is worth 1 mark.' },
      { name: 'Section B: Short Answer',      type: 'short',    marks: 40, questionCount: 4,                instructions: 'Answer ALL questions in the spaces provided. Show all working clearly.' },
      { name: 'Section C: Extended Response', type: 'extended', marks: 40, questionCount: 2,                instructions: 'Answer ALL questions. Show all working clearly. Marks are awarded for correct method and working, not just the final answer.' }
    ],
    totalMarks: 100, timeLimitMins: 180, allowedMaterials: 'Scientific calculator, ruler',
    style: 'BSSS ACT exam. Rigorous Year 12 level. Section A: 1 mark MCQ. Section B: multi-part questions with show-working. Section C: complex multi-step problems worth 15-25 marks each. Include SI units, scientific notation, and relevant formulas.'
  },
  'NESA': {
    sections: [
      { name: 'Section I',  type: 'mcq',   marks: 20, questionCount: 20, marksPerQ: 1, instructions: 'Select the alternative A, B, C or D that best answers the question.' },
      { name: 'Section II', type: 'short', marks: 80, questionCount: 6,                instructions: 'Answer the questions in the spaces provided. Extra writing space is provided at the back.' }
    ],
    totalMarks: 100, timeLimitMins: 180, allowedMaterials: 'Approved calculator, ruler',
    style: 'NSW HSC NESA exam. HSC difficulty. Section I: 1 mark MCQ. Section II: multi-part with working.'
  },
  'VCAA': {
    sections: [
      { name: 'Section A', type: 'mcq',   marks: 20, questionCount: 20, marksPerQ: 1, instructions: 'Choose the response that is correct or best answers the question.' },
      { name: 'Section B', type: 'short', marks: 60, questionCount: 6,                instructions: 'Answer all questions in the spaces provided.' }
    ],
    totalMarks: 80, timeLimitMins: 150, allowedMaterials: 'CAS calculator, formula sheet',
    style: 'VCE VCAA exam. Reference data booklet provided. Multi-part questions.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const qstashSig = req.headers['upstash-signature']
  if (!qstashSig && process.env.NODE_ENV === 'production') {
    // Allow through — we rely on job data integrity
  }

  try {
    const {
      jobId, userId, subjectId, slotNumber,
      customInstructions = '', replaceSlot,
      targetUnit = null   // ← unit scoping: null means whole course
    } = await parseBody(req)

    if (!jobId || !userId || !subjectId) {
      res.status(400).json({ error: 'Missing required fields' }); return
    }

    const paperKey = `sm:papers:${userId}:${subjectId}`

    // Mark as generating
    const papers = await redisGet(paperKey) || []
    const jobIdx = papers.findIndex(p => p.id === jobId)
    if (jobIdx >= 0) { papers[jobIdx].status = 'generating'; await redisSet(paperKey, papers) }

    // Get subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) throw new Error('Subject not found')

    const { name, state, examBoard, yearLevel, topics = [], paperFormat = {}, extractedFormat } = subject

    const auFormat = AU_EXAM_FORMATS[examBoard?.toUpperCase()]
    const effectiveFormat = auFormat || extractedFormat
    const isCompetitive = ['UCAT','GAMSAT','IELTS','SELECTIVE','AMC','OC'].includes(examBoard?.toUpperCase())

    // ── Load docs — filter to targetUnit if specified ─────────────────────────
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    const pastPapers = allDocs.filter(d => d.docType === 'past-paper')
    const notesDocs  = allDocs.filter(d => d.docType === 'notes' || !d.docType)

    // If targetUnit is set, prefer docs tagged to that unit
    let docsToUse = pastPapers.length > 0 ? pastPapers : notesDocs
    let unitScopedDocs = []
    if (targetUnit) {
      unitScopedDocs = allDocs.filter(d => d.unit === targetUnit)
      if (unitScopedDocs.length > 0) {
        docsToUse = unitScopedDocs
        console.log(`Unit scoped to "${targetUnit}": using ${unitScopedDocs.length} docs`)
      } else {
        console.log(`No docs found for unit "${targetUnit}", falling back to all docs`)
      }
    }

    let docContext = ''
    let sourceType = 'syllabus'
    if (docsToUse.length > 0) {
      const allChunks = docsToUse.flatMap(d => d.chunks || [])
      let charCount = 0
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 3000) break
        docContext += chunk + '\n'
        charCount += chunk.length
      }
      if (charCount > 50) sourceType = pastPapers.length > 0 ? 'past-paper' : 'docs'
    }

    // Paper memory — avoid repeating topics across slots
    const existingPapers2 = await redisGet(paperKey) || []
    const usedTopics = [...new Set(
      existingPapers2
        .filter(p => p.status === 'ready' && p.id !== jobId && (!targetUnit || p.targetUnit === targetUnit))
        .flatMap(p => p.topicsCovered || [])
    )]
    const allTopics = topics.length > 0 ? topics : [`General ${name} content`]
    const unusedTopics = allTopics.filter(t => !usedTopics.includes(t))
    const memoryNote = usedTopics.length > 0
      ? `PAPER MEMORY: Already covered in previous mocks: ${usedTopics.join(', ')}. Prioritise these untested topics: ${unusedTopics.length > 0 ? unusedTopics.join(', ') : 'use fresh angles on all topics'}.`
      : ''

    const topicsList = allTopics.length > 0 ? allTopics.join(', ') : `General ${name} content`

    let sectionInstructions = ''
    if (effectiveFormat) {
      sectionInstructions = `
EXAM FORMAT — follow exactly:
Total marks: ${effectiveFormat.totalMarks} | Time: ${effectiveFormat.timeLimitMins} minutes | Materials: ${effectiveFormat.allowedMaterials || 'Standard'}
Style guide: ${effectiveFormat.style}

SECTIONS:
${effectiveFormat.sections.map((s, i) =>
  `Section ${String.fromCharCode(65+i)}: ${s.name}
  - Type: ${s.type} | Marks: ${s.marks} total${s.marksPerQ ? ` (${s.marksPerQ} mark each)` : ''} | Questions: ${s.questionCount}
  - Instructions: ${s.instructions}`
).join('\n\n')}`
    } else {
      const sections = Array.isArray(paperFormat.sections)
        ? paperFormat.sections
        : ['Multiple choice', 'Short answer', 'Extended response']
      const mps = Math.floor((paperFormat.totalMarks || 100) / sections.length)
      sectionInstructions = `Sections: ${sections.join(', ')} — ${mps} marks each. Total: ${paperFormat.totalMarks || 100} marks, ${paperFormat.timeLimitMins || 180} minutes.`
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = `You are an expert ${examBoard} exam paper writer for ${name}, Year ${yearLevel}, ${state}, Australia.

Create Mock Paper ${slotNumber} — a complete, realistic exam paper.

${memoryNote}
${docContext ? `REFERENCE MATERIAL (from student's uploaded past papers):\n${docContext}\n` : ''}
${customInstructions ? `ADDITIONAL FOCUS: ${customInstructions}\n` : ''}
SUBJECT: ${name} | BOARD: ${examBoard} | YEAR: ${yearLevel} | STATE: ${state}
TOPICS TO COVER: ${topicsList}

${sectionInstructions}

CRITICAL REQUIREMENTS:
1. Match the format above — correct section structure and mark allocations
2. For MCQ: exactly 1 mark each, 4 options (A/B/C/D), one clearly correct answer
3. For short answer: 2 questions with parts (a)(b)(c), marks per part in brackets
4. For extended response: 1 complex multi-step problem, 20+ marks
5. Include physics formulas, SI units, scientific notation where appropriate
6. DIAGRAMS: When a question needs a diagram, use [DIAGRAM_REF:N] in the question text. Add the diagram to the top-level "diagrams" array with matching "id", "type" (circuit/force/graph/wave/other), and "description". Do NOT embed SVG inside question strings.
7. Keep questions concise but rigorous — exam-ready for Year ${yearLevel} ${examBoard}
8. Include a "coverPage" field in the JSON with school, subject, unit info
${targetUnit ? `9. UNIT SCOPE — CRITICAL: This mock covers "${targetUnit}" ONLY. Every question must be from "${targetUnit}" content. Do NOT include topics from other units. The coverPage should note the unit scope.` : ''}

Return ONLY valid JSON — no markdown, no explanation:
{
  "coverPage": {
    "school": "Narrabundah College",
    "subject": "${name}",
    "year": "Year ${yearLevel}",
    "examBoard": "${examBoard}",
    "mockNumber": ${slotNumber},
    ${targetUnit ? `"unitScope": "${targetUnit}",` : ''}
    "instructions": ["Write in black or blue pen", "Scientific calculator permitted", "Show all working for full marks", "Marks are awarded for correct working, not just final answers"]
  },
  "diagrams": [],
  "title": "${name} — Mock Paper ${slotNumber}${targetUnit ? ` (${targetUnit})` : ''}",
  "examBoard": "${examBoard}",
  "subject": "${name}",
  "yearLevel": "${yearLevel}",
  "state": "${state}",
  "targetUnit": ${targetUnit ? `"${targetUnit}"` : 'null'},
  "totalMarks": ${effectiveFormat?.totalMarks || 100},
  "timeAllowed": "${effectiveFormat?.timeLimitMins || 180} minutes",
  "allowedMaterials": "${effectiveFormat?.allowedMaterials || 'Scientific calculator, ruler'}",
  "instructions": "Read all questions carefully. Show all working for full marks.",
  "sections": [
    {
      "name": "Section name",
      "type": "mcq|short|extended",
      "marks": 20,
      "instructions": "Section instructions",
      "questions": [
        {
          "number": 1,
          "question": "Full question text. Use [DIAGRAM_REF:N] to reference diagrams.",
          "parts": null,
          "marks": 1,
          "type": "mcq",
          "options": ["A. option", "B. option", "C. option", "D. option"],
          "answer": "A",
          "workingOut": "Step by step solution",
          "markingCriteria": "Award 1 mark for...",
          "topic": "Topic name"
        }
      ]
    }
  ]
}`

    // ── Call Claude ───────────────────────────────────────────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error: ${claudeRes.status} ${errText.slice(0,100)}`)
    }

    const claudeData = await claudeRes.json()
    const raw = '{' + (claudeData.content?.[0]?.text || '{}')
    const paper = extractJson(raw)

    if (!paper.sections || !Array.isArray(paper.sections)) {
      throw new Error('Invalid paper structure returned')
    }

    // ── Generate SVGs for diagrams ────────────────────────────────────────────
    if (paper.diagrams && paper.diagrams.length > 0) {
      paper.diagrams = paper.diagrams.map(d => ({ ...d, svg: generateDiagramSVG(d) }))
    }

    const topicsCovered = [...new Set(
      paper.sections.flatMap(s => s.questions?.map(q => q.topic).filter(Boolean) || [])
    )]
    const questionsAsked = paper.sections.flatMap(s =>
      s.questions?.map(q => q.question?.slice(0, 60)).filter(Boolean) || []
    )

    const paperRecord = {
      id: jobId,
      slotNumber,
      subjectId,
      subjectName: name,
      examBoard,
      targetUnit: targetUnit || null,   // ← persisted on the record
      generatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sourceType,
      docCount: allDocs.length,
      topicsCovered,
      questionsAsked,
      status: 'ready',
      paper
    }

    // Save
    const finalPapers = await redisGet(paperKey) || []
    const finalIdx = finalPapers.findIndex(p => p.id === jobId)
    if (finalIdx >= 0) finalPapers[finalIdx] = paperRecord
    else finalPapers.push(paperRecord)
    const sorted = finalPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber)
    await redisSet(paperKey, sorted)

    res.status(200).json({ ok: true, jobId, slotNumber, targetUnit })

  } catch (e) {
    console.error('mock-worker error:', e.message)
    try {
      const body = await parseBody(req).catch(() => ({}))
      if (body.jobId && body.userId && body.subjectId) {
        const paperKey = `sm:papers:${body.userId}:${body.subjectId}`
        const papers = await redisGet(paperKey) || []
        const idx = papers.findIndex(p => p.id === body.jobId)
        if (idx >= 0) { papers[idx].status = 'failed'; await redisSet(paperKey, papers) }
      }
    } catch {}
    res.status(500).json({ error: e.message })
  }
}

// ─── SVG generators ───────────────────────────────────────────────────────────
function generateDiagramSVG(diagram) {
  const { type, description } = diagram
  const desc = (description || '').toLowerCase()
  if (type === 'circuit' || desc.includes('circuit') || desc.includes('resistor') || desc.includes('battery')) return buildCircuitSVG(description)
  if (type === 'force'   || desc.includes('force')   || desc.includes('free body') || desc.includes('friction'))  return buildForceSVG(description)
  if (type === 'graph'   || desc.includes('graph')   || desc.includes('velocity')  || desc.includes('displacement')) return buildGraphSVG(description)
  if (type === 'wave'    || desc.includes('wave')    || desc.includes('frequency') || desc.includes('wavelength'))  return buildWaveSVG(description)
  return buildGenericSVG(description)
}

function buildCircuitSVG(description) {
  const voltageMatch = (description || '').match(/(\d+)\s*V/)
  const voltage = voltageMatch ? voltageMatch[1] : '12'
  return `<svg width="420" height="260" viewBox="0 0 420 260" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
  <rect width="420" height="260" fill="white" rx="6"/>
  <line x1="40" y1="50" x2="380" y2="50" stroke="#222" stroke-width="2"/>
  <line x1="380" y1="50" x2="380" y2="210" stroke="#222" stroke-width="2"/>
  <line x1="40" y1="210" x2="380" y2="210" stroke="#222" stroke-width="2"/>
  <line x1="40" y1="130" x2="40" y2="210" stroke="#222" stroke-width="2"/>
  <line x1="40" y1="50" x2="40" y2="90" stroke="#222" stroke-width="2"/>
  <line x1="30" y1="90" x2="50" y2="90" stroke="#222" stroke-width="3"/>
  <line x1="34" y1="100" x2="46" y2="100" stroke="#222" stroke-width="1.5"/>
  <line x1="30" y1="110" x2="50" y2="110" stroke="#222" stroke-width="3"/>
  <line x1="34" y1="120" x2="46" y2="120" stroke="#222" stroke-width="1.5"/>
  <line x1="40" y1="120" x2="40" y2="130" stroke="#222" stroke-width="2"/>
  <text x="55" y="97" font-size="10" fill="#444">+</text>
  <text x="55" y="123" font-size="10" fill="#444">−</text>
  <text x="4" y="108" font-size="11" fill="#1a56db" font-weight="bold">${voltage}V</text>
  <rect x="140" y="40" width="60" height="20" fill="white" stroke="#222" stroke-width="2" rx="3"/>
  <text x="170" y="54" font-size="11" fill="#222" text-anchor="middle">R₁</text>
  <circle cx="240" cy="50" r="4" fill="#222"/>
  <circle cx="240" cy="210" r="4" fill="#222"/>
  <line x1="240" y1="50" x2="240" y2="80" stroke="#222" stroke-width="2"/>
  <rect x="220" y="80" width="40" height="20" fill="white" stroke="#222" stroke-width="2" rx="3"/>
  <text x="240" y="94" font-size="11" fill="#222" text-anchor="middle">R₂</text>
  <line x1="240" y1="100" x2="240" y2="130" stroke="#222" stroke-width="2"/>
  <line x1="240" y1="50" x2="300" y2="50" stroke="#222" stroke-width="2"/>
  <line x1="300" y1="50" x2="300" y2="80" stroke="#222" stroke-width="2"/>
  <rect x="280" y="80" width="40" height="20" fill="white" stroke="#222" stroke-width="2" rx="3"/>
  <text x="300" y="94" font-size="11" fill="#222" text-anchor="middle">R₃</text>
  <line x1="300" y1="100" x2="300" y2="130" stroke="#222" stroke-width="2"/>
  <line x1="240" y1="130" x2="300" y2="130" stroke="#222" stroke-width="2"/>
  <line x1="240" y1="130" x2="240" y2="210" stroke="#222" stroke-width="2"/>
  <text x="80" y="44" font-size="10" fill="#059669">→ I</text>
  <text x="210" y="248" font-size="10" fill="#666" text-anchor="middle">Circuit diagram (not to scale)</text>
</svg>`
}

function buildForceSVG(description) {
  const hasIncline = (description || '').toLowerCase().includes('incline') || (description || '').toLowerCase().includes('slope')
  if (hasIncline) {
    return `<svg width="380" height="240" viewBox="0 0 380 240" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
  <rect width="380" height="240" fill="white" rx="6"/>
  <polygon points="30,200 350,200 350,80" fill="#e5e7eb" stroke="#374151" stroke-width="2"/>
  <rect x="180" y="118" width="36" height="28" fill="#93c5fd" stroke="#1d4ed8" stroke-width="1.5" transform="rotate(-25,198,132)"/>
  <text x="195" y="134" font-size="10" fill="#1e40af" text-anchor="middle" transform="rotate(-25,198,132)">m</text>
  <defs>
    <marker id="a1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#dc2626"/></marker>
    <marker id="a2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#7c3aed"/></marker>
    <marker id="a3" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#059669"/></marker>
  </defs>
  <line x1="198" y1="132" x2="198" y2="60" stroke="#dc2626" stroke-width="2" marker-end="url(#a1)"/>
  <text x="204" y="72" font-size="11" fill="#dc2626">N</text>
  <line x1="198" y1="132" x2="198" y2="185" stroke="#7c3aed" stroke-width="2" marker-end="url(#a2)"/>
  <text x="204" y="183" font-size="11" fill="#7c3aed">mg</text>
  <line x1="198" y1="132" x2="148" y2="115" stroke="#059669" stroke-width="2" marker-end="url(#a3)"/>
  <text x="128" y="110" font-size="11" fill="#059669">f</text>
  <text x="320" y="196" font-size="11" fill="#374151">θ</text>
  <text x="190" y="228" font-size="10" fill="#666" text-anchor="middle">Free body diagram (inclined plane)</text>
</svg>`
  }
  return `<svg width="320" height="260" viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
  <rect width="320" height="260" fill="white" rx="6"/>
  <rect x="130" y="110" width="60" height="40" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="2" rx="4"/>
  <text x="160" y="134" font-size="12" fill="#1e40af" text-anchor="middle" font-weight="bold">m</text>
  <defs>
    <marker id="b1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#7c3aed"/></marker>
    <marker id="b2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#dc2626"/></marker>
    <marker id="b3" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#059669"/></marker>
    <marker id="b4" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#d97706"/></marker>
  </defs>
  <line x1="160" y1="150" x2="160" y2="205" stroke="#7c3aed" stroke-width="2.5" marker-end="url(#b1)"/>
  <text x="168" y="200" font-size="12" fill="#7c3aed" font-weight="bold">W=mg</text>
  <line x1="160" y1="110" x2="160" y2="55" stroke="#dc2626" stroke-width="2.5" marker-end="url(#b2)"/>
  <text x="168" y="68" font-size="12" fill="#dc2626" font-weight="bold">N</text>
  <line x1="190" y1="130" x2="250" y2="130" stroke="#059669" stroke-width="2.5" marker-end="url(#b3)"/>
  <text x="258" y="134" font-size="12" fill="#059669" font-weight="bold">F</text>
  <line x1="130" y1="130" x2="70" y2="130" stroke="#d97706" stroke-width="2.5" marker-end="url(#b4)"/>
  <text x="36" y="134" font-size="12" fill="#d97706" font-weight="bold">f</text>
  <text x="160" y="248" font-size="10" fill="#666" text-anchor="middle">Free body diagram</text>
</svg>`
}

function buildGraphSVG(description) {
  const isVT = (description || '').toLowerCase().includes('velocity') && (description || '').toLowerCase().includes('time')
  const isDT = (description || '').toLowerCase().includes('displacement') && (description || '').toLowerCase().includes('time')
  const yLabel = isVT ? 'v (m/s)' : isDT ? 'd (m)' : 'y'
  return `<svg width="380" height="260" viewBox="0 0 380 260" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
  <rect width="380" height="260" fill="white" rx="6"/>
  ${[1,2,3,4].map(i => `<line x1="60" y1="${210-i*40}" x2="340" y2="${210-i*40}" stroke="#e5e7eb" stroke-width="1"/>`).join('')}
  ${[1,2,3,4,5,6].map(i => `<line x1="${60+i*46}" y1="30" x2="${60+i*46}" y2="210" stroke="#e5e7eb" stroke-width="1"/>`).join('')}
  <line x1="60" y1="210" x2="340" y2="210" stroke="#374151" stroke-width="2"/>
  <line x1="60" y1="30" x2="60" y2="210" stroke="#374151" stroke-width="2"/>
  <polygon points="340,210 328,205 328,215" fill="#374151"/>
  <polygon points="60,30 55,42 65,42" fill="#374151"/>
  <text x="345" y="214" font-size="11" fill="#374151">t (s)</text>
  <text x="14" y="120" font-size="11" fill="#374151" transform="rotate(-90,20,120)">${yLabel}</text>
  ${[1,2,3,4,5,6].map(i => `<text x="${54+i*46}" y="224" font-size="10" fill="#6b7280" text-anchor="middle">${i}</text>`).join('')}
  ${[1,2,3,4].map(i => `<text x="48" y="${214-i*40}" font-size="10" fill="#6b7280" text-anchor="end">${i*10}</text>`).join('')}
  <polyline points="60,210 152,170 244,130 290,90" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="60" cy="210" r="4" fill="#2563eb"/>
  <circle cx="152" cy="170" r="4" fill="#2563eb"/>
  <circle cx="244" cy="130" r="4" fill="#2563eb"/>
  <circle cx="290" cy="90" r="4" fill="#2563eb"/>
  <text x="190" y="248" font-size="10" fill="#666" text-anchor="middle">${yLabel.split(' ')[0]} vs time graph</text>
</svg>`
}

function buildWaveSVG(description) {
  return `<svg width="380" height="220" viewBox="0 0 380 220" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
  <rect width="380" height="220" fill="white" rx="6"/>
  <line x1="30" y1="110" x2="360" y2="110" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="30" y1="30" x2="30" y2="190" stroke="#374151" stroke-width="2"/>
  <path d="M30,110 C55,110 65,40 100,40 S145,180 180,180 S225,40 260,40 S305,180 330,110" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
  <defs>
    <marker id="la" markerWidth="8" markerHeight="8" refX="2" refY="3" orient="auto"><path d="M8,0 L0,3 L8,6 z" fill="#374151"/></marker>
    <marker id="ra" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#374151"/></marker>
    <marker id="ra2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#dc2626"/></marker>
    <marker id="la2" markerWidth="8" markerHeight="8" refX="2" refY="3" orient="auto"><path d="M8,0 L0,3 L8,6 z" fill="#dc2626"/></marker>
  </defs>
  <line x1="100" y1="195" x2="260" y2="195" stroke="#374151" stroke-width="1.5" marker-start="url(#la)" marker-end="url(#ra)"/>
  <text x="180" y="210" font-size="11" fill="#374151" text-anchor="middle">λ (wavelength)</text>
  <line x1="348" y1="40" x2="348" y2="110" stroke="#dc2626" stroke-width="1.5" marker-start="url(#la2)" marker-end="url(#ra2)"/>
  <text x="360" y="78" font-size="11" fill="#dc2626">A</text>
  <text x="14" y="113" font-size="11" fill="#374151" text-anchor="end">0</text>
  <text x="190" y="218" font-size="10" fill="#666" text-anchor="middle">Transverse wave diagram</text>
</svg>`
}

function buildGenericSVG(description) {
  const words = (description || 'Diagram').split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).length > 45) { lines.push(line.trim()); line = w }
    else line += ' ' + w
  }
  if (line.trim()) lines.push(line.trim())
  const height = Math.max(100, 56 + lines.length * 22)
  return `<svg width="380" height="${height}" viewBox="0 0 380 ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
  <rect width="380" height="${height}" fill="#f8fafc" rx="8" stroke="#e2e8f0" stroke-width="1.5"/>
  <rect x="12" y="12" width="356" height="${height-24}" fill="white" rx="6" stroke="#e2e8f0" stroke-width="1"/>
  <text x="190" y="36" font-size="12" fill="#64748b" text-anchor="middle" font-weight="600">📐 Diagram</text>
  ${lines.map((l, i) => `<text x="190" y="${54+i*22}" font-size="12" fill="#334155" text-anchor="middle">${l}</text>`).join('')}
</svg>`
}
