import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function chunkText(text, size = 800, overlap = 100) {
  const chunks = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + size))
    i += size - overlap
    if (i + overlap >= text.length) break
  }
  if (text.length > 0 && chunks.length === 0) chunks.push(text.slice(i))
  return chunks.filter(c => c.trim().length > 20)
}

function extractPdfText(buffer) {
  const str = buffer.toString('latin1')
  const texts = []
  const btRegex = /BT([\s\S]*?)ET/g
  let match
  while ((match = btRegex.exec(str)) !== null) {
    const block = match[1]
    const strRegex = /\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|')/g
    const arrRegex = /\[((?:[^\[\]])*)\]\s*TJ/g
    let m
    while ((m = strRegex.exec(block)) !== null) {
      const t = m[1].replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))).replace(/\\n/g, '\n').replace(/\\/g, '')
      if (t.trim()) texts.push(t)
    }
    while ((m = arrRegex.exec(block)) !== null) {
      const parts = []
      const pRegex = /\(((?:[^()\\]|\\.)*)\)/g
      let p
      while ((p = pRegex.exec(m[1])) !== null) parts.push(p[1].replace(/\\/g, ''))
      if (parts.length) texts.push(parts.join(''))
    }
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractDocxText(buffer) {
  const str = buffer.toString('utf8', 0, Math.min(buffer.length, 5000000))
  const texts = []
  const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
  let match
  while ((match = regex.exec(str)) !== null) {
    if (match[1].trim()) texts.push(match[1])
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

function splitMultipart(buffer, boundary) {
  const parts = []
  const boundaryBuf = Buffer.from('--' + boundary)
  let pos = 0
  while (pos < buffer.length) {
    const boundaryIdx = indexOf(buffer, boundaryBuf, pos)
    if (boundaryIdx === -1) break
    pos = boundaryIdx + boundaryBuf.length
    if (buffer[pos] === 45 && buffer[pos + 1] === 45) break
    if (buffer[pos] === 13) pos++
    if (buffer[pos] === 10) pos++
    const headerEnd = indexOf(buffer, Buffer.from('\r\n\r\n'), pos)
    if (headerEnd === -1) break
    const headerStr = buffer.slice(pos, headerEnd).toString('utf8')
    const headers = {}
    for (const line of headerStr.split('\r\n')) {
      const colon = line.indexOf(':')
      if (colon > 0) headers[line.slice(0, colon).toLowerCase().trim()] = line.slice(colon + 1).trim()
    }
    pos = headerEnd + 4
    const nextBoundary = indexOf(buffer, boundaryBuf, pos)
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2
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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  let userId
  try { userId = await requireAuth(req) }
  catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }

  try {
    const body = await parseBody(req)
    const contentType = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/)
    if (!boundaryMatch) { res.status(400).json({ error: 'Expected multipart/form-data' }); return }

    const parts = splitMultipart(body, boundaryMatch[1])
    let fileBuffer = null, filename = 'unknown', subjectId = null, fileType = 'pdf'
    let docType = 'notes' // default

    for (const part of parts) {
      const disposition = part.headers['content-disposition'] || ''
      if (disposition.includes('name="subjectId"')) {
        subjectId = part.data.toString('utf8').trim()
      } else if (disposition.includes('name="docType"')) {
        docType = part.data.toString('utf8').trim() || 'notes'
      } else if (disposition.includes('name="file"')) {
        const nameMatch = disposition.match(/filename="([^"]+)"/)
        if (nameMatch) filename = nameMatch[1]
        fileBuffer = part.data
        const ct = part.headers['content-type'] || ''
        if (ct.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) fileType = 'pdf'
        else if (filename.toLowerCase().endsWith('.docx')) fileType = 'docx'
        else fileType = 'txt'
      }
    }

    if (!fileBuffer || !subjectId) { res.status(400).json({ error: 'Missing file or subjectId' }); return }

    let rawText = ''
    if (fileType === 'pdf') rawText = extractPdfText(fileBuffer)
    else if (fileType === 'docx') rawText = extractDocxText(fileBuffer)
    else rawText = fileBuffer.toString('utf8')

    if (!rawText || rawText.length < 50) {
      res.status(400).json({ error: 'Could not extract text. Try a text-based PDF or DOCX.' })
      return
    }

    const textChunks = chunkText(rawText)
    const doc = {
      id: genId(),
      filename,
      fileType,
      docType, // 'notes' or 'past-paper'
      charCount: rawText.length,
      chunkCount: textChunks.length,
      chunks: textChunks,
      uploadedAt: new Date().toISOString()
    }

    const key = `sm:docs:${userId}:${subjectId}`
    const existing = await redisGet(key) || []
    existing.push(doc)
    await redisSet(key, existing)

    res.status(200).json({ ok: true, docId: doc.id, filename, docType, chunkCount: textChunks.length, charCount: rawText.length })
  } catch (e) {
    console.error('ingest-doc error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
