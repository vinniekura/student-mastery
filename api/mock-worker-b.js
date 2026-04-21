import { redisGet, redisSet } from './lib/redis.js'

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function sanitize(text) {
  if (!text) return ''
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .trim()
}

function extractJsonArray(text) {
  try { const p = JSON.parse(text.trim()); return Array.isArray(p) ? p : null } catch {}
  const stripped = text.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim()
  try { const p = JSON.parse(stripped); return Array.isArray(p) ? p : null } catch {}
  const start = text.indexOf('['), end = text.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try { const p = JSON.parse(text.slice(start, end+1)); return Array.isArray(p) ? p : null } catch {}
  }
  if (start !== -1) {
    let partial = text.slice(start).trimEnd().replace(/,\s*$/, '')
    let open = 0, openBr = 0, inStr = false, esc = false
    for (const ch of partial) {
      if (esc) { esc=false; continue }
      if (ch==='\\' && inStr) { esc=true; continue }
      if (ch==='"') { inStr=!inStr; continue }
      if (inStr) continue
      if (ch==='{') open++; if (ch==='}') open--
      if (ch==='[') openBr++; if (ch===']') openBr--
    }
    while (open>0) { partial+='}'; open-- }
    while (openBr>0) { partial+=']'; openBr-- }
    try { const p = JSON.parse(partial); return Array.isArray(p) ? p : null } catch {}
  }
  return null
}

async function callClaude(system, prompt, maxTokens=2500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0,120)}`)
  const data = await res.json()
  console.log(`Claude-B: ${data.content?.[0]?.text?.length||0} chars | stop:${data.stop_reason}`)
  return data.content?.[0]?.text || ''
}

// Import diagram builders inline (same as mock-worker.js)
function buildParallelPlatesSVG(p={}) {
  const sep=p.separation||'4.0 cm', volts=p.voltage||'400 V'
  const charge=p.particleCharge||'negative', topPos=p.topPlatePolarity||'positive'
  const W=380, H=280, py1=60, py2=210, px1=80, px2=300
  const pColor=charge==='positive'?'#dc2626':'#2563eb'
  const pSym=charge==='positive'?'+':'−'
  const topLbl=topPos==='positive'?'+ + + + + + +':'− − − − − − −'
  const botLbl=topPos==='positive'?'− − − − − − −':'+ + + + + + +'
  let arrows=''
  for(let i=0;i<5;i++){
    const ax=px1+20+i*44, ay1=py1+22, ay2=py2-22
    arrows+=`<line x1="${ax}" y1="${ay1}" x2="${ax}" y2="${ay2}" stroke="#6b7280" stroke-width="1.5" marker-end="url(#ea)"/>`
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb"><defs><marker id="ea" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#6b7280" stroke-width="1.5"/></marker></defs><rect width="${W}" height="${H}" fill="white"/><rect x="${px1}" y="${py1-12}" width="${px2-px1}" height="12" fill="#374151" rx="2"/><text x="${(px1+px2)/2}" y="${py1-20}" font-size="12" fill="#374151" text-anchor="middle" font-weight="600">${topLbl}</text><rect x="${px1}" y="${py2}" width="${px2-px1}" height="12" fill="#374151" rx="2"/><text x="${(px1+px2)/2}" y="${py2+28}" font-size="12" fill="#374151" text-anchor="middle" font-weight="600">${botLbl}</text>${arrows.replace(/\/>/g,' marker-end="url(#ea)"/>')}<text x="${px2+18}" y="${(py1+py2)/2+4}" font-size="14" fill="#374151" font-style="italic">E</text><circle cx="${(px1+px2)/2}" cy="${(py1+py2)/2}" r="13" fill="${pColor}" opacity="0.15" stroke="${pColor}" stroke-width="2"/><text x="${(px1+px2)/2}" y="${(py1+py2)/2+5}" font-size="15" fill="${pColor}" text-anchor="middle" font-weight="700">${pSym}</text><text x="${W/2}" y="${H-6}" font-size="10" fill="#9ca3af" text-anchor="middle">${volts} between plates · separation ${sep}</text></svg>`
}

