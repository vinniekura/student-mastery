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
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  throw new Error('Could not extract JSON from response')
}

const EXAM_PRESETS = {
  UCAT: {
    name: 'UCAT', fullName: 'University Clinical Aptitude Test',
    sections: [
      { name: 'Verbal Reasoning', type: 'mcq', marks: 44, instructions: '21 minutes. Read passages and answer questions.', questionCount: 2 },
      { name: 'Decision Making', type: 'mcq', marks: 29, instructions: '31 minutes. Logical reasoning.', questionCount: 2 },
      { name: 'Quantitative Reasoning', type: 'mcq', marks: 36, instructions: '25 minutes. Numerical interpretation.', questionCount: 2 },
      { name: 'Abstract Reasoning', type: 'mcq', marks: 50, instructions: '12 minutes. Pattern recognition.', questionCount: 2 },
      { name: 'Situational Judgement', type: 'mcq', marks: 69, instructions: '26 minutes. Rate appropriateness of responses.', questionCount: 2 }
    ],
    totalMarks: 3600, timeLimitMins: 115,
    style: 'UCAT AU/NZ. Aptitude not knowledge. Clinical scenarios for SJT. VR uses dense passages.'
  },
  GAMSAT: {
    name: 'GAMSAT', fullName: 'Graduate Medical School Admissions Test',
    sections: [
      { name: 'Section I — Humanities & Social Sciences', type: 'mcq', marks: 75, instructions: 'Interpret texts, poems, cartoons.', questionCount: 2 },
      { name: 'Section II — Written Communication', type: 'extended', marks: 2, instructions: 'Two essays: personal/social and argumentative.', questionCount: 2 },
      { name: 'Section III — Biological & Physical Sciences', type: 'mcq', marks: 110, instructions: 'Biology 40%, Chemistry 40%, Physics 20%.', questionCount: 2 }
    ],
    totalMarks: 100, timeLimitMins: 348,
    style: 'GAMSAT AU. Graduate-level difficulty. Section III requires deep science reasoning.'
  },
  IELTS: {
    name: 'IELTS Academic', fullName: 'International English Language Testing System',
    sections: [
      { name: 'Reading', type: 'short', marks: 40, instructions: 'Three passages. MCQ, matching, completion.', questionCount: 2 },
      { name: 'Writing Task 1', type: 'extended', marks: 9, instructions: 'Describe a graph or chart in 150+ words.', questionCount: 1 },
      { name: 'Writing Task 2', type: 'extended', marks: 9, instructions: 'Argumentative essay 250+ words.', questionCount: 1 }
    ],
    totalMarks: 9, timeLimitMins: 120,
    style: 'IELTS Academic band 6.5-8.0. Formal register. Authentic academic texts.'
  },
  SELECTIVE: {
    name: 'Selective School', fullName: 'NSW Selective School Entry Test',
    sections: [
      { name: 'Reading', type: 'mcq', marks: 30, instructions: 'Comprehension questions.', questionCount: 2 },
      { name: 'Mathematical Reasoning', type: 'mcq', marks: 35, instructions: 'Problem solving questions.', questionCount: 2 },
      { name: 'Thinking Skills', type: 'mcq', marks: 40, instructions: 'Abstract reasoning questions.', questionCount: 2 },
      { name: 'Writing', type: 'extended', marks: 30, instructions: 'Creative or persuasive prompt.', questionCount: 1 }
    ],
    totalMarks: 135, timeLimitMins: 175,
    style: 'NSW Selective Year 9 entry. Year 8 students. Australian contexts.'
  },
  AMC: {
    name: 'AMC MCQ', fullName: 'Australian Medical Council MCQ Examination',
    sections: [
      { name: 'Clinical Medicine', type: 'mcq', marks: 150, instructions: 'Single best answer clinical vignettes.', questionCount: 4 }
    ],
    totalMarks: 150, timeLimitMins: 210,
    style: 'AMC MCQ. Clinical vignette format. All specialties. Evidence-based.'
  },
  OC: {
    name: 'OC Test', fullName: 'Opportunity Class Placement Test',
    sections: [
      { name: 'Reading', type: 'mcq', marks: 30, instructions: 'Comprehension on varied texts.', questionCount: 2 },
      { name: 'Mathematical Reasoning', type: 'mcq', marks: 35, instructions: 'Numeracy for Year 4-5 level.', questionCount: 2 },
      { name: 'Thinking Skills', type: 'mcq', marks: 30, instructions: 'Logical and abstract reasoning.', questionCount: 2 }
    ],
    totalMarks: 95, timeLimitMins: 120,
    style: 'NSW OC. Year 4 level (9-10 year olds). Simple language. Australian contexts.'
  }
}

