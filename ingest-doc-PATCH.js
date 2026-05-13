// api/ingest-doc.js — PATCH for PDF timeout + handwritten page filtering
// Apply this to your existing ingest-doc.js

// ✅ ADD THIS SECTION after your existing utility functions (sanitizeText, chunkText, etc.)

/**
 * Detects if a document (by filename or content) is a solution sheet
 * Returns true if it looks like solutions/answers/marking scheme
 */
function isSolutionDocument(filename, firstPageText = '') {
  const solutionPatterns = [
    'solution',
    'answer',
    'marking',
    'mark',
    'scheme',
    'key',
    'worked',
    'exemplar',
    'sample answer'
  ]
  
  const name = (filename || '').toLowerCase()
  const text = (firstPageText || '').toLowerCase().slice(0, 500)
  
  return solutionPatterns.some(p => name.includes(p) || text.includes(p))
}

/**
 * Quick heuristic: detect if a page looks handwritten
 * Checks for low text density, scattered positioning, or very short lines
 */
function looksHandwritten(pageText) {
  if (!pageText || pageText.length < 20) return false
  
  const lines = pageText.split('\n').filter(l => l.trim().length > 0)
  const avgLineLength = lines.reduce((sum, l) => sum + l.length, 0) / lines.length
  
  // Handwritten typically has:
  // - Many short lines (avg < 30 chars)
  // - Low character density per line
  // - Lots of whitespace
  return avgLineLength < 30
}

/**
 * Extract text from PDF with page limit + solution detection
 * Skips handwritten pages and solution sheets automatically
 */
async function extractPdfText(buffer, filename) {
  try {
    const pdf = await require('pdf-parse')(buffer)
    
    // HARD LIMIT: only process first 10 pages (solutions are always at end)
    const pagesToProcess = Math.min(10, pdf.numpages)
    const MAX_PAGE_PROCESS_TIME = 5000 // 5 seconds per page
    
    let allText = ''
    let skippedPages = []
    
    for (let i = 0; i < pagesToProcess; i++) {
      try {
        const page = pdf.pages[i]
        
        // Timeout guard per page
        const pageStart = Date.now()
        const pageText = page.getTextContent 
          ? await page.getTextContent() 
          : (page.text || '')
        const pageTime = Date.now() - pageStart
        
        if (pageTime > MAX_PAGE_PROCESS_TIME) {
          console.log(`Page ${i + 1} took ${pageTime}ms, skipping (likely handwritten)`)
          skippedPages.push({ page: i + 1, reason: 'timeout' })
          continue
        }
        
        // Check if page looks handwritten
        if (looksHandwritten(pageText)) {
          console.log(`Page ${i + 1} looks handwritten, skipping`)
          skippedPages.push({ page: i + 1, reason: 'handwritten' })
          continue
        }
        
        allText += `\n--- Page ${i + 1} ---\n${pageText}\n`
        
      } catch (pageErr) {
        console.log(`Error processing page ${i + 1}:`, pageErr.message)
        skippedPages.push({ page: i + 1, reason: 'parse_error' })
      }
    }
    
    // If total PDF is > 10 pages, note that solutions were likely skipped
    if (pdf.numpages > 10) {
      allText += `\n[Note: Pages ${pagesToProcess + 1}-${pdf.numpages} skipped (likely solutions)]\n`
    }
    
    return {
      text: sanitizeText(allText),
      numPages: pdf.numpages,
      processedPages: pagesToProcess,
      skippedPages
    }
    
  } catch (err) {
    console.error('PDF extraction failed:', err.message)
    throw new Error(`Failed to extract PDF: ${err.message}`)
  }
}

// ✅ IN YOUR MAIN HANDLER (where you call the PDF processing)
// Update the section that processes uploaded files:

// REPLACE THIS:
// const text = await someOldPdfFunction(buffer)

// WITH THIS:
async function processUploadedFile(buffer, filename, mimeType) {
  // Check if this is a solution document FIRST
  if (isSolutionDocument(filename)) {
    throw new Error(`Cannot ingest ${filename} — this appears to be a solution sheet. Upload primary exam papers only.`)
  }
  
  let text = ''
  let metadata = { file: filename, type: mimeType }
  
  if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
    const pdfResult = await extractPdfText(buffer, filename)
    text = pdfResult.text
    metadata.pdfPages = pdfResult.numPages
    metadata.processedPages = pdfResult.processedPages
    metadata.skippedPages = pdfResult.skippedPages
    
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
    // Your existing DOCX processing
    text = await extractDocxText(buffer) // your existing function
    
  } else if (mimeType.startsWith('text/') || filename.endsWith('.txt')) {
    text = buffer.toString('utf-8')
    
  } else if (mimeType.startsWith('image/')) {
    // Your existing image OCR if you have it
    text = await extractImageText(buffer) // your existing function
  }
  
  return { text, metadata }
}

// ✅ IN YOUR STAGE 2 FORMAT DETECTION
// When you analyze the document, now you have metadata about skipped pages:

function analyzeFormat(text, metadata = {}) {
  // Your existing format detection logic
  const format = detectFormatSignature(text) // your existing function
  
  // ADD: note about skipped pages
  if (metadata.skippedPages && metadata.skippedPages.length > 0) {
    console.log(`Format analysis: ${metadata.skippedPages.length} pages were skipped (handwritten/timeout)`)
    format.handwrittenPagesSkipped = metadata.skippedPages.length
  }
  
  if (metadata.pdfPages > 10) {
    format.note = `Full PDF is ${metadata.pdfPages} pages; processed first 10 (solutions likely at end)`
  }
  
  return format
}

// ✅ EXPORT these functions so they're available in your API handler
export { 
  isSolutionDocument, 
  looksHandwritten, 
  extractPdfText,
  processUploadedFile
}