function buildMagneticFieldSVG(p={}) {
  const rows=p.rows||5, cols=p.cols||7
  const fieldDir=p.fieldDirection||'into-page'
  const pCharge=p.particleCharge||'positive', pVel=p.particleVelocity||'right'
  const cell=44, ox=40, oy=40
  const W=cols*cell+ox*2, H=rows*cell+oy*2+30
  let syms=''
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const cx=ox+c*cell+cell/2, cy=oy+r*cell+cell/2
    if(fieldDir==='into-page'){
      syms+=`<line x1="${cx-8}" y1="${cy-8}" x2="${cx+8}" y2="${cy+8}" stroke="#374151" stroke-width="1.5"/><line x1="${cx+8}" y1="${cy-8}" x2="${cx-8}" y2="${cy+8}" stroke="#374151" stroke-width="1.5"/>`
    } else {
      syms+=`<circle cx="${cx}" cy="${cy}" r="3" fill="#374151"/><circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="#374151" stroke-width="1"/>`
    }
  }
  const px=ox+cell, py=oy+Math.floor(rows/2)*cell+cell/2
  const pColor=pCharge==='positive'?'#dc2626':'#2563eb'
  const pSym=pCharge==='positive'?'+':'−'
  let vx1=px+16,vy1=py,vx2=px+55,vy2=py
  if(pVel==='left'){vx1=px-16;vx2=px-55}
  if(pVel==='up'){vx1=px;vy1=py-16;vx2=px;vy2=py-55}
  if(pVel==='down'){vx1=px;vy1=py+16;vx2=px;vy2=py+55}
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb"><defs><marker id="va" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#d97706" stroke-width="1.8"/></marker></defs><rect width="${W}" height="${H}" fill="white"/>${syms}<circle cx="${px}" cy="${py}" r="13" fill="${pColor}" opacity="0.15" stroke="${pColor}" stroke-width="2"/><text x="${px}" y="${py+5}" font-size="15" fill="${pColor}" text-anchor="middle" font-weight="700">${pSym}</text><line x1="${vx1}" y1="${vy1}" x2="${vx2}" y2="${vy2}" stroke="#d97706" stroke-width="2.5" marker-end="url(#va)"/><text x="${(vx1+vx2)/2}" y="${Math.min(vy1,vy2)-8}" font-size="12" fill="#d97706" text-anchor="middle" font-style="italic">v</text><text x="${W/2}" y="${H-8}" font-size="11" fill="#6b7280" text-anchor="middle">B (${fieldDir==='into-page'?'into page ×':'out of page •'}) · ${pCharge} charge</text></svg>`
}

function buildGravFieldGraphSVG(p={}) {
  const bodyName=p.bodyName||'Earth', surfaceG=parseFloat(p.surfaceG)||9.8
  const W=400, H=280, ox=65, oy=240, gw=290, gh=190
  let pathD=''
  for(let i=0;i<=80;i++){
    const r=1+i*2/80, g=surfaceG/(r*r)
    const x=ox+(r-1)*gw/2, y=oy-(g/surfaceG)*gh
    pathD+=(i===0?'M':'L')+`${x.toFixed(1)},${y.toFixed(1)}`
  }
  let xLbls='', yLbls=''
  for(let i=0;i<=4;i++){
    const x=ox+i*gw/4, rv=(1+i*0.5).toFixed(1)
    xLbls+=`<text x="${x}" y="${oy+18}" font-size="10" fill="#6b7280" text-anchor="middle">${rv}R</text><line x1="${x}" y1="${oy}" x2="${x}" y2="${oy+4}" stroke="#d1d5db" stroke-width="1"/>`
  }
  for(let i=0;i<=4;i++){
    const y=oy-i*gh/4, gv=(surfaceG*i/4).toFixed(1)
    yLbls+=`<text x="${ox-8}" y="${y+4}" font-size="10" fill="#6b7280" text-anchor="end">${gv}</text><line x1="${ox-4}" y1="${y}" x2="${ox}" y2="${y}" stroke="#d1d5db" stroke-width="1"/>`
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb"><rect width="${W}" height="${H}" fill="white"/>${[1,2,3,4].map(i=>`<line x1="${ox}" y1="${oy-i*gh/4}" x2="${ox+gw}" y2="${oy-i*gh/4}" stroke="#f3f4f6" stroke-width="1"/>`).join('')}<line x1="${ox}" y1="${oy-gh-10}" x2="${ox}" y2="${oy+4}" stroke="#374151" stroke-width="1.5"/><line x1="${ox-4}" y1="${oy}" x2="${ox+gw+10}" y2="${oy}" stroke="#374151" stroke-width="1.5"/><path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>${xLbls}${yLbls}<text x="${ox+gw/2}" y="${H-4}" font-size="11" fill="#374151" text-anchor="middle">Distance from centre of ${bodyName}</text><text x="14" y="${oy-gh/2}" font-size="11" fill="#374151" text-anchor="middle" transform="rotate(-90,14,${oy-gh/2})">g (N/kg)</text></svg>`
}

