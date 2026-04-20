import { redisGet, redisSet } from './lib/redis.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function extractJson(text) {
  // Try direct parse first
  try { return JSON.parse(text.trim()) } catch {}

  // Strip markdown fences
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  try { return JSON.parse(stripped) } catch {}

  // Find outermost { }
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in response')

  // Try progressively shorter substrings from the end
  for (let end = text.length - 1; end > start; end--) {
    if (text[end] === '}') {
      try {
        const slice = text.slice(start, end + 1)
        const parsed = JSON.parse(slice)
        if (parsed && typeof parsed === 'object') return parsed
      } catch {}
    }
  }

  // Last resort: try to auto-close truncated JSON
  const partial = text.slice(start)
  // Count open braces/brackets and close them
  let openBraces = 0, openBrackets = 0, inString = false, escape = false
  for (const ch of partial) {
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') openBraces++
    if (ch === '}') openBraces--
    if (ch === '[') openBrackets++
    if (ch === ']') openBrackets--
  }
  // Remove trailing comma if present
  let closed = partial.trimEnd().replace(/,\s*$/, '')
  // Close open structures
  while (openBrackets > 0) { closed += ']'; openBrackets-- }
  while (openBraces > 0) { closed += '}'; openBraces-- }
  try {
    const parsed = JSON.parse(closed)
    if (parsed?.sections || parsed?.title) {
      parsed._truncated = true
      console.log('Recovered truncated JSON — sections:', parsed.sections?.length)
      return parsed
    }
  } catch {}

  throw new Error('Could not extract JSON from response')
}

const AU_EXAM_FORMATS = {
  'BSSS': {
    sections: [
      { name: 'Section A: Multiple Choice',   type: 'mcq',      marks: 20, marksPerQ: 1, questionCount: 20, instructions: 'Circle the letter of the best answer. Each question is worth 1 mark.' },
      { name: 'Section B: Short Answer',      type: 'short',    marks: 40, questionCount: 4,                instructions: 'Answer ALL questions in the spaces provided. Show all working clearly.' },
      { name: 'Section C: Extended Response', type: 'extended', marks: 40, questionCount: 2,                instructions: 'Answer ALL questions. Show all working clearly. Marks are awarded for correct method and working.' }
    ],
    totalMarks: 100, timeLimitMins: 180, allowedMaterials: 'Scientific calculator, ruler',
    style: 'BSSS ACT senior secondary exam.'
  },
  'NESA': {
    sections: [
      { name: 'Section I',  type: 'mcq',   marks: 20, questionCount: 20, marksPerQ: 1, instructions: 'Select the alternative A, B, C or D.' },
      { name: 'Section II', type: 'short', marks: 80, questionCount: 6,                instructions: 'Answer the questions in the spaces provided.' }
    ],
    totalMarks: 100, timeLimitMins: 180, allowedMaterials: 'Approved calculator, ruler',
    style: 'NSW HSC NESA exam.'
  },
  'VCAA': {
    sections: [
      { name: 'Section A', type: 'mcq',   marks: 20, questionCount: 20, marksPerQ: 1, instructions: 'Choose the best response.' },
      { name: 'Section B', type: 'short', marks: 60, questionCount: 6,                instructions: 'Answer all questions.' }
    ],
    totalMarks: 80, timeLimitMins: 150, allowedMaterials: 'CAS calculator, formula sheet',
    style: 'VCE VCAA exam.'
  }
}

