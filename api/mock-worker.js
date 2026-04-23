// api/mock-worker.js
// Generates a mock paper that EXACTLY matches the format of real past papers
// Uses confirmedScope from analyse-docs for question counts, section structure, topics

import { redisGet, redisSet } from './lib/redis.js'

function sanitize(text) {
  if (!text) return ''
  return text
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\u0000/g, '')
}

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 4000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
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

async function updateProgress(paperId, userId, subjectId, progress, statusMsg) {
  const papersKey = `sm:papers:${userId}`
  const papers = await redisGet(papersKey) || []
  const idx = papers.findIndex(p => p.id === paperId)
  if (idx !== -1) {
    papers[idx].progress = progress
    papers[idx].statusMsg = statusMsg
    if (progress === 100) papers[idx].status = 'complete'
    await redisSet(papersKey, papers)
  }
}

// ── Diagram builders ──────────────────────────────────────────────────────────

function buildDiagram(type, params = {}) {
  const diagrams = {
    'free-body': buildFreeBodyDiagram,
    'circuit': buildCircuitDiagram,
    'wave': buildWaveDiagram,
    'graph': buildGraphDiagram,
    'force-vector': buildForceVectorDiagram,
    'parallel-plates': buildParallelPlatesDiagram,
    'default': buildGenericDiagram
  }
  const builder = diagrams[type] || diagrams['default']
  return builder(params)
}

function buildFreeBodyDiagram({ label = 'Object', forces = [] } = {}) {
  const arrows = forces.length > 0 ? forces : [
    { dir: 'up', label: 'N (Normal)', len: 60 },
    { dir: 'down', label: 'W (Weight)', len: 60 },
    { dir: 'right', label: 'F (Applied)', len: 50 }
  ]
  let arrowSvg = ''
  const dirs = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] }
  for (const a of arrows) {
    const [dx, dy] = dirs[a.dir] || [0,-1]
    const x2 = 100 + dx * (a.len || 50)
    const y2 = 100 + dy * (a.len || 50)
    const lx = 100 + dx * ((a.len || 50) + 14)
    const ly = 100 + dy * ((a.len || 50) + 14)
    arrowSvg += `<line x1="100" y1="100" x2="${x2}" y2="${y2}" stroke="#0d9488" stroke-width="2" marker-end="url(#ah)"/>`
    arrowSvg += `<text x="${lx}" y="${ly}" fill="#e2e8f0" font-size="10" text-anchor="middle" dominant-baseline="middle">${a.label}</text>`
  }
  return `<svg viewBox="0 0 200 200" width="200" height="200" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0d9488"/></marker></defs>
  <rect x="80" y="80" width="40" height="40" fill="#334155" stroke="#0d9488" stroke-width="1.5" rx="4"/>
  <text x="100" y="104" fill="#e2e8f0" font-size="9" text-anchor="middle">${label}</text>
  ${arrowSvg}
  </svg>`
}

function buildCircuitDiagram({ components = [] } = {}) {
  return `<svg viewBox="0 0 240 180" width="240" height="180" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <rect x="30" y="30" width="180" height="120" fill="none" stroke="#0d9488" stroke-width="2" rx="4"/>
  <!-- Battery -->
  <line x1="30" y1="90" x2="30" y2="70" stroke="#0d9488" stroke-width="2"/>
  <line x1="20" y1="70" x2="40" y2="70" stroke="#0d9488" stroke-width="2"/>
  <line x1="24" y1="62" x2="36" y2="62" stroke="#0d9488" stroke-width="1"/>
  <line x1="30" y1="62" x2="30" y2="30" stroke="#0d9488" stroke-width="2"/>
  <text x="10" y="68" fill="#94a3b8" font-size="9">+</text>
  <text x="10" y="64" fill="#94a3b8" font-size="9">−</text>
  <!-- Resistor zigzag -->
  <polyline points="120,30 125,20 130,30 135,20 140,30 145,20 150,30" fill="none" stroke="#0d9488" stroke-width="2"/>
  <text x="135" y="14" fill="#e2e8f0" font-size="9" text-anchor="middle">R</text>
  <!-- Bulb/load symbol -->
  <circle cx="210" cy="90" r="12" fill="none" stroke="#0d9488" stroke-width="2"/>
  <line x1="204" y1="84" x2="216" y2="96" stroke="#0d9488" stroke-width="1.5"/>
  <line x1="216" y1="84" x2="204" y2="96" stroke="#0d9488" stroke-width="1.5"/>
  <text x="228" y="93" fill="#e2e8f0" font-size="9">L</text>
  <text x="115" y="165" fill="#94a3b8" font-size="10" text-anchor="middle">Series Circuit</text>
  </svg>`
}