function buildTwoChargesSVG(p={}) {
  const q1=p.q1||'+3.0 μC', q2=p.q2||'−2.0 μC'
  const q2pos=p.q2pos||'x = 0.50 m', pointP=p.pointP||'x = 0.20 m'
  const W=480, H=200, y=100, x1=80, x2=380, xP=180
  const c1=q1.includes('-')||q1.includes('−')?'#2563eb':'#dc2626'
  const c2=q2.includes('-')||q2.includes('−')?'#2563eb':'#dc2626'
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb"><rect width="${W}" height="${H}" fill="white"/><line x1="40" y1="${y}" x2="${W-30}" y2="${y}" stroke="#374151" stroke-width="1.5"/><polygon points="${W-30},${y} ${W-38},${y-4} ${W-38},${y+4}" fill="#374151"/><text x="${W-20}" y="${y+4}" font-size="12" fill="#374151" font-style="italic">x</text><circle cx="${x1}" cy="${y}" r="18" fill="${c1}" opacity="0.15" stroke="${c1}" stroke-width="2"/><text x="${x1}" y="${y+5}" font-size="12" fill="${c1}" text-anchor="middle" font-weight="700">${q1}</text><text x="${x1}" y="${y+36}" font-size="10" fill="#6b7280" text-anchor="middle">x = 0</text><circle cx="${x2}" cy="${y}" r="18" fill="${c2}" opacity="0.15" stroke="${c2}" stroke-width="2"/><text x="${x2}" y="${y+5}" font-size="12" fill="${c2}" text-anchor="middle" font-weight="700">${q2}</text><text x="${x2}" y="${y+36}" font-size="10" fill="#6b7280" text-anchor="middle">${q2pos}</text><line x1="${xP}" y1="${y-24}" x2="${xP}" y2="${y+24}" stroke="#059669" stroke-width="2" stroke-dasharray="4,3"/><circle cx="${xP}" cy="${y}" r="5" fill="#059669"/><text x="${xP}" y="${y-30}" font-size="11" fill="#059669" text-anchor="middle" font-weight="600">P</text><text x="${xP}" y="${y+40}" font-size="10" fill="#059669" text-anchor="middle">${pointP}</text></svg>`
}