async function generatePaper(userId, subject, options) {
  const { subjectId, customInstructions, replaceSlot, forceNew } = options
  const { name, state, examBoard, yearLevel, topics = [], paperFormat = {} } = subject

  const preset = EXAM_PRESETS[examBoard?.toUpperCase()] || EXAM_PRESETS[name?.toUpperCase()]
  const isCompetitive = !!preset

  const { totalMarks = preset?.totalMarks || 100, timeLimitMins = preset?.timeLimitMins || 180 } = paperFormat

  // Get existing papers for memory
  const paperKey = `sm:papers:${userId}:${subjectId}`
  const existingPapers = await redisGet(paperKey) || []

  // Paper memory
  const usedTopics = [...new Set(existingPapers.flatMap(p => p.topicsCovered || []))]
  const usedQuestions = existingPapers.flatMap(p => (p.questionsAsked || []).slice(0, 2))
  const allTopics = topics.map(t => t.name)
  const unusedTopics = allTopics.filter(t => !usedTopics.includes(t))

  // Get docs — prefer 'past-paper' type for mock generation
  const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
  const pastPapers = allDocs.filter(d => d.docType === 'past-paper')
  const notesDocs = allDocs.filter(d => d.docType === 'notes' || !d.docType)
  // Use past papers first, fall back to notes, then nothing
  const docsToUse = pastPapers.length > 0 ? pastPapers : notesDocs
  let docContext = ''
  let sourceType = 'syllabus'
  if (docsToUse.length > 0) {
    const allChunks = docsToUse.flatMap(d => d.chunks || [])
    let charCount = 0
    const selected = []
    for (const chunk of allChunks) {
      if (charCount + chunk.length > 4000) break
      selected.push(chunk)
      charCount += chunk.length
    }
    if (charCount > 100) {
      docContext = selected.join('\n\n')
      sourceType = pastPapers.length > 0 ? 'past-paper' : 'docs'
    }
  }

  const paperNumber = replaceSlot !== null && replaceSlot !== undefined
    ? replaceSlot
    : existingPapers.length + 1

  const memorySection = usedTopics.length > 0
    ? `AVOID repeating: ${usedTopics.join(', ')}. PRIORITISE: ${unusedTopics.length > 0 ? unusedTopics.join(', ') : 'fresh scenarios'}. Do NOT reuse: ${usedQuestions.slice(0, 3).join(' | ')}`
    : ''

  let prompt
  if (isCompetitive) {
    const p = preset
    const sectionDetail = p.sections.map((s, i) =>
      `Section ${i + 1}: ${s.name} — ${s.questionCount} questions. ${s.instructions}`
    ).join('\n')

    prompt = `Create Mock Paper ${paperNumber} for ${p.name} (${p.fullName}).
Style: ${p.style}
${memorySection ? `Memory: ${memorySection}` : ''}
${docContext ? `Student material:\n${docContext.slice(0, 1200)}` : ''}
${customInstructions ? `Focus: ${customInstructions}` : ''}

Sections:
${sectionDetail}

Return ONLY valid JSON:`
  } else {
    const topicsList = allTopics.length > 0 ? allTopics.join(', ') : `General ${name}`
    const sections = Array.isArray(paperFormat.sections)
      ? paperFormat.sections
      : ['Multiple choice', 'Short answer', 'Extended response']
    const marksPerSection = Math.floor(totalMarks / sections.length)

    prompt = `Create Mock Paper ${paperNumber} for ${examBoard} ${name}, Year ${yearLevel}, ${state}.
${memorySection ? `Memory: ${memorySection}` : ''}
${docContext ? `Use this material:\n${docContext.slice(0, 1200)}` : ''}
${customInstructions ? `Focus: ${customInstructions}` : ''}
Topics: ${topicsList}
Sections: ${sections.join(', ')} — ${marksPerSection} marks each
Total: ${totalMarks} marks, ${timeLimitMins} minutes

Return ONLY valid JSON — 3-4 questions per section, match real ${examBoard} style:`
  }

  const jsonTemplate = `{
  "title": "${isCompetitive ? (preset?.name || name) : name} — Mock Paper ${paperNumber}",
  "examBoard": "${isCompetitive ? (preset?.name || examBoard) : examBoard}",
  "subject": "${name}",
  "yearLevel": "${yearLevel || 'N/A'}",
  "totalMarks": ${totalMarks},
  "timeAllowed": "${timeLimitMins} minutes",
  "instructions": "Answer ALL questions.",
  "sections": [{"name":"...","type":"mcq","marks":0,"instructions":"...","questions":[{"number":1,"question":"...","marks":1,"type":"mcq","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","markingCriteria":"...","topic":"..."}]}]
}`

  const fullPrompt = `${prompt}\n\nStructure:\n${jsonTemplate}`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: '{' }
      ]
    })
  })

  if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`)

  const claudeData = await claudeRes.json()
  const raw = '{' + (claudeData.content?.[0]?.text || '{}')
  const paper = extractJson(raw)

  if (!paper.sections || !Array.isArray(paper.sections)) {
    throw new Error('Invalid paper structure')
  }

  const topicsCovered = [...new Set(
    paper.sections.flatMap(s => s.questions?.map(q => q.topic).filter(Boolean) || [])
  )]
  const questionsAsked = paper.sections.flatMap(s =>
    s.questions?.map(q => q.question?.slice(0, 60)).filter(Boolean) || []
  )

  const paperRecord = {
    id: genId(),
    slotNumber: paperNumber,
    subjectId,
    subjectName: name,
    examBoard,
    generatedAt: new Date().toISOString(),
    sourceType,
    docCount: docs.length,
    topicsCovered,
    questionsAsked,
    isCompetitive,
    status: 'ready',
    paper
  }

  // Save to subject-specific slot
  let updatedPapers = [...existingPapers]
  if (replaceSlot !== null && replaceSlot !== undefined) {
    const slotIdx = updatedPapers.findIndex(p => p.slotNumber === replaceSlot)
    if (slotIdx >= 0) updatedPapers[slotIdx] = paperRecord
    else updatedPapers.push(paperRecord)
  } else if (forceNew && updatedPapers.length >= 5) {
    updatedPapers.sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt))
    updatedPapers[0] = { ...paperRecord, slotNumber: updatedPapers[0].slotNumber }
  } else {
    updatedPapers.push(paperRecord)
  }

  updatedPapers = updatedPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber)
  await redisSet(paperKey, updatedPapers)

  return paperRecord
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const { subjectId, customInstructions = '', forceNew = false, replaceSlot = null } = await parseBody(req)
    if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) { res.status(404).json({ error: 'Subject not found' }); return }

    // Check slots
    const paperKey = `sm:papers:${userId}:${subjectId}`
    const existingPapers = await redisGet(paperKey) || []
    if (existingPapers.length >= 5 && !forceNew && replaceSlot === null) {
      res.status(200).json({
        slotsExhausted: true,
        papers: existingPapers.map(({ paper, questionsAsked, ...rest }) => rest)
      })
      return
    }

    // Write a "generating" placeholder immediately
    const jobId = genId()
    const slotNumber = replaceSlot !== null ? replaceSlot : existingPapers.length + 1
    const placeholder = {
      id: jobId,
      slotNumber,
      subjectId,
      subjectName: subject.name,
      generatedAt: new Date().toISOString(),
      status: 'generating',
      topicsCovered: [],
      paper: null
    }

    let updatedPapers = [...existingPapers]
    if (replaceSlot !== null) {
      const idx = updatedPapers.findIndex(p => p.slotNumber === replaceSlot)
      if (idx >= 0) updatedPapers[idx] = placeholder
      else updatedPapers.push(placeholder)
    } else {
      updatedPapers.push(placeholder)
    }
    updatedPapers = updatedPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber)
    await redisSet(paperKey, updatedPapers)

    // Return immediately — fire and forget
    res.status(200).json({ ok: true, jobId, slotNumber, status: 'generating' })

    // Generate in background (after response sent)
    generatePaper(userId, subject, { subjectId, customInstructions, replaceSlot, forceNew })
      .catch(async (e) => {
        console.error('Background generation failed:', e.message)
        // Mark placeholder as failed
        const papers = await redisGet(paperKey) || []
        const idx = papers.findIndex(p => p.id === jobId)
        if (idx >= 0) {
          papers[idx] = { ...papers[idx], status: 'failed', error: e.message }
          await redisSet(paperKey, papers)
        }
      })

  } catch (e) {
    console.error('generate-mock error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
