import { redisGet, redisSet } from '../src/lib/redis.js'
import { requireAuth } from '../src/lib/clerk.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => { body += c.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId
  try { userId = await requireAuth(req) }
  catch { return res.status(401).json({ error: 'Unauthorized' }) }

  try {
    const body = await parseBody(req)
    const { subjectId, customInstructions='', replaceSlot=null, confirmedScope=null, difficultyMode='match' } = body

    if (!subjectId) return res.status(400).json({ error: 'subjectId required' })

    // Validate subject exists
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject  = subjects.find(s => s.id === subjectId)
    if (!subject) return res.status(404).json({ error: 'Subject not found' })

    // Accept scope from request body, or load from Redis
    const scope = confirmedScope || await redisGet(`sm:scope:${userId}:${subjectId}`)
    if (!scope) {
      return res.status(400).json({ error: 'Please analyse your documents and confirm the exam format before generating.' })
    }
    // Mark as confirmed so mock-worker treats it as valid
    if (!scope.confirmed) scope.confirmed = true

    // Require at least one doc
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    if (docs.length === 0) {
      return res.status(400).json({ error: 'No documents uploaded. Upload past papers first.' })
    }

    // Find next available slot
    const paperKey = `sm:papers:${userId}:${subjectId}`
    const papers   = await redisGet(paperKey) || []

    // Auto-cleanup stuck queued papers older than 10 minutes
    const tenMinAgo = Date.now() - 10 * 60 * 1000
    const cleaned = papers.map(p => {
      if ((p.status === 'queued' || p.status === 'generating') && new Date(p.generatedAt).getTime() < tenMinAgo) {
        return { ...p, status: 'failed', error: 'Timed out — please retry' }
      }
      return p
    })

    let slotNumber = replaceSlot
    if (!slotNumber) {
      const usedSlots = cleaned.filter(p => p.status !== 'failed').map(p => p.slotNumber)
      for (let s = 1; s <= 5; s++) {
        if (!usedSlots.includes(s)) { slotNumber = s; break }
      }
    }

    if (!slotNumber) {
      return res.status(200).json({ slotsExhausted: true, error: 'All 5 slots are in use. Redo a paper to free a slot.' })
    }

    // Create paper record
    const jobId = genId()
    const record = {
      id: jobId, slotNumber, subjectId, subjectName: subject.name,
      status: 'queued', progress: 0, generatedAt: new Date().toISOString()
    }

    // Remove old paper in this slot if replacing
    const updated = cleaned.filter(p => p.slotNumber !== slotNumber)
    updated.push(record)
    await redisSet(paperKey, updated.sort((a,b) => a.slotNumber - b.slotNumber))

    // Dispatch to mock-worker via QStash
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'studentmastery.datamastery.com.au'
    const workerUrl = `https://${host}/api/mock-worker`

    const payload = {
      jobId, userId, subjectId, slotNumber,
      customInstructions, confirmedScope: scope, difficultyMode
    }

    if (process.env.QSTASH_TOKEN) {
      const qRes = await fetch(`https://qstash.upstash.io/v2/publish/${workerUrl}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
          'Content-Type': 'application/json',
          'Upstash-Retries': '0'
        },
        body: JSON.stringify(payload)
      })
      if (!qRes.ok) {
        const errText = await qRes.text()
        console.error('QStash error:', qRes.status, errText.slice(0,100))
        // Mark as failed if QStash failed
        const pp = await redisGet(paperKey) || []
        const ii = pp.findIndex(p => p.id === jobId)
        if (ii >= 0) { pp[ii].status = 'failed'; pp[ii].error = 'Queue error — please retry'; await redisSet(paperKey, pp) }
        return res.status(500).json({ error: 'Failed to queue paper generation. Please try again.' })
      }
      console.log(`Queued paper ${slotNumber} job ${jobId} via QStash → ${workerUrl}`)
    } else {
      console.warn('No QSTASH_TOKEN — mock-worker will not be called')
    }

    return res.status(200).json({ ok: true, jobId, slotNumber })

  } catch(e) {
    console.error('generate-mock error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