function buildDifficultyInstruction(difficultyProfile, difficultyMode) {
  const profile = difficultyProfile || {}
  const mode = difficultyMode || 'match'
  const baseDesc = profile.description || 'Standard difficulty'
  const cogLevel = profile.cognitiveLevel || 'apply'
  const steps = profile.stepsPerCalculation || '2-3'
  const working = profile.workingRequired !== false
  const marksPerQ = profile.marksPerQuestion || '1-5'

  if (mode === 'match') {
    return `DIFFICULTY — MATCH THE PAST PAPERS EXACTLY:
Difficulty profile from uploaded papers: "${baseDesc}"
- Cognitive level: ${cogLevel}
- Calculation complexity: ${steps} steps per problem
- Working required: ${working ? 'Yes — show full method' : 'Answers only'}
- Mark allocation: ${marksPerQ} marks per question/part
CRITICAL: Your mock must feel IDENTICAL in difficulty. Match the cognitive demand, number of steps, question style, depth of explanation. A student who studied these past papers should find your mock feels like the same exam.`
  }
  if (mode === 'harder') {
    return `DIFFICULTY — SLIGHTLY HARDER THAN PAST PAPERS:
Base: "${baseDesc}" — increase ~15-20%:
- Add one more step to multi-part calculations
- Require 2 concepts together rather than 1
- Include 1-2 questions at next cognitive level up
- Use less familiar contexts for the same underlying concepts
Keep same format, mark allocations, and overall structure.`
  }
  if (mode === 'exam-plus') {
    return `DIFFICULTY — EXAM-PLUS (hardest preparation mode):
Base: "${baseDesc}" — push significantly harder:
- Multi-step problems requiring synthesis of 3+ concepts
- Students must identify which principle applies (not told upfront)
- Extended analysis requiring full derivations or multi-paragraph reasoning
- Unfamiliar contexts with familiar underlying concepts
- Challenge questions requiring deep understanding
Students who handle this mock will be very well prepared for any version of the real exam.`
  }
  return 'Match the difficulty of the past papers exactly.'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const {
      jobId, userId, subjectId, slotNumber,
      customInstructions = '',
      replaceSlot,
      confirmedScope = null,
      difficultyMode = 'match'
    } = await parseBody(req)

    if (!jobId || !userId || !subjectId) { res.status(400).json({ error: 'Missing required fields' }); return }

    const paperKey = `sm:papers:${userId}:${subjectId}`
    const papers = await redisGet(paperKey) || []
    const jobIdx = papers.findIndex(p => p.id === jobId)
    if (jobIdx >= 0) { papers[jobIdx].status = 'generating'; await redisSet(paperKey, papers) }

    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) throw new Error('Subject not found')

    const { name, state, examBoard, yearLevel, topics = [], extractedFormat } = subject

    const scopeTerm         = confirmedScope?.term || null
    const scopeTopics       = confirmedScope?.topics?.length > 0 ? confirmedScope.topics : null
    const scopeExamType     = confirmedScope?.examType || null
    const scopeTimeMins     = confirmedScope?.format?.timeMins || null
    const scopeTotalMarks   = confirmedScope?.format?.totalMarks || null
    const difficultyProfile = confirmedScope?.difficultyProfile || null
    const levelDescription  = confirmedScope?.levelDescription || `Year ${yearLevel} ${examBoard}`

    const auFormat = AU_EXAM_FORMATS[examBoard?.toUpperCase()]
    let effectiveSections, effectiveTotalMarks, effectiveTimeMins, effectiveMaterials, effectiveStyle

    if (scopeTotalMarks && confirmedScope?.format?.sections?.length > 0 && Array.isArray(confirmedScope.format.sections)) {
      effectiveTotalMarks = scopeTotalMarks; effectiveTimeMins = scopeTimeMins || 60
      effectiveMaterials = 'Scientific calculator, ruler'
      effectiveStyle = `${scopeExamType || 'exam'} for ${levelDescription}`
      effectiveSections = null
    } else if (auFormat) {
      effectiveSections = auFormat.sections
      effectiveTotalMarks = scopeTotalMarks || auFormat.totalMarks
      effectiveTimeMins = scopeTimeMins || auFormat.timeLimitMins
      effectiveMaterials = auFormat.allowedMaterials; effectiveStyle = auFormat.style
    } else if (extractedFormat) {
      effectiveSections = extractedFormat.sections
      effectiveTotalMarks = scopeTotalMarks || extractedFormat.totalMarks
      effectiveTimeMins = scopeTimeMins || extractedFormat.timeLimitMins
      effectiveMaterials = extractedFormat.allowedMaterials || 'Scientific calculator'
      effectiveStyle = extractedFormat.style || ''
    } else {
      effectiveTotalMarks = scopeTotalMarks || 100; effectiveTimeMins = scopeTimeMins || 60
      effectiveMaterials = 'Scientific calculator'; effectiveStyle = `${scopeExamType || 'exam'} for ${levelDescription}`
      effectiveSections = null
    }

    // Load doc context
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    let docContext = '', sourceType = 'syllabus'
    if (allDocs.length > 0) {
      const allChunks = allDocs.flatMap(d => d.chunks || [])
      let charCount = 0
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 3000) break
        docContext += chunk + '\n'; charCount += chunk.length
      }
      if (charCount > 50) sourceType = allDocs.some(d => d.docType === 'past-paper') ? 'past-paper' : 'docs'
    }

    // Paper memory
    const existingPapers = await redisGet(paperKey) || []
    const usedTopics = [...new Set(
      existingPapers.filter(p => p.status === 'ready' && p.id !== jobId).flatMap(p => p.topicsCovered || [])
    )]
    const allTopics    = scopeTopics || topics
    const unusedTopics = allTopics.filter(t => !usedTopics.includes(t))
    const memoryNote   = usedTopics.length > 0
      ? `PAPER MEMORY: Already covered: ${usedTopics.join(', ')}. Prioritise: ${unusedTopics.length > 0 ? unusedTopics.join(', ') : 'fresh angles on all topics'}.`
      : ''

    const topicsList = allTopics.length > 0 ? allTopics.join(', ') : `General ${name} content`

    let sectionInstructions = ''
    if (effectiveSections) {
      sectionInstructions = `
EXAM FORMAT — replicate exactly:
Total marks: ${effectiveTotalMarks} | Time: ${effectiveTimeMins} minutes | Materials: ${effectiveMaterials}
SECTIONS:
${effectiveSections.map((s, i) =>
  `${String.fromCharCode(65+i)}) ${s.name} — ${s.marks} marks${s.marksPerQ ? ` (${s.marksPerQ}/q)` : ''}, ${s.questionCount} questions. ${s.instructions}`
).join('\n')}`
    } else {
      sectionInstructions = `
EXAM FORMAT:
Total marks: ${effectiveTotalMarks} | Time: ${effectiveTimeMins} minutes | Level: ${levelDescription}
Replicate the format of the uploaded past papers exactly — same section types, question styles, mark patterns.`
    }

    const difficultyInstruction = buildDifficultyInstruction(difficultyProfile, difficultyMode)

    const prompt = `You are an expert exam paper writer. Create a complete, realistic mock exam that closely mirrors the uploaded past papers.

SUBJECT: ${name} | LEVEL: ${levelDescription} | TOPICS: ${topicsList}
${docContext ? `\nPAST PAPER REFERENCE:\n${docContext}\n` : ''}
${memoryNote}
${customInstructions ? `ADDITIONAL FOCUS: ${customInstructions}\n` : ''}
${sectionInstructions}

${difficultyInstruction}

${scopeTerm ? `SCOPE: "${scopeTerm}" (${scopeExamType || 'exam'}) — ONLY questions on: ${topicsList}` : ''}

DIAGRAMS: Use [DIAGRAM_REF:N] in question text. Add to "diagrams" array: { "id":N, "type":"magnetic-field|parallel-plates|solenoid|gravitational-field|free-body|circuit|wave|electric-field|graph", "description":"...", "params":{...} }
Params by type — magnetic-field:{"rows":5,"cols":7,"particleCharge":"negative","particleVelocity":"right","fieldDirection":"into-page"} parallel-plates:{"separation":"4cm","voltage":"800V","particleCharge":"negative","topPlatePolarity":"positive"} solenoid:{"turns":8,"length":"0.10m","currentDirection":"left-to-right"} gravitational-field:{"bodyName":"Mars","surfaceG":"3.73"} circuit:{"voltage":"12","r1":"4","r2":"6","r3":"8"}

QUALITY: Match exact format, marks, numbering. MCQ: 4 plausible options. Parts build on each other. Realistic values. Include all given constants. Marking criteria per mark.

Return ONLY valid JSON — no markdown, no explanation:
{"coverPage":{"school":"Narrabundah College","subject":"${name}","level":"${levelDescription}","examType":"${scopeExamType || 'Mock Exam'}","mockNumber":${slotNumber}${scopeTerm ? `,"scope":"${scopeTerm}"` : ''},"instructions":["Write in black or blue pen","Show all working for full marks","Scientific calculator permitted"]},"diagrams":[],"title":"${name} — Mock Paper ${slotNumber}${scopeTerm ? ` (${scopeTerm})` : ''}","subject":"${name}","levelDescription":"${levelDescription}","examBoard":"${examBoard || ''}","scopeTerm":${scopeTerm ? `"${scopeTerm}"` : 'null'},"scopeExamType":${scopeExamType ? `"${scopeExamType}"` : 'null'},"difficultyMode":"${difficultyMode}","totalMarks":${effectiveTotalMarks},"timeAllowed":"${effectiveTimeMins} minutes","allowedMaterials":"${effectiveMaterials}","sections":[{"name":"Section name","type":"mcq","marks":20,"instructions":"Circle the best answer","questions":[{"number":1,"question":"Question text","parts":null,"marks":1,"type":"mcq","options":["A. option","B. option","C. option","D. option"],"answer":"B","workingOut":"Solution","markingCriteria":"1 mark for B","topic":"Topic"}]}]}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error: ${claudeRes.status} ${errText.slice(0, 100)}`)
    }

    const claudeData = await claudeRes.json()
    const raw = '{' + (claudeData.content?.[0]?.text || '{}')
    console.log('Claude response length:', raw.length, '| stop_reason:', claudeData.stop_reason)
    if (claudeData.stop_reason === 'max_tokens') console.error('TRUNCATED — hit max_tokens, JSON will be incomplete')
    const paper = extractJson(raw)
    if (!paper.sections || !Array.isArray(paper.sections)) throw new Error('Invalid paper structure')

    // Generate SVGs for all diagrams using purpose-built renderers
    if (paper.diagrams?.length > 0) {
      paper.diagrams = paper.diagrams.map(d => ({ ...d, svg: generateDiagramSVG(d) }))
    }

    const topicsCovered = [...new Set(
      paper.sections.flatMap(s => s.questions?.map(q => q.topic).filter(Boolean) || [])
    )]

    const paperRecord = {
      id: jobId, slotNumber, subjectId, subjectName: name,
      levelDescription, examBoard: examBoard || '',
      scopeTerm: scopeTerm || null, scopeExamType: scopeExamType || null,
      difficultyMode,
      generatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      sourceType, docCount: allDocs.length,
      topicsCovered, status: 'ready', paper
    }

    const finalPapers = await redisGet(paperKey) || []
    const finalIdx = finalPapers.findIndex(p => p.id === jobId)
    if (finalIdx >= 0) finalPapers[finalIdx] = paperRecord
    else finalPapers.push(paperRecord)
    await redisSet(paperKey, finalPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber))

    res.status(200).json({ ok: true, jobId, slotNumber, scopeTerm, difficultyMode })

  } catch (e) {
    console.error('mock-worker error:', e.message)
    try {
      const body = await parseBody(req).catch(() => ({}))
      if (body.jobId && body.userId && body.subjectId) {
        const pk = `sm:papers:${body.userId}:${body.subjectId}`
        const pp = await redisGet(pk) || []
        const ii = pp.findIndex(p => p.id === body.jobId)
        if (ii >= 0) { pp[ii].status = 'failed'; await redisSet(pk, pp) }
      }
    } catch {}
    res.status(500).json({ error: e.message })
  }
}

