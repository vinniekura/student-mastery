import { redisGet, redisSet, redisKeys } from '../src/lib/redis.js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'digest@datamastery.com.au'
const ADMIN_TOKEN = process.env.SM_ADMIN_TOKEN

export default async function handler(req) {
  // Allow Vercel cron (no auth header) or admin token
  const authHeader = req.headers.authorization || ''
  const isCron = req.headers['x-vercel-cron'] === '1'
  const isAdmin = authHeader === `Bearer ${ADMIN_TOKEN}`

  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // Find all profile keys to get all users
  const profileKeys = await redisKeys('sm:profile:*')
  if (!profileKeys?.length) {
    return Response.json({ sent: 0, message: 'No users found' })
  }

  let sent = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const profileKey of profileKeys) {
    try {
      const userId = profileKey.replace('sm:profile:', '')
      const profile = await redisGet(profileKey)

      // Skip if digest disabled
      if (profile?.digestEnabled === false) continue

      // Skip if already sent today
      const lastSentKey = `sm:digest:${userId}:last`
      const lastSent = await redisGet(lastSentKey)
      if (lastSent) {
        const lastDate = new Date(lastSent)
        lastDate.setHours(0, 0, 0, 0)
        if (lastDate.getTime() === today.getTime()) continue
      }

      // Get subjects for this user
      const subjects = await redisGet(`sm:subjects:${userId}`) || []
      if (!subjects.length) continue

      // Build upcoming events (next 14 days)
      const in14 = new Date(today)
      in14.setDate(in14.getDate() + 14)

      const upcoming = subjects.flatMap(s => [
        ...(s.examDates || []).map(e => ({ ...e, subjectName: s.name, type: 'exam' })),
        ...(s.assignmentDueDates || []).map(a => ({ ...a, subjectName: s.name, type: 'assignment' }))
      ])
        .filter(e => {
          const d = new Date(e.date)
          return d >= today && d <= in14
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date))

      if (!upcoming.length) continue

      // Build email HTML
      const toEmail = profile?.email || profile?.parentEmail
      if (!toEmail) continue

      const html = buildDigestEmail(profile, upcoming, today)

      // Send via Resend
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: toEmail,
          subject: `Your study schedule — ${today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}`,
          html
        })
      })

      if (res.ok) {
        await redisSet(lastSentKey, new Date().toISOString())
        sent++
        // Send copy to parent if set
        if (profile?.parentEmail && profile.parentEmail !== toEmail) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({ from: FROM_EMAIL, to: profile.parentEmail, subject: `Study schedule for ${profile.name || 'your student'} — ${today.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}`, html })
          })
        }
      }
    } catch (err) {
      console.error(`Digest error for key ${profileKey}:`, err.message)
    }
  }

  return Response.json({ sent, total: profileKeys.length })
}

function buildDigestEmail(profile, events, today) {
  const name = profile?.name || profile?.firstName || 'there'

  const rows = events.map(e => {
    const d = new Date(e.date)
    const days = Math.ceil((d - today) / (1000 * 60 * 60 * 24))
    const urgency = days <= 3 ? '#dc2626' : days <= 7 ? '#d97706' : '#6b7280'
    const typeLabel = e.type === 'exam' ? '📝 EXAM' : '📋 DUE'
    const dateStr = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    const countdown = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151">${typeLabel}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111827">${e.title}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">${e.subjectName}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">${dateStr}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;color:${urgency}">${countdown}</td>
      </tr>`
  }).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
    <!-- Header -->
    <div style="background:#0f172a;padding:24px 28px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:rgba(13,148,136,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px">🎓</div>
        <div>
          <div style="color:#f8fafc;font-size:16px;font-weight:700">Student Mastery</div>
          <div style="color:#94a3b8;font-size:12px">Daily study schedule</div>
        </div>
      </div>
    </div>
    <!-- Body -->
    <div style="padding:24px 28px">
      <p style="font-size:15px;color:#374151;margin:0 0 20px">Hi ${name}, here's your study schedule for the next 14 days.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Type</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Task</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Subject</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Date</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Countdown</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <!-- Footer -->
    <div style="padding:16px 28px;border-top:1px solid #e5e7eb;background:#f8fafc">
      <p style="font-size:11px;color:#9ca3af;margin:0">
        Student Mastery by <a href="https://datamastery.com.au" style="color:#0d9488;text-decoration:none">Data Mastery</a> · 
        <a href="https://studentmastery.datamastery.com.au/settings" style="color:#0d9488;text-decoration:none">Manage preferences</a>
      </p>
    </div>
  </div>
</body>
</html>`
}
