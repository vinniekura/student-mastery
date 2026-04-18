import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth, unauthorizedResponse } from './lib/clerk.js'

export default async function handler(req) {
  let userId
  try { userId = await requireAuth(req) }
  catch { return unauthorizedResponse() }

  const key = `sm:profile:${userId}`

  if (req.method === 'GET') {
    const profile = await redisGet(key) || {}
    return Response.json({ profile })
  }

  if (req.method === 'POST') {
    const incoming = await req.json()
    const existing = await redisGet(key) || {}
    const profile = { ...existing, ...incoming, updatedAt: new Date().toISOString() }
    await redisSet(key, profile)
    return Response.json({ profile })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
