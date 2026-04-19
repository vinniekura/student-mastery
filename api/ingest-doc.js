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

function splitMultipart(body, boundary) {
  const parts = []
  const boundaryBuf = Buffer.from('--' + boundary)
  let start = 0
  while (start < body.length) {
    const boundaryIdx = body.indexOf(boundaryBuf, start)
    if (boundaryIdx === -1) break
    const partStart = boundaryIdx + boundaryBuf.length
    if (body[partStart] === 45 && body[partStart + 1] === 45) break
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart)
    if (headerEnd === -1) break
    const headerStr = body.slice(partStart + 2, headerEnd).toString('utf8')
    const headers = {}
    for (const line of headerStr.split('\r\n')) {
      const colon = line.indexOf(':')
      if (colon > -1) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
    }
    const nextBoundary = body.indexOf(boundaryBuf, headerEnd + 4)
    const dataEnd = nextBoundary === -1 ? body.length : nextBoundary - 2
    parts.push({ headers, data: body.slice(headerEnd + 4, dataEnd) })
    start = nextBoundary === -1 ? body.length : nextBoundary
  }
  return parts
}

export default async function handler(req, res) {
  // Route to format extraction if action=extract-format
  const { url = '', method } = req
  const qIdx = url.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
  if (params.get('action') === 'extract-format') {
    let userId
    try { userId = await requireAuth(req) }
    catch (e) { res.status(401).json({ error: 'Unauthorized' }); return }
    try { return await extractFormatHandler(req, res, userId) }
    catch (e) { res.status(500).json({ error: e.message }); return }
  }

  if (method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

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
    let fileType = 'pdf', docType = 'notes', mimeType = '', unit = ''

    for (const part of parts) {
      const disposition = part.headers['content-disposition'] || ''
      if (disposition.includes('name="subjectId"')) {
        subjectId = part.data.toString('utf8').trim()
      } else if (disposition.includes('name="docType"')) {
        docType = part.data.toString('utf8').trim() || 'notes'
      } else if (disposition.includes('name="unit"')) {
        unit = part.data.toString('utf8').trim()
      } else if (disposition.includes('name="file"')) {
        const nameMatch = disposition.match(/filename="([^"]+)"/)
        if (nameMatch) filename = nameMatch[1]
        fileBuffer = part.data
        mimeType = part.headers['content-type'] || ''
        const lower = filename.toLowerCase()
        if (lower.endsWith('.pdf'))                    fileType = 'pdf'
        else if (lower.endsWith('.docx'))             fileType = 'docx'
        else if (lower.match(/\.(jpg|jpeg)$/))        fileType = 'jpg'
        else if (lower.endsWith('.png'))              fileType = 'png'
        else if (lower.endsWith('.txt'))              fileType = 'txt'
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
      // ── PDF: go straight to Claude native PDF reading ────────────────────
      // Skip regex extraction — it returns binary garbage for modern PDFs
      // Claude haiku handles PDFs natively and is fast enough within 300s
      try {
        const base64Pdf = fileBuffer.toString('base64')
        const pdfRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',   // fastest model — critical for 300s limit
            max_tokens: 4000,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf }
                },
                {
                  type: 'text',
                  text: 'Extract ALL text from this document including questions, answers, formulas, diagrams descriptions, and instructions. Preserve the structure and numbering. Output only the raw extracted text, nothing else.'
                }
              ]
            }]
          })
        })

        if (pdfRes.ok) {
          const pdfData = await pdfRes.json()
          const extracted = pdfData.content?.[0]?.text || ''
          if (extracted.length > 50) {
            rawText = extracted
            ocrUsed = true
            console.log('Claude native PDF reading succeeded:', extracted.length, 'chars')
          } else {
            console.log('Claude PDF returned short response, trying image OCR fallback')
          }
        } else {
          const errText = await pdfRes.text()
          console.error('Claude PDF API error:', pdfRes.status, errText.slice(0, 200))
        }
      } catch (e) {
        console.error('Claude PDF reading failed:', e.message)
      }

      // Fallback: image OCR on first 3 pages if Claude reading failed
      if (rawText.length < 50) {
        console.log('Trying image OCR fallback on PDF pages...')
        try {
          const images = extractPdfImages(fileBuffer)
          if (images.length > 0) {
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
        } catch (e) {
          console.error('PDF image extraction failed:', e.message)
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
      unit: unit || null,
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
      unit: doc.unit,
      ocrUsed,
      chunkCount: textChunks.length,
      charCount: rawText.length
    })

  } catch (e) {
    console.error('ingest-doc error:', e.message)
    res.status(500).json({ error: e.message })
  }
}

// ── Format extraction handler (unchanged) ─────────────────────────────────────
export async function extractFormatHandler(req, res, userId) {
  const { url = '' } = req
  const qIdx = url.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
  const subjectId = params.get('subjectId')
  if (!subjectId) { res.status(400).json({ error: 'subjectId required' }); return }

  const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`) || []
  const pastPapers = allDocs.filter(d => d.docType === 'past-paper')
  if (pastPapers.length === 0) {
    res.status(400).json({ error: 'No past papers uploaded yet.' }); return
  }

  const allChunks = pastPapers.flatMap(d => d.chunks || [])
  let sampleText = ''
  let charCount = 0
  for (const chunk of allChunks) {
    if (charCount + chunk.length > 3000) break
    sampleText += chunk + '\n'
    charCount += chunk.length
  }

  const subjects = await redisGet(`sm:subjects:${userId}`) || []
  const subject = subjects.find(s => s.id === subjectId) || {}

  const formatRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [
        { role: 'user', content: `Extract the exam format from this past paper content for ${subject.name || 'Physics'} ${subject.examBoard || 'BSSS'}:\n\n${sampleText}\n\nReturn JSON only: {"sections":[{"name":"...","type":"mcq|short|extended","marks":0,"questionCount":0,"marksPerQ":0,"instructions":"..."}],"totalMarks":0,"timeLimitMins":0,"allowedMaterials":"...","style":"..."}` },
        { role: 'assistant', content: '{' }
      ]
    })
  })

  if (!formatRes.ok) { res.status(500).json({ error: 'Format extraction failed' }); return }

  const formatData = await formatRes.json()
  const raw = '{' + (formatData.content?.[0]?.text || '{}')
  try {
    const fmt = JSON.parse(raw.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim())
    const subjects2 = await redisGet(`sm:subjects:${userId}`) || []
    const idx = subjects2.findIndex(s => s.id === subjectId)
    if (idx >= 0) {
      subjects2[idx].extractedFormat = fmt
      subjects2[idx].extractedFormatAt = new Date().toISOString()
      await redisSet(`sm:subjects:${userId}`, subjects2)
    }
    res.status(200).json({ ok: true, format: fmt })
  } catch (e) {
    res.status(500).json({ error: 'Could not parse format response' })
  }
}
