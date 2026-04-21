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
  // Auto-close truncated array
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

async function callClaude(systemHint, userPrompt, maxTokens=2000) {
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
      system: systemHint,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0,100)}`)
  const data = await res.json()
  console.log(`Claude: ${data.content?.[0]?.text?.length||0} chars | stop:${data.stop_reason}`)
  return data.content?.[0]?.text || ''
}

function buildDifficultyNote(profile, mode) {
  if (!profile) return 'Standard difficulty — realistic Year 12 exam standard.'
  const base = `Cognitive level: ${profile.cognitiveLevel||'apply'}. Steps per problem: ${profile.stepsPerCalculation||'2-3'}.`
  if (mode==='match')     return `Match difficulty exactly: ${profile.description||'standard'}. ${base}`
  if (mode==='harder')    return `~20% harder than: ${profile.description}. Add one extra step, combine 2 concepts. ${base}`
  if (mode==='exam-plus') return `Maximum difficulty. Multi-concept synthesis, 3+ steps, unfamiliar contexts. ${base}`
  return base
}

// ─── SVG Diagram Builders ────────────────────────────────────────────────────

function buildParallelPlatesSVG(p={}) {
  const sep    = p.separation || '4.0 cm'
  const volts  = p.voltage    || '400 V'
  const charge = p.particleCharge || 'negative'
  const topPos = p.topPlatePolarity || 'positive'
  const W=380, H=280, py1=60, py2=210, px1=80, px2=300
  const pColor = charge==='positive' ? '#dc2626' : '#2563eb'
  const pSym   = charge==='positive' ? '+' : '−'
  const topLbl = topPos==='positive' ? '+ + + + + + +' : '− − − − − − −'
  const botLbl = topPos==='positive' ? '− − − − − − −' : '+ + + + + + +'
  let arrows = ''
  for(let i=0;i<5;i++){
    const ax=px1+20+i*44, ay1=py1+22, ay2=py2-22
    arrows+=`<line x1="${ax}" y1="${ay1}" x2="${ax}" y2="${ay2}" stroke="#6b7280" stroke-width="1.5" marker-end="url(#ea)"/>`
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<defs><marker id="ea" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#6b7280" stroke-width="1.5"/></marker></defs>
<rect width="${W}" height="${H}" fill="white"/>
<rect x="${px1}" y="${py1-12}" width="${px2-px1}" height="12" fill="#374151" rx="2"/>
<text x="${(px1+px2)/2}" y="${py1-20}" font-size="12" fill="#374151" text-anchor="middle" font-weight="600">${topLbl}</text>
<rect x="${px1}" y="${py2}" width="${px2-px1}" height="12" fill="#374151" rx="2"/>
<text x="${(px1+px2)/2}" y="${py2+28}" font-size="12" fill="#374151" text-anchor="middle" font-weight="600">${botLbl}</text>
${arrows}
<text x="${px2+18}" y="${(py1+py2)/2+4}" font-size="14" fill="#374151" font-style="italic">E</text>
<circle cx="${(px1+px2)/2}" cy="${(py1+py2)/2}" r="13" fill="${pColor}" opacity="0.15" stroke="${pColor}" stroke-width="2"/>
<text x="${(px1+px2)/2}" y="${(py1+py2)/2+5}" font-size="15" fill="${pColor}" text-anchor="middle" font-weight="700">${pSym}</text>
<line x1="${px1-8}" y1="${py1}" x2="${px1-8}" y2="${py2}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3,3"/>
<text x="${px1-14}" y="${(py1+py2)/2+4}" font-size="11" fill="#6b7280" text-anchor="end">${sep}</text>
<text x="${W/2}" y="${H-6}" font-size="10" fill="#9ca3af" text-anchor="middle">${volts} between plates · separation ${sep}</text>
</svg>`
}

