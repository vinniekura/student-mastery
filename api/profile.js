import { redisGet, redisSet } from '../src/lib/redis.js'
import { requireAuth } from '../src/lib/clerk.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const key = `sm:profile:${userId}`

  try {
    if (req.method === 'GET') {
      const profile = await redisGet(key) || {}
      res.status(200).json({ profile })
      return
    }

    if (req.method === 'POST') {
      const incoming = await parseBody(req)
      const existing = await redisGet(key) || {}
      const profile = { ...existing, ...incoming, updatedAt: new Date().toISOString() }
      await redisSet(key, profile)
      res.status(200).json({ profile })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('profile error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