function buildWaveDiagram({ label = 'Displacement–Position' } = {}) {
  const points = []
  for (let x = 0; x <= 240; x += 3) {
    const y = 80 - Math.sin(x * 0.052) * 40
    points.push(`${x + 20},${y}`)
  }
  return `<svg viewBox="0 0 280 160" width="280" height="160" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="80" x2="265" y2="80" stroke="#475569" stroke-width="1" stroke-dasharray="4"/>
  <line x1="20" y1="10" x2="20" y2="150" stroke="#475569" stroke-width="1.5"/>
  <line x1="20" y1="150" x2="265" y2="150" stroke="#475569" stroke-width="1.5"/>
  <polyline points="${points.join(' ')}" fill="none" stroke="#0d9488" stroke-width="2"/>
  <text x="140" y="158" fill="#94a3b8" font-size="9" text-anchor="middle">Position (m)</text>
  <text x="6" y="50" fill="#94a3b8" font-size="9" text-anchor="middle" transform="rotate(-90,6,80)">Displacement</text>
  <text x="140" y="20" fill="#e2e8f0" font-size="10" text-anchor="middle">${label}</text>
  <text x="140" y="35" fill="#64748b" font-size="8" text-anchor="middle">λ ←────────→</text>
  </svg>`
}

function buildGraphDiagram({ xLabel = 'Time (s)', yLabel = 'Velocity (m/s)', title = 'v–t graph' } = {}) {
  return `<svg viewBox="0 0 240 180" width="240" height="180" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <line x1="40" y1="20" x2="40" y2="150" stroke="#475569" stroke-width="1.5"/>
  <line x1="40" y1="150" x2="220" y2="150" stroke="#475569" stroke-width="1.5"/>
  <line x1="40" y1="150" x2="40" y2="50" stroke="#0d9488" stroke-width="2"/>
  <line x1="40" y1="50" x2="130" y2="50" stroke="#0d9488" stroke-width="2"/>
  <line x1="130" y1="50" x2="220" y2="120" stroke="#0d9488" stroke-width="2" stroke-dasharray="5,3"/>
  <text x="130" y="170" fill="#94a3b8" font-size="9" text-anchor="middle">${xLabel}</text>
  <text x="10" y="90" fill="#94a3b8" font-size="9" text-anchor="middle" transform="rotate(-90,10,90)">${yLabel}</text>
  <text x="130" y="14" fill="#e2e8f0" font-size="10" text-anchor="middle">${title}</text>
  </svg>`
}

function buildForceVectorDiagram({ angle = 30 } = {}) {
  const rad = angle * Math.PI / 180
  const fx = Math.cos(rad) * 70
  const fy = Math.sin(rad) * 70
  return `<svg viewBox="0 0 200 180" width="200" height="180" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="va" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0d9488"/></marker></defs>
  <line x1="30" y1="140" x2="185" y2="140" stroke="#475569" stroke-width="1"/>
  <line x1="30" y1="20" x2="30" y2="140" stroke="#475569" stroke-width="1"/>
  <line x1="30" y1="140" x2="${30+fx}" y2="${140-fy}" stroke="#0d9488" stroke-width="2.5" marker-end="url(#va)"/>
  <line x1="30" y1="140" x2="${30+fx}" y2="140" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4"/>
  <line x1="${30+fx}" y1="140" x2="${30+fx}" y2="${140-fy}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4"/>
  <text x="${30+fx/2}" y="135" fill="#94a3b8" font-size="9" text-anchor="middle">Fx</text>
  <text x="${30+fx+10}" y="${140-fy/2}" fill="#94a3b8" font-size="9">Fy</text>
  <text x="${30+fx/2-8}" y="${140-fy/2+10}" fill="#0d9488" font-size="10">F</text>
  <text x="${50}" y="132" fill="#e2e8f0" font-size="9">${angle}°</text>
  </svg>`
}

function buildParallelPlatesDiagram({} = {}) {
  return `<svg viewBox="0 0 220 160" width="220" height="160" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="ea" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#f59e0b"/></marker></defs>
  <rect x="20" y="20" width="180" height="12" fill="#334155" stroke="#0d9488" stroke-width="1.5" rx="2"/>
  <rect x="20" y="128" width="180" height="12" fill="#334155" stroke="#0d9488" stroke-width="1.5" rx="2"/>
  <text x="10" y="30" fill="#0d9488" font-size="11">+</text>
  <text x="10" y="140" fill="#ef4444" font-size="11">−</text>
  ${[60,95,130,165].map(x => `<line x1="${x}" y1="32" x2="${x}" y2="128" stroke="#f59e0b" stroke-width="1.5" marker-end="url(#ea)" stroke-dasharray="6,2"/>`).join('')}
  <text x="110" y="155" fill="#94a3b8" font-size="9" text-anchor="middle">Uniform Electric Field E</text>
  </svg>`
}