function buildMagneticFieldSVG(p={}) {
  const rows=p.rows||5, cols=p.cols||7
  const fieldDir=p.fieldDirection||'into-page'
  const pCharge=p.particleCharge||'positive'
  const pVel=p.particleVelocity||'right'
  const cell=44, ox=40, oy=40
  const W=cols*cell+ox*2, H=rows*cell+oy*2+30
  let syms=''
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const cx=ox+c*cell+cell/2, cy=oy+r*cell+cell/2
    if(fieldDir==='into-page'){
      syms+=`<line x1="${cx-8}" y1="${cy-8}" x2="${cx+8}" y2="${cy+8}" stroke="#374151" stroke-width="1.5"/>
<line x1="${cx+8}" y1="${cy-8}" x2="${cx-8}" y2="${cy+8}" stroke="#374151" stroke-width="1.5"/>`
    } else {
      syms+=`<circle cx="${cx}" cy="${cy}" r="3" fill="#374151"/>
<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="#374151" stroke-width="1"/>`
    }
  }
  const px=ox+cell, py=oy+Math.floor(rows/2)*cell+cell/2
  const pColor=pCharge==='positive'?'#dc2626':'#2563eb'
  const pSym=pCharge==='positive'?'+':'−'
  let vx1=px+16,vy1=py,vx2=px+55,vy2=py
  if(pVel==='left'){vx1=px-16;vx2=px-55}
  if(pVel==='up'){vx1=px;vy1=py-16;vx2=px;vy2=py-55}
  if(pVel==='down'){vx1=px;vy1=py+16;vx2=px;vy2=py+55}
  const fieldLbl=fieldDir==='into-page'?'B (into page ×)':'B (out of page •)'
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<defs><marker id="va" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#d97706" stroke-width="1.8"/></marker></defs>
<rect width="${W}" height="${H}" fill="white"/>
${syms}
<circle cx="${px}" cy="${py}" r="13" fill="${pColor}" opacity="0.15" stroke="${pColor}" stroke-width="2"/>
<text x="${px}" y="${py+5}" font-size="15" fill="${pColor}" text-anchor="middle" font-weight="700">${pSym}</text>
<line x1="${vx1}" y1="${vy1}" x2="${vx2}" y2="${vy2}" stroke="#d97706" stroke-width="2.5" marker-end="url(#va)"/>
<text x="${(vx1+vx2)/2}" y="${Math.min(vy1,vy2)-8}" font-size="12" fill="#d97706" text-anchor="middle" font-style="italic">v</text>
<text x="${W/2}" y="${H-8}" font-size="11" fill="#6b7280" text-anchor="middle">${fieldLbl} · ${pCharge} charge</text>
</svg>`
}

function buildGravFieldGraphSVG(p={}) {
  const bodyName=p.bodyName||'Earth', surfaceG=parseFloat(p.surfaceG)||9.8
  const W=400, H=280, ox=65, oy=240, gw=290, gh=190
  let pathD=''
  for(let i=0;i<=80;i++){
    const r=1+i*2/80
    const g=surfaceG/(r*r)
    const x=ox+(r-1)*gw/2, y=oy-(g/surfaceG)*gh
    pathD+=(i===0?'M':'L')+`${x.toFixed(1)},${y.toFixed(1)}`
  }
  let xLbls='', yLbls=''
  for(let i=0;i<=4;i++){
    const x=ox+i*gw/4, rv=(1+i*0.5).toFixed(1)
    xLbls+=`<text x="${x}" y="${oy+18}" font-size="10" fill="#6b7280" text-anchor="middle">${rv}R</text>
