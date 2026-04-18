async function redis(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Redis env vars missing')
  const base = url.replace(/\/$/, '')
  const parts = [command, ...args].map(a => encodeURIComponent(String(a)))
  const res = await fetch(`${base}/${parts.join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`Redis ${command} failed: ${res.status}`)
  const data = await res.json()
  return data.result
}
export async function redisGet(key) {
  const val = await redis('GET', key)
  if (val === null || val === undefined) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return val } }
  return val
}
export async function redisSet(key, value, ex = null) {
  const str = JSON.stringify(value)
  if (ex) return redis('SET', key, str, 'EX', String(ex))
  return redis('SET', key, str)
}
export async function redisDel(key) { return redis('DEL', key) }
export async function redisKeys(pattern) { return redis('KEYS', pattern) }