// ─── Diagram router ───────────────────────────────────────────────────────────
function generateDiagramSVG(diagram) {
  const { type, params = {}, description = '' } = diagram
  const desc = description.toLowerCase()
  switch (type) {
    case 'magnetic-field':    return buildMagneticFieldSVG(params, description)
    case 'parallel-plates':   return buildParallelPlatesSVG(params, description)
    case 'solenoid':          return buildSolenoidSVG(params, description)
    case 'gravitational-field': return buildGravFieldSVG(params, description)
    case 'free-body':         return buildFreeBodySVG(params, description)
    case 'circuit':           return buildCircuitSVG(params, description)
    case 'wave':              return buildWaveSVG(params, description)
    case 'graph':             return buildGenericGraphSVG(params, description)
    case 'electric-field':    return buildElectricFieldSVG(params, description)
    default:
      // Fallback: try to detect from description
      if (desc.includes('magnetic') || desc.includes('cross') || desc.includes('into page')) return buildMagneticFieldSVG(params, description)
      if (desc.includes('plate') || desc.includes('capacitor')) return buildParallelPlatesSVG(params, description)
      if (desc.includes('solenoid') || desc.includes('coil')) return buildSolenoidSVG(params, description)
      if (desc.includes('gravitational') && desc.includes('distance')) return buildGravFieldSVG(params, description)
      if (desc.includes('free body') || desc.includes('force')) return buildFreeBodySVG(params, description)
      if (desc.includes('circuit') || desc.includes('resistor')) return buildCircuitSVG(params, description)
      if (desc.includes('wave')) return buildWaveSVG(params, description)
      return buildGenericSVG(description)
  }
}

