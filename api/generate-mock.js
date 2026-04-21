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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    // ← confirmedScope added here — was missing, causing "not defined" error
    const {
      subjectId,
      customInstructions = '',
      forceNew = false,
      replaceSlot = null,
      confirmedScope = null,
      difficultyMode = 'match'
    } = await parseBody(req)

    if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) { res.status(404).json({ error: 'Subject not found' }); return }

    // Check slots
    const paperKey = `sm:papers:${userId}:${subjectId}`
    const existingPapers = await redisGet(paperKey) || []
    const cleanedPapers = existingPapers.filter(p => {
      if (p.status === 'generating' || p.status === 'queued') {
        return (Date.now() - new Date(p.generatedAt).getTime()) < 600000 // 10 min timeout
      }
      return p.status === 'ready'
    })

    if (cleanedPapers.length >= 5 && !forceNew && replaceSlot === null) {
      res.status(200).json({
        slotsExhausted: true,
        papers: cleanedPapers.map(({ paper, questionsAsked, ...rest }) => rest)
      })
      return
    }

    const slotNumber = replaceSlot !== null ? replaceSlot : cleanedPapers.length + 1
    const jobId = genId()

    // Save placeholder immediately
    const placeholder = {
      id: jobId,
      slotNumber,
      subjectId,
      subjectName: subject.name,
      generatedAt: new Date().toISOString(),
      status: 'queued',
      topicsCovered: [],
      paper: null
    }

    let updatedPapers = [...cleanedPapers]
    if (replaceSlot !== null) {
      const idx = updatedPapers.findIndex(p => p.slotNumber === replaceSlot)
      if (idx >= 0) updatedPapers[idx] = placeholder
      else updatedPapers.push(placeholder)
    } else {
      updatedPapers.push(placeholder)
    }
    updatedPapers = updatedPapers.slice(0, 5).sort((a, b) => a.slotNumber - b.slotNumber)
    await redisSet(paperKey, updatedPapers)

    // Publish job to QStash — confirmedScope forwarded through
    const workerUrl = `https://${req.headers.host}/api/mock-worker`
    const qstashRes = await fetch('https://qstash.upstash.io/v2/publish/' + workerUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Retries': '0',
        'Upstash-Delay': '0s'
      },
      body: JSON.stringify({
        jobId,
        userId,
        subjectId,
        slotNumber,
        customInstructions,
        replaceSlot,
        confirmedScope,
        difficultyMode
      })
    })

    if (!qstashRes.ok) {
      const err = await qstashRes.text()
      console.error('QStash publish failed:', qstashRes.status, err)
      const papers2 = await redisGet(paperKey) || []
      const idx2 = papers2.findIndex(p => p.id === jobId)
      if (idx2 >= 0) { papers2[idx2].status = 'failed'; await redisSet(paperKey, papers2) }
      res.status(500).json({ error: 'Failed to queue generation' })
      return
    }

    res.status(200).json({ ok: true, jobId, slotNumber, status: 'queued' })

  } catch (e) {
    console.error('generate-mock error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
