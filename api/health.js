export default async function handler(req, res) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  const clerkKey = process.env.CLERK_SECRET_KEY

  const result = {
    hasRedisUrl: !!url,
    hasRedisToken: !!token,
    hasClerkKey: !!clerkKey,
    redisUrlPrefix: url ? url.slice(0, 30) + '...' : 'MISSING',
  }

  try {
    const r = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await r.json()
    result.redisStatus = r.status
    result.redisPing = data.result
  } catch (e) {
    result.redisError = e.message
  }

  res.status(200).json(result)
}