// ─── Magnetic field region (crosses = into page, dots = out of page) ──────────
function buildMagneticFieldSVG(params, description) {
  const rows = params.rows || 5
  const cols = params.cols || 7
  const fieldDir = params.fieldDirection || 'into-page'
  const particleCharge = params.particleCharge || 'positive'
  const particleVelocity = params.particleVelocity || 'right'

  const cellSize = 44
  const W = cols * cellSize + 80
  const H = rows * cellSize + 80
  const offsetX = 40, offsetY = 40

  let symbols = ''
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = offsetX + c * cellSize + cellSize / 2
      const cy = offsetY + r * cellSize + cellSize / 2
      if (fieldDir === 'into-page') {
        // × symbol
        symbols += `<line x1="${cx-8}" y1="${cy-8}" x2="${cx+8}" y2="${cy+8}" stroke="#374151" stroke-width="1.5"/>`
        symbols += `<line x1="${cx+8}" y1="${cy-8}" x2="${cx-8}" y2="${cy+8}" stroke="#374151" stroke-width="1.5"/>`
      } else {
        // • symbol (out of page)
        symbols += `<circle cx="${cx}" cy="${cy}" r="3" fill="#374151"/>`
        symbols += `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="#374151" stroke-width="1"/>`
      }
    }
  }

  // Particle in centre-left area
  const px = offsetX + cellSize
  const py = offsetY + Math.floor(rows / 2) * cellSize + cellSize / 2
  const particleColor = particleCharge === 'positive' ? '#dc2626' : '#2563eb'
  const particleSymbol = particleCharge === 'positive' ? '+' : '−'

  // Velocity arrow direction
  let vx2 = px + 50, vy2 = py, vx1 = px + 16, vy1 = py
  if (particleVelocity === 'left')  { vx2 = px - 50; vx1 = px - 16 }
  if (particleVelocity === 'up')    { vx2 = px; vy2 = py - 50; vx1 = px; vy1 = py - 16 }
  if (particleVelocity === 'down')  { vx2 = px; vy2 = py + 50; vx1 = px; vy1 = py + 16 }

  const fieldLabel = fieldDir === 'into-page' ? 'B (into page)' : 'B (out of page)'
  const chargeLabel = particleCharge === 'positive' ? 'Proton (+)' : 'Electron (−)'

  return `<svg width="${W}" height="${H + 30}" viewBox="0 0 ${W} ${H + 30}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H + 30}" fill="white" rx="6"/>
  <defs><marker id="va" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#d97706" stroke-width="1.5"/></marker></defs>
  ${symbols}
  <circle cx="${px}" cy="${py}" r="12" fill="${particleColor}" opacity="0.15" stroke="${particleColor}" stroke-width="2"/>
  <text x="${px}" y="${py+4}" font-size="14" font-weight="bold" fill="${particleColor}" text-anchor="middle">${particleSymbol}</text>
  <line x1="${vx1}" y1="${vy1}" x2="${vx2}" y2="${vy2}" stroke="#d97706" stroke-width="2" marker-end="url(#va)"/>
  <text x="${(vx1+vx2)/2}" y="${(vy1+vy2)/2 - 8}" font-size="11" fill="#d97706" text-anchor="middle">v</text>
  <text x="${W/2}" y="${H + 20}" font-size="11" fill="#6b7280" text-anchor="middle">${fieldLabel} · ${chargeLabel}</text>
</svg>`
}