function buildFreeBodySVG(p={}) {
  const forces=p.forces||['weight down','normal up']
  const W=300, H=260, cx=150, cy=130
  const fMap={'weight down':{dx:0,dy:65,color:'#7c3aed',label:'W = mg'},'normal up':{dx:0,dy:-65,color:'#dc2626',label:'N'},'friction left':{dx:-65,dy:0,color:'#d97706',label:'f'},'friction right':{dx:65,dy:0,color:'#d97706',label:'F'},'applied right':{dx:70,dy:0,color:'#059669',label:'F'},'applied left':{dx:-70,dy:0,color:'#059669',label:'F'},'tension up':{dx:0,dy:-65,color:'#2563eb',label:'T'},'electric up':{dx:0,dy:-65,color:'#dc2626',label:'qE'},'electric down':{dx:0,dy:65,color:'#dc2626',label:'qE'}}
  let defs='', arrows=''
  const used=new Set()
  for(const f of forces){
    const key=f.toLowerCase(), fd=fMap[key]||{dx:50,dy:0,color:'#374151',label:f}
    const id='bm'+key.replace(/\s/g,'')
    if(!used.has(id)){used.add(id);defs+=`<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="${fd.color}" stroke-width="1.8"/></marker>`}
    const x2=cx+fd.dx, y2=cy+fd.dy
    arrows+=`<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${fd.color}" stroke-width="2.5" marker-end="url(#${id})"/><text x="${cx+fd.dx*1.25}" y="${cy+fd.dy*1.25+4}" font-size="12" fill="${fd.color}" text-anchor="middle" font-style="italic">${fd.label}</text>`
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="white"/>${arrows}<rect x="${cx-22}" y="${cy-22}" width="44" height="44" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="2" rx="5"/><text x="${cx}" y="${cy+5}" font-size="13" fill="#1e40af" text-anchor="middle" font-weight="700">m</text></svg>`
}

function renderDiagramSVG(diag) {
  if(!diag||!diag.type) return null
  const t=diag.type, p=diag.params||{}, desc=(diag.description||'').toLowerCase()
  if(t==='parallel-plates'||desc.includes('plate')) return buildParallelPlatesSVG(p)
  if(t==='magnetic-field'||desc.includes('magnetic')) return buildMagneticFieldSVG(p)
  if(t==='gravitational-field'||desc.includes('gravitational field vs')) return buildGravFieldGraphSVG(p)
  if(t==='two-charges'||desc.includes('point charge')) return buildTwoChargesSVG(p)
  if(t==='free-body'||desc.includes('free body')) return buildFreeBodySVG(p)
  return null
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  let body = {}
  try { body = await parseBody(req) } catch {}

  const { jobId, userId, subjectId, slotNumber, partialPaper, confirmedScope=null, difficultyMode='match', topicsList='', sys='' } = body
  if (!jobId || !userId || !subjectId) { res.status(400).json({ error: 'Missing required fields' }); return }

  const paperKey = `sm:papers:${userId}:${subjectId}`

  async function markFailed(msg) {
    try {
      const pp = await redisGet(paperKey)||[]
      const ii = pp.findIndex(p=>p.id===jobId)
      if(ii>=0){ pp[ii].status='failed'; pp[ii].error=msg; await redisSet(paperKey,pp) }
    } catch {}
  }

  try {
    // Update progress to 75%
    const papers = await redisGet(paperKey)||[]
    const ji = papers.findIndex(p=>p.id===jobId)
    if(ji>=0){ papers[ji].status='generating'; papers[ji].progress=75; await redisSet(paperKey,papers) }

    const subjects = await redisGet(`sm:subjects:${userId}`)||[]
    const subject  = subjects.find(s=>s.id===subjectId)
    if(!subject) throw new Error('Subject not found')

    const { name, examBoard='BSSS' } = subject
    const scopeTerm  = confirmedScope?.term||null
    const scopeType  = confirmedScope?.examType||'exam'
    const levelDesc  = confirmedScope?.levelDescription||`Year ${subject.yearLevel||12} ${examBoard}`
    const allTopics  = topicsList || (confirmedScope?.topics||subject.topics||[]).join(', ') || `General ${name}`

    const sysPrompt  = sys || `You are an expert ${examBoard} exam paper writer for ${name}. Generate realistic exam questions matching actual ${examBoard} past papers. ONLY generate questions on: ${allTopics}. Return ONLY valid JSON arrays.`

    // ── CALL 3: SA Q3+Q4 ─────────────────────────────────────────────────────
    const existingQCount = (partialPaper?.sections||[])
      .flatMap(s=>s.questions||[]).length

    const call3Text = await callClaude(sysPrompt,
`Subject: ${name} | Level: ${levelDesc} | Exam board: ${examBoard}
Topics (ONLY these): ${allTopics}${scopeTerm?` | Scope: ${scopeTerm}`:''}
Difficulty: ${difficultyMode === 'harder' ? 'Slightly harder than past papers — add one extra step per calculation' : difficultyMode === 'exam-plus' ? 'Maximum difficulty — multi-concept synthesis, 3+ steps' : 'Match past paper difficulty exactly'}

Generate exactly 2 more short answer questions (different topics from Q11-Q12 already generated).
RULES:
- Every calculation sub-part MUST include ALL given values in the question text
- Each question: 3-4 sub-parts, total 8-12 marks
- At least one diagram if relevant to the physics
- Parts build — part b uses result from part a

Diagram types: "parallel-plates", "magnetic-field", "gravitational-field", "two-charges", "free-body"

Return ONLY valid JSON array:
[{
  "number":${existingQCount+1},
  "question":"Full scenario with ALL given values",
  "topic":"Topic name",
  "marks":10,
  "diagram":{"type":"gravitational-field","description":"Graph of g vs distance","params":{"bodyName":"Earth","surfaceG":"9.8"}},
  "parts":[{"part":"a","question":"Sub-question with given values","marks":3,"answer":"Full worked solution","markingCriteria":"Award 1 mark for... Award 1 mark for..."}]
}]`, 2800)

    let saQs2 = extractJsonArray(call3Text) || []
    saQs2 = saQs2.map((q,i)=>({...q, number: existingQCount+i+1}))

    // ── CALL 4: Extended response (Section C) ─────────────────────────────────
    const call4Text = await callClaude(sysPrompt,
`Subject: ${name} | Level: ${levelDesc} | Exam board: ${examBoard}
Topics (ONLY these): ${allTopics}${scopeTerm?` | Scope: ${scopeTerm}`:''}
Difficulty: ${difficultyMode === 'exam-plus' ? 'Maximum difficulty' : 'Match past paper difficulty'}

Generate exactly 1 extended response question for Section C.
This is the hardest question — requires synthesis of 2-3 concepts.
Total: 15-20 marks across 5-6 sub-parts.
For Physics: velocity selector (crossed E and B fields), OR orbital mechanics, OR circular motion in B field.
For other subjects: choose the most complex/synthesis topic.

RULES:
- Include ALL given values in the question stem
- Include a diagram if relevant
- Parts a-f build progressively — each uses prior results
- Final part should require evaluation/analysis, not just calculation

Return ONLY valid JSON array with ONE question:
[{
  "number":${existingQCount+saQs2.length+1},
  "question":"Full extended scenario with ALL given values",
  "topic":"Topic name",
  "marks":18,
  "isExtended":true,
  "diagram":{"type":"parallel-plates","description":"Velocity selector setup","params":{"separation":"3.0 cm","voltage":"4500 V","particleCharge":"positive","topPlatePolarity":"positive"}},
  "parts":[{"part":"a","question":"First sub-part","marks":2,"answer":"Solution","markingCriteria":"Award marks for..."}]
}]`, 3000)

    let extQs = extractJsonArray(call4Text) || []
    extQs = extQs.map((q,i)=>({...q, number: existingQCount+saQs2.length+i+1, isExtended:true}))

    // ── Render diagrams ────────────────────────────────────────────────────────
    const renderWithDiagram = (qs) => qs.map(q => {
      if(q.diagram) {
        const svg = renderDiagramSVG(q.diagram)
        if(svg) return { ...q, diagram: { ...q.diagram, svg } }
      }
      return q
    })

    saQs2 = renderWithDiagram(saQs2)
    extQs = renderWithDiagram(extQs)

    // ── Merge with partial paper ───────────────────────────────────────────────
    const paper = partialPaper || { sections: [], diagrams: [] }

    // Add SA Q3+Q4 to Section B
    const sectionB = paper.sections?.find(s=>s.type==='short')
    if(sectionB) {
      sectionB.questions = [...(sectionB.questions||[]), ...saQs2]
      sectionB.marks = sectionB.questions.reduce((s,q)=>s+(q.marks||0),0)
    }

    // Add Section C — Extended Response
    if(extQs.length > 0) {
      const extSection = {
        name: 'Section C: Extended Response',
        type: 'extended',
        marks: extQs.reduce((s,q)=>s+(q.marks||0),0),
        instructions: 'Answer ALL questions. Show all working clearly. Marks are awarded for correct method and working, not just final answers.',
        questions: extQs
      }
      paper.sections = [...(paper.sections||[]), extSection]
    }

    // Recalculate total
    const totalMarks = (paper.sections||[]).reduce((s,sec)=>s+sec.marks,0)
    paper.totalMarks = totalMarks

    // All topics covered
    const topicsCovered = [...new Set(
      (paper.sections||[]).flatMap(s=>s.questions||[]).map(q=>q.topic).filter(Boolean)
    )]

    // Update cover page
    if(paper.coverPage) {
      paper.coverPage.totalMarks = totalMarks
      const secSummary = (paper.sections||[]).map(s=>`${s.name} — ${s.marks} marks`).join(' · ')
      paper.coverPage.sectionSummary = secSummary
    }

    // Save as ready
    const allPapers = await redisGet(paperKey)||[]
    const fi = allPapers.findIndex(p=>p.id===jobId)
    const record = {
      id:jobId, slotNumber, subjectId, subjectName:name,
      levelDescription:levelDesc, examBoard,
      scopeTerm:scopeTerm||null, scopeExamType:scopeType, difficultyMode,
      generatedAt: allPapers[fi]?.generatedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sourceType: allPapers[fi]?.sourceType || 'syllabus',
      docCount: allPapers[fi]?.docCount || 0,
      topicsCovered, status:'ready', progress:100, paper
    }
    if(fi>=0) allPapers[fi]=record; else allPapers.push(record)
    await redisSet(paperKey, allPapers.slice(0,5).sort((a,b)=>a.slotNumber-b.slotNumber))

    console.log(`Paper ${slotNumber} COMPLETE — ${totalMarks} marks | ${topicsCovered.length} topics | SA:${saQs2.length} Ext:${extQs.length}`)

    // Send email notification
    try {
      if(process.env.RESEND_API_KEY) {
        const userData = await redisGet(`sm:profile:${userId}`)
        const email = userData?.email
        if(email) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Student Mastery <papers@datamastery.com.au>',
              to: email,
              subject: `Your ${name} Mock Paper ${slotNumber} is ready`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <h2 style="color:#1D9E75;margin-bottom:8px">Your mock paper is ready! 🎉</h2>
                <p style="color:#374151;margin-bottom:16px"><strong>${name} — Mock Paper ${slotNumber}</strong><br>
                ${totalMarks} marks · ${topicsCovered.slice(0,4).join(', ')}${topicsCovered.length>4?` +${topicsCovered.length-4} more topics`:''}</p>
                <a href="https://studentmastery.datamastery.com.au/mock-paper" style="display:inline-block;background:#1D9E75;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">View paper →</a>
                <p style="color:#9ca3af;font-size:12px;margin-top:24px">Student Mastery — datamastery.com.au</p>
              </div>`
            })
          })
          console.log(`Email sent to ${email}`)
        }
      }
    } catch(emailErr) {
      console.log('Email skipped:', emailErr.message)
    }

    res.status(200).json({ ok:true, jobId, slotNumber, totalMarks, sections: (paper.sections||[]).length })

  } catch(e) {
    console.error('mock-worker-b error:', e.message)
    await markFailed(e.message)
    res.status(500).json({ error: e.message })
  }
}
