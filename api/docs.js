import { redisGet, redisSet } from '../src/server/redis.js'
import { requireAuth } from '../src/server/clerk.js'

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const { url = '', method } = req
  const qIndex = url.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
  const subjectId = params.get('subjectId')

  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  const key = `sm:docs:${userId}:${subjectId}`

  try {
    if (method === 'GET') {
      const docs = await redisGet(key) || []
      // Return docs without chunks (too large for listing)
      const summary = docs.map(({ chunks, ...rest }) => rest)
      res.status(200).json({ docs: summary })
      return
    }

    if (method === 'DELETE') {
      const docId = params.get('docId')
      if (!docId) { res.status(400).json({ error: 'docId required' }); return }
      const docs = await redisGet(key) || []
      await redisSet(key, docs.filter(d => d.id !== docId))
      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('docs error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
