import { redisGet, redisSet } from './lib/redis.js'
import { requireAuth } from './lib/clerk.js'
import { extractTextViaVision, extractPdfImages } from './lib/ocr.js'

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
  // Route to format extraction if action=extract-format
  const qIdx = (req.url || '').indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '')
  if (params.get('action') === 'extract-format') {
    let userId
    try { userId = await requireAuth(req) }
    catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }
    try { return await extractFormatHandler(req, res, userId) }
    catch (e) { res.status(500).json({ error: e.message }); return }
  }

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
    let fileBuffer = null, filename = 'unknown', subjectId = null
    let fileType = 'pdf', docType = 'notes', mimeType = ''

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
        mimeType = part.headers['content-type'] || ''
        const lower = filename.toLowerCase()
        if (lower.endsWith('.pdf')) fileType = 'pdf'
        else if (lower.endsWith('.docx')) fileType = 'docx'
        else if (lower.match(/\.(jpg|jpeg)$/)) fileType = 'jpg'
        else if (lower.endsWith('.png')) fileType = 'png'
        else if (lower.endsWith('.txt')) fileType = 'txt'
        else fileType = 'txt'
      }
    }

    if (!fileBuffer || !subjectId) { res.status(400).json({ error: 'Missing file or subjectId' }); return }

    let rawText = ''
    let ocrUsed = false

    if (fileType === 'jpg' || fileType === 'png') {
      // Direct image — use vision OCR
      const imageMime = fileType === 'png' ? 'image/png' : 'image/jpeg'
      rawText = await extractTextViaVision(fileBuffer, imageMime)
      ocrUsed = true
    } else if (fileType === 'pdf') {
      // Try text extraction first
      rawText = extractPdfText(fileBuffer)
      
      // If minimal text extracted, it's likely scanned — try vision OCR on embedded images
      if (rawText.length < 100) {
        console.log('PDF has minimal text, trying vision OCR on embedded images...')
        const images = extractPdfImages(fileBuffer)
        
        if (images.length > 0) {
          // OCR up to 3 images (pages)
          const ocrResults = []
          for (const img of images.slice(0, 3)) {
            try {
              const text = await extractTextViaVision(img.data, img.mimeType)
              if (text && text.length > 20) ocrResults.push(text)
            } catch (e) {
              console.error('Image OCR failed:', e.message)
            }
          }
          if (ocrResults.length > 0) {
            rawText = ocrResults.join('\n\n')
            ocrUsed = true
          }
        }
        
        // If still no text, send whole PDF first page as context to Claude
        if (rawText.length < 50) {
          // Try sending raw PDF buffer as document to Claude
          try {
            const base64Pdf = fileBuffer.toString('base64')
            const res2 = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 2000,
                messages: [{
                  role: 'user',
                  content: [
                    {
                      type: 'document',
                      source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf }
                    },
                    {
                      type: 'text',
                      text: 'Extract all text content from this document. Output only the raw text, no commentary.'
                    }
                  ]
                }]
              })
            })
            if (res2.ok) {
              const data2 = await res2.json()
              const extracted = data2.content?.[0]?.text || ''
              if (extracted.length > 50) {
                rawText = extracted
                ocrUsed = true
              }
            }
          } catch (e) {
            console.error('PDF document OCR failed:', e.message)
          }
        }
      }
    } else if (fileType === 'docx') {
      rawText = extractDocxText(fileBuffer)
    } else {
      rawText = fileBuffer.toString('utf8')
    }

    if (!rawText || rawText.length < 30) {
      res.status(400).json({ 
        error: 'Could not extract text from this file. For handwritten notes, take a clear photo and upload as JPG/PNG. For scanned PDFs, ensure the scan is clear.'
      })
      return
    }

    const textChunks = chunkText(rawText)
    const doc = {
      id: genId(),
      filename,
      fileType,
      docType,
      ocrUsed,
      charCount: rawText.length,
      chunkCount: textChunks.length,
      chunks: textChunks,
      uploadedAt: new Date().toISOString()
    }

    const key = `sm:docs:${userId}:${subjectId}`
    const existing = await redisGet(key) || []
    existing.push(doc)
    await redisSet(key, existing)

    res.status(200).json({ 
      ok: true, 
      docId: doc.id, 
      filename, 
      docType,
      ocrUsed,
      chunkCount: textChunks.length, 
      charCount: rawText.length 
    })
  } catch (e) {
    console.error('ingest-doc error:', e.message)
    res.status(500).json({ error: e.message })
  }
}

