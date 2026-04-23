// api/mock-assemble.js
// Final step in the paper generation pipeline.
// Called by QStash after all sections are complete.
// Reads partial section results from Redis, assembles the full paper,
// calculates topic coverage, updates paper memory, saves final record.
//
// Vercel timeout: well under 10s (Redis reads + simple JS assembly, no Claude calls).

import { redisGet, redisSet, redisDel } from './lib/redis.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => { body += c.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function calculateTopicCoverage(sections, allTopics) {
  const coveredTopics = new Set()
  const paperText = JSON.stringify(sections).toLowerCase()

  for (const topic of allTopics) {
    const name = (typeof topic === 'string' ? topic : topic.name).toLowerCase()
    // Match on any meaningful word (4+ chars)
    const words = name.split(/\s+/).filter(w => w.length >= 4)
    if (words.length > 0 && words.some(w => paperText.includes(w))) {
      coveredTopics.add(name)
    }
  }

  const topicNames = allTopics.map(t => typeof t === 'string' ? t : t.name)
  return {
    covered: coveredTopics.size,
    total: topicNames.length,
    percentage: topicNames.length > 0
      ? Math.round((coveredTopics.size / topicNames.length) * 100)
      : 100,
    coveredTopics: [...coveredTopics],
    uncoveredTopics: topicNames.filter(n => !coveredTopics.has(n.toLowerCase()))
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Immediately ACK to QStash
  res.status(200).json({ ok: true, assembling: true })

  let body
  try { body = await parseBody(req) } catch { return }

  const { paperId, userId, subjectId, sectionsTotal, sections } = body
  if (!paperId || !userId || !subjectId) return

  try {
    // Read all section results
    const sectionKey = `sm:paper-section:${userId}:${paperId}`
    const sectionResults = await redisGet(sectionKey) || {}

    // Get scope for metadata
    const scope = await redisGet(`sm:scope:${userId}:${subjectId}`) || {}
    const allTopics = scope.topics || []

    // Order sections correctly
    const orderedSections = []
    for (let i = 0; i < sectionsTotal; i++) {
      if (sectionResults[i]) {
        orderedSections.push(sectionResults[i])
      } else {
        // Section is missing — add a placeholder
        const sectionSpec = sections?.[i] || {}
        orderedSections.push({
          sectionName: sectionSpec.name || `Section ${i + 1}`,
          sectionType: sectionSpec.type || 'Unknown',
          instructions: '',
          questions: [],
          error: 'This section did not complete — please regenerate.'
        })
      }
    }

    // Calculate coverage
    const coverage = calculateTopicCoverage(orderedSections, allTopics)

    // Total marks from sections
    const calculatedTotal = orderedSections.reduce((sum, s) => {
      const sectionMarks = (s.questions || []).reduce((sq, q) => {
        if (q.marks) return sq + q.marks
        if (q.totalMarks) return sq + q.totalMarks
        if (q.parts) return sq + q.parts.reduce((pq, p) => pq + (p.marks || 0), 0)
        return sq
      }, 0)
      return sum + sectionMarks
    }, 0)

    // Assemble final paper
    const paper = {
      title: `${scope.subjectName || 'Mock'} Examination`,
      subjectName: scope.subjectName || '',
      examBoard: scope.examBoard || '',
      duration: scope.duration || '',
      totalMarks: scope.totalMarks || calculatedTotal || 0,
      instructions: [
        scope.totalMarks ? `This paper is worth ${scope.totalMarks} marks.` : '',
        scope.duration ? `Time allowed: ${scope.duration}.` : '',
        'Write your answers clearly. Show all working where required.'
      ].filter(Boolean).join(' '),
      sections: orderedSections,
      coverage,
      generatedAt: new Date().toISOString(),
      scopeUsed: {
        examType: scope.examType,
        examBoard: scope.examBoard,
        duration: scope.duration,
        sectionCount: sectionsTotal,
        topicsTotal: allTopics.length
      }
    }

    // Update paper memory (topics covered in this paper — prevents repetition in future papers)
    const memoryKey = `sm:paper-memory:${userId}:${subjectId}`
    const existingMemory = await redisGet(memoryKey) || []
    const newEntries = coverage.coveredTopics || []
    const updatedMemory = [...existingMemory, ...newEntries].slice(-150)
    await redisSet(memoryKey, updatedMemory)

    // Save final paper record
    const papersKey = `sm:papers:${userId}`
    const papers = await redisGet(papersKey) || []
    const idx = papers.findIndex(p => p.id === paperId)
    if (idx !== -1) {
      papers[idx].status = 'complete'
      papers[idx].progress = 100
      papers[idx].statusMsg = 'Complete'
      papers[idx].paper = paper
      papers[idx].coverage = coverage
      papers[idx].completedAt = new Date().toISOString()
      await redisSet(papersKey, papers)
    }

    // Cleanup partial section data (no longer needed)
    try { await redisDel(sectionKey) } catch {}

    console.log(`Paper ${paperId} assembled: ${orderedSections.length} sections, ${coverage.percentage}% topic coverage`)

  } catch (e) {
    console.error('mock-assemble error:', e.message)
    // Mark paper as error
    try {
      const papersKey = `sm:papers:${userId}`
      const papers = await redisGet(papersKey) || []
      const idx = papers.findIndex(p => p.id === paperId)
      if (idx !== -1) {
        papers[idx].status = 'error'
        papers[idx].error = `Assembly failed: ${e.message}`
        await redisSet(papersKey, papers)
      }
    } catch {}
  }
}
