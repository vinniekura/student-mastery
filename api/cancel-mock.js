import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const { url = '' } = req
  const qIndex = url.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
  const subjectId = params.get('subjectId')
  const paperId = params.get('paperId')

  if (!subjectId || !paperId) { res.status(400).json({ error: 'subjectId and paperId required' }); return }

  try {
    const key = `sm:papers:${userId}:${subjectId}`
    const papers = await redisGet(key) || []
    const updated = papers.filter(p => p.id !== paperId)
    await redisSet(key, updated)
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