function buildGenericDiagram({ label = 'Diagram' } = {}) {
  return `<svg viewBox="0 0 200 120" width="200" height="120" style="background:#1e2535;border-radius:8px;" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="180" height="100" fill="none" stroke="#334155" stroke-width="1" rx="6"/>
  <text x="100" y="65" fill="#475569" font-size="11" text-anchor="middle">${label}</text>
  </svg>`
}

function pickDiagram(topicText) {
  const t = topicText.toLowerCase()
  if (t.includes('force') && (t.includes('body') || t.includes('object'))) return buildDiagram('free-body')
  if (t.includes('circuit') || t.includes('resistor') || t.includes('capacitor')) return buildDiagram('circuit')
  if (t.includes('wave') || t.includes('oscillat') || t.includes('harmonic')) return buildDiagram('wave')
  if (t.includes('vector') || t.includes('component') || t.includes('resolv')) return buildDiagram('force-vector')
  if (t.includes('electric field') || t.includes('plate') || t.includes('charge')) return buildDiagram('parallel-plates')
  if (t.includes('graph') || t.includes('velocity') || t.includes('acceleration') || t.includes('displacement')) return buildDiagram('graph')
  return null
}

// ── Section generators ────────────────────────────────────────────────────────

async function generateMCQSection(section, topics, context, subjectName, scope) {
  const topicList = topics.map(t => typeof t === 'string' ? t : t.name).join(', ')
  const questionCount = section.questionCount || 20
  const marksEach = section.marksPerQuestion || 1

  const prompt = `You are writing a ${subjectName} exam for ${scope.examBoard || 'a state curriculum'}.

PAST PAPER FORMAT:
- This is ${section.name}: ${section.type}
- EXACTLY ${questionCount} questions, ${marksEach} mark each
- Instructions: ${section.instructions || `Answer ALL ${questionCount} questions.`}

TOPICS TO COVER (must cover all of these across the questions):
${topicList}

STUDENT CONTEXT:
${context.slice(0, 4000)}

Generate EXACTLY ${questionCount} multiple choice questions. Distribute them EVENLY across all topics listed above — do not cluster questions on just one or two topics.

Return ONLY valid JSON in this exact structure:
{
  "sectionName": "${section.name}",
  "sectionType": "Multiple Choice",
  "instructions": "${section.instructions || `Answer ALL ${questionCount} questions. Each question is worth ${marksEach} mark.`}",
  "questions": [
    {
      "number": 1,
      "topic": "topic name",
      "stem": "Question text here",
      "options": {
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      },
      "answer": "A",
      "marks": ${marksEach},
      "explanation": "Brief explanation of why A is correct"
    }
  ]
}`

  const raw = await callClaude(
    `You are an expert exam writer. Generate exactly ${questionCount} MCQ questions. Return ONLY valid JSON.`,
    prompt,
    4500
  )
  return extractJson(raw)
}

async function generateShortAnswerSection(section, topics, context, subjectName, scope) {
  const topicList = topics.map(t => typeof t === 'string' ? t : t.name).join(', ')
  const questionCount = section.questionCount || 5
  const totalMarks = section.totalMarks || 50

  const prompt = `You are writing a ${subjectName} exam for ${scope.examBoard || 'a state curriculum'}.

PAST PAPER FORMAT:
- This is ${section.name}: ${section.type}
- EXACTLY ${questionCount} questions, totalling ${totalMarks} marks
- Instructions: ${section.instructions || `Answer ALL ${questionCount} questions.`}

TOPICS TO COVER:
${topicList}

STUDENT CONTEXT:
${context.slice(0, 4000)}

Generate EXACTLY ${questionCount} short answer questions. Each question should have 2-4 parts (a, b, c, d). Marks per question should add to approximately ${Math.round(totalMarks / questionCount)} marks each.

Where appropriate, reference diagrams (the app will render them). For diagram-based questions, add "diagramType": "free-body" or "circuit" or "wave" or "graph" to the question.

Return ONLY valid JSON:
{
  "sectionName": "${section.name}",
  "sectionType": "Short Answer",
  "instructions": "${section.instructions || `Answer ALL ${questionCount} questions.`}",
  "questions": [
    {
      "number": 1,
      "topic": "topic name",
      "context": "An object of mass 5 kg is placed on a frictionless surface...",
      "diagramType": "free-body",
      "parts": [
        {
          "part": "a",
          "question": "Calculate the net force acting on the object.",
          "marks": 3,
          "markingCriteria": ["Correct formula F = ma (1 mark)", "Correct substitution (1 mark)", "Correct answer with units (1 mark)"]
        },
        {
          "part": "b",
          "question": "Describe the motion of the object if a constant force is applied.",
          "marks": 2,
          "markingCriteria": ["Uniform acceleration (1 mark)", "Direction consistent with force (1 mark)"]
        }
      ],
      "totalMarks": 5
    }
  ]
}`

  const raw = await callClaude(
    `You are an expert exam writer. Generate exactly ${questionCount} short answer questions. Return ONLY valid JSON.`,
    prompt,
    5000
  )
  return extractJson(raw)
}