<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy+4}" stroke="#d1d5db" stroke-width="1"/>`
  }
  for(let i=0;i<=4;i++){
    const y=oy-i*gh/4, gv=(surfaceG*i/4).toFixed(1)
    yLbls+=`<text x="${ox-8}" y="${y+4}" font-size="10" fill="#6b7280" text-anchor="end">${gv}</text>
<line x1="${ox-4}" y1="${y}" x2="${ox}" y2="${y}" stroke="#d1d5db" stroke-width="1"/>`
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<rect width="${W}" height="${H}" fill="white"/>
${[1,2,3,4].map(i=>`<line x1="${ox}" y1="${oy-i*gh/4}" x2="${ox+gw}" y2="${oy-i*gh/4}" stroke="#f3f4f6" stroke-width="1"/>`).join('')}
<line x1="${ox}" y1="${oy-gh-10}" x2="${ox}" y2="${oy+4}" stroke="#374151" stroke-width="1.5"/>
<line x1="${ox-4}" y1="${oy}" x2="${ox+gw+10}" y2="${oy}" stroke="#374151" stroke-width="1.5"/>
<polygon points="${ox+gw+10},${oy} ${ox+gw+2},${oy-4} ${ox+gw+2},${oy+4}" fill="#374151"/>
<polygon points="${ox},${oy-gh-10} ${ox-4},${oy-gh-2} ${ox+4},${oy-gh-2}" fill="#374151"/>
<line x1="${ox}" y1="${oy-gh}" x2="${ox+gw}" y2="${oy-gh}" stroke="#fca5a5" stroke-width="1" stroke-dasharray="4,3"/>
<path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="${ox}" cy="${oy-gh}" r="4" fill="#dc2626"/>
<text x="${ox+6}" y="${oy-gh-6}" font-size="10" fill="#dc2626">g = ${surfaceG} N/kg at surface</text>
${xLbls}${yLbls}
<text x="${ox+gw/2}" y="${H-4}" font-size="11" fill="#374151" text-anchor="middle">Distance from centre of ${bodyName}</text>
<text x="14" y="${oy-gh/2}" font-size="11" fill="#374151" text-anchor="middle" transform="rotate(-90,14,${oy-gh/2})">g (N/kg)</text>
</svg>`
}

function buildTwoChargesSVG(p={}) {
  const q1=p.q1||'+3.0 μC', q2=p.q2||'−2.0 μC'
  const q1pos=p.q1pos||'x = 0', q2pos=p.q2pos||'x = 0.50 m'
  const pointP=p.pointP||'x = 0.20 m'
  const W=480, H=200, y=100
  const x1=80, x2=380, xP=180
  const c1=q1.includes('-')||q1.includes('−')?'#2563eb':'#dc2626'
  const c2=q2.includes('-')||q2.includes('−')?'#2563eb':'#dc2626'
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<rect width="${W}" height="${H}" fill="white"/>
<line x1="40" y1="${y}" x2="${W-30}" y2="${y}" stroke="#374151" stroke-width="1.5"/>
<polygon points="${W-30},${y} ${W-38},${y-4} ${W-38},${y+4}" fill="#374151"/>
<text x="${W-20}" y="${y+4}" font-size="12" fill="#374151" font-style="italic">x</text>
<circle cx="${x1}" cy="${y}" r="18" fill="${c1}" opacity="0.15" stroke="${c1}" stroke-width="2"/>
<text x="${x1}" y="${y+5}" font-size="13" fill="${c1}" text-anchor="middle" font-weight="700">${q1}</text>
<text x="${x1}" y="${y+36}" font-size="10" fill="#6b7280" text-anchor="middle">${q1pos}</text>
<circle cx="${x2}" cy="${y}" r="18" fill="${c2}" opacity="0.15" stroke="${c2}" stroke-width="2"/>
<text x="${x2}" y="${y+5}" font-size="13" fill="${c2}" text-anchor="middle" font-weight="700">${q2}</text>
<text x="${x2}" y="${y+36}" font-size="10" fill="#6b7280" text-anchor="middle">${q2pos}</text>
<line x1="${xP}" y1="${y-24}" x2="${xP}" y2="${y+24}" stroke="#059669" stroke-width="2" stroke-dasharray="4,3"/>
<circle cx="${xP}" cy="${y}" r="5" fill="#059669"/>
<text x="${xP}" y="${y-30}" font-size="11" fill="#059669" text-anchor="middle" font-weight="600">P</text>
<text x="${xP}" y="${y+40}" font-size="10" fill="#059669" text-anchor="middle">${pointP}</text>
<line x1="${x1}" y1="${y+56}" x2="${x2}" y2="${y+56}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3,3"/>
<text x="${(x1+x2)/2}" y="${y+70}" font-size="10" fill="#9ca3af" text-anchor="middle">separation d</text>
<text x="${W/2}" y="${H-6}" font-size="10" fill="#9ca3af" text-anchor="middle">Not to scale</text>
</svg>`
}

