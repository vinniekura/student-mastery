// Vision-based OCR for handwritten notes and scanned documents
// Sends images to Claude vision API to extract text

export async function extractTextViaVision(imageBuffer, mimeType) {
  const base64 = imageBuffer.toString('base64')
  
  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          },
          {
            type: 'text',
            text: `Extract ALL text from this image exactly as written. This may be handwritten notes, a scanned document, or a photo of study material.

Rules:
- Transcribe every word, number, formula, and symbol you can see
- Preserve the structure (headings, bullet points, equations)
- For mathematical formulas, write them in plain text (e.g. "x^2 + 2x - 3" or "F = ma")
- If text is unclear, make your best attempt and mark it with [unclear]
- Do NOT add explanations or commentary — just the raw transcribed text
- If there are diagrams, describe them briefly in [brackets]

Output only the transcribed text, nothing else.`
          }
        ]
      }]
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Vision OCR failed: ${res.status} ${err.slice(0, 100)}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// Convert PDF pages to images using a simple approach
// For scanned PDFs, extract embedded images
export async function extractPdfImages(buffer) {
  // Look for JPEG/PNG image data embedded in PDF
  const images = []
  const bytes = buffer
  
  // Find JPEG markers (FFD8FF)
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0xFF && bytes[i+1] === 0xD8 && bytes[i+2] === 0xFF) {
      // Found JPEG start, find end (FFD9)
      for (let j = i + 2; j < bytes.length - 1; j++) {
        if (bytes[j] === 0xFF && bytes[j+1] === 0xD9) {
          const imgData = bytes.slice(i, j + 2)
          if (imgData.length > 5000) { // Skip tiny images
            images.push({ data: imgData, mimeType: 'image/jpeg' })
          }
          i = j
          break
        }
      }
    }
    // Find PNG markers (89504E47)
    if (bytes[i] === 0x89 && bytes[i+1] === 0x50 && bytes[i+2] === 0x4E && bytes[i+3] === 0x47) {
      // PNG - find IEND chunk
      for (let j = i + 8; j < bytes.length - 7; j++) {
        if (bytes[j] === 0x49 && bytes[j+1] === 0x45 && bytes[j+2] === 0x4E && bytes[j+3] === 0x44) {
          const imgData = bytes.slice(i, j + 8)
          if (imgData.length > 5000) {
            images.push({ data: imgData, mimeType: 'image/png' })
          }
          i = j
          break
        }
      }
    }
  }
  
  return images
}