async function generateExtendedSection(section, topics, context, subjectName, scope) {
  const topicList = topics.map(t => typeof t === 'string' ? t : t.name).join(', ')
  const questionCount = section.questionCount || 2
  const totalMarks = section.totalMarks || 30

  const prompt = `You are writing a ${subjectName} exam for ${scope.examBoard || 'a state curriculum'}.

PAST PAPER FORMAT:
- This is ${section.name}: ${section.type}
- ${questionCount} extended response question(s), ${totalMarks} marks total
- Instructions: ${section.instructions || 'Answer all parts fully.'}

TOPICS:
${topicList}

CONTEXT:
${context.slice(0, 3000)}

Generate ${questionCount} extended response question(s) with multiple parts. These should require synthesis, evaluation, and multi-step reasoning.

Return ONLY valid JSON:
{
  "sectionName": "${section.name}",
  "sectionType": "Extended Response",
  "instructions": "${section.instructions || 'Answer all parts. Show all working.'}",
  "questions": [
    {
      "number": 1,
      "topic": "topic name",
      "context": "Scenario or stimulus text...",
      "parts": [
        {
          "part": "a",
          "question": "Extended question part...",
          "marks": 10,
          "markingCriteria": ["criterion 1", "criterion 2"]
        }
      ],
      "totalMarks": ${totalMarks}
    }
  ]
}`

  const raw = await callClaude(
    `You are an expert exam writer. Generate extended response questions. Return ONLY valid JSON.`,
    prompt,
    4000
  )
  return extractJson(raw)
}

// ── Topic coverage validator ──────────────────────────────────────────────────

