import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  const { url = '', method } = req
  const qIndex = url.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
  const subjectId = params.get('subjectId')
  const paperId = params.get('paperId')

  try {
    if (method === 'GET') {
      if (subjectId) {
        const papers = await redisGet(`sm:papers:${userId}:${subjectId}`) || []
        // Clean up any stuck generating placeholders older than 5 minutes
        const now = Date.now()
        const cleaned = papers.filter(p => {
          if (p.status === 'generating') {
            return (now - new Date(p.generatedAt).getTime()) < 300000
          }
          return true
        })
        if (cleaned.length !== papers.length) {
          await redisSet(`sm:papers:${userId}:${subjectId}`, cleaned)
        }
        const summary = cleaned.map(({ paper, questionsAsked, ...rest }) => ({ ...rest, paper }))
        res.status(200).json({ papers: summary })
      } else {
        const global = await redisGet(`sm:papers:${userId}`) || []
        res.status(200).json({ papers: global.map(({ paper, questionsAsked, ...rest }) => ({ ...rest, paper })) })
      }
      return
    }

    if (method === 'DELETE') {
      if (!subjectId || !paperId) { res.status(400).json({ error: 'subjectId and paperId required' }); return }
      const papers = await redisGet(`sm:papers:${userId}:${subjectId}`) || []
      await redisSet(`sm:papers:${userId}:${subjectId}`, papers.filter(p => p.id !== paperId))
      const global = await redisGet(`sm:papers:${userId}`) || []
      await redisSet(`sm:papers:${userId}`, global.filter(p => p.id !== paperId))
      res.status(200).json({ ok: true })
      return
    }

    // POST /api/papers?action=cancel — cancel a generating paper
    if (method === 'POST') {
      const action = params.get('action')
      if (action === 'cancel') {
        if (!subjectId || !paperId) { res.status(400).json({ error: 'subjectId and paperId required' }); return }
        const papers = await redisGet(`sm:papers:${userId}:${subjectId}`) || []
        await redisSet(`sm:papers:${userId}:${subjectId}`, papers.filter(p => p.id !== paperId))
        res.status(200).json({ ok: true })
        return
      }
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('papers error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
