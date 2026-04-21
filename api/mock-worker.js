import { redisGet, redisSet } from './lib/redis.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function sanitize(text) {
  if (!text) return ''
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .trim()
}

function extractJson(text) {
  try { return JSON.parse(text.trim()) } catch {}
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  try { return JSON.parse(stripped) } catch {}
  // Find outermost { } — try progressively shorter substrings
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON found')
  for (let end = text.length - 1; end > start; end--) {
    if (text[end] === '}') {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1))
        if (parsed && typeof parsed === 'object') return parsed
      } catch {}
    }
  }
  // Auto-close truncated JSON
  const partial = text.slice(start)
  let open = 0, openBr = 0, inStr = false, esc = false
  for (const ch of partial) {
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') open++; if (ch === '}') open--
    if (ch === '[') openBr++; if (ch === ']') openBr--
  }
  let closed = partial.trimEnd().replace(/,\s*$/, '')
  while (openBr > 0) { closed += ']'; openBr-- }
  while (open > 0) { closed += '}'; open-- }
  try {
    const parsed = JSON.parse(closed)
    if (parsed?.questions || parsed?.sections) { parsed._truncated = true; return parsed }
  } catch {}
  throw new Error('Could not extract JSON')
}

async function callClaude(prompt, maxTokens = 2000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '[' }
      ]
    })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} ${err.slice(0, 100)}`)
  }
  const data = await res.json()
  console.log(`Claude call: ${data.content?.[0]?.text?.length || 0} chars | stop: ${data.stop_reason}`)
  return '[' + (data.content?.[0]?.text || '[]')
}

function buildDifficultyNote(profile, mode) {
  if (!profile) return ''
  if (mode === 'match') return `Match this difficulty exactly: ${profile.description || 'standard'}. Cognitive level: ${profile.cognitiveLevel || 'apply'}. Steps per problem: ${profile.stepsPerCalculation || '2-3'}.`
  if (mode === 'harder') return `Make it ~20% harder than: ${profile.description}. Add one extra step per calculation, combine 2 concepts.`
  if (mode === 'exam-plus') return `Maximum difficulty. Multi-concept synthesis, 3+ steps, students must identify which principle applies.`
  return ''
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let body = {}
  try { body = await parseBody(req) } catch {}

  const { jobId, userId, subjectId, slotNumber, customInstructions = '', confirmedScope = null, difficultyMode = 'match' } = body

  if (!jobId || !userId || !subjectId) { res.status(400).json({ error: 'Missing required fields' }); return }

  const paperKey = `sm:papers:${userId}:${subjectId}`

  async function markFailed(msg) {
    try {
      const pp = await redisGet(paperKey) || []
      const ii = pp.findIndex(p => p.id === jobId)
      if (ii >= 0) { pp[ii].status = 'failed'; pp[ii].error = msg; await redisSet(paperKey, pp) }
    } catch {}
  }

  try {
    const papers = await redisGet(paperKey) || []
    const ji = papers.findIndex(p => p.id === jobId)
    if (ji >= 0) { papers[ji].status = 'generating'; await redisSet(paperKey, papers) }

    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) throw new Error('Subject not found')

    const { name, examBoard = 'BSSS', yearLevel = '12' } = subject
    const scopeTopics     = confirmedScope?.topics?.length > 0 ? confirmedScope.topics : (subject.topics || [])
    const scopeTerm       = confirmedScope?.term || null
    const scopeExamType   = confirmedScope?.examType || 'exam'
    const levelDesc       = confirmedScope?.levelDescription || `Year ${yearLevel} ${examBoard}`
    const diffProfile     = confirmedScope?.difficultyProfile || null
    const diffNote        = buildDifficultyNote(diffProfile, difficultyMode)
    const topicsList      = scopeTopics.length > 0 ? scopeTopics.join(', ') : `General ${name}`

    // Load doc context — capped at 1000 chars
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    let docContext = ''
    if (allDocs.length > 0) {
      const chunks = allDocs.flatMap(d => d.chunks || [])
      let chars = 0
      for (const chunk of chunks) {
        const clean = sanitize(chunk)
        if (chars + clean.length > 1000) break
        docContext += clean + '\n'; chars += clean.length
      }
    }

    const context = `Subject: ${name} | Level: ${levelDesc} | Topics: ${topicsList}${scopeTerm ? ` | Scope: ${scopeTerm}` : ''}${customInstructions ? ` | Focus: ${customInstructions}` : ''}${diffNote ? `\nDifficulty: ${diffNote}` : ''}${docContext ? `\nReference material:\n${docContext.slice(0, 800)}` : ''}`

    // ── CALL 1: Generate MCQ questions ─────────────────────────────────────
    const mcqPrompt = `You are an expert exam paper writer for ${name}.

${context}

Generate exactly 10 multiple choice questions for a ${examBoard} exam paper.
Each question worth 1 mark. Topics: ${topicsList}.
Questions must be realistic exam standard — not trivial. Plausible distractors (common mistakes).