// Also handles format extraction — POST /api/ingest-doc?action=extract-format
export async function extractFormatHandler(req, res, userId) {
  const { url = '' } = req
  const qIndex = url.indexOf('?')
  const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
  const subjectId = params.get('subjectId')

  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
  const pastPapers = allDocs.filter(d => d.docType === 'past-paper')

  if (pastPapers.length === 0) {
    res.status(400).json({ error: 'No past papers uploaded yet.' })
    return
  }

  const chunks = pastPapers.flatMap(d => d.chunks || [])
  let context = ''
  let charCount = 0
  for (const chunk of chunks) {
    if (charCount + chunk.length > 5000) break
    context += chunk + '\n\n'
    charCount += chunk.length
  }

  // If no text extracted, use subject info to infer format
  if (charCount < 50) {
    const subjects = await redisGet(`sm:subjects:${userId}`) || []
    const subject = subjects.find(s => s.id === subjectId)
    const fallbackFormat = {
      totalMarks: subject?.paperFormat?.totalMarks || 100,
      timeAllowed: `${subject?.paperFormat?.timeLimitMins || 180} minutes`,
      sections: (subject?.paperFormat?.sections || ['Multiple choice', 'Short answer', 'Extended response']).map(name => ({
        name, type: name.toLowerCase().includes('choice') ? 'mcq' : 'extended',
        marks: Math.floor((subject?.paperFormat?.totalMarks || 100) / 3),
        questionCount: 5, instructions: '', hasDiagrams: false
      })),
      formulaSheet: false,
      allowedMaterials: 'Scientific calculator',
      questionStyle: `Standard ${subject?.examBoard || 'AU'} exam format`,
      inferredFromSubject: true
    }
    const idx = subjects.findIndex(s => s.id === subjectId)
    if (idx >= 0) {
      subjects[idx].extractedFormat = fallbackFormat
      subjects[idx].formatExtractedAt = new Date().toISOString()
      await redisSet(`sm:subjects:${userId}`, subjects)
    }
    res.status(200).json({ ok: true, format: fallbackFormat, warning: 'PDFs had no extractable text — using subject settings as format template. Re-upload PDFs for better results.' })
    return
  }

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [
        { role: 'user', content: `Analyse this exam paper and extract its exact format as JSON:\n\n${context}\n\nReturn ONLY JSON: {"totalMarks":0,"timeAllowed":"","sections":[{"name":"","type":"mcq","marks":0,"questionCount":0,"instructions":"","hasDiagrams":false}],"formulaSheet":false,"allowedMaterials":"","questionStyle":""}` },
        { role: 'assistant', content: '{' }
      ]
    })
  })

  if (!claudeRes.ok) throw new Error(`Claude error: ${claudeRes.status}`)
  const data = await claudeRes.json()
  const raw = '{' + (data.content?.[0]?.text || '{}')
  
  let format
  try {
    format = JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim())
  } catch { throw new Error('Could not parse format') }

  const subjects = await redisGet(`sm:subjects:${userId}`) || []
  const idx = subjects.findIndex(s => s.id === subjectId)
  if (idx >= 0) {
    subjects[idx].extractedFormat = format
    subjects[idx].formatExtractedAt = new Date().toISOString()
    await redisSet(`sm:subjects:${userId}`, subjects)
  }

  res.status(200).json({ ok: true, format })
}
