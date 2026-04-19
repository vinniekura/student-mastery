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
  // Try fixing trailing commas
  if (start !== -1 && end !== -1) {
    try {
      const fixed = text.slice(start, end + 1).replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
      return JSON.parse(fixed)
    } catch {}
  }
  throw new Error('Could not extract JSON from response')
}

const EXAM_PRESETS = {
  UCAT: {
    name: 'UCAT', fullName: 'University Clinical Aptitude Test',
    sections: [
      { name: 'Verbal Reasoning', type: 'mcq', marks: 44, instructions: '21 minutes. Read passages and answer.', questionCount: 3 },
      { name: 'Decision Making', type: 'mcq', marks: 29, instructions: '31 minutes. Logical reasoning.', questionCount: 2 },
      { name: 'Quantitative Reasoning', type: 'mcq', marks: 36, instructions: '25 minutes. Numerical interpretation.', questionCount: 3 },
      { name: 'Abstract Reasoning', type: 'mcq', marks: 50, instructions: '12 minutes. Pattern recognition.', questionCount: 2 },
      { name: 'Situational Judgement', type: 'mcq', marks: 69, instructions: '26 minutes. Rate appropriateness.', questionCount: 2 }
    ],
    totalMarks: 3600, timeLimitMins: 115,
    style: 'UCAT AU/NZ. Aptitude not knowledge. Clinical scenarios for SJT. Dense passages for VR.'
  },
  GAMSAT: {
    name: 'GAMSAT', fullName: 'Graduate Medical School Admissions Test',
    sections: [
      { name: 'Section I — Humanities & Social Sciences', type: 'mcq', marks: 75, instructions: 'Interpret texts and stimuli.', questionCount: 4 },
      { name: 'Section II — Written Communication', type: 'extended', marks: 2, instructions: 'Two essays: personal and argumentative.', questionCount: 2 },
      { name: 'Section III — Biological & Physical Sciences', type: 'mcq', marks: 110, instructions: 'Biology 40%, Chemistry 40%, Physics 20%.', questionCount: 4 }
    ],
    totalMarks: 100, timeLimitMins: 348,
    style: 'GAMSAT AU. Graduate-level. Deep science reasoning required.'
  },
  IELTS: {
    name: 'IELTS Academic', fullName: 'International English Language Testing System',
    sections: [
      { name: 'Reading', type: 'short', marks: 40, instructions: 'Three passages. MCQ and completion.', questionCount: 4 },
      { name: 'Writing Task 1', type: 'extended', marks: 9, instructions: 'Describe a graph in 150+ words.', questionCount: 1 },
      { name: 'Writing Task 2', type: 'extended', marks: 9, instructions: 'Argumentative essay 250+ words.', questionCount: 1 }
    ],
    totalMarks: 9, timeLimitMins: 120,
    style: 'IELTS Academic band 6.5-8.0. Formal register.'
  },
  SELECTIVE: {
    name: 'Selective School', fullName: 'NSW Selective School Entry Test',
    sections: [
      { name: 'Reading', type: 'mcq', marks: 30, instructions: 'Comprehension questions.', questionCount: 3 },
      { name: 'Mathematical Reasoning', type: 'mcq', marks: 35, instructions: 'Problem solving.', questionCount: 3 },
      { name: 'Thinking Skills', type: 'mcq', marks: 40, instructions: 'Abstract reasoning.', questionCount: 3 },
      { name: 'Writing', type: 'extended', marks: 30, instructions: 'Creative or persuasive prompt.', questionCount: 1 }
    ],
    totalMarks: 135, timeLimitMins: 175,
    style: 'NSW Selective Year 9 entry. Year 8 level. Australian contexts.'
  },
  AMC: {
    name: 'AMC MCQ', fullName: 'Australian Medical Council MCQ Examination',
    sections: [
      { name: 'Clinical Medicine', type: 'mcq', marks: 150, instructions: 'Single best answer clinical vignettes.', questionCount: 6 }
    ],
    totalMarks: 150, timeLimitMins: 210,
    style: 'AMC MCQ. Clinical vignette format. All specialties. Evidence-based.'
  },
  OC: {
    name: 'OC Test', fullName: 'Opportunity Class Placement Test',
    sections: [
      { name: 'Reading', type: 'mcq', marks: 30, instructions: 'Comprehension questions.', questionCount: 3 },
      { name: 'Mathematical Reasoning', type: 'mcq', marks: 35, instructions: 'Numeracy Year 4-5 level.', questionCount: 3 },
      { name: 'Thinking Skills', type: 'mcq', marks: 30, instructions: 'Logical reasoning.', questionCount: 3 }
    ],
    totalMarks: 95, timeLimitMins: 120,
    style: 'NSW OC. Year 4 level. Simple language. Australian contexts.'
  }
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

    const { name, state, examBoard, yearLevel, topics = [], paperFormat = {}, extractedFormat } = subject
    const preset = EXAM_PRESETS[examBoard?.toUpperCase()] || EXAM_PRESETS[name?.toUpperCase()]
    const isCompetitive = !!preset

    // Use extracted format from real past papers if available
    const useExtractedFormat = !!extractedFormat && !isCompetitive

    const { totalMarks = preset?.totalMarks || 100, timeLimitMins = preset?.timeLimitMins || 180 } = paperFormat

    // Check slots
    const paperKey = `sm:papers:${userId}:${subjectId}`
    const existingPapers = await redisGet(paperKey) || []
    // Clear any stuck generating placeholders first
    const cleanedPapers = existingPapers.filter(p => p.status !== 'generating')
    if (cleanedPapers.length !== existingPapers.length) {
      await redisSet(paperKey, cleanedPapers)
    }

    if (cleanedPapers.length >= 5 && !forceNew && replaceSlot === null) {
      res.status(200).json({
        slotsExhausted: true,
        papers: cleanedPapers.map(({ paper, questionsAsked, ...rest }) => rest)
      })
      return
    }

    // Paper memory
    const usedTopics = [...new Set(cleanedPapers.flatMap(p => p.topicsCovered || []))]
    const usedQuestions = cleanedPapers.flatMap(p => (p.questionsAsked || []).slice(0, 2))
    const allTopics = topics.map(t => t.name)
    const unusedTopics = allTopics.filter(t => !usedTopics.includes(t))
    const memorySection = usedTopics.length > 0
      ? `AVOID repeating: ${usedTopics.join(', ')}. Focus on: ${unusedTopics.length > 0 ? unusedTopics.join(', ') : 'fresh scenarios'}.`
      : ''

    // Get docs — prefer past-paper type
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    const pastPapers = allDocs.filter(d => d.docType === 'past-paper')
    const notesDocs = allDocs.filter(d => d.docType === 'notes' || !d.docType)
    const docsToUse = pastPapers.length > 0 ? pastPapers : notesDocs
    let docContext = ''
    let sourceType = 'syllabus'
    if (docsToUse.length > 0) {
      const allChunks = docsToUse.flatMap(d => d.chunks || [])
      let charCount = 0
      const selected = []
      for (const chunk of allChunks) {
        if (charCount + chunk.length > 500) break
        selected.push(chunk)
        charCount += chunk.length
      }
      if (charCount > 100) {
        docContext = selected.join('\n\n')
        sourceType = pastPapers.length > 0 ? 'past-paper' : 'docs'
      }
    }

    const paperNumber = replaceSlot !== null ? replaceSlot : cleanedPapers.length + 1

    // Build prompt
    let prompt
    if (isCompetitive) {
      const p = preset
      const sectionDetail = p.sections.map((s, i) =>
        `S${i + 1}: ${s.name} — ${s.questionCount} Qs. ${s.instructions}`
      ).join('\n')
      prompt = `Create Mock Paper ${paperNumber} for ${p.name}.
Style: ${p.style}
${memorySection ? `Memory: ${memorySection}` : ''}
${docContext ? `Material:\n${docContext}` : ''}
${customInstructions ? `Focus: ${customInstructions}` : ''}
Sections:\n${sectionDetail}
Return ONLY valid JSON with this structure:
{"title":"${p.name} Mock ${paperNumber}","examBoard":"${p.name}","subject":"${p.fullName}","yearLevel":"N/A","totalMarks":${p.totalMarks},"timeAllowed":"${p.timeLimitMins} minutes","instructions":"Work through each section.","sections":[{"name":"...","type":"mcq","marks":0,"instructions":"...","questions":[{"number":1,"question":"...","marks":1,"type":"mcq","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","markingCriteria":"...","topic":"..."}]}]}`
    } else {
      const topicsList = allTopics.length > 0 ? allTopics.join(', ') : `General ${name}`
      const sections = Array.isArray(paperFormat.sections)
        ? paperFormat.sections
        : ['Multiple choice', 'Short answer', 'Extended response']
      const marksPerSection = Math.floor(totalMarks / sections.length)
      const formatInstructions = useExtractedFormat ? `
EXACT EXAM FORMAT (extracted from real past paper — follow this precisely):
- Total marks: ${extractedFormat.totalMarks}
- Time: ${extractedFormat.timeAllowed}
- Formula sheet: ${extractedFormat.formulaSheet ? 'YES' : 'NO'}
- Allowed materials: ${extractedFormat.allowedMaterials || 'Standard'}
- Question style: ${extractedFormat.questionStyle || 'Match past paper'}
SECTIONS:
${(extractedFormat.sections || []).map((s, i) => `Section ${i+1}: ${s.name} — ${s.questionCount} questions, ${s.marks} marks. ${s.instructions}. ${s.hasDiagrams ? 'Include diagram descriptions.' : ''}`).join('\n')}
` : `Sections: ${sections.join(', ')} — ${marksPerSection} marks each. Total: ${totalMarks} marks, ${timeLimitMins} min.`

    prompt = `Create Mock Paper ${paperNumber} for ${examBoard} ${name}, Year ${yearLevel}, ${state}.
${memorySection ? `Memory: ${memorySection}` : ''}
${docContext ? `Reference material:\n${docContext}` : ''}
${customInstructions ? `Focus: ${customInstructions}` : ''}
Topics: ${topicsList}
${formatInstructions}
Generate EXACTLY 2 questions per section. Keep questions concise and exam-appropriate.
Return ONLY valid JSON:
{"title":"${name} Mock Paper ${paperNumber}","examBoard":"${examBoard}","subject":"${name}","yearLevel":"${yearLevel}","totalMarks":${totalMarks},"timeAllowed":"${timeLimitMins} minutes","instructions":"Answer ALL questions. Show all working.","sections":[{"name":"...","type":"mcq","marks":${marksPerSection},"instructions":"...","questions":[{"number":1,"question":"...","marks":2,"type":"mcq","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"B","markingCriteria":"...","topic":"..."}]}]}`
    }

    // Call Claude — synchronous, wait for result
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }
        ]
      })
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      console.error('Claude API error:', claudeRes.status, errText.slice(0, 300))
      throw new Error(`Claude API error: ${claudeRes.status} ${errText.slice(0, 100)}`)
    }

    const claudeData = await claudeRes.json()
    const raw = '{' + (claudeData.content?.[0]?.text || '{}')
    const paper = extractJson(raw)

    if (!paper.sections || !Array.isArray(paper.sections)) {
      throw new Error('Invalid paper structure — please try again')
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
      docCount: allDocs.length,
      topicsCovered,
      questionsAsked,
      isCompetitive,
      status: 'ready',
      paper
    }

    // Save to slot
    let updatedPapers = [...cleanedPapers]
    if (replaceSlot !== null) {
      const idx = updatedPapers.findIndex(p => p.slotNumber === replaceSlot)
      if (idx >= 0) updatedPapers[idx] = paperRecord
      else updatedPapers.push(paperRecord)
    } else if (forceNew && updatedPapers.length >= 5) {
      updatedPapers.sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt))
      updatedPapers[0] = { ...paperRecord, slotNumber: updatedPapers[0].slotNumber }
    } else {
      updatedPapers.push(paperRecord)
    }

    updatedPapers = updatedPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber)
    await redisSet(paperKey, updatedPapers)

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
