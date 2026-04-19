import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth, unauthorizedResponse } from './lib/clerk.js'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      try { resolve(JSON.parse(body)) }
      catch (e) { resolve({}) }
    })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) {
    console.error('Auth error:', e.message)
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const key = `sm:subjects:${userId}`
  const { url = '', method } = req
  const qIndex = url.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')

  try {
    if (method === 'GET') {
      const subjects = await redisGet(key) || []
      res.status(200).json({ subjects })
      return
    }

    if (method === 'POST') {
      const subject = await parseBody(req)
      if (!subject?.id) { res.status(400).json({ error: 'Subject id required' }); return }
      const subjects = await redisGet(key) || []
      const idx = subjects.findIndex(s => s.id === subject.id)
      if (idx >= 0) {
        subjects[idx] = { ...subjects[idx], ...subject, updatedAt: new Date().toISOString() }
      } else {
        subjects.push({ ...subject, createdAt: new Date().toISOString() })
      }
      await redisSet(key, subjects)
      res.status(200).json({ subject: idx >= 0 ? subjects[idx] : subjects[subjects.length - 1] })
      return
    }

    if (method === 'DELETE') {
      const id = params.get('id')
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const subjects = await redisGet(key) || []
      await redisSet(key, subjects.filter(s => s.id !== id))
      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })

  } catch (e) {
    console.error('subjects error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