function calculateTopicCoverage(paper, allTopics) {
  const coveredTopics = new Set()
  const paperText = JSON.stringify(paper).toLowerCase()

  for (const topic of allTopics) {
    const name = (typeof topic === 'string' ? topic : topic.name).toLowerCase()
    const words = name.split(/\s+/).filter(w => w.length > 3)
    if (words.some(w => paperText.includes(w))) {
      coveredTopics.add(name)
    }
  }

  return {
    covered: coveredTopics.size,
    total: allTopics.length,
    percentage: allTopics.length > 0 ? Math.round((coveredTopics.size / allTopics.length) * 100) : 100,
    uncoveredTopics: allTopics
      .map(t => typeof t === 'string' ? t : t.name)
      .filter(name => !coveredTopics.has(name.toLowerCase()))
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // QStash verification (optional — add if using Upstash QStash)
  // const sig = req.headers['upstash-signature']
  // if (!sig) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const body = await parseBody(req)
    const { paperId, userId, subjectId } = body

    if (!paperId || !userId || !subjectId) {
      return res.status(400).json({ error: 'paperId, userId, subjectId required' })
    }

    // Get subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) return res.status(404).json({ error: 'Subject not found' })

    // Get confirmed scope
    const scope = await redisGet(`sm:scope:${userId}:${subjectId}`)

    // Get all docs
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []

    // Build context from doc chunks
    let context = ''
    for (const doc of docs.slice(0, 5)) {
      const chunks = (doc.chunks || []).slice(0, 10)
      context += chunks.map(c => sanitize(c)).join('\n') + '\n\n'
    }

    // Get paper memory (topics used in previous papers)
    const paperMemory = await redisGet(`sm:paper-memory:${userId}:${subjectId}`) || []

    await updateProgress(paperId, userId, subjectId, 10, 'Analysing exam format...')

    const subjectName = scope?.subjectName || subject.name || 'the subject'
    const examBoard = scope?.examBoard || ''

    // Determine sections to generate
    let sections = scope?.sections || []
    const topics = scope?.topics || []
    const allTopics = topics.length > 0 ? topics : [{ name: subject.name || 'General Topics' }]

    // Filter out topics already heavily covered in previous papers
    const unusedTopics = allTopics.filter(t => {
      const name = (typeof t === 'string' ? t : t.name).toLowerCase()
      const timesUsed = paperMemory.filter(m => m.toLowerCase().includes(name)).length
      return timesUsed < 2
    })
    const topicsToUse = unusedTopics.length >= 3 ? unusedTopics : allTopics

    if (sections.length === 0) {
      // Fallback: default to MCQ + Short Answer
      sections = [
        { name: 'Section A', type: 'Multiple Choice', questionCount: 20, marksPerQuestion: 1, totalMarks: 20 },
        { name: 'Section B', type: 'Short Answer', questionCount: 5, marksPerQuestion: 10, totalMarks: 50 }
      ]
    }

    const generatedSections = []
    const progressStep = Math.floor(70 / sections.length)
    let progressBase = 15

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      await updateProgress(paperId, userId, subjectId, progressBase, `Generating ${section.name}...`)

      let sectionData = null
      const sType = (section.type || '').toLowerCase()

      try {
        if (sType.includes('multiple choice') || sType.includes('mcq')) {
          sectionData = await generateMCQSection(section, topicsToUse, context, subjectName, scope || {})
        } else if (sType.includes('extended') || sType.includes('essay')) {
          sectionData = await generateExtendedSection(section, topicsToUse, context, subjectName, scope || {})
        } else {
          // Default: short answer
          sectionData = await generateShortAnswerSection(section, topicsToUse, context, subjectName, scope || {})
        }

        if (!sectionData) {
          sectionData = {
            sectionName: section.name,
            sectionType: section.type,
            instructions: section.instructions || 'Answer all questions.',
            questions: [],
            error: 'Generation failed for this section'
          }
        }

        // Add SVG diagrams for questions that reference them
        if (sectionData.questions) {
          for (const q of sectionData.questions) {
            if (q.diagramType) {
              q.diagramSvg = buildDiagram(q.diagramType, {})
            } else {
              // Auto-detect diagram from question text
              const autoSvg = pickDiagram(JSON.stringify(q))
              if (autoSvg) q.diagramSvg = autoSvg
            }
          }
        }

        generatedSections.push(sectionData)
      } catch (sectionErr) {
        console.error(`Section ${section.name} failed:`, sectionErr.message)
        generatedSections.push({
          sectionName: section.name,
          sectionType: section.type,
          instructions: section.instructions || '',
          questions: [],
          error: sectionErr.message
        })
      }

      progressBase += progressStep
    }

    // Calculate topic coverage
    const coverage = calculateTopicCoverage({ sections: generatedSections }, allTopics)

    // Update paper memory with covered topics
    const newMemoryEntries = topics
      .filter(t => {
        const name = (typeof t === 'string' ? t : t.name).toLowerCase()
        return JSON.stringify(generatedSections).toLowerCase().includes(name.split(' ')[0])
      })
      .map(t => typeof t === 'string' ? t : t.name)

    const updatedMemory = [...paperMemory, ...newMemoryEntries].slice(-100)
    await redisSet(`sm:paper-memory:${userId}:${subjectId}`, updatedMemory)

    await updateProgress(paperId, userId, subjectId, 90, 'Finalising paper...')

    // Build final paper record
    const paper = {
      title: `${subjectName} Mock Examination`,
      subjectName,
      examBoard: scope?.examBoard || '',
      duration: scope?.duration || '',
      totalMarks: scope?.totalMarks || sections.reduce((sum, s) => sum + (s.totalMarks || 0), 0),
      instructions: `This paper is worth ${scope?.totalMarks || 'total'} marks. Time allowed: ${scope?.duration || 'see instructions'}.`,
      sections: generatedSections,
      coverage,
      generatedAt: new Date().toISOString(),
      scopeUsed: scope ? {
        examType: scope.examType,
        examBoard: scope.examBoard,
        duration: scope.duration,
        sectionCount: sections.length
      } : null
    }

    // Save complete paper
    const papersKey = `sm:papers:${userId}`
    const papers = await redisGet(papersKey) || []
    const idx = papers.findIndex(p => p.id === paperId)
    if (idx !== -1) {
      papers[idx].status = 'complete'
      papers[idx].progress = 100
      papers[idx].paper = paper
      papers[idx].coverage = coverage
      papers[idx].completedAt = new Date().toISOString()
      await redisSet(papersKey, papers)
    }

    return res.status(200).json({ ok: true, paperId, coverage })

  } catch (e) {
    console.error('mock-worker error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
