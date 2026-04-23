// api/scope.js
// GET: retrieve confirmed scope for a subject
// POST: save/update confirmed scope

import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

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
  try { userId = await requireAuth(req) } catch { return res.status(401).json({ error: 'Unauthorized' }) }

  const { subjectId } = req.method === 'GET'
    ? req.query || {}
    : await parseBody(req)

  if (!subjectId) return res.status(400).json({ error: 'subjectId required' })

  if (req.method === 'GET') {
    const scope = await redisGet(`sm:scope:${userId}:${subjectId}`)
    return res.status(200).json({ scope: scope || null })
  }

  if (req.method === 'POST') {
    const body = await parseBody(req)
    const { scope } = body
    if (!scope) return res.status(400).json({ error: 'scope required' })
    await redisSet(`sm:scope:${userId}:${subjectId}`, scope)
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
