import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth, unauthorizedResponse } from './lib/clerk.js'

export default async function handler(req) {
  // Auth
  let userId
  try {
    userId = await requireAuth(req)
  } catch (e) {
    console.error('Auth error:', e.message)
    return unauthorizedResponse()
  }

  const key = `sm:subjects:${userId}`

  // Parse query params safely without new URL()
  const rawUrl = req.url || ''
  const qIndex = rawUrl.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '')

  try {
    if (req.method === 'GET') {
      const subjects = await redisGet(key) || []
      return Response.json({ subjects })
    }

    if (req.method === 'POST') {
      const subject = await req.json()
      if (!subject?.id) {
        return Response.json({ error: 'Subject id required' }, { status: 400 })
      }
      const subjects = await redisGet(key) || []
      const idx = subjects.findIndex(s => s.id === subject.id)
      if (idx >= 0) {
        subjects[idx] = { ...subjects[idx], ...subject, updatedAt: new Date().toISOString() }
      } else {
        subjects.push({ ...subject, createdAt: new Date().toISOString() })
      }
      await redisSet(key, subjects)
      return Response.json({ subject: idx >= 0 ? subjects[idx] : subjects[subjects.length - 1] })
    }

    if (req.method === 'DELETE') {
      const id = params.get('id')
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const subjects = await redisGet(key) || []
      await redisSet(key, subjects.filter(s => s.id !== id))
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })

  } catch (e) {
    console.error('subjects handler error:', e.message, e.stack)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
