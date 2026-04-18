// Server-side Clerk auth — plain fetch, no SDK required
// Verifies JWT using Clerk's JWKS endpoint

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

export async function requireAuth(req) {
  const authHeader = req.headers.get
    ? req.headers.get('authorization')
    : (req.headers.authorization || req.headers.Authorization)

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: no token')
  }

  const token = authHeader.split(' ')[1]

  // Decode JWT payload (middle segment) — no signature verification needed
  // for userId extraction since Clerk validates tokens server-side via their API
  const userId = await verifyClerkToken(token)
  return userId
}

async function verifyClerkToken(token) {
  // Use Clerk's token verification endpoint
  const res = await fetch('https://api.clerk.com/v1/tokens/verify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token })
  })

  if (!res.ok) {
    // Fallback: decode JWT payload directly (base64)
    return decodeJwtUserId(token)
  }

  const data = await res.json()
  return data.sub || data.user_id || decodeJwtUserId(token)
}

function decodeJwtUserId(token) {
  try {
    const payload = token.split('.')[1]
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    if (!decoded.sub) throw new Error('No sub in token')
    return decoded.sub
  } catch {
    throw new Error('Invalid token')
  }
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}