// ─── Parallel plates ──────────────────────────────────────────────────────────
function buildParallelPlatesSVG(params, description) {
  const separation = params.separation || '4.0 cm'
  const voltage = params.voltage || '400 V'
  const particleCharge = params.particleCharge || 'positive'
  const topPlate = params.topPlatePolarity || 'positive'

  const W = 380, H = 280
  const plateY1 = 60, plateY2 = 210
  const plateX1 = 80, plateX2 = 300

  const particleColor = particleCharge === 'positive' ? '#dc2626' : '#2563eb'
  const particleSymbol = particleCharge === 'positive' ? '+' : '−'
  const topLabel = topPlate === 'positive' ? '+ + + + + + +' : '− − − − − − −'
  const botLabel = topPlate === 'positive' ? '− − − − − − −' : '+ + + + + + +'

  // E field arrows (5 arrows pointing from + to -)
  const arrowDir = topPlate === 'positive' ? 1 : -1
  let eArrows = ''
  for (let i = 0; i < 5; i++) {
    const ax = plateX1 + 20 + i * 44
    const ay1 = plateY1 + 20
    const ay2 = plateY2 - 20
    eArrows += `<line x1="${ax}" y1="${ay1}" x2="${ax}" y2="${ay2}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,3"/>`
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H}" fill="white" rx="6"/>
  <defs>
    <marker id="ea" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#9ca3af" stroke-width="1.5"/>
    </marker>
  </defs>
  <!-- Top plate -->
  <rect x="${plateX1}" y="${plateY1 - 10}" width="${plateX2 - plateX1}" height="10" fill="#374151" rx="2"/>
  <text x="${(plateX1+plateX2)/2}" y="${plateY1 - 16}" font-size="11" fill="#374151" text-anchor="middle">${topLabel}</text>
  <!-- Bottom plate -->
  <rect x="${plateX1}" y="${plateY2}" width="${plateX2 - plateX1}" height="10" fill="#374151" rx="2"/>
  <text x="${(plateX1+plateX2)/2}" y="${plateY2 + 24}" font-size="11" fill="#374151" text-anchor="middle">${botLabel}</text>
  <!-- E field arrows -->
  ${eArrows.replace(/stroke-dasharray="4,3"\/>/g, `stroke-dasharray="4,3" marker-end="url(#ea)"/>`)}
  <!-- E field label -->
  <text x="${plateX2 + 20}" y="${(plateY1+plateY2)/2 + 4}" font-size="12" fill="#374151">E</text>
  <!-- Particle -->
  <circle cx="${(plateX1+plateX2)/2}" cy="${(plateY1+plateY2)/2}" r="12" fill="${particleColor}" opacity="0.15" stroke="${particleColor}" stroke-width="2"/>
  <text x="${(plateX1+plateX2)/2}" y="${(plateY1+plateY2)/2 + 4}" font-size="14" fill="${particleColor}" text-anchor="middle" font-weight="bold">${particleSymbol}</text>
  <!-- Labels -->
  <text x="${plateX1 - 10}" y="${(plateY1+plateY2)/2 + 4}" font-size="11" fill="#6b7280" text-anchor="end">${separation}</text>
  <text x="${W/2}" y="${H - 6}" font-size="10" fill="#9ca3af" text-anchor="middle">${voltage} between plates · ${separation} separation</text>
</svg>`
}

// ─── Solenoid ─────────────────────────────────────────────────────────────────
function buildSolenoidSVG(params, description) {
  const turns = params.turns || 8
  const length = params.length || '0.10 m'
  const currentDir = params.currentDirection || 'left-to-right'

  const W = 440, H = 200
  const solenoidX = 60, solenoidY = 70, solenoidW = 320, solenoidH = 60

  // Draw coil loops
  let loops = ''
  const loopW = solenoidW / turns
  for (let i = 0; i < turns; i++) {
    const x = solenoidX + i * loopW
    loops += `<ellipse cx="${x + loopW/2}" cy="${solenoidY + solenoidH/2}" rx="${loopW * 0.4}" ry="${solenoidH/2}" fill="none" stroke="#374151" stroke-width="2"/>`
  }

  // Iron core
  const coreStr = `<rect x="${solenoidX + 10}" y="${solenoidY + solenoidH/2 - 6}" width="${solenoidW - 20}" height="12" fill="#6b7280" rx="3" opacity="0.4"/>`
  // Core label
  const coreLabel = `<text x="${solenoidX + solenoidW/2}" y="${solenoidY + solenoidH/2 + 4}" font-size="10" fill="#374151" text-anchor="middle">iron core</text>`

  // B field arrows inside
  let bArrows = ''
  const bDir = currentDir === 'left-to-right' ? 1 : -1
  for (let i = 1; i < 4; i++) {
    const bx = solenoidX + i * solenoidW / 4
    if (bDir > 0) {
      bArrows += `<line x1="${bx}" y1="${solenoidY + solenoidH/2}" x2="${bx + 30}" y2="${solenoidY + solenoidH/2}" stroke="#2563eb" stroke-width="1.5" marker-end="url(#ba)"/>`
    } else {
      bArrows += `<line x1="${bx}" y1="${solenoidY + solenoidH/2}" x2="${bx - 30}" y2="${solenoidY + solenoidH/2}" stroke="#2563eb" stroke-width="1.5" marker-end="url(#ba)"/>`
    }
  }

  // Current labels
  const iLabel1 = currentDir === 'left-to-right' ? '⊗ I' : '⊙ I'
  const iLabel2 = currentDir === 'left-to-right' ? '⊙ I' : '⊗ I'

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H}" fill="white" rx="6"/>
  <defs><marker id="ba" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#2563eb" stroke-width="1.5"/></marker></defs>
  ${coreStr}
  ${loops}
  ${bArrows}
  <!-- N turns label -->
  <text x="${solenoidX + solenoidW/2}" y="${solenoidY - 16}" font-size="12" fill="#374151" text-anchor="middle">${turns} turns · L = ${length}</text>
  <!-- Current direction labels -->
  <text x="${solenoidX - 16}" y="${solenoidY + solenoidH/2 + 4}" font-size="11" fill="#dc2626" text-anchor="end">${iLabel1}</text>
  <text x="${solenoidX + solenoidW + 16}" y="${solenoidY + solenoidH/2 + 4}" font-size="11" fill="#dc2626">${iLabel2}</text>
  <!-- B field label -->
  <text x="${W/2}" y="${solenoidY + solenoidH + 28}" font-size="11" fill="#2563eb" text-anchor="middle">B field direction →</text>
  <text x="${W/2}" y="${H - 6}" font-size="10" fill="#9ca3af" text-anchor="middle">Solenoid cross-section · B = μ₀NI/L</text>
</svg>`
}

