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

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch { return res.status(401).json({ error: 'Unauthorized' }) }

  const key = `sm:events:${userId}`
  const url  = req.url || ''
  const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')

  try {
    if (req.method === 'GET') {
      const events = await redisGet(key) || []
      return res.status(200).json({ events: events.sort((a,b)=>a.date.localeCompare(b.date)) })
    }

    if (req.method === 'POST') {
      const body   = await parseBody(req)
      const events = await redisGet(key) || []
      const idx    = events.findIndex(e => e.id === body.id)
      if (idx >= 0) events[idx] = body  // update
      else events.push(body)            // create
      await redisSet(key, events)
      return res.status(200).json({ ok: true, event: body })
    }

    if (req.method === 'DELETE') {
      const eventId = params.get('eventId')
      if (!eventId) return res.status(400).json({ error: 'eventId required' })
      const events = await redisGet(key) || []
      await redisSet(key, events.filter(e => e.id !== eventId))
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch(e) {
    console.error('events error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