function buildFreeBodySVG(p={}) {
  const forces=p.forces||['weight down','normal up']
  const W=300, H=260, cx=150, cy=130
  const fMap = {
    'weight down':    {dx:0,dy:65,color:'#7c3aed',label:'W = mg'},
    'normal up':      {dx:0,dy:-65,color:'#dc2626',label:'N'},
    'friction left':  {dx:-65,dy:0,color:'#d97706',label:'f'},
    'friction right': {dx:65,dy:0,color:'#d97706',label:'F_applied'},
    'applied right':  {dx:70,dy:0,color:'#059669',label:'F'},
    'applied left':   {dx:-70,dy:0,color:'#059669',label:'F'},
    'tension up':     {dx:0,dy:-65,color:'#2563eb',label:'T'},
    'electric up':    {dx:0,dy:-65,color:'#dc2626',label:'qE'},
    'electric down':  {dx:0,dy:65,color:'#dc2626',label:'qE'},
  }
  let arrows=''
  const used=new Set()
  for(const f of forces){
    const key=f.toLowerCase()
    const fd=fMap[key]||{dx:50,dy:0,color:'#374151',label:f}
    const id='arr'+key.replace(/\s/g,'')
    if(!used.has(id)){
      used.add(id)
      arrows+=`<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="${fd.color}" stroke-width="1.8"/></marker></defs>`
    }
    const x2=cx+fd.dx, y2=cy+fd.dy
    arrows+=`<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${fd.color}" stroke-width="2.5" marker-end="url(#${id})"/>
<text x="${cx+fd.dx*1.25}" y="${cy+fd.dy*1.25+4}" font-size="12" fill="${fd.color}" text-anchor="middle" font-style="italic">${fd.label}</text>`
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<rect width="${W}" height="${H}" fill="white"/>
${arrows}
<rect x="${cx-22}" y="${cy-22}" width="44" height="44" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="2" rx="5"/>
<text x="${cx}" y="${cy+5}" font-size="13" fill="#1e40af" text-anchor="middle" font-weight="700">m</text>
<text x="${W/2}" y="${H-6}" font-size="10" fill="#9ca3af" text-anchor="middle">Free body diagram</text>
</svg>`
}

function buildCircuitSVG(p={}) {
  const V=p.voltage||'12', r1=p.r1||'R₁', r2=p.r2||'R₂', r3=p.r3||'R₃'
  const u=v=>isNaN(v)?v:v+'Ω'
  return `<svg width="420" height="240" viewBox="0 0 420 240" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<rect width="420" height="240" fill="white"/>
<line x1="40" y1="50" x2="380" y2="50" stroke="#222" stroke-width="2"/>
<line x1="380" y1="50" x2="380" y2="200" stroke="#222" stroke-width="2"/>
<line x1="40" y1="200" x2="380" y2="200" stroke="#222" stroke-width="2"/>
<line x1="40" y1="120" x2="40" y2="200" stroke="#222" stroke-width="2"/>
<line x1="40" y1="50" x2="40" y2="88" stroke="#222" stroke-width="2"/>
<line x1="28" y1="88" x2="52" y2="88" stroke="#222" stroke-width="3.5"/>
<line x1="32" y1="100" x2="48" y2="100" stroke="#222" stroke-width="1.5"/>
<line x1="28" y1="110" x2="52" y2="110" stroke="#222" stroke-width="3.5"/>
<line x1="32" y1="120" x2="48" y2="120" stroke="#222" stroke-width="1.5"/>
<line x1="40" y1="120" x2="40" y2="130" stroke="#222" stroke-width="2"/>
<text x="8" y="106" font-size="11" fill="#1a56db" font-weight="700">${V}V</text>
<rect x="140" y="40" width="60" height="20" fill="white" stroke="#374151" stroke-width="2" rx="3"/>
<text x="170" y="54" font-size="11" fill="#374151" text-anchor="middle">${u(r1)}</text>
<circle cx="240" cy="50" r="3" fill="#374151"/>
<line x1="240" y1="50" x2="240" y2="78" stroke="#374151" stroke-width="2"/>
<rect x="220" y="78" width="40" height="18" fill="white" stroke="#374151" stroke-width="2" rx="3"/>
<text x="240" y="91" font-size="11" fill="#374151" text-anchor="middle">${u(r2)}</text>
<line x1="240" y1="96" x2="240" y2="125" stroke="#374151" stroke-width="2"/>
<line x1="240" y1="50" x2="305" y2="50" stroke="#374151" stroke-width="2"/>
<line x1="305" y1="50" x2="305" y2="78" stroke="#374151" stroke-width="2"/>
<rect x="285" y="78" width="40" height="18" fill="white" stroke="#374151" stroke-width="2" rx="3"/>
<text x="305" y="91" font-size="11" fill="#374151" text-anchor="middle">${u(r3)}</text>
<line x1="305" y1="96" x2="305" y2="125" stroke="#374151" stroke-width="2"/>
<line x1="240" y1="125" x2="305" y2="125" stroke="#374151" stroke-width="2"/>
<line x1="240" y1="125" x2="240" y2="200" stroke="#374151" stroke-width="2"/>
<text x="210" y="228" font-size="10" fill="#9ca3af" text-anchor="middle">Circuit diagram (not to scale)</text>
</svg>`
}

function buildWaveSVG(p={}) {
  const wl=p.wavelength||'λ', amp=p.amplitude||'A'
  return `<svg width="380" height="210" viewBox="0 0 380 210" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;background:white;border-radius:8px;border:1px solid #e5e7eb">
<rect width="380" height="210" fill="white"/>
<line x1="30" y1="105" x2="360" y2="105" stroke="#d1d5db" stroke-width="1" stroke-dasharray="5,4"/>
<line x1="28" y1="25" x2="28" y2="185" stroke="#374151" stroke-width="1.5"/>
<path d="M30,105 C55,105 65,38 100,38 S145,172 180,172 S225,38 260,38 S305,172 330,105" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
<defs>
<marker id="lw" viewBox="0 0 10 10" refX="2" refY="5" orient="auto"><path d="M8,0 L0,5 L8,10" fill="none" stroke="#374151" stroke-width="1.5"/></marker>
<marker id="rw" viewBox="0 0 10 10" refX="8" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10" fill="none" stroke="#374151" stroke-width="1.5"/></marker>
<marker id="ua" viewBox="0 0 10 10" refX="8" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10" fill="none" stroke="#dc2626" stroke-width="1.5"/></marker>
<marker id="da" viewBox="0 0 10 10" refX="8" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10" fill="none" stroke="#dc2626" stroke-width="1.5"/></marker>
</defs>
<line x1="100" y1="190" x2="260" y2="190" stroke="#374151" stroke-width="1.5" marker-start="url(#lw)" marker-end="url(#rw)"/>
<text x="180" y="204" font-size="11" fill="#374151" text-anchor="middle" font-style="italic">${wl}</text>
<line x1="348" y1="38" x2="348" y2="105" stroke="#dc2626" stroke-width="1.5" marker-end="url(#ua)"/>
<text x="360" y="74" font-size="11" fill="#dc2626" font-style="italic">${amp}</text>
<text x="14" y="109" font-size="11" fill="#374151">0</text>
</svg>`
}

function renderDiagramSVG(diag) {
  if (!diag || !diag.type) return null
  const t = diag.type, p = diag.params || {}
  const desc = (diag.description||'').toLowerCase()
  if (t==='parallel-plates'  || desc.includes('plate'))        return buildParallelPlatesSVG(p)
  if (t==='magnetic-field'   || desc.includes('magnetic'))      return buildMagneticFieldSVG(p)
  if (t==='gravitational-field' || desc.includes('gravitational field vs')) return buildGravFieldGraphSVG(p)
  if (t==='two-charges'      || desc.includes('point charge'))  return buildTwoChargesSVG(p)
  if (t==='free-body'        || desc.includes('free body'))     return buildFreeBodySVG(p)
  if (t==='circuit'          || desc.includes('circuit'))       return buildCircuitSVG(p)
  if (t==='wave'             || desc.includes('wave'))          return buildWaveSVG(p)
  return null
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  let body = {}
  try { body = await parseBody(req) } catch {}

  const { jobId, userId, subjectId, slotNumber, customInstructions='', confirmedScope=null, difficultyMode='match' } = body
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
    const papers = await redisGet(paperKey)||[]
    const ji = papers.findIndex(p=>p.id===jobId)
    if(ji>=0){ papers[ji].status='generating'; await redisSet(paperKey,papers) }

    const subjects = await redisGet(`sm:subjects:${userId}`)||[]
    const subject  = subjects.find(s=>s.id===subjectId)
    if(!subject) throw new Error('Subject not found')

    const { name, examBoard='BSSS', yearLevel='12' } = subject
    const scopeTopics  = confirmedScope?.topics?.length>0 ? confirmedScope.topics : (subject.topics||[])
    const scopeTerm    = confirmedScope?.term||null
    const scopeType    = confirmedScope?.examType||'exam'
    const levelDesc    = confirmedScope?.levelDescription||`Year ${yearLevel} ${examBoard}`
    const diffProfile  = confirmedScope?.difficultyProfile||null
    const diffNote     = buildDifficultyNote(diffProfile, difficultyMode)
    const topicsList   = scopeTopics.length>0 ? scopeTopics.join(', ') : `General ${name}`
    const sys = `You are an expert ${examBoard} exam paper writer for ${name}. Generate realistic exam questions matching actual ${examBoard} past papers. ONLY generate questions on: ${topicsList}. Return ONLY valid JSON arrays.`

    // Doc context — 800 chars max
    const allDocs = await redisGet(`sm:docs:${userId}:${subjectId}`)||[]
    let docContext=''
    if(allDocs.length>0){
      const chunks=allDocs.flatMap(d=>d.chunks||[])
      let chars=0
      for(const chunk of chunks){
        const c=sanitize(chunk)
        if(chars+c.length>800) break
        docContext+=c+'\n'; chars+=c.length
      }
    }

    // Paper memory — force gap topics into this paper
    const existingPapers = await redisGet(paperKey)||[]
    const coveredTopics = [...new Set(
      existingPapers.filter(p=>p.status==='ready'&&p.id!==jobId).flatMap(p=>p.topicsCovered||[])
    )]
    const gapTopics = scopeTopics.filter(t=>
      !coveredTopics.some(c=>c.toLowerCase().includes(t.toLowerCase().slice(0,8)))
    )
    const memoryNote = coveredTopics.length > 0
      ? `\nPAPER MEMORY — Already covered: ${coveredTopics.join(', ')}.\nMUST prioritise these gap topics in this paper: ${gapTopics.length>0 ? gapTopics.join(', ') : 'fresh angles on all topics'}.`
      : ''

    const ctx = `Subject: ${name} | Level: ${levelDesc} | Exam board: ${examBoard}
Topics (ONLY these): ${topicsList}${scopeTerm?` | Scope: ${scopeTerm}`:''}
Difficulty: ${diffNote}${customInstructions?`\nFocus: ${customInstructions}`:''}${memoryNote}${docContext?`\nPast paper reference:\n${docContext.slice(0,600)}`:''}`

    // ── CALL 1: MCQ ──────────────────────────────────────────────────────────
    const mcqText = await callClaude(sys,
`${ctx}

Generate exactly 10 multiple choice questions for a ${examBoard} ${name} exam.
Rules:
- Each worth 1 mark, 4 options (A/B/C/D)
- Plausible distractors based on common student mistakes
- Include ALL given values needed to solve calculation questions
- ONLY from these topics: ${topicsList}
- Mix: recall (3), application (4), analysis (3)

Return ONLY a valid JSON array — no preamble, no markdown:
[{"number":1,"question":"Full question text with ALL given values","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"B","topic":"Topic name","workingOut":"Solution"}]`, 3500)

    let mcqQs = extractJsonArray(mcqText) || []

    // ── CALL 2: Short answer WITH diagrams ───────────────────────────────────
    const saText = await callClaude(sys,
`${ctx}

Generate exactly 2 short answer questions for a ${examBoard} ${name} exam.
CRITICAL RULES:
- Every calculation sub-part MUST include ALL given values (voltage, separation, mass, charge, field strength etc.) in the question text itself — never assume the student has them
- At least ONE question MUST include a diagram
- Each question: 3-4 sub-parts (a,b,c,d), total 8-12 marks
- Parts must build — part b uses result from part a

Diagram types: "parallel-plates", "magnetic-field", "gravitational-field", "two-charges", "free-body", "circuit", "wave"

Return ONLY a valid JSON array:
[{
  "number":11,
  "question":"Full scenario with ALL given numerical values stated here",
  "topic":"Topic name",
  "marks":10,
  "diagram":{
    "type":"parallel-plates",
    "description":"Two horizontal plates separated by 4.0 cm. Upper plate positive (+), lower plate negative (−). Electron at lower plate.",
    "params":{"separation":"4.0 cm","voltage":"600 V","particleCharge":"negative","topPlatePolarity":"positive"}
  },
  "parts":[{
    "part":"a",
    "question":"Sub-question with any additional given values needed",
    "marks":2,
    "answer":"Full worked solution with units",
    "markingCriteria":"Award 1 mark for [X]. Award 1 mark for [Y]."
  }]
}]`, 2800)

    let saQs = extractJsonArray(saText) || []
    saQs = saQs.map((q,i)=>({...q, number: mcqQs.length+i+1}))

    // ── Render diagrams as SVG ───────────────────────────────────────────────
    const allDiagrams = []
    saQs = saQs.map(q => {
      if (q.diagram) {
        const svg = renderDiagramSVG(q.diagram)
        if (svg) {
          const diagId = allDiagrams.length + 1
          allDiagrams.push({ id: diagId, ...q.diagram, svg })
          return { ...q, diagramId: diagId, diagram: { ...q.diagram, svg } }
        }
      }
      return q
    })

    // ── Assemble paper ───────────────────────────────────────────────────────
    const mcqMarks = mcqQs.length
    const saMarks  = saQs.reduce((s,q)=>s+(q.marks||10),0)
    const total    = mcqMarks + saMarks

    const paper = {
      coverPage: {
        school: 'Narrabundah College', subject: name, level: levelDesc,
        examType: scopeType, mockNumber: slotNumber,
        ...(scopeTerm && { scope: scopeTerm }),
        instructions: [
          'Write in black or blue pen only',
          'Show all working clearly for full marks',
          'Scientific calculator permitted',
          'Phones and all electronic devices must be away'
        ]
      },
      title: `${name} — Mock Paper ${slotNumber}${scopeTerm?` (${scopeTerm})`:''}`,
      subject: name, levelDescription: levelDesc, examBoard,
      scopeTerm: scopeTerm||null, scopeExamType: scopeType, difficultyMode,
      totalMarks: total,
      timeAllowed: confirmedScope?.format?.timeMins ? `${confirmedScope.format.timeMins} minutes` : '60 minutes',
      allowedMaterials: 'Scientific calculator, ruler',
      diagrams: allDiagrams,
      sections: [
        {
          name: 'Section A: Multiple Choice', type: 'mcq', marks: mcqMarks,
          instructions: 'Circle the letter of the best answer. Each question is worth 1 mark.',
          questions: mcqQs.map(q=>({...q, type:'mcq', marks:1, parts:null,
            markingCriteria:`Award 1 mark for ${q.answer}`}))
        },
        {
          name: 'Section B: Short Answer', type: 'short', marks: saMarks,
          instructions: 'Answer ALL questions in the spaces provided. Show all working clearly.',
          questions: saQs.map(q=>({...q, type:'short'}))
        }
      ]
    }

    // Update progress to 50%
    const midPapers = await redisGet(paperKey)||[]
    const mi = midPapers.findIndex(p=>p.id===jobId)
    if(mi>=0){ midPapers[mi].status='generating'; midPapers[mi].progress=50; midPapers[mi].paper=paper; await redisSet(paperKey,midPapers) }

    console.log(`Paper ${slotNumber} 50% — starting calls 3+4...`)

    // ── CALL 3: SA Q3+Q4 ─────────────────────────────────────────────────────
    const existingQCount = (paper.sections||[]).flatMap(s=>s.questions||[]).length

    const call3Text = await callClaude(sys,
`Subject: ${name} | Level: ${levelDesc} | Exam board: ${examBoard}
Topics (ONLY these): ${topicsList}${scopeTerm?` | Scope: ${scopeTerm}`:''}
Difficulty: ${difficultyMode==='harder'?'~20% harder than past papers':difficultyMode==='exam-plus'?'Maximum difficulty — multi-concept synthesis':'Match past paper difficulty exactly'}${memoryNote}

Generate exactly 2 more short answer questions (different topics from SA Q1-Q2 already generated).
RULES:
- ALL given values must be in the question text
- Each question: 3-4 sub-parts, 8-12 marks total
- Include a diagram if relevant
- Parts build — part b uses result from part a

Diagram types: "parallel-plates","magnetic-field","gravitational-field","two-charges","free-body"

Return ONLY valid JSON array:
[{"number":${existingQCount+1},"question":"Full scenario with ALL given values","topic":"Topic","marks":10,"diagram":{"type":"gravitational-field","description":"g vs distance graph","params":{"bodyName":"Earth","surfaceG":"9.8"}},"parts":[{"part":"a","question":"Sub-question","marks":3,"answer":"Solution","markingCriteria":"Award marks for..."}]}]`, 2800)

    let saQs2 = extractJsonArray(call3Text)||[]
    saQs2 = saQs2.map((q,i)=>({...q, number:existingQCount+i+1}))
    saQs2 = saQs2.map(q=>{
      if(q.diagram){ const svg=renderDiagramSVG(q.diagram); if(svg) return{...q,diagram:{...q.diagram,svg}} }
      return q
    })

    // Add to Section B
    const sectionB = paper.sections?.find(s=>s.type==='short')
    if(sectionB){ sectionB.questions=[...(sectionB.questions||[]),...saQs2]; sectionB.marks=sectionB.questions.reduce((s,q)=>s+(q.marks||0),0) }

    // Update progress to 75%
    const p75 = await redisGet(paperKey)||[]
    const p75i = p75.findIndex(p=>p.id===jobId)
    if(p75i>=0){ p75[p75i].progress=75; p75[p75i].paper=paper; await redisSet(paperKey,p75) }

    console.log(`Paper ${slotNumber} 75% — starting call 4 (extended response)...`)

    // ── CALL 4: Section C Extended Response ──────────────────────────────────
    const totalQSoFar = existingQCount + saQs2.length

    const call4Text = await callClaude(sys,
`Subject: ${name} | Level: ${levelDesc} | Exam board: ${examBoard}
Topics (ONLY these): ${topicsList}${scopeTerm?` | Scope: ${scopeTerm}`:''}
Difficulty: ${difficultyMode==='exam-plus'?'Maximum — multi-concept synthesis, 3+ steps':'Match past paper difficulty'}

Generate exactly 1 extended response question for Section C.
This is the hardest question — synthesis of 2-3 concepts, 15-20 marks, 5-6 sub-parts.
For Physics: velocity selector (crossed E and B fields), OR orbital mechanics + circular motion, OR solenoid + force on conductor.
For other subjects: choose the most complex synthesis topic from the scope.
RULES:
- Include ALL given values in question stem
- Include diagram if relevant
- Parts a-f build progressively
- Final part requires evaluation or analysis, not just calculation

Return ONLY valid JSON array with ONE question:
[{"number":${totalQSoFar+1},"question":"Full extended scenario with ALL given values","topic":"Topic","marks":18,"isExtended":true,"diagram":{"type":"parallel-plates","description":"Velocity selector setup","params":{"separation":"3.0 cm","voltage":"4500 V","particleCharge":"positive","topPlatePolarity":"positive"}},"parts":[{"part":"a","question":"First sub-part","marks":2,"answer":"Solution","markingCriteria":"Award marks for..."}]}]`, 3000)

    let extQs = extractJsonArray(call4Text)||[]
    extQs = extQs.map((q,i)=>({...q, number:totalQSoFar+i+1, isExtended:true}))
    extQs = extQs.map(q=>{
      if(q.diagram){ const svg=renderDiagramSVG(q.diagram); if(svg) return{...q,diagram:{...q.diagram,svg}} }
      return q
    })

    // Add Section C
    if(extQs.length>0){
      paper.sections=[...(paper.sections||[]),{
        name:'Section C: Extended Response', type:'extended',
        marks:extQs.reduce((s,q)=>s+(q.marks||0),0),
        instructions:'Answer ALL questions. Show all working clearly. Marks are awarded for correct method and working.',
        questions:extQs
      }]
    }

    // Final total
    const finalTotal = (paper.sections||[]).reduce((s,sec)=>s+sec.marks,0)
    paper.totalMarks = finalTotal
    if(paper.coverPage) paper.coverPage.totalMarks = finalTotal

    const topicsCovered = [...new Set(
      (paper.sections||[]).flatMap(s=>s.questions||[]).map(q=>q.topic).filter(Boolean)
    )]

    // Save as READY at 100%
    const record = {
      id:jobId, slotNumber, subjectId, subjectName:name,
      levelDescription:levelDesc, examBoard,
      scopeTerm:scopeTerm||null, scopeExamType:scopeType, difficultyMode,
      generatedAt:new Date().toISOString(), completedAt:new Date().toISOString(),
      sourceType:allDocs.length>0?'docs':'syllabus', docCount:allDocs.length,
      topicsCovered, status:'ready', progress:100, paper
    }

    const finalPapers = await redisGet(paperKey)||[]
    const fi = finalPapers.findIndex(p=>p.id===jobId)
    if(fi>=0) finalPapers[fi]=record; else finalPapers.push(record)
    await redisSet(paperKey, finalPapers.slice(0,5).sort((a,b)=>a.slotNumber-b.slotNumber))

    console.log(`Paper ${slotNumber} COMPLETE — ${finalTotal} marks | ${topicsCovered.length} topics | ${(paper.sections||[]).length} sections`)

    // Email notification
    try {
      if(process.env.RESEND_API_KEY){
        const userData = await redisGet(`sm:profile:${userId}`)
        const email = userData?.email
        if(email){
          await fetch('https://api.resend.com/emails',{
            method:'POST',
            headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
            body:JSON.stringify({
              from:'Student Mastery <papers@datamastery.com.au>',
              to:email,
              subject:`Your ${name} Mock Paper ${slotNumber} is ready`,
              html:`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#1D9E75">Your mock paper is ready!</h2><p><strong>${name} — Mock Paper ${slotNumber}</strong><br>${finalTotal} marks · ${topicsCovered.slice(0,4).join(', ')}${topicsCovered.length>4?` +${topicsCovered.length-4} more`:''}</p><a href="https://studentmastery.datamastery.com.au/mock-paper" style="display:inline-block;background:#1D9E75;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">View paper →</a></div>`
            })
          })
        }
      }
    } catch(emailErr){ console.log('Email skipped:', emailErr.message) }

    res.status(200).json({ ok:true, jobId, slotNumber, totalMarks:finalTotal, sections:(paper.sections||[]).length })

  } catch(e) {
    console.error('mock-worker error:', e.message)
    await markFailed(e.message)
    res.status(500).json({ error: e.message })
  }
}
