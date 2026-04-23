// api/generate-mock.js
// Validates subject + confirmed scope, creates paper record, dispatches to mock-worker
// Fixed: proper error handling, scope validation, paper record creation before worker call

import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => { body += c.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId
  try { userId = await requireAuth(req) } catch { return res.status(401).json({ error: 'Unauthorized' }) }

  try {
    const { subjectId } = await parseBody(req)
    if (!subjectId) return res.status(400).json({ error: 'subjectId required' })

    // Get subject
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    if (!subject) return res.status(404).json({ error: 'Subject not found' })

    // Get confirmed scope (required)
    const scope = await redisGet(`sm:scope:${userId}:${subjectId}`)
    if (!scope || !scope.confirmed) {
      return res.status(400).json({ error: 'Please analyse your documents and confirm the exam format before generating.' })
    }

    // Get docs
    const docs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
    if (docs.length === 0) {
      return res.status(400).json({ error: 'No documents uploaded. Please upload past papers or notes first.' })
    }

    // Create paper record
    const paperId = genId()
    const paperRecord = {
      id: paperId,
      subjectId,
      subjectName: scope.subjectName || subject.name,
      status: 'generating',
      progress: 0,
      statusMsg: 'Queued…',
      createdAt: new Date().toISOString()
    }

    const papersKey = `sm:papers:${userId}`
    const existingPapers = await redisGet(papersKey) || []
    existingPapers.unshift(paperRecord)
    await redisSet(papersKey, existingPapers.slice(0, 20))

    // Try QStash first, fallback to direct call
    const workerUrl = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/mock-worker`

    if (process.env.QSTASH_TOKEN) {
      // Async via QStash
      const qstashRes = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(workerUrl)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paperId, userId, subjectId })
      })
      if (!qstashRes.ok) {
        console.warn('QStash failed, falling back to direct call')
        // Fall through to direct call below
      } else {
        return res.status(200).json({ ok: true, paperId, async: true })
      }
    }

    // Direct call (sync for small papers, or when QStash unavailable)
    // Fire and forget — respond immediately then process
    res.status(200).json({ ok: true, paperId, async: false })

    // Process after response (Vercel edge gives us some time)
    try {
      const { default: mockWorker } = await import('./mock-worker.js')
      // Create a fake req/res for the worker
      const fakeReq = {
        method: 'POST',
        headers: {},
        on: (event, cb) => {
          if (event === 'data') cb(JSON.stringify({ paperId, userId, subjectId }))
          if (event === 'end') cb()
        }
      }
      const fakeRes = {
        status: () => fakeRes,
        json: () => {}
      }
      await mockWorker(fakeReq, fakeRes)
    } catch (workerErr) {
      console.error('Worker error:', workerErr.message)
      // Update paper status to error
      const papers = await redisGet(papersKey) || []
      const idx = papers.findIndex(p => p.id === paperId)
      if (idx !== -1) {
        papers[idx].status = 'error'
        papers[idx].error = workerErr.message
        await redisSet(papersKey, papers)
      }
    }

  } catch (e) {
    console.error('generate-mock error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
