// api/ingest-doc.js
// Ingests PDF, DOCX, TXT, image files into Redis for a subject
// NO unit selection required — auto-detects document role and metadata
// Fixes: multi-part form handling, large files, encoding issues

import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

function sanitizeText(text) {
  if (!text) return ''
  return text
    .replace(/[\uD800-\uDFFF]/g, '')   // remove lone surrogates
    .replace(/\u0000/g, '')             // remove null bytes
    .replace(/[^\x09\x0A\x0D\x20-\x7E\x80-\xFF\u0100-\uFFFC]/g, ' ')
    .replace(/\s{4,}/g, '\n\n')
    .trim()
}

function chunkText(text, chunkSize = 800, overlap = 100) {
  const clean = sanitizeText(text)
  if (clean.length === 0) return []
  const chunks = []
  let start = 0
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length)
    const chunk = clean.slice(start, end).trim()
    if (chunk.length > 50) chunks.push(chunk)
    start = end - overlap
    if (start >= clean.length) break
  }
  return chunks
}

// ── Multipart parser ──────────────────────────────────────────────────────────

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary)
  const parts = []
  let pos = 0

  while (pos < buffer.length) {
    const start = indexOf(buffer, boundaryBuf, pos)
    if (start === -1) break
    pos = start + boundaryBuf.length

    if (buffer[pos] === 0x2D && buffer[pos + 1] === 0x2D) break // --boundary--

    if (buffer[pos] === 0x0D) pos += 2  // \r\n

    // Read headers
    const headerEnd = indexOf(buffer, Buffer.from('\r\n\r\n'), pos)
    if (headerEnd === -1) break
    const headerStr = buffer.slice(pos, headerEnd).toString('utf8')
    pos = headerEnd + 4

    // Find next boundary
    const nextBoundary = indexOf(buffer, boundaryBuf, pos)
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2

    const headers = {}
    for (const line of headerStr.split('\r\n')) {
      const colon = line.indexOf(':')
      if (colon !== -1) {
        headers[line.slice(0, colon).toLowerCase().trim()] = line.slice(colon + 1).trim()
      }
    }

    parts.push({ headers, data: buffer.slice(pos, dataEnd) })
    pos = nextBoundary === -1 ? buffer.length : nextBoundary
  }
  return parts
}

function indexOf(buf, search, start = 0) {
  for (let i = start; i <= buf.length - search.length; i++) {
    let found = true
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break }
    }
    if (found) return i
  }
  return -1
}

function parseContentDisposition(header) {
  if (!header) return {}
  const result = {}
  const nameMatch = header.match(/name="([^"]*)"/)
  const filenameMatch = header.match(/filename="([^"]*)"/)
  if (nameMatch) result.name = nameMatch[1]
  if (filenameMatch) result.filename = filenameMatch[1]
  return result
}

// ── Text extractors ───────────────────────────────────────────────────────────

function extractFromPdf(buffer) {
  try {
    const str = buffer.toString('latin1')
    const textParts = []

    // Extract text from stream objects
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
    let match
    while ((match = streamRegex.exec(str)) !== null) {
      const streamContent = match[1]
      // Extract text operators
      const tjRegex = /\(([^)]*)\)\s*Tj/g
      const tjMatch2 = /\[((?:[^[\]]*|\[[^\]]*\])*)\]\s*TJ/g
      let m
      while ((m = tjRegex.exec(streamContent)) !== null) {
        textParts.push(m[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\'))
      }
      while ((m = tjMatch2.exec(streamContent)) !== null) {
        const inner = m[1].replace(/\([^)]*\)/g, s => s.slice(1,-1))
        textParts.push(inner)
      }
    }

    // Also try plain text extraction
    const plainRegex = /BT\s*([\s\S]*?)\s*ET/g
    while ((match = plainRegex.exec(str)) !== null) {
      const bt = match[1]
      const subMatch = bt.match(/\(([^)]{2,})\)/g)
      if (subMatch) {
        textParts.push(...subMatch.map(s => s.slice(1,-1)))
      }
    }

    const combined = textParts.join(' ').replace(/\s+/g, ' ').trim()
    return combined.length > 100 ? combined : null
  } catch {
    return null
  }
}

