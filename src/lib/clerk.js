// Server-side Clerk auth helper for Vercel API functions
import { createClerkClient } from '@clerk/clerk-sdk-node'

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

export async function requireAuth(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: no token')
  }
  const token = authHeader.split(' ')[1]
  const { sub: userId } = await clerk.verifyToken(token)
  return userId
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}
