export async function requireAuth(req) {
  let authHeader
  if (typeof req.headers.get === 'function') {
    authHeader = req.headers.get('authorization')
  } else {
    authHeader = req.headers.authorization || req.headers.Authorization
  }
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized')
  const token = authHeader.split(' ')[1]
  const parts = token.split('.')
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  if (!decoded.sub) throw new Error('No sub in token')
  return decoded.sub
}
export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}