function extractFromDocx(buffer) {
  try {
    // DOCX is a ZIP — find word/document.xml
    const str = buffer.toString('binary')
    // Simple zip entry finder
    const xmlStart = str.indexOf('<?xml')
    const wordDocIdx = str.indexOf('word/document.xml')

    // Find XML content sections
    const textMatches = []
    const wTRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
    const bufStr = buffer.toString('utf8', 0, Math.min(buffer.length, 5 * 1024 * 1024))
    let m
    while ((m = wTRegex.exec(bufStr)) !== null) {
      if (m[1].trim().length > 0) textMatches.push(m[1])
    }

    if (textMatches.length > 0) {
      return textMatches.join(' ').replace(/\s+/g, ' ').trim()
    }

    // Fallback: try reading as plain text if XML extraction fails
    const plainText = buffer.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return plainText.length > 100 ? plainText : null
  } catch {
    return null
  }
}

function extractFromTxt(buffer) {
  try {
    // Try UTF-8 first, fallback to latin1
    let text = buffer.toString('utf8')
    if (text.includes('\uFFFD')) {
      text = buffer.toString('latin1')
    }
    return text.length > 0 ? text : null
  } catch {
    return buffer.toString('latin1')
  }
}

// ── Document role detection ───────────────────────────────────────────────────

function detectDocumentRole(filename, text) {
  const fname = (filename || '').toLowerCase()
  const sample = (text || '').slice(0, 2000).toLowerCase()

  // Handwritten/solution sheet detection — filter these OUT
  const isSolutionSheet = (
    /solution|answer.?sheet|marking.?guide|mark.?scheme|worked.?solution/i.test(fname) ||
    /^(solution|answer|mark)/i.test(fname) ||
    (sample.includes('solution') && sample.includes('answer') && sample.length < 500)
  )
  if (isSolutionSheet) return 'solution_sheet'

  // Past paper detection
  const isPastPaper = (
    /exam|test|paper|assessment|past|sample|practice|trial/i.test(fname) ||
    /section [ab]|multiple choice|short answer|time allowed|total marks/i.test(sample) ||
    /instructions to candidates|answer (all|the following)/i.test(sample)
  )
  if (isPastPaper) return 'past_paper'

  // Notes/context
  return 'notes'
}

// ── Claude text extraction fallback (for images/scans) ──────────────────────

