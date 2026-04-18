import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth, unauthorizedResponse } from './lib/clerk.js'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

export default async function handler(req) {
  let userId
  try {
    userId = await requireAuth(req)
  } catch (e) {
    console.error('Auth error:', e.message)
    return unauthorizedResponse()
  }

  const key = `sm:subjects:${userId}`
  const rawUrl = req.url || ''
  const qIndex = rawUrl.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '')

  try {
    if (req.method === 'GET') {
      const subjects = await redisGet(key) || []
      return json({ subjects })
    }

    if (req.method === 'POST') {
      const subject = await req.json()
      if (!subject?.id) return json({ error: 'Subject id required' }, 400)
      const subjects = await redisGet(key) || []
      const idx = subjects.findIndex(s => s.id === subject.id)
      if (idx >= 0) {
        subjects[idx] = { ...subjects[idx], ...subject, updatedAt: new Date().toISOString() }
      } else {
        subjects.push({ ...subject, createdAt: new Date().toISOString() })
      }
      await redisSet(key, subjects)
      return json({ subject: idx >= 0 ? subjects[idx] : subjects[subjects.length - 1] })
    }

    if (req.method === 'DELETE') {
      const id = params.get('id')
      if (!id) return json({ error: 'id required' }, 400)
      const subjects = await redisGet(key) || []
      await redisSet(key, subjects.filter(s => s.id !== id))
      return json({ ok: true })
    }

    return json({ error: 'Method not allowed' }, 405)

  } catch (e) {
    console.error('subjects error:', e.message, e.stack)
    return json({ error: e.message }, 500)
  }
}