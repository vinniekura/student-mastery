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

// Competitive exam presets
const EXAM_PRESETS = {
  UCAT: {
    name: 'UCAT',
    fullName: 'University Clinical Aptitude Test',
    sections: [
      { name: 'Verbal Reasoning', type: 'mcq', marks: 44, instructions: '44 questions, 21 minutes. Read passages and answer questions.', questionCount: 6 },
      { name: 'Decision Making', type: 'mcq', marks: 29, instructions: '29 questions, 31 minutes. Logical reasoning and decision analysis.', questionCount: 4 },
      { name: 'Quantitative Reasoning', type: 'mcq', marks: 36, instructions: '36 questions, 25 minutes. Numerical and data interpretation.', questionCount: 5 },
      { name: 'Abstract Reasoning', type: 'mcq', marks: 50, instructions: '50 questions, 12 minutes. Pattern recognition and spatial reasoning.', questionCount: 4 },
      { name: 'Situational Judgement', type: 'mcq', marks: 69, instructions: '69 questions, 26 minutes. Rate appropriateness of responses.', questionCount: 4 }
    ],
    totalMarks: 3600,
    timeLimitMins: 115,
    style: 'UCAT Australia/New Zealand. Questions test aptitude not knowledge. Use realistic clinical and professional scenarios for SJT. VR uses dense text passages.'
  },
  GAMSAT: {
    name: 'GAMSAT',
    fullName: 'Graduate Medical School Admissions Test',
    sections: [
      { name: 'Section I — Reasoning in Humanities & Social Sciences', type: 'mcq', marks: 75, instructions: 'Interpret and analyse texts, poems, cartoons and other stimuli.', questionCount: 8 },
      { name: 'Section II — Written Communication', type: 'extended', marks: 2, instructions: 'Two essays: one personal/social, one argumentative. 60 minutes.', questionCount: 2 },
      { name: 'Section III — Reasoning in Biological & Physical Sciences', type: 'mcq', marks: 110, instructions: 'Biology (40%), Chemistry (40%), Physics (20%). Unit-based questions.', questionCount: 10 }
    ],
    totalMarks: 100,
    timeLimitMins: 348,
    style: 'GAMSAT Australia. High difficulty graduate-level. Section III requires deep science reasoning. Essay tasks need sophisticated argument structure.'
  },
  IELTS: {
    name: 'IELTS Academic',
    fullName: 'International English Language Testing System',
    sections: [
      { name: 'Reading', type: 'short', marks: 40, instructions: 'Three long passages. Answer questions including MCQ, matching, completion.', questionCount: 8 },
      { name: 'Writing Task 1', type: 'extended', marks: 9, instructions: 'Describe a graph, chart, diagram or map in 150+ words.', questionCount: 1 },
      { name: 'Writing Task 2', type: 'extended', marks: 9, instructions: 'Write an argumentative essay in 250+ words on a given topic.', questionCount: 1 }
    ],
    totalMarks: 9,
    timeLimitMins: 120,
    style: 'IELTS Academic band 6.5-8.0 level. Reading uses authentic academic texts. Writing tasks need formal register and coherent argument.'
  },
  SELECTIVE: {
    name: 'Selective School',
    fullName: 'NSW Selective School Entry Test',
    sections: [
      { name: 'Reading', type: 'mcq', marks: 30, instructions: 'Read passages and answer comprehension questions.', questionCount: 6 },
      { name: 'Mathematical Reasoning', type: 'mcq', marks: 35, instructions: 'Problem solving and mathematical reasoning questions.', questionCount: 7 },
      { name: 'Thinking Skills', type: 'mcq', marks: 40, instructions: 'Verbal and non-verbal abstract reasoning questions.', questionCount: 8 },
      { name: 'Writing', type: 'extended', marks: 30, instructions: 'Write a response to a creative or persuasive prompt.', questionCount: 1 }
    ],
    totalMarks: 135,
    timeLimitMins: 175,
    style: 'NSW Selective High School Placement Test. Year 9 entry. Questions appropriate for Year 8 students. Use Australian contexts and scenarios.'
  },
  AMC: {
    name: 'AMC MCQ',
    fullName: 'Australian Medical Council MCQ Examination',
    sections: [
      { name: 'Clinical Medicine', type: 'mcq', marks: 150, instructions: 'Single best answer questions across all medical specialties.', questionCount: 15 }
    ],
    totalMarks: 150,
    timeLimitMins: 210,
    style: 'AMC MCQ exam. Clinical vignette format. 35-year-old presents with... style. Cover medicine, surgery, O&G, paediatrics, psychiatry, GP. Evidence-based practice.'
  },
  OC: {
    name: 'OC Test',
    fullName: 'Opportunity Class Placement Test',
    sections: [
      { name: 'Reading', type: 'mcq', marks: 30, instructions: 'Comprehension questions on varied texts.', questionCount: 6 },
      { name: 'Mathematical Reasoning', type: 'mcq', marks: 35, instructions: 'Numeracy and problem solving for Year 4-5 level.', questionCount: 7 },
      { name: 'Thinking Skills', type: 'mcq', marks: 30, instructions: 'Logical and abstract reasoning questions.', questionCount: 6 }
    ],
    totalMarks: 95,
    timeLimitMins: 120,
    style: 'NSW OC Placement Test. Year 4 level (9-10 year olds). Simple, clear language. Australian school contexts. Fun and engaging scenarios.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const {
      subjectId,
      customInstructions = '',
      forceNew = false,
      replaceSlot = null
    } = await parseBody(req)

    if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

    // Get subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) { res.status(404).json({ error: 'Subject not found' }); return }

    const { name, state, examBoard, yearLevel, topics = [], paperFormat = {} } = subject

    // Check if this is a competitive exam preset
    const preset = EXAM_PRESETS[examBoard] || EXAM_PRESETS[name?.toUpperCase()]
    const isCompetitive = !!preset

    const {
      sections = preset?.sections?.map(s => s.name) || ['Multiple choice', 'Short answer', 'Extended response'],
      totalMarks = preset?.totalMarks || 100,
      timeLimitMins = preset?.timeLimitMins || 180
    } = paperFormat

    // Get existing papers for this subject
    const paperKey = `sm:papers:${userId}:${subjectId}`
    const existingPapers = await redisGet(paperKey) || []

    // Check slot availability
    const MAX_SLOTS = 5
    if (existingPapers.length >= MAX_SLOTS && !forceNew && replaceSlot === null) {
      res.status(200).json({
        slotsExhausted: true,
        message: `You have ${MAX_SLOTS} mock papers for this subject. Choose a slot to replace.`,
        papers: existingPapers.map(({ paper, ...rest }) => rest)
      })
      return
    }

    // Build paper memory — what topics/questions have been used
    const usedTopics = []
    const usedQuestions = []
    for (const p of existingPapers) {
      if (p.topicsCovered) usedTopics.push(...p.topicsCovered)
      if (p.questionsAsked) usedQuestions.push(...p.questionsAsked.slice(0, 3))
    }
    const uniqueUsedTopics = [...new Set(usedTopics)]
    const allTopics = topics.map(t => t.name)
    const unusedTopics = allTopics.filter(t => !uniqueUsedTopics.includes(t))

    // Get ingested docs
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    let docContext = ''
    let sourceType = 'syllabus'

    if (docs.length > 0) {
      const allChunks = docs.flatMap(d => d.chunks || [])
      let charCount = 0
      const selected = []
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 5000) break
        selected.push(chunk)
        charCount += chunk.length
      }
      if (charCount > 100) {
        docContext = selected.join('\n\n')
        sourceType = 'docs'
      }
    }

    // Build prompt
    const paperNumber = replaceSlot !== null ? replaceSlot : existingPapers.length + 1
    const memorySection = uniqueUsedTopics.length > 0
      ? `\nPAPER MEMORY (avoid repeating these):\n- Already covered: ${uniqueUsedTopics.join(', ')}\n- Prioritise these unused topics: ${unusedTopics.length > 0 ? unusedTopics.join(', ') : 'create fresh scenarios on covered topics'}\n- Do NOT reuse these question stems: ${usedQuestions.join(' | ') || 'none yet'}\n`
      : ''

    let prompt
    if (isCompetitive) {
      const p = preset
      const sectionDetail = p.sections.map((s, i) =>
        `Section ${i + 1}: ${s.name} — ${s.questionCount} questions, ${s.marks} marks. ${s.instructions}`
      ).join('\n')

      prompt = `You are an expert ${p.fullName} (${p.name}) exam paper writer.

Create Mock Paper ${paperNumber} for ${p.name}.
${memorySection}
EXAM STYLE: ${p.style}
${docContext ? `\nStudent's study material:\n---\n${docContext.slice(0, 3000)}\n---\n` : ''}
${customInstructions ? `\nExtra instructions: ${customInstructions}\n` : ''}

SECTIONS:
${sectionDetail}

Return ONLY this JSON (no other text):
{
  "title": "${p.name} — Mock Paper ${paperNumber}",
  "examBoard": "${p.name}",
  "subject": "${p.fullName}",
  "yearLevel": "Graduate/Undergraduate",
  "totalMarks": ${p.totalMarks},
  "timeAllowed": "${p.timeLimitMins} minutes",
  "instructions": "This is a timed practice exam. Work through each section systematically.",
  "sections": [/* all ${p.sections.length} sections with realistic questions */]
}`
    } else {
      const topicsList = allTopics.length > 0 ? allTopics.join(', ') : `General ${name} content`
      const sectionList = Array.isArray(sections) ? sections : ['Multiple choice', 'Short answer', 'Extended response']
      const marksPerSection = Math.floor(totalMarks / sectionList.length)

      prompt = `You are an expert ${examBoard} exam paper writer for ${name}, Year ${yearLevel}, ${state}.

Create Mock Paper ${paperNumber} that DIFFERS from previous papers.
${memorySection}
${docContext ? `\nBase questions on this study material:\n---\n${docContext.slice(0, 4000)}\n---\n` : ''}
${customInstructions ? `\nExtra focus: ${customInstructions}\n` : ''}

EXAM SPECS:
- Subject: ${name} | Board: ${examBoard} | Year: ${yearLevel} | State: ${state}
- Total marks: ${totalMarks} | Time: ${timeLimitMins} minutes
- Sections: ${sectionList.join(', ')}
- Topics: ${topicsList}

Return ONLY this JSON (no other text):
{
  "title": "${name} — Mock Paper ${paperNumber}",
  "examBoard": "${examBoard}",
  "subject": "${name}",
  "yearLevel": "${yearLevel}",
  "totalMarks": ${totalMarks},
  "timeAllowed": "${timeLimitMins} minutes",
  "instructions": "Answer ALL questions. Show all working where required.",
  "sections": [
    {
      "name": "section name",
      "type": "mcq|short|extended",
      "marks": ${marksPerSection},
      "instructions": "section instructions",
      "questions": [
        {
          "number": 1,
          "question": "question text",
          "marks": 2,
          "type": "mcq",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "answer": "B",
          "markingCriteria": "marking criteria",
          "topic": "topic name"
        }
      ]
    }
  ]
}`
    }

    // Call Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251001',
        max_tokens: 6000,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }
        ]
      })
    })

    if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`)

    const claudeData = await claudeRes.json()
    const raw = '{' + (claudeData.content?.[0]?.text || '{}')
    const paper = extractJson(raw)

    if (!paper.sections || !Array.isArray(paper.sections)) {
      throw new Error('Invalid paper structure — please try again')
    }

    // Extract topics covered in this paper
    const topicsCovered = [...new Set(
      paper.sections.flatMap(s => s.questions?.map(q => q.topic).filter(Boolean) || [])
    )]
    const questionsAsked = paper.sections.flatMap(s =>
      s.questions?.map(q => q.question?.slice(0, 60)).filter(Boolean) || []
    )

    // Build paper record
    const paperRecord = {
      id: genId(),
      slotNumber: paperNumber,
      subjectId,
      subjectName: name,
      examBoard: examBoard,
      generatedAt: new Date().toISOString(),
      sourceType,
      docCount: docs.length,
      topicsCovered,
      questionsAsked,
      isCompetitive,
      paper
    }

    // Save to slot
    let updatedPapers = [...existingPapers]
    if (replaceSlot !== null) {
      const slotIdx = updatedPapers.findIndex(p => p.slotNumber === replaceSlot)
      if (slotIdx >= 0) updatedPapers[slotIdx] = paperRecord
      else updatedPapers.push(paperRecord)
    } else if (forceNew && updatedPapers.length >= MAX_SLOTS) {
      // Replace oldest
      updatedPapers.sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt))
      updatedPapers[0] = { ...paperRecord, slotNumber: updatedPapers[0].slotNumber }
    } else {
      updatedPapers.push(paperRecord)
    }

    // Keep max 5, sorted by slot
    updatedPapers = updatedPapers.slice(0, MAX_SLOTS)
    updatedPapers.sort((a, b) => a.slotNumber - b.slotNumber)

    await redisSet(paperKey, updatedPapers)

    // Also update global papers index for listing
    const globalKey = `sm:papers:${userId}`
    const globalPapers = await redisGet(globalKey) || []
    const globalIdx = globalPapers.findIndex(p => p.id === paperRecord.id)
    if (globalIdx >= 0) globalPapers[globalIdx] = paperRecord
    else globalPapers.unshift(paperRecord)
    await redisSet(globalKey, globalPapers.slice(0, 50))

    res.status(200).json({
      ok: true,
      paperId: paperRecord.id,
      slotNumber: paperNumber,
      paper,
      sourceType,
      topicsCovered,
      totalSlots: updatedPapers.length
    })

  } catch (e) {
    console.error('generate-mock error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
