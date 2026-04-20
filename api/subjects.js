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
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const key = `sm:subjects:${userId}`
  const { method } = req

  try {
    if (method === 'GET') {
      const subjects = await redisGet(key) || []
      res.status(200).json({ subjects })
      return
    }

    if (method === 'POST') {
      const body = await parseBody(req)
      const subjects = await redisGet(key) || []

      // PATCH — update existing subject (difficulty, topics, etc.)
      if (body.id) {
        const idx = subjects.findIndex(s => s.id === body.id)
        if (idx >= 0) {
          subjects[idx] = { ...subjects[idx], ...body, updatedAt: new Date().toISOString() }
          await redisSet(key, subjects)
          res.status(200).json({ subject: subjects[idx] })
        } else {
          res.status(404).json({ error: 'Subject not found' })
        }
        return
      }

      // CREATE — new subject
      const subject = {
        id: genId(),
        name: body.name || 'Unnamed Subject',
        state: body.state || 'ACT',
        examBoard: body.examBoard || 'BSSS',
        yearLevel: body.yearLevel || '12',
        topics: body.topics || [],
        difficultyLevel: 'match',   // default difficulty — persisted per subject
        createdAt: new Date().toISOString()
      }
      subjects.push(subject)
      await redisSet(key, subjects)
      res.status(200).json({ subject })
      return
    }

    if (method === 'DELETE') {
      const url = req.url || ''
      const qIdx = url.indexOf('?')
      const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
      const subjectId = params.get('subjectId') || params.get('id')
      if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }
      const subjects = await redisGet(key) || []
      await redisSet(key, subjects.filter(s => s.id !== subjectId))
      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('subjects error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
