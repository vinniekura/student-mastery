// Server-side Clerk auth — works with both Node.js (Vercel) and Web API request formats

export async function requireAuth(req) {
  // Handle both Node IncomingMessage (req.headers.authorization)
  // and Web API Request (req.headers.get('authorization'))
  let authHeader
  if (typeof req.headers.get === 'function') {
    authHeader = req.headers.get('authorization')
  } else {
    authHeader = req.headers.authorization || req.headers.Authorization
  }

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: no token')
  }

  const token = authHeader.split(' ')[1]
  return decodeJwtUserId(token)
}

function decodeJwtUserId(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid JWT structure')
    // base64url decode the payload
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    if (!decoded.sub) throw new Error('No sub in token')
    return decoded.sub
  } catch (e) {
    throw new Error(`Invalid token: ${e.message}`)
  }
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}
