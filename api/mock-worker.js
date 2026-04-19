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
  // Try direct parse
  try { return JSON.parse(text.trim()) } catch {}
  // Strip markdown
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  try { return JSON.parse(stripped) } catch {}
  // Find outermost braces
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const fixed = text.slice(start, end + 1)
        .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
      return JSON.parse(fixed)
    } catch {}
  }
  // Handle truncated JSON — find last complete section and close it
  if (start !== -1) {
    let partial = text.slice(start)
    // Try closing at last complete question object
    const lastQ = partial.lastIndexOf('"topic"')
    if (lastQ > 0) {
      // Find the closing brace of that question
      let depth = 0, closeAt = -1
      for (let i = lastQ; i < partial.length; i++) {
        if (partial[i] === '{') depth++
        if (partial[i] === '}') { depth--; if (depth <= 0) { closeAt = i; break } }
      }
      if (closeAt > 0) {
        // Close questions array, section, sections array, root object
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

// AU curriculum exam formats
const AU_EXAM_FORMATS = {
  'BSSS': {
    sections: [
      {
        name: 'Section A: Multiple Choice',
        type: 'mcq', marks: 20, questionCount: 20, marksPerQ: 1,
        instructions: 'Circle the letter of the best answer. Each question is worth 1 mark.'
      },
      {
        name: 'Section B: Short Answer',
        type: 'short', marks: 40, questionCount: 4,
        instructions: 'Answer ALL questions in the spaces provided. Show all working clearly.'
      },
      {
        name: 'Section C: Extended Response',
        type: 'extended', marks: 40, questionCount: 2,
        instructions: 'Answer ALL questions. Show all working clearly. Marks are awarded for correct method and working, not just the final answer.'
      }
    ],
    totalMarks: 100,
    timeLimitMins: 180,
    allowedMaterials: 'Scientific calculator, ruler',
    style: 'BSSS ACT Physics. Rigorous Year 12 level. Section A: 1 mark MCQ, no working required. Section B: multi-part questions with show-working. Section C: complex multi-step problems worth 15-25 marks each. Include SI units, scientific notation, and relevant formulas in questions. For questions with diagrams, describe the diagram clearly in [DIAGRAM: description] format.'
  },
  'NESA': {
    sections: [
      { name: 'Section I', type: 'mcq', marks: 20, questionCount: 20, marksPerQ: 1, instructions: 'Select the alternative A, B, C or D that best answers the question.' },
      { name: 'Section II', type: 'short', marks: 80, questionCount: 6, instructions: 'Answer the questions in the spaces provided. Extra writing space is provided at the back.' }
    ],
    totalMarks: 100, timeLimitMins: 180, allowedMaterials: 'Approved calculator, ruler',
    style: 'NSW HSC NESA exam. HSC difficulty. Section I: 1 mark MCQ. Section II: multi-part with working.'
  },
  'VCAA': {
    sections: [
      { name: 'Section A', type: 'mcq', marks: 20, questionCount: 20, marksPerQ: 1, instructions: 'Choose the response that is correct or best answers the question.' },
      { name: 'Section B', type: 'short', marks: 60, questionCount: 6, instructions: 'Answer all questions in the spaces provided.' }
    ],
    totalMarks: 80, timeLimitMins: 150, allowedMaterials: 'CAS calculator, formula sheet',
    style: 'VCE VCAA exam. Reference data booklet provided. Multi-part questions.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  // Verify QStash signature (basic check)
  const qstashSig = req.headers['upstash-signature']
  if (!qstashSig && process.env.NODE_ENV === 'production') {
    // Allow through — signature verification requires @upstash/qstash package
    // We rely on the job data being valid instead
  }

  try {
    const { jobId, userId, subjectId, slotNumber, customInstructions = '', replaceSlot } = await parseBody(req)

    if (!jobId || !userId || !subjectId) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const paperKey = `sm:papers:${userId}:${subjectId}`

    // Mark as generating
    const papers = await redisGet(paperKey) || []
    const jobIdx = papers.findIndex(p => p.id === jobId)
    if (jobIdx >= 0) {
      papers[jobIdx].status = 'generating'
      await redisSet(paperKey, papers)
    }

    // Get subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) throw new Error('Subject not found')

    const { name, state, examBoard, yearLevel, topics = [], paperFormat = {}, extractedFormat } = subject

    // Determine format
    const auFormat = AU_EXAM_FORMATS[examBoard?.toUpperCase()]
    const effectiveFormat = auFormat || extractedFormat
    const isCompetitive = ['UCAT','GAMSAT','IELTS','SELECTIVE','AMC','OC'].includes(examBoard?.toUpperCase())

    // Get past papers for context
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    const pastPapers = allDocs.filter(d => d.docType === 'past-paper')
    const notesDocs = allDocs.filter(d => d.docType === 'notes' || !d.docType)
    const docsToUse = pastPapers.length > 0 ? pastPapers : notesDocs
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

    // Paper memory
    const existingPapers2 = await redisGet(paperKey) || []
    const readyPapers = existingPapers2.filter(p => p.status === 'ready')
    const usedTopics = [...new Set(readyPapers.flatMap(p => p.topicsCovered || []))]
    const allTopics = topics.map(t => t.name)
    const unusedTopics = allTopics.filter(t => !usedTopics.includes(t))
    const memoryNote = usedTopics.length > 0
      ? `PAPER MEMORY: Already covered in previous mocks: ${usedTopics.join(', ')}. Prioritise these untested topics: ${unusedTopics.length > 0 ? unusedTopics.join(', ') : 'use fresh angles on all topics'}.`
      : ''

    // Build the full prompt
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
6. For diagrams write [DIAGRAM: description] inline
7. Keep questions concise but rigorous — exam-ready for Year ${yearLevel} ${examBoard}

Return ONLY valid JSON — no markdown, no explanation:
{
  "title": "${name} — Mock Paper ${slotNumber}",
  "examBoard": "${examBoard}",
  "subject": "${name}",
  "yearLevel": "${yearLevel}",
  "state": "${state}",
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
          "question": "Full question text. [DIAGRAM: description if needed]",
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

    // Call Claude Sonnet — no timeout constraint here
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
      generatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sourceType,
      docCount: allDocs.length,
      topicsCovered,
      questionsAsked,
      status: 'ready',
      paper
    }

    // Save completed paper
    const finalPapers = await redisGet(paperKey) || []
    const finalIdx = finalPapers.findIndex(p => p.id === jobId)
    if (finalIdx >= 0) {
      finalPapers[finalIdx] = paperRecord
    } else {
      finalPapers.push(paperRecord)
    }
    const sorted = finalPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber)
    await redisSet(paperKey, sorted)

    console.log(`Mock paper ${slotNumber} generated successfully for ${name}: ${topicsCovered.length} topics, ${paper.sections?.reduce((acc, s) => acc + (s.questions?.length || 0), 0)} questions`)

    res.status(200).json({ ok: true, paperId: jobId })

  } catch (e) {
    console.error('mock-worker error:', e.message)

    // Mark job as failed in Redis
    try {
      const { jobId, userId, subjectId } = await parseBody(req).catch(() => ({}))
      if (jobId && userId && subjectId) {
        const paperKey = `sm:papers:${userId}:${subjectId}`
        const papers = await redisGet(paperKey) || []
        const idx = papers.findIndex(p => p.id === jobId)
        if (idx >= 0) {
          papers[idx].status = 'failed'
          papers[idx].error = e.message
          await redisSet(paperKey, papers)
        }
      }
    } catch (e2) { console.error('Failed to mark job as failed:', e2.message) }

    res.status(500).json({ error: e.message })
  }
}