async function extractViaVision(buffer, mimeType, filename) {
  try {
    const base64 = buffer.toString('base64')
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 }
            },
            {
              type: 'text',
              text: 'Extract ALL text from this image exactly as it appears. Include questions, answers, diagrams labels, everything. Output raw text only.'
            }
          ]
        }]
      })
    })
    if (!response.ok) return null
    const data = await response.json()
    return data.content?.[0]?.text || null
  } catch {
    return null
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId
  try { userId = await requireAuth(req) } catch { return res.status(401).json({ error: 'Unauthorized' }) }

  try {
    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Must be multipart/form-data' })
    }

    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/)
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary found' })
    const boundary = boundaryMatch[1]

    const rawBody = await readRawBody(req)
    const parts = parseMultipart(rawBody, boundary)

    // Extract fields from parts
    let subjectId = null
    const files = []

    for (const part of parts) {
      const disp = parseContentDisposition(part.headers['content-disposition'] || '')
      if (!disp.name) continue

      if (disp.name === 'subjectId') {
        subjectId = part.data.toString('utf8').trim()
      } else if (disp.name === 'files' || disp.name === 'file') {
        if (disp.filename && part.data.length > 0) {
          files.push({
            filename: disp.filename,
            mimeType: part.headers['content-type'] || 'application/octet-stream',
            data: part.data
          })
        }
      }
    }

    if (!subjectId) return res.status(400).json({ error: 'subjectId required' })
    if (files.length === 0) return res.status(400).json({ error: 'No files found in upload' })

    // Get existing docs
    const docsKey = `sm:docs:${userId}:${subjectId}`
    const existingDocs = await redisGet(docsKey) || []

    const results = []

    for (const file of files) {
      const { filename, mimeType, data } = file
      const ext = filename.split('.').pop()?.toLowerCase() || ''

      let text = null
      let extractionMethod = 'direct'

      // Extract text based on file type
      if (ext === 'pdf' || mimeType === 'application/pdf') {
        text = extractFromPdf(data)
        extractionMethod = 'pdf-parse'
        if (!text || text.length < 100) {
          // Try vision for scanned/image PDFs — first page only
          // For now just flag it
          text = text || ''
          if (text.length < 100) {
            results.push({
              filename,
              status: 'warning',
              message: 'PDF appears to be scanned/image-based. Text extraction was limited. Try uploading a typed/digital PDF for best results.'
            })
            extractionMethod = 'scan-limited'
          }
        }
      } else if (ext === 'docx' || mimeType.includes('wordprocessingml') || mimeType.includes('msword')) {
        text = extractFromDocx(data)
        extractionMethod = 'docx-parse'
      } else if (ext === 'txt' || mimeType.startsWith('text/')) {
        text = extractFromTxt(data)
        extractionMethod = 'txt'
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) || mimeType.startsWith('image/')) {
        // Vision extraction for images
        const visionMime = mimeType.startsWith('image/') ? mimeType : `image/${ext}`
        text = await extractViaVision(data, visionMime, filename)
        extractionMethod = 'vision-ocr'
        if (!text) {
          results.push({ filename, status: 'error', message: 'Could not extract text from image. Make sure the image is clear and legible.' })
          continue
        }
      } else {
        results.push({ filename, status: 'error', message: `Unsupported file type: .${ext}. Supported: PDF, DOCX, TXT, PNG, JPG` })
        continue
      }

      if (!text || text.length < 30) {
        results.push({ filename, status: 'error', message: 'No readable text found in this file. It may be encrypted or image-only.' })
        continue
      }

      // Detect role (past paper vs notes vs solution sheet)
      const role = detectDocumentRole(filename, text)

      if (role === 'solution_sheet') {
        results.push({
          filename,
          status: 'filtered',
          message: 'This looks like a solution/marking sheet — it\'s been filtered out to avoid polluting exam questions with answers.',
          role
        })
        continue
      }

      // Chunk
      const chunks = chunkText(text, 800, 100)

      const doc = {
        id: genId(),
        name: filename,
        role,
        extractionMethod,
        uploadedAt: new Date().toISOString(),
        charCount: text.length,
        chunkCount: chunks.length,
        chunks
      }

      existingDocs.push(doc)
      results.push({
        filename,
        status: 'ok',
        role,
        chunks: chunks.length,
        message: role === 'past_paper'
          ? `✅ Past exam paper detected — will define format and topics.`
          : `✅ Notes/context detected — will enrich topic coverage.`
      })
    }

    // Save updated docs (cap at 30 per subject)
    await redisSet(docsKey, existingDocs.slice(-30))

    // Invalidate any existing scope so user re-analyses
    await redisSet(`sm:scope:${userId}:${subjectId}`, null)

    const successCount = results.filter(r => r.status === 'ok').length
    const errorCount = results.filter(r => r.status === 'error').length
    const filteredCount = results.filter(r => r.status === 'filtered').length

    return res.status(200).json({
      ok: true,
      totalDocs: existingDocs.length,
      results,
      summary: `${successCount} file${successCount !== 1 ? 's' : ''} ingested${filteredCount > 0 ? `, ${filteredCount} solution sheet${filteredCount !== 1 ? 's' : ''} filtered out` : ''}${errorCount > 0 ? `, ${errorCount} failed` : ''}. Click "Analyse my documents" to extract your exam format.`,
      needsAnalysis: true  // tell frontend to prompt for re-analysis
    })

  } catch (e) {
    console.error('ingest-doc error:', e.message, e.stack)
    return res.status(500).json({ error: `Ingestion failed: ${e.message}` })
  }
}