// ─── Gravitational field vs distance ─────────────────────────────────────────
function buildGravFieldSVG(params, description) {
  const bodyName = params.bodyName || 'Planet'
  const surfaceG = parseFloat(params.surfaceG) || 9.8
  const W = 400, H = 280
  const ox = 60, oy = 240, gw = 300, gh = 200

  // Plot g = surfaceG * (R/r)^2 curve (normalized: r from 1R to 3R)
  let pathD = ''
  for (let i = 0; i <= 60; i++) {
    const r = 1 + i * 2 / 60  // r from 1 to 3 (multiples of R_surface)
    const g = surfaceG / (r * r)
    const x = ox + (r - 1) * gw / 2
    const y = oy - (g / surfaceG) * gh
    pathD += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`
  }

  // Axis labels
  let xLabels = '', yLabels = ''
  for (let i = 0; i <= 4; i++) {
    const x = ox + i * gw / 4
    const rVal = (1 + i * 0.5).toFixed(1)
    xLabels += `<text x="${x}" y="${oy + 16}" font-size="10" fill="#6b7280" text-anchor="middle">${rVal}R</text>`
    xLabels += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + 4}" stroke="#9ca3af" stroke-width="1"/>`
  }
  for (let i = 0; i <= 4; i++) {
    const y = oy - i * gh / 4
    const gVal = (surfaceG * i / 4).toFixed(1)
    yLabels += `<text x="${ox - 6}" y="${y + 4}" font-size="10" fill="#6b7280" text-anchor="end">${gVal}</text>`
    yLabels += `<line x1="${ox - 4}" y1="${y}" x2="${ox}" y2="${y}" stroke="#9ca3af" stroke-width="1"/>`
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H}" fill="white" rx="6"/>
  <!-- Grid -->
  ${Array.from({length: 4}, (_, i) => `<line x1="${ox}" y1="${oy - (i+1)*gh/4}" x2="${ox+gw}" y2="${oy - (i+1)*gh/4}" stroke="#f3f4f6" stroke-width="1"/>`).join('')}
  <!-- Axes -->
  <line x1="${ox}" y1="${oy - gh - 10}" x2="${ox}" y2="${oy}" stroke="#374151" stroke-width="1.5"/>
  <line x1="${ox}" y1="${oy}" x2="${ox + gw + 10}" y2="${oy}" stroke="#374151" stroke-width="1.5"/>
  <!-- Surface marker -->
  <line x1="${ox}" y1="${oy - gh}" x2="${ox}" y2="${oy}" stroke="#dc2626" stroke-width="1" stroke-dasharray="4,3"/>
  <!-- Curve -->
  <path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
  ${xLabels}
  ${yLabels}
  <!-- Labels -->
  <text x="${ox + gw/2}" y="${H - 4}" font-size="11" fill="#374151" text-anchor="middle">Distance from centre of ${bodyName}</text>
  <text x="16" y="${oy - gh/2}" font-size="11" fill="#374151" text-anchor="middle" transform="rotate(-90,16,${oy - gh/2})">g (N/kg)</text>
  <text x="${ox + 4}" y="${oy - gh - 14}" font-size="10" fill="#dc2626">Surface (g = ${surfaceG})</text>
</svg>`
}

// ─── Free body diagram ────────────────────────────────────────────────────────
function buildFreeBodySVG(params, description) {
  const forces = params.forces || ['weight down', 'normal up']
  const W = 320, H = 260, cx = 160, cy = 130

  const forceMap = {
    'weight down':   { dx: 0, dy: 60, color: '#7c3aed', label: 'W=mg' },
    'normal up':     { dx: 0, dy: -60, color: '#dc2626', label: 'N' },
    'friction left': { dx: -60, dy: 0, color: '#d97706', label: 'f' },
    'friction right':{ dx: 60, dy: 0, color: '#d97706', label: 'f' },
    'applied right': { dx: 60, dy: 0, color: '#059669', label: 'F' },
    'applied left':  { dx: -60, dy: 0, color: '#059669', label: 'F' },
    'tension up':    { dx: 0, dy: -60, color: '#2563eb', label: 'T' },
  }

  let arrows = ''
  for (const f of forces) {
    const fData = forceMap[f.toLowerCase()] || { dx: 40, dy: 0, color: '#374151', label: f.split(' ')[0] }
    const x2 = cx + fData.dx, y2 = cy + fData.dy
    const lx = cx + fData.dx * 1.3, ly = cy + fData.dy * 1.3
    arrows += `<defs><marker id="f${f.replace(/\s/g,'')}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="${fData.color}" stroke-width="1.5"/></marker></defs>`
    arrows += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${fData.color}" stroke-width="2.5" marker-end="url(#f${f.replace(/\s/g,'')})"/>`
    arrows += `<text x="${lx}" y="${ly + 4}" font-size="12" fill="${fData.color}" text-anchor="middle" font-weight="bold">${fData.label}</text>`
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H}" fill="white" rx="6"/>
  ${arrows}
  <rect x="${cx - 20}" y="${cy - 20}" width="40" height="40" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="2" rx="4"/>
  <text x="${cx}" y="${cy + 5}" font-size="12" fill="#1e40af" text-anchor="middle" font-weight="bold">m</text>
  <text x="${W/2}" y="${H - 6}" font-size="10" fill="#9ca3af" text-anchor="middle">Free body diagram</text>
</svg>`
}

// ─── Circuit ──────────────────────────────────────────────────────────────────
function buildCircuitSVG(params, description) {
  const voltage = params.voltage || '12'
  const r1 = params.r1 || 'R₁'
  const r2 = params.r2 || 'R₂'
  const r3 = params.r3 || 'R₃'
  return `<svg width="420" height="260" viewBox="0 0 420 260" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
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
  <text x="4" y="108" font-size="11" fill="#1a56db" font-weight="bold">${voltage}V</text>
  <rect x="140" y="40" width="60" height="20" fill="white" stroke="#222" stroke-width="2" rx="3"/>
  <text x="170" y="54" font-size="11" fill="#222" text-anchor="middle">${r1}${params.r1 && !isNaN(params.r1) ? 'Ω' : ''}</text>
  <circle cx="240" cy="50" r="4" fill="#222"/><circle cx="240" cy="210" r="4" fill="#222"/>
  <line x1="240" y1="50" x2="240" y2="80" stroke="#222" stroke-width="2"/>
  <rect x="220" y="80" width="40" height="20" fill="white" stroke="#222" stroke-width="2" rx="3"/>
  <text x="240" y="94" font-size="11" fill="#222" text-anchor="middle">${r2}${params.r2 && !isNaN(params.r2) ? 'Ω' : ''}</text>
  <line x1="240" y1="100" x2="240" y2="130" stroke="#222" stroke-width="2"/>
  <line x1="240" y1="50" x2="300" y2="50" stroke="#222" stroke-width="2"/>
  <line x1="300" y1="50" x2="300" y2="80" stroke="#222" stroke-width="2"/>
  <rect x="280" y="80" width="40" height="20" fill="white" stroke="#222" stroke-width="2" rx="3"/>
  <text x="300" y="94" font-size="11" fill="#222" text-anchor="middle">${r3}${params.r3 && !isNaN(params.r3) ? 'Ω' : ''}</text>
  <line x1="300" y1="100" x2="300" y2="130" stroke="#222" stroke-width="2"/>
  <line x1="240" y1="130" x2="300" y2="130" stroke="#222" stroke-width="2"/>
  <line x1="240" y1="130" x2="240" y2="210" stroke="#222" stroke-width="2"/>
  <text x="80" y="44" font-size="10" fill="#059669">→ I</text>
  <text x="210" y="248" font-size="10" fill="#666" text-anchor="middle">Circuit diagram (not to scale)</text>
</svg>`
}

// ─── Wave ─────────────────────────────────────────────────────────────────────
function buildWaveSVG(params, description) {
  const wavelengthLabel = params.wavelength || 'λ'
  const amplitudeLabel  = params.amplitude  || 'A'
  return `<svg width="380" height="220" viewBox="0 0 380 220" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="380" height="220" fill="white" rx="6"/>
  <line x1="30" y1="110" x2="360" y2="110" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="30" y1="30" x2="30" y2="190" stroke="#374151" stroke-width="2"/>
  <path d="M30,110 C55,110 65,40 100,40 S145,180 180,180 S225,40 260,40 S305,180 330,110" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
  <defs>
    <marker id="lwa" viewBox="0 0 10 10" refX="2" refY="3" orient="auto"><path d="M8,0 L0,3 L8,6 z" fill="#374151"/></marker>
    <marker id="rwa" viewBox="0 0 10 10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#374151"/></marker>
    <marker id="aw2" viewBox="0 0 10 10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#dc2626"/></marker>
    <marker id="aw3" viewBox="0 0 10 10" refX="2" refY="3" orient="auto"><path d="M8,0 L0,3 L8,6 z" fill="#dc2626"/></marker>
  </defs>
  <line x1="100" y1="196" x2="260" y2="196" stroke="#374151" stroke-width="1.5" marker-start="url(#lwa)" marker-end="url(#rwa)"/>
  <text x="180" y="212" font-size="11" fill="#374151" text-anchor="middle">${wavelengthLabel}</text>
  <line x1="348" y1="40" x2="348" y2="110" stroke="#dc2626" stroke-width="1.5" marker-start="url(#aw3)" marker-end="url(#aw2)"/>
  <text x="362" y="78" font-size="11" fill="#dc2626">${amplitudeLabel}</text>
  <text x="14" y="113" font-size="11" fill="#374151" text-anchor="end">0</text>
  <text x="190" y="218" font-size="9" fill="#9ca3af" text-anchor="middle">Transverse wave</text>
</svg>`
}

// ─── Electric field lines ─────────────────────────────────────────────────────
function buildElectricFieldSVG(params, description) {
  const chargeType = params.chargeType || 'positive'
  const W = 300, H = 280, cx = 150, cy = 140

  const numLines = 8
  let fieldLines = ''
  for (let i = 0; i < numLines; i++) {
    const angle = (i / numLines) * 2 * Math.PI
    const r1 = 20, r2 = 110
    const x1 = cx + r1 * Math.cos(angle), y1 = cy + r1 * Math.sin(angle)
    const x2 = cx + r2 * Math.cos(angle), y2 = cy + r2 * Math.sin(angle)
    if (chargeType === 'positive') {
      fieldLines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#dc2626" stroke-width="1.5" marker-end="url(#fe)"/>`
    } else {
      fieldLines += `<line x1="${x2.toFixed(1)}" y1="${y2.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="#2563eb" stroke-width="1.5" marker-end="url(#fe2)"/>`
    }
  }

  const chargeColor = chargeType === 'positive' ? '#dc2626' : '#2563eb'
  const chargeSymbol = chargeType === 'positive' ? '+Q' : '−Q'

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H}" fill="white" rx="6"/>
  <defs>
    <marker id="fe" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#dc2626" stroke-width="1.5"/></marker>
    <marker id="fe2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#2563eb" stroke-width="1.5"/></marker>
  </defs>
  ${fieldLines}
  <circle cx="${cx}" cy="${cy}" r="18" fill="${chargeColor}" opacity="0.15" stroke="${chargeColor}" stroke-width="2"/>
  <text x="${cx}" y="${cy + 5}" font-size="13" fill="${chargeColor}" text-anchor="middle" font-weight="bold">${chargeSymbol}</text>
  <text x="${W/2}" y="${H - 6}" font-size="10" fill="#9ca3af" text-anchor="middle">Electric field lines — ${chargeType} point charge</text>