Return ONLY a valid JSON array of 10 questions, no other text:
[{"number":1,"question":"Full question text","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"B","topic":"Topic name","workingOut":"Brief solution"}]`

    const mcqRaw = await callClaude(mcqPrompt, 2500)
    let mcqQuestions = []
    try {
      const parsed = JSON.parse(mcqRaw)
      mcqQuestions = Array.isArray(parsed) ? parsed : []
    } catch {
      try { mcqQuestions = extractJson(mcqRaw) } catch {}
    }
    if (!Array.isArray(mcqQuestions)) mcqQuestions = []

    // ── CALL 2: Generate short answer questions ─────────────────────────────
    const saPrompt = `You are an expert exam paper writer for ${name}.

${context}

Generate exactly 2 short answer questions for a ${examBoard} exam paper.
Each question should have 3-4 sub-parts (a, b, c, d) worth 2-3 marks each. Total ~20 marks.
Questions must require calculation and reasoning. Show marking criteria per part.

Return ONLY a valid JSON array of 2 questions, no other text:
[{"number":11,"question":"Stem text for the question scenario","marks":10,"topic":"Topic name","parts":[{"part":"a","question":"Sub-question text","marks":2,"answer":"Solution with working","markingCriteria":"Award 1 mark for... Award 1 mark for..."}]}]`

    const saRaw = await callClaude(saPrompt, 2500)
    let saQuestions = []
    try {
      const parsed = JSON.parse(saRaw)
      saQuestions = Array.isArray(parsed) ? parsed : []
    } catch {
      try { saQuestions = extractJson(saRaw) } catch {}
    }
    if (!Array.isArray(saQuestions)) saQuestions = []

    // Renumber short answer questions
    saQuestions = saQuestions.map((q, i) => ({ ...q, number: mcqQuestions.length + i + 1 }))

    const mcqMarks  = mcqQuestions.length
    const saMarks   = saQuestions.reduce((sum, q) => sum + (q.marks || 10), 0)
    const totalMarks = mcqMarks + saMarks

    const paper = {
      coverPage: {
        school: 'Narrabundah College',
        subject: name,
        level: levelDesc,
        examType: scopeExamType,
        mockNumber: slotNumber,
        scope: scopeTerm || undefined,
        instructions: [
          'Write in black or blue pen only',
          'Show all working for full marks',
          'Scientific calculator permitted',
          'Phones and electronic devices must be away'
        ]
      },
      title: `${name} — Mock Paper ${slotNumber}${scopeTerm ? ` (${scopeTerm})` : ''}`,
      subject: name,
      levelDescription: levelDesc,
      examBoard,
      scopeTerm: scopeTerm || null,
      scopeExamType,
      difficultyMode,
      totalMarks,
      timeAllowed: confirmedScope?.format?.timeMins ? `${confirmedScope.format.timeMins} minutes` : '60 minutes',
      allowedMaterials: 'Scientific calculator, ruler',
      diagrams: [],
      sections: [
        {
          name: 'Section A: Multiple Choice',
          type: 'mcq',
          marks: mcqMarks,
          instructions: 'Circle the letter of the best answer. Each question is worth 1 mark.',
          questions: mcqQuestions.map(q => ({ ...q, type: 'mcq', marks: 1, parts: null, markingCriteria: `Award 1 mark for ${q.answer}` }))
        },
        {
          name: 'Section B: Short Answer',
          type: 'short',
          marks: saMarks,
          instructions: 'Answer ALL questions in the spaces provided. Show all working clearly.',
          questions: saQuestions.map(q => ({ ...q, type: 'short' }))
        }
      ]
    }

    const topicsCovered = [...new Set([
      ...mcqQuestions.map(q => q.topic).filter(Boolean),
      ...saQuestions.map(q => q.topic).filter(Boolean)
    ])]

    const paperRecord = {
      id: jobId, slotNumber, subjectId,
      subjectName: name, levelDescription: levelDesc, examBoard,
      scopeTerm: scopeTerm || null, scopeExamType, difficultyMode,
      generatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      sourceType: allDocs.length > 0 ? 'docs' : 'syllabus',
      docCount: allDocs.length, topicsCovered, status: 'ready', paper
    }

    const finalPapers = await redisGet(paperKey) || []
    const fi = finalPapers.findIndex(p => p.id === jobId)
    if (fi >= 0) finalPapers[fi] = paperRecord
    else finalPapers.push(paperRecord)
    await redisSet(paperKey, finalPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber))

    console.log(`Paper ${slotNumber} ready — ${mcqQuestions.length} MCQ + ${saQuestions.length} SA = ${totalMarks} marks`)
    res.status(200).json({ ok: true, jobId, slotNumber, totalMarks })

  } catch (e) {
    console.error('mock-worker error:', e.message)
    await markFailed(e.message)
    res.status(500).json({ error: e.message })
  }
}
