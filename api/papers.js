import { redisGet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

export default async function handler(req, res) {
  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const papers = await redisGet(`sm:papers:${userId}`) || []
    // Return summary without full paper content for listing
    const summary = papers.map(({ paper, ...rest }) => ({
      ...rest,
      sectionCount: paper?.sections?.length || 0,
      totalQuestions: paper?.sections?.reduce((acc, s) => acc + (s.questions?.length || 0), 0) || 0,
      paper // include full paper for viewing
    }))
    res.status(200).json({ papers: summary })
  } catch (e) {
    console.error('papers error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