</svg>`
}

// ─── Generic graph ────────────────────────────────────────────────────────────
function buildGenericGraphSVG(params, description) {
  const xLabel = params.xLabel || 't (s)'
  const yLabel = params.yLabel || 'y'
  const W = 380, H = 260
  const ox = 60, oy = 210, gw = 280, gh = 170
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;">
  <rect width="${W}" height="${H}" fill="white" rx="6"/>
  ${[1,2,3,4].map(i => `<line x1="${ox}" y1="${oy-i*gh/4}" x2="${ox+gw}" y2="${oy-i*gh/4}" stroke="#f3f4f6" stroke-width="1"/>`).join('')}
  <line x1="${ox}" y1="${oy}" x2="${ox+gw+10}" y2="${oy}" stroke="#374151" stroke-width="1.5"/>
  <line x1="${ox}" y1="${oy-gh-10}" x2="${ox}" y2="${oy}" stroke="#374151" stroke-width="1.5"/>
  <polygon points="${ox+gw+10},${oy} ${ox+gw},${oy-4} ${ox+gw},${oy+4}" fill="#374151"/>
  <polygon points="${ox},${oy-gh-10} ${ox-4},${oy-gh} ${ox+4},${oy-gh}" fill="#374151"/>
  <text x="${ox+gw+14}" y="${oy+4}" font-size="11" fill="#374151">${xLabel}</text>
  <text x="${ox}" y="${oy-gh-14}" font-size="11" fill="#374151" text-anchor="middle">${yLabel}</text>
  <polyline points="${ox},${oy} ${ox+gw*0.3},${oy-gh*0.5} ${ox+gw*0.6},${oy-gh*0.75} ${ox+gw},${oy-gh*0.5}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
  <text x="${W/2}" y="${H-4}" font-size="10" fill="#9ca3af" text-anchor="middle">${description || 'Graph'}</text>
</svg>`
}

// ─── Generic fallback ─────────────────────────────────────────────────────────
function buildGenericSVG(description) {
  const words = (description || 'Diagram').split(' ')
  const lines = []; let line = ''
  for (const w of words) {
    if ((line + ' ' + w).length > 45) { lines.push(line.trim()); line = w } else line += ' ' + w
  }
  if (line.trim()) lines.push(line.trim())
  const h = Math.max(100, 56 + lines.length * 22)
  return `<svg width="380" height="${h}" viewBox="0 0 380 ${h}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;"><rect width="380" height="${h}" fill="#f8fafc" rx="8" stroke="#e2e8f0" stroke-width="1.5"/><text x="190" y="36" font-size="12" fill="#64748b" text-anchor="middle" font-weight="600">Diagram</text>${lines.map((l, i) => `<text x="190" y="${54+i*22}" font-size="12" fill="#334155" text-anchor="middle">${l}</text>`).join('')}</svg>`
}
// Mon Apr 20 23:46:15 AUSEST 2026
