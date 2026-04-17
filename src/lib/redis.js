// Upstash Redis REST client — plain fetch, no SDK (same pattern as AUSOVRN Assist)
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function redis(command, ...args) {
  const res = await fetch(`${REDIS_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  if (!res.ok) throw new Error(`Redis error: ${res.status}`)
  const data = await res.json()
  return data.result
}

export async function redisGet(key) {
  const val = await redis('GET', key)
  if (!val) return null
  try { return JSON.parse(val) } catch { return val }
}

export async function redisSet(key, value, exSeconds = null) {
  const str = JSON.stringify(value)
  if (exSeconds) return redis('SET', key, str, 'EX', exSeconds)
  return redis('SET', key, str)
}

export async function redisDel(key) {
  return redis('DEL', key)
}

export async function redisKeys(pattern) {
  return redis('KEYS', pattern)
}
