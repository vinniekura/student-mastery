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

  try {
    if (method === 'GET') {
      if (subjectId) {
        // Get papers for specific subject (5-slot view)
        const papers = await redisGet(`sm:papers:${userId}:${subjectId}`) || []
        const summary = papers.map(({ paper, questionsAsked, ...rest }) => ({
          ...rest,
          sectionCount: paper?.sections?.length || 0,
          totalQuestions: paper?.sections?.reduce((acc, s) => acc + (s.questions?.length || 0), 0) || 0,
          paper
        }))
        res.status(200).json({ papers: summary })
      } else {
        // Get all papers across all subjects
        const global = await redisGet(`sm:papers:${userId}`) || []
        res.status(200).json({ papers: global.map(({ paper, questionsAsked, ...rest }) => ({ ...rest, paper })) })
      }
      return
    }

    if (method === 'DELETE') {
      const paperId = params.get('paperId')
      if (!subjectId || !paperId) { res.status(400).json({ error: 'subjectId and paperId required' }); return }

      const papers = await redisGet(`sm:papers:${userId}:${subjectId}`) || []
      const updated = papers.filter(p => p.id !== paperId)
      await redisSet(`sm:papers:${userId}:${subjectId}`, updated)

      // Also remove from global index
      const global = await redisGet(`sm:papers:${userId}`) || []
      await redisSet(`sm:papers:${userId}`, global.filter(p => p.id !== paperId))

      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('papers error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
