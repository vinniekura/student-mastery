export default async function handler(req) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  const clerkKey = process.env.CLERK_SECRET_KEY

  const result = {
    hasRedisUrl: !!url,
    hasRedisToken: !!token,
    hasClerkKey: !!clerkKey,
    redisUrlPrefix: url ? url.slice(0, 30) + '...' : 'MISSING',
  }

  // Test Redis connection
  try {
    const res = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    result.redisStatus = res.status
    result.redisPing = data.result
  } catch (e) {
    result.redisError = e.message
  }

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
