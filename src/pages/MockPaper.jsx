import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  queued:     { label: 'Queued',      color: '#d97706', spin: false },
  generating: { label: 'Generating',  color: 'var(--teal2)', spin: true  },
  failed:     { label: 'Failed',      color: 'var(--red)',   spin: false },
  ready: null
}

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.jpg,.jpeg,.png'
const MAX_FILE_SIZE  = 15 * 1024 * 1024

// ─── Utilities ────────────────────────────────────────────────────────────────

function renderQuestionText(text, diagrams) {
  if (!text) return null
  const parts = []; let remaining = text
  while (remaining.length > 0) {
    const svgStart = remaining.indexOf('[SVG:')
    const refMatch = remaining.match(/\[DIAGRAM_REF:(\d+)\]/)
    const diagStart = remaining.indexOf('[DIAGRAM:')
    const candidates = [
      svgStart >= 0  ? { type:'svg', pos:svgStart } : null,
      refMatch       ? { type:'ref', pos:refMatch.index, match:refMatch } : null,
      diagStart >= 0 ? { type:'diag', pos:diagStart } : null,
    ].filter(Boolean)
    if (candidates.length === 0) { parts.push(<span key={parts.length}>{remaining}</span>); break }
    candidates.sort((a,b) => a.pos - b.pos)
    const first = candidates[0]
    if (first.pos > 0) parts.push(<span key={parts.length}>{remaining.slice(0, first.pos)}</span>)
    if (first.type === 'svg') {
      const end = remaining.indexOf(']', svgStart+5)
      if (end === -1) { parts.push(<span key={parts.length}>{remaining}</span>); break }
      parts.push(<div key={parts.length} style={{margin:'12px 0',padding:'16px',background:'white',borderRadius:8,border:'1px solid var(--border)',display:'flex',justifyContent:'center',overflowX:'auto'}}><div dangerouslySetInnerHTML={{__html:remaining.slice(svgStart+5,end)}}/></div>)
      remaining = remaining.slice(end+1)
    } else if (first.type === 'ref') {
      const diagram = diagrams?.find(d => d.id === parseInt(first.match[1]))
      if (diagram?.svg) parts.push(<div key={parts.length} style={{margin:'12px 0',padding:'16px',background:'white',borderRadius:8,border:'1px solid var(--border)',display:'flex',justifyContent:'center',overflowX:'auto'}}><div dangerouslySetInnerHTML={{__html:diagram.svg}}/></div>)
      remaining = remaining.slice(first.match.index + first.match[0].length)
    } else if (first.type === 'diag') {
      const end = remaining.indexOf(']', diagStart+9)
      if (end === -1) { parts.push(<span key={parts.length}>{remaining}</span>); break }
      parts.push(<DiagramPlaceholder key={parts.length} desc={remaining.slice(diagStart+9,end).trim()}/>)
      remaining = remaining.slice(end+1)
    }
  }
  return parts.length > 0 ? parts : text
}

function DiagramPlaceholder({ desc }) {
  return (
    <div style={{margin:'10px 0',padding:'12px 16px',background:'var(--bg3)',border:'1px dashed var(--border2)',borderRadius:8,fontSize:12,color:'var(--text2)',display:'flex',gap:8}}>
      <span style={{fontSize:16}}>📐</span>
      <div><strong style={{color:'var(--text)',display:'block',marginBottom:2}}>Diagram:</strong>{desc}</div>
    </div>
  )
}

// ─── Stage 1 + 2: Upload + Analyse ───────────────────────────────────────────

function UploadAndAnalyse({ subjectId, subjectDocs, onDocsChange, onAnalyse, analysing, analyseError, getToken }) {
  const [uploading, setUploading] = useState({})
  const [progress, setProgress]   = useState({})
  const [error, setError]         = useState(null)
  const primaryRef = useRef(); const contextRef = useRef()

  const primaryDocs = subjectDocs.filter(d => d.docType !== 'context')
  const contextDocs = subjectDocs.filter(d => d.docType === 'context')
  const hasEnough   = primaryDocs.length > 0

  async function uploadFile(file, role) {
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!ACCEPTED_TYPES.includes(ext)) { setError('Unsupported file type. Use PDF, DOCX, TXT, JPG, PNG'); return }
    if (file.size > MAX_FILE_SIZE) { setError('File too large. Max 15MB.'); return }
    setError(null)
    const isImage = ['.jpg','.jpeg','.png'].includes(ext)
    setUploading(u => ({...u, [role]: true}))
    setProgress(p => ({...p, [role]: isImage ? `Reading ${file.name}...` : `Uploading ${file.name}...`}))
    try {
      const token = await getToken()
      const fd = new FormData()
      fd.append('file', file); fd.append('subjectId', subjectId); fd.append('docType', role)
      const res  = await fetch('/api/ingest-doc', { method:'POST', headers:{Authorization:`Bearer ${token}`}, body:fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setProgress(p => ({...p, [role]: `✓ ${data.chunkCount} chunks from ${file.name}`}))
      setTimeout(() => setProgress(p => ({...p, [role]: null})), 4000)
      onDocsChange?.()
    } catch(e) { setError(e.message) }
    finally { setUploading(u => ({...u, [role]: false})) }
  }

  function handleDrop(e, role) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]; if (file) uploadFile(file, role)
  }

  function DropZone({ role, label, hint, color, inputRef }) {
    const isUploading = uploading[role]
    const prog        = progress[role]
    return (
      <div>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}}/>
          <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{label}</div>
          <div style={{fontSize:11,color:'var(--text3)',marginLeft:'auto'}}>{hint}</div>
        </div>
        <div
          onClick={() => !isUploading && inputRef.current?.click()}
          onDragOver={e=>{e.preventDefault()}}
          onDrop={e=>handleDrop(e, role)}
          style={{border:`2px dashed ${color}40`,borderRadius:10,padding:'14px 16px',textAlign:'center',cursor:isUploading?'not-allowed':'pointer',background:'var(--bg3)',transition:'all .15s',minHeight:70,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:4}}
        >
          <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} onChange={e=>{const f=e.target.files[0];if(f)uploadFile(f,role);e.target.value=''}} style={{display:'none'}}/>
          {isUploading
            ? <div style={{fontSize:12,color}}>{prog}</div>
            : prog
              ? <div style={{fontSize:12,color:'#10b981'}}>{prog}</div>
              : <>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>Drop here or click to browse</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>PDF · DOCX · TXT · JPG · PNG · Max 15MB</div>
                </>
          }
        </div>
        {/* Uploaded files for this role */}
        {subjectDocs.filter(d=>d.docType===role||(role==='past-paper'&&d.docType!=='context'&&!d.docType)).map(d=>(
          <div key={d.id} style={{fontSize:11,color:'var(--text3)',padding:'3px 8px',marginTop:4,background:'var(--bg2)',borderRadius:6,display:'flex',alignItems:'center',gap:6}}>
            <span style={{color}}>✓</span>{d.filename}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:14,padding:22,marginBottom:16}}>
      {/* Stage header */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <div style={{width:28,height:28,borderRadius:'50%',background:'var(--teal-bg)',border:'1px solid var(--teal-border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'var(--teal2)',flexShrink:0}}>1</div>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Upload your documents</div>
          <div style={{fontSize:11,color:'var(--text3)'}}>Past papers define the format. Context material enriches topics only.</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <DropZone role="past-paper" label="Past exam papers" hint="Format + topics" color="var(--teal2)" inputRef={primaryRef}/>
        <DropZone role="context" label="Context / reference" hint="Topics only" color="#7c3aed" inputRef={contextRef}/>
      </div>

      {error && <div style={{fontSize:12,color:'var(--red)',padding:'6px 10px',background:'var(--red-bg)',borderRadius:7,marginBottom:10}}>{error}</div>}

      {/* Analyse button */}
      <div style={{display:'flex',alignItems:'center',gap:12,paddingTop:12,borderTop:'1px solid var(--border)'}}>
        <div style={{flex:1}}>
          {hasEnough
            ? <div style={{fontSize:12,color:'var(--teal2)'}}>✓ {primaryDocs.length} exam paper{primaryDocs.length!==1?'s':''} ready to analyse{contextDocs.length>0?` · ${contextDocs.length} context doc${contextDocs.length!==1?'s':''} for topic enrichment`:''}</div>
            : <div style={{fontSize:12,color:'var(--text3)'}}>Upload at least one past exam paper to continue</div>
          }
        </div>
        <button onClick={onAnalyse} disabled={!hasEnough||analysing} style={{padding:'10px 24px',borderRadius:10,fontSize:13,fontWeight:700,background:hasEnough&&!analysing?'var(--teal)':'var(--bg3)',color:hasEnough&&!analysing?'#fff':'var(--text3)',border:'none',cursor:hasEnough&&!analysing?'pointer':'not-allowed',display:'flex',alignItems:'center',gap:8,whiteSpace:'nowrap',flexShrink:0}}>
          {analysing
            ? <><svg style={{width:14,height:14,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .8s linear infinite'}}/> Analysing...</>
            : '🔍 Analyse papers'
          }
        </button>
      </div>
      {analyseError && <div style={{fontSize:12,color:'var(--red)',marginTop:8,padding:'6px 10px',background:'var(--red-bg)',borderRadius:7}}>{analyseError}</div>}
    </div>
  )
}

// ─── Stage 3: Scope Confirmation ─────────────────────────────────────────────

function ScopeConfirmation({ scope, onConfirm, onReanalyse, analysing, onGenerateNow }) {
  const [term, setTerm]             = useState(scope.term || '')
  const [examType, setExamType]     = useState(scope.examType || '')
  const [topics, setTopics]         = useState((scope.topics || []).join(', '))
  const [timeMins, setTimeMins]     = useState(scope.format?.timeMins || 60)
  const [totalMarks, setTotalMarks] = useState(scope.format?.totalMarks || '')
  const [hasMCQ, setHasMCQ]         = useState(scope.hasMCQ !== false)
  const [difficulty, setDifficulty] = useState('match')
  const [confirmed, setConfirmed]   = useState(false)

  const topicList = topics.split(',').map(t=>t.trim()).filter(Boolean)

  const perPaper  = Math.ceil(topicList.length / 5) || 1
  const arc = Array.from({length:5}, (_,i) => ({
    paper: i+1,
    topics: topicList.slice(i*perPaper, (i+1)*perPaper)
  }))

  function buildConfirmedScope() {
    return {
      term, examType, topics: topicList,
      format: { timeMins:Number(timeMins)||60, totalMarks:Number(totalMarks)||100, sections:scope.format?.sections||[], questionStructure:scope.format?.questionStructure||'', noMCQ:!hasMCQ },
      curriculum: scope.curriculum, confidence: scope.confidence,
      difficultyProfile: scope.difficultyProfile||null, difficultyMode: difficulty,
      levelDescription: scope.levelDescription||'', hasMCQ,
      sectionType: hasMCQ ? 'mcq-and-long-answer' : 'long-answer-only',
      summaryLine: `${term} · ${examType}`,
    }
  }

  async function handleConfirmAndGenerate() {
    const confirmedScope = buildConfirmedScope()
    await onConfirm(confirmedScope)
    onGenerateNow(confirmedScope)
  }

  const inp = {width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--text)',fontSize:13,boxSizing:'border-box'}
  const confidenceColor = scope.confidence==='high' ? 'var(--teal2)' : '#d97706'

  // Format preview
  function FormatPreview() {
    const sections = hasMCQ
      ? [{name:'Section A',sub:'Multiple choice (MCQ)',color:'#7c3aed'},{name:'Section B',sub:'Short answer',color:'var(--teal2)'},{name:'Section C',sub:'Extended response',color:'#d97706'}]
      : [{name:'Questions 1–5',sub:'Multi-part (a)(b)(c)(d)',color:'var(--teal2)'},{name:'Final Q',sub:'Extended synthesis',color:'#d97706'}]
    return (
      <div style={{display:'flex',gap:6}}>
        {sections.map((s,i) => (
          <div key={i} style={{flex:1,background:'var(--bg2)',border:`1px solid ${s.color}30`,borderRadius:8,padding:'8px 10px',borderTop:`3px solid ${s.color}`}}>
            <div style={{fontSize:11,fontWeight:600,color:s.color}}>{s.name}</div>
            <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>{s.sub}</div>
          </div>
        ))}
      </div>
    )
  }

  if (confirmed) {
    // Stage 3b: Paper plan — show arc then generate
    return (
      <div style={{background:'var(--bg2)',border:'2px solid var(--teal-border)',borderRadius:14,padding:24,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:'var(--teal-bg)',border:'2px solid var(--teal2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>✓</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>Your exam format understood</div>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{topicList.length} topics · {hasMCQ?'MCQ + short answer + extended':'Long answer only'} · {timeMins} min · {totalMarks||'~'} marks</div>
          </div>
        </div>

        {/* 5-paper coverage arc */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>5-paper topic coverage plan</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
            {arc.map(({paper,topics:pt}) => (
              <div key={paper} style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 10px',borderTop:'3px solid var(--teal-border)'}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--teal2)',marginBottom:6}}>Mock {paper}</div>
                {pt.length>0
                  ? pt.map(t=><div key={t} style={{fontSize:9,color:'var(--text3)',lineHeight:1.6}}>→ {t.length>24?t.slice(0,24)+'…':t}</div>)
                  : <div style={{fontSize:9,color:'var(--text3)'}}>Gap revision + harder angles</div>
                }
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:'var(--text3)',marginTop:8}}>Each paper uses gap tracking — topics not yet tested get prioritised in the next paper.</div>
        </div>

        <div style={{display:'flex',gap:10}}>
          <button onClick={handleConfirmAndGenerate} style={{flex:1,padding:'13px 0',borderRadius:10,fontSize:15,fontWeight:700,background:'var(--teal)',color:'#fff',border:'none',cursor:'pointer'}}>
            🚀 Generate Mock Paper 1
          </button>
          <button onClick={()=>setConfirmed(false)} style={{padding:'13px 16px',borderRadius:10,fontSize:13,background:'var(--bg3)',color:'var(--text2)',border:'1px solid var(--border)',cursor:'pointer'}}>
            ← Edit
          </button>
        </div>
      </div>
    )
  }

  // Stage 3a: Review detected format
  return (
    <div style={{background:'var(--bg2)',border:'2px solid var(--teal-border)',borderRadius:14,padding:24,marginBottom:16}}>

      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,borderRadius:'50%',background:'var(--teal-bg)',border:'1px solid var(--teal-border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'var(--teal2)',flexShrink:0}}>2</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Confirm what I understood about your exam</div>
            <div style={{fontSize:11,color:'var(--text3)'}}>Format from: {scope.docNames?.slice(0,2).join(', ')}{scope.docNames?.length>2?` +${scope.docNames.length-2} more`:''}
              {scope.ignoredDocNames?.length>0 && <span style={{color:'#d97706'}}> · {scope.ignoredDocNames.length} solution sheet{scope.ignoredDocNames.length>1?'s':''} ignored</span>}
              {scope.contextDocNames?.length>0 && <span style={{color:'#7c3aed'}}> · {scope.contextDocNames.length} context doc{scope.contextDocNames.length>1?'s':''} used for topics</span>}
            </div>
          </div>
        </div>
        <div style={{fontSize:11,padding:'3px 10px',borderRadius:10,background:scope.confidence==='high'?'var(--teal-bg)':'rgba(217,119,6,0.1)',color:confidenceColor,border:`1px solid ${confidenceColor}40`,flexShrink:0,marginLeft:12}}>
          {scope.confidence} confidence
        </div>
      </div>

      {scope.confidenceReason && (
        <div style={{fontSize:12,color:'var(--text2)',padding:'8px 12px',borderRadius:8,background:'var(--bg3)',marginBottom:16,borderLeft:`3px solid ${confidenceColor}`}}>
          {scope.confidenceReason}
        </div>
      )}

      {/* Format detection — most critical */}
      <div style={{background:'var(--bg3)',borderRadius:10,padding:'14px 16px',marginBottom:14,border:'1px solid var(--border)'}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:10}}>Detected exam format — is this right?</div>
        <FormatPreview />
        <div style={{display:'flex',gap:8,marginTop:12}}>
          {[{val:false,label:'Long answer only',desc:'Multi-part questions, no MCQ'},{val:true,label:'MCQ + Long answer',desc:'Multiple choice + written sections'}].map(opt => (
            <button key={String(opt.val)} onClick={()=>setHasMCQ(opt.val)} style={{flex:1,padding:'9px 12px',borderRadius:8,textAlign:'left',cursor:'pointer',border:hasMCQ===opt.val?'2px solid var(--teal2)':'1px solid var(--border)',background:hasMCQ===opt.val?'var(--teal-bg)':'var(--bg2)'}}>
              <div style={{fontSize:12,fontWeight:600,color:hasMCQ===opt.val?'var(--teal2)':'var(--text)',marginBottom:2}}>{opt.label}</div>
              <div style={{fontSize:10,color:'var(--text3)'}}>{opt.desc}</div>
            </button>
          ))}
        </div>
        {scope.format?.questionStructure && (
          <div style={{marginTop:10,fontSize:11,color:'var(--text3)',padding:'5px 10px',background:'var(--bg2)',borderRadius:6}}>Style: {scope.format.questionStructure}</div>
        )}
      </div>

      {/* Term + exam type + marks + time */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
        <div>
          <label style={{fontSize:11,color:'var(--text3)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.05em'}}>Term / Period</label>
          <input style={inp} value={term} onChange={e=>setTerm(e.target.value)} placeholder="e.g. SMO5 Statistics, Term 1"/>
          {scope.termOptions?.length>0 && <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>{scope.termOptions.slice(0,4).map(t=><button key={t} onClick={()=>setTerm(t)} style={{fontSize:10,padding:'2px 8px',borderRadius:8,background:term===t?'var(--teal)':'var(--bg3)',color:term===t?'#fff':'var(--text3)',border:term===t?'none':'1px solid var(--border)',cursor:'pointer'}}>{t}</button>)}</div>}
        </div>
        <div>
          <label style={{fontSize:11,color:'var(--text3)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.05em'}}>Exam type</label>
          <input style={inp} value={examType} onChange={e=>setExamType(e.target.value)} placeholder="e.g. unit test, final exam"/>
          {scope.examTypeOptions?.length>0 && <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>{scope.examTypeOptions.slice(0,4).map(t=><button key={t} onClick={()=>setExamType(t)} style={{fontSize:10,padding:'2px 8px',borderRadius:8,background:examType===t?'var(--teal)':'var(--bg3)',color:examType===t?'#fff':'var(--text3)',border:examType===t?'none':'1px solid var(--border)',cursor:'pointer'}}>{t}</button>)}</div>}
        </div>
        <div>
          <label style={{fontSize:11,color:'var(--text3)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.05em'}}>Time (minutes)</label>
          <input style={inp} type="number" value={timeMins} onChange={e=>setTimeMins(e.target.value)} placeholder="60"/>
        </div>
        <div>
          <label style={{fontSize:11,color:'var(--text3)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.05em'}}>Total marks</label>
          <input style={inp} type="number" value={totalMarks} onChange={e=>setTotalMarks(e.target.value)} placeholder="77"/>
        </div>
      </div>

      {/* Topics */}
      <div style={{marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
          <label style={{fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Topics to test</label>
          <span style={{fontSize:10,color:'var(--teal2)',fontWeight:600}}>{topicList.length} detected · tap × to remove</span>
        </div>
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:6}}>
          {topicList.map((t,i) => (
            <span key={i} onClick={()=>setTopics(topicList.filter((_,j)=>j!==i).join(', '))} style={{fontSize:10,padding:'3px 10px',borderRadius:10,background:'var(--teal-bg)',color:'var(--teal2)',border:'1px solid var(--teal-border)',cursor:'pointer',userSelect:'none'}}>
              {t} ×
            </span>
          ))}
        </div>
        <textarea style={{...inp,height:60,resize:'vertical',lineHeight:1.5}} value={topics} onChange={e=>setTopics(e.target.value)} placeholder="Add or edit topics, comma separated..."/>
      </div>

      {/* Difficulty */}
      <div style={{marginBottom:18}}>
        <label style={{fontSize:11,color:'var(--text3)',display:'block',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.05em'}}>Mock difficulty</label>
        {scope.difficultyProfile?.description && <div style={{fontSize:11,color:'var(--text3)',marginBottom:8,padding:'5px 10px',background:'var(--bg3)',borderRadius:6}}>Detected: {scope.difficultyProfile.description} · {scope.difficultyProfile.stepsPerCalculation} steps/problem</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
          {[{v:'match',l:'Match exactly',d:'Same as your past papers'},{v:'harder',l:'Slightly harder',d:'~20% more challenging'},{v:'exam-plus',l:'Exam-plus',d:'Maximum difficulty'}].map(o => (
            <button key={o.v} onClick={()=>setDifficulty(o.v)} style={{padding:'9px 10px',borderRadius:10,textAlign:'left',cursor:'pointer',border:difficulty===o.v?'2px solid var(--teal2)':'1px solid var(--border)',background:difficulty===o.v?'var(--teal-bg)':'var(--bg3)'}}>
              <div style={{fontSize:11,fontWeight:600,color:difficulty===o.v?'var(--teal2)':'var(--text)',marginBottom:2}}>{o.l}</div>
              <div style={{fontSize:10,color:'var(--text3)'}}>{o.d}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{display:'flex',gap:10}}>
        <button onClick={()=>setConfirmed(true)} style={{flex:1,padding:'11px 0',borderRadius:10,fontSize:14,fontWeight:700,background:'var(--teal)',color:'#fff',border:'none',cursor:'pointer'}}>
          Looks right — show my 5-paper plan →
        </button>
        <button onClick={onReanalyse} disabled={analysing} style={{padding:'11px 16px',borderRadius:10,fontSize:13,background:'var(--bg3)',color:'var(--text2)',border:'1px solid var(--border)',cursor:analysing?'not-allowed':'pointer'}}>
          {analysing?'Analysing...':'Re-analyse'}
        </button>
      </div>
    </div>
  )
}

// ─── Stage 5: Post-generation comparison card ─────────────────────────────────

function ComparisonCard({ comparison, docCount }) {
  if (!comparison) return null
  const { overallMatch, topicCoveragePercent, formatMatchPercent, coveredTopics, gapTopics, strikeRate } = comparison
  const isGreat = overallMatch >= 90
  return (
    <div style={{background:'var(--bg2)',border:`1px solid ${isGreat?'rgba(16,185,129,0.3)':'rgba(217,119,6,0.3)'}`,borderRadius:14,padding:'18px 22px',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>How this paper compares to your past papers</div>
          <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>Based on {docCount||'your'} uploaded past paper{docCount!==1?'s':''}</div>
        </div>
        <div style={{textAlign:'center',marginLeft:16,flexShrink:0}}>
          <div style={{fontSize:36,fontWeight:700,color:isGreat?'#10b981':'#d97706',lineHeight:1}}>{overallMatch}%</div>
          <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>{strikeRate}</div>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
        {[{l:'Topic coverage',v:topicCoveragePercent,c:'#10b981'},{l:'Format match',v:formatMatchPercent,c:'#2563eb'}].map(({l,v,c}) => (
          <div key={l}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text2)',marginBottom:4}}><span>{l}</span><span style={{fontWeight:600}}>{v}%</span></div>
            <div style={{height:5,background:'var(--border)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${v}%`,background:c,borderRadius:3}}/></div>
          </div>
        ))}
      </div>
      {coveredTopics?.length>0 && (
        <div style={{marginBottom:8}}>
          <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>Covered in this paper:</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{coveredTopics.map(t=><span key={t} style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.25)',color:'#10b981'}}>✓ {t}</span>)}</div>
        </div>
      )}
      {gapTopics?.length>0 && (
        <div>
          <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>Queued for next paper:</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{gapTopics.map(t=><span key={t} style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.25)',color:'#d97706'}}>→ {t}</span>)}</div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MockPaper() {
  const { getToken } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()

  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [subjectPapers, setSubjectPapers]         = useState([])
  const [loadingPapers, setLoadingPapers]         = useState(false)
  const [submitting, setSubmitting]               = useState(false)
  const [error, setError]                         = useState(null)
  const [customInstructions, setCustomInstructions] = useState('')
  const [viewingPaper, setViewingPaper]           = useState(null)
  const [showAnswers, setShowAnswers]             = useState({})
  const [confirmReplace, setConfirmReplace]       = useState(null)
  const [subjectDocs, setSubjectDocs]             = useState([])
  const [scope, setScope]                         = useState(null)
  const [analysing, setAnalysing]                 = useState(false)
  const [analyseError, setAnalyseError]           = useState(null)
  const [slotsExhausted, setSlotsExhausted]       = useState(false)
  const pollRef = useRef(null)

  useEffect(() => { getToken().then(t => fetchSubjects(t)); return () => clearInterval(pollRef.current) }, [])

  useEffect(() => {
    clearInterval(pollRef.current)
    setError(null); setSlotsExhausted(false); setScope(null); setSubjectDocs([])
    if (selectedSubjectId) { loadSubjectPapers(); loadSubjectDocs(); loadScope() }
  }, [selectedSubjectId])

  useEffect(() => {
    const pending = subjectPapers.filter(p => p.status==='queued'||p.status==='generating')
    clearInterval(pollRef.current)
    if (pending.length > 0) {
      pollRef.current = setInterval(async () => {
        const token = await getToken()
        const res = await fetch(`/api/papers?subjectId=${selectedSubjectId}`, {headers:{Authorization:`Bearer ${token}`}})
        if (res.ok) { const d = await res.json(); setSubjectPapers(d.papers||[]) }
      }, 8000)
    }
    return () => clearInterval(pollRef.current)
  }, [subjectPapers, selectedSubjectId])

  async function loadSubjectPapers() {
    setLoadingPapers(true)
    try { const token=await getToken(); const res=await fetch(`/api/papers?subjectId=${selectedSubjectId}`,{headers:{Authorization:`Bearer ${token}`}}); if(res.ok){const d=await res.json();setSubjectPapers(d.papers||[])} } finally { setLoadingPapers(false) }
  }

  async function loadSubjectDocs() {
    try { const token=await getToken(); const res=await fetch(`/api/docs?subjectId=${selectedSubjectId}`,{headers:{Authorization:`Bearer ${token}`}}); if(res.ok){const d=await res.json();setSubjectDocs(d.docs||[])} } catch {}
  }

  async function loadScope() {
    try { const token=await getToken(); const res=await fetch(`/api/docs?subjectId=${selectedSubjectId}&action=scope`,{headers:{Authorization:`Bearer ${token}`}}); if(res.ok){const d=await res.json();setScope(d.scope||null)} } catch {}
  }

  async function runAnalysis() {
    setAnalysing(true); setAnalyseError(null)
    try {
      const token = await getToken()
      const res  = await fetch(`/api/docs?subjectId=${selectedSubjectId}&action=analyse`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}})
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Analysis failed')
      setScope(data.scope)
    } catch(e) { setAnalyseError(e.message) }
    finally { setAnalysing(false) }
  }

  async function confirmScope(editedScope) {
    try {
      const token = await getToken()
      const res  = await fetch(`/api/docs?subjectId=${selectedSubjectId}&action=scope`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({confirmedScope:editedScope})})
      const data = await res.json()
      if (res.ok) setScope(data.scope)
    } catch {}
  }

  async function generate(replaceSlot=null) {
    setSubmitting(true); setError(null); setSlotsExhausted(false); setConfirmReplace(null)
    try {
      const token = await getToken()
      const res  = await fetch('/api/generate-mock',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({subjectId:selectedSubjectId,customInstructions,replaceSlot,confirmedScope:scope||null,difficultyMode:scope?.difficultyMode||'match'})})
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed to queue paper')
      if (data.slotsExhausted) { setSlotsExhausted(true); return }
      await loadSubjectPapers()
    } catch(e) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  async function generateWithScope(confirmedScopeOverride) {
    setSubmitting(true); setError(null); setSlotsExhausted(false)
    try {
      const token = await getToken()
      const res  = await fetch('/api/generate-mock',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({subjectId:selectedSubjectId,customInstructions,confirmedScope:confirmedScopeOverride,difficultyMode:confirmedScopeOverride?.difficultyMode||'match'})})
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed to queue paper')
      if (data.slotsExhausted) { setSlotsExhausted(true); return }
      await loadSubjectPapers()
    } catch(e) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  async function clearOrphans() {
    try {
      const token = await getToken()
      const stuck = subjectPapers.filter(p => p.status === 'queued' || p.status === 'generating')
      for (const p of stuck) {
        await fetch(`/api/papers?subjectId=${selectedSubjectId}&paperId=${p.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        })
      }
      await loadSubjectPapers()
    } catch(e) { setError(e.message) }
  }

  async function deletePaper(paperId) {
    try { const token=await getToken(); await fetch(`/api/papers?subjectId=${selectedSubjectId}&paperId=${paperId}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}}); await loadSubjectPapers() } catch {}
  }

  function toggleAnswer(sIdx,qIdx) { setShowAnswers(a=>({...a,[`${sIdx}-${qIdx}`]:!a[`${sIdx}-${qIdx}`]})) }

  const sel = {width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--text)',fontSize:13,cursor:'pointer',appearance:'none'}

  // ── Paper viewer ────────────────────────────────────────────────────────────
  if (viewingPaper) {
    const { paper, slotNumber, comparison, docCount } = viewingPaper
    return (
      <div style={{maxWidth:900}}>
        <style>{`@media print{.no-print{display:none!important}}`}</style>
        <div style={{display:'flex',gap:10,marginBottom:16,alignItems:'center'}} className="no-print">
          <button onClick={()=>setViewingPaper(null)} style={{background:'none',border:'1px solid var(--border)',borderRadius:8,padding:'7px 14px',color:'var(--text2)',cursor:'pointer',fontSize:13}}>← Back</button>
          <div style={{flex:1,fontSize:13,fontWeight:600,color:'var(--text)'}}>{paper.title}</div>
          <button onClick={()=>window.print()} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'7px 14px',color:'var(--text2)',cursor:'pointer',fontSize:13}}>🖨 Print</button>
        </div>

        {/* Stage 5: Comparison scorecard */}
        <ComparisonCard comparison={comparison} docCount={docCount}/>

        {/* Paper content */}
        <div style={{background:'var(--bg2)',border:'2px solid var(--border)',borderRadius:14,padding:'36px 40px',marginBottom:16}}>
          <div style={{textAlign:'center',borderBottom:'3px double var(--border)',paddingBottom:20,marginBottom:20}}>
            <div style={{fontSize:11,letterSpacing:'0.2em',textTransform:'uppercase',color:'var(--text3)',marginBottom:6}}>Australian Capital Territory</div>
            <div style={{fontSize:28,fontWeight:800,color:'var(--text)',letterSpacing:'-0.5px',marginBottom:4}}>{paper.coverPage?.school||'Student Mastery'}</div>
            <div style={{width:60,height:3,background:'var(--teal)',margin:'10px auto',borderRadius:2}}/>
            <div style={{fontSize:18,fontWeight:600,color:'var(--text)',marginTop:10}}>{paper.subject} — Year</div>
            <div style={{fontSize:13,color:'var(--text2)',marginTop:4}}>{paper.examBoard} Mock Examination — Paper {slotNumber}</div>
            {paper.scopeTerm&&<div style={{fontSize:12,color:'var(--teal2)',marginTop:4,fontWeight:600}}>Scope: {paper.scopeTerm} · {paper.scopeExamType}</div>}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,margin:'20px 0'}}>
              {[{label:'Total marks',value:paper.totalMarks},{label:'Time allowed',value:paper.timeAllowed||'60 minutes'},{label:'Permitted materials',value:paper.allowedMaterials||'Scientific calculator, ruler'}].map(({label,value})=>(
                <div key={label} style={{background:'var(--bg3)',borderRadius:8,padding:'10px 14px',border:'1px solid var(--border)'}}>
                  <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:4}}>{label}</div>
                  <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{textAlign:'left',fontSize:12,color:'var(--text2)',marginTop:8}}>
              <div style={{fontWeight:600,marginBottom:4}}>Instructions to candidates</div>
              {(paper.coverPage?.instructions||['Write in black or blue pen only','Show all working clearly for full marks']).map((inst,i)=><div key={i} style={{marginBottom:3}}>• {inst}</div>)}
            </div>
            {paper.sections?.map(s=><div key={s.name} style={{fontSize:12,color:'var(--text2)',marginTop:4}}>• {s.name} — {s.marks} marks</div>)}
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,fontSize:12,color:'var(--text3)'}}>
            <span>Full name ___________________________</span>
            <span>Teacher ___________________________</span>
            <span>Date _______________</span>
          </div>

          {(paper.sections||[]).map((section,sIdx) => (
            <div key={sIdx} style={{marginBottom:32}}>
              <div style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
                <div style={{fontSize:16,fontWeight:700,color:'var(--text)',marginBottom:4}}>{section.name}</div>
                <div style={{fontSize:12,color:'var(--text3)',marginBottom:2}}>{section.instructions}</div>
                <div style={{fontSize:12,color:'var(--teal2)',fontWeight:600}}>{section.marks} marks</div>
              </div>
              {(section.questions||[]).map((q,qIdx) => (
                <div key={qIdx} style={{marginBottom:20,padding:'16px 18px',background:'var(--bg3)',borderRadius:10,border:'1px solid var(--border)'}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:10}}>
                    <div style={{width:28,height:28,borderRadius:'50%',background:'var(--bg2)',border:'1px solid var(--border2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'var(--text)',flexShrink:0}}>
                      {q.type==='mcq'?q.number:`Q${q.number}`}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:'var(--text)',marginBottom:6,lineHeight:1.6}}>{renderQuestionText(q.question, paper.diagrams)}</div>
                      {q.diagram?.svg && (
                        <div style={{margin:'12px 0',padding:'16px',background:'white',borderRadius:10,border:'1px solid var(--border)',display:'flex',justifyContent:'center',overflowX:'auto'}}>
                          <div dangerouslySetInnerHTML={{__html:q.diagram.svg}}/>
                        </div>
                      )}
                      {q.diagram&&!q.diagram.svg&&q.diagram.description&&<DiagramPlaceholder desc={q.diagram.description}/>}
                      {q.parts&&q.parts.map((part,pIdx)=>(
                        <div key={pIdx} style={{marginLeft:16,marginBottom:12}}>
                          <div style={{fontSize:13,color:'var(--text)',marginBottom:6}}>
                            <strong>{String.fromCharCode(97+pIdx)})</strong>{' '}{renderQuestionText(part.question, paper.diagrams)}
                            <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>[{part.marks} {part.marks!==1?'marks':'mark'}]</span>
                          </div>
                          <div style={{border:'1px solid var(--border)',borderRadius:6,height:part.marks>2?80:44,background:'var(--bg2)',marginBottom:4}}/>
                        </div>
                      ))}
                      {q.options&&!q.parts&&(
                        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
                          {q.options.map((opt,i)=><div key={i} style={{fontSize:13,color:'var(--text)',padding:'8px 12px',borderRadius:8,background:'var(--bg2)',border:'1px solid var(--border)'}}>{opt}</div>)}
                        </div>
                      )}
                      {q.type!=='mcq'&&!q.parts&&<div style={{border:'1px solid var(--border)',borderRadius:8,height:q.isExtended?120:60,background:'var(--bg2)',marginBottom:8}}/>}
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8}}>
                        <div style={{display:'flex',gap:8}}>
                          <span style={{fontSize:11,color:'var(--text3)',background:'var(--bg2)',padding:'2px 10px',borderRadius:10,border:'1px solid var(--border)'}}>{q.marks} {q.marks===1?'mark':'marks'}</span>
                          {q.topic&&<span style={{fontSize:11,color:'var(--text3)'}}>{q.topic}</span>}
                        </div>
                        <button onClick={()=>toggleAnswer(sIdx,qIdx)} style={{fontSize:12,color:'var(--teal2)',background:'none',border:'none',cursor:'pointer'}}>
                          {showAnswers[`${sIdx}-${qIdx}`]?'Hide answer ↑':'Show answer ↓'}
                        </button>
                      </div>
                      {showAnswers[`${sIdx}-${qIdx}`]&&(
                        <div style={{marginTop:10,background:'var(--teal-bg)',border:'1px solid var(--teal-border)',borderRadius:10,padding:'14px 18px'}}>
                          {q.answer&&<div style={{fontSize:13,fontWeight:600,color:'var(--teal2)',marginBottom:6}}>Answer: {q.answer}</div>}
                          {q.workingOut&&<div style={{fontSize:12,color:'var(--text)',lineHeight:1.8,marginBottom:6,fontFamily:'monospace',background:'var(--bg3)',padding:'8px 12px',borderRadius:6}}>{q.workingOut}</div>}
                          {q.parts&&q.parts.map((pt,pi)=>(
                            <div key={pi} style={{marginBottom:8}}>
                              <div style={{fontSize:12,fontWeight:600,color:'var(--teal2)'}}>Part {String.fromCharCode(97+pi)}) {pt.marks} marks</div>
                              <div style={{fontSize:12,color:'var(--text)',lineHeight:1.7}}>{pt.answer}</div>
                              {pt.markingCriteria&&<div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>{pt.markingCriteria}</div>}
                            </div>
                          ))}
                          {q.markingCriteria&&!q.parts&&<div style={{fontSize:12,color:'var(--text2)',lineHeight:1.6}}><strong>Marking:</strong> {q.markingCriteria}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Main page ───────────────────────────────────────────────────────────────
  const selectedSubject  = subjects.find(s => s.id === selectedSubjectId)
  const readyPapers      = subjectPapers.filter(p => p.status==='ready')
  const pendingPapers    = subjectPapers.filter(p => p.status==='queued'||p.status==='generating')
  const scopeConfirmed   = scope?.confirmed === true
  const hasDocs          = subjectDocs.length > 0
  const hasScopePending  = hasDocs && scope && !scopeConfirmed
  const allScopeTopics   = scope?.topics || []

  return (
    <div style={{maxWidth:900}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
      <div style={{marginBottom:24}}><h1 style={{fontSize:22,fontWeight:700,color:'var(--text)'}}>Mock paper generator</h1><div style={{fontSize:13,color:'var(--text3)',marginTop:4}}>Upload your past papers · AI mirrors the format exactly · Practice with realistic mock exams</div></div>

      {/* Subject selector */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:14,padding:20,marginBottom:16}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'end'}}>
          <div>
            <label style={{fontSize:12,color:'var(--text2)',display:'block',marginBottom:6}}>Select subject</label>
            <select value={selectedSubjectId} onChange={e=>setSelectedSubjectId(e.target.value)} style={sel}>
              <option value="">Choose a subject...</option>
              {subjects.map(s=><option key={s.id} value={s.id}>{s.name} — {s.examBoard} Year {s.yearLevel}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:12,color:'var(--text2)',display:'block',marginBottom:6}}>Custom focus (optional)</label>
            <input type="text" value={customInstructions} onChange={e=>setCustomInstructions(e.target.value)} placeholder="e.g. More on integration, harder extended response..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--text)',fontSize:13,boxSizing:'border-box'}}/>
          </div>
        </div>
        {selectedSubject&&<div style={{marginTop:10,fontSize:12,color:'var(--text3)'}}>{selectedSubject.state} · {selectedSubject.examBoard} · Year {selectedSubject.yearLevel}</div>}
      </div>

      {selectedSubjectId && (<>

        {/* Stage 1+2: Upload + Analyse — hide only when scope confirmed AND papers already exist */}
        {(!scopeConfirmed || subjectPapers.length === 0) && (
          <UploadAndAnalyse
            subjectId={selectedSubjectId}
            subjectDocs={subjectDocs}
            onDocsChange={loadSubjectDocs}
            onAnalyse={runAnalysis}
            analysing={analysing}
            analyseError={analyseError}
            getToken={getToken}
          />
        )}

        {/* Stage 3: Scope confirmation */}
        {hasScopePending && (
          <ScopeConfirmation
            scope={scope}
            onConfirm={confirmScope}
            onReanalyse={runAnalysis}
            analysing={analysing}
            onGenerateNow={generateWithScope}
          />
        )}

        {/* Confirmed scope badge */}
        {scopeConfirmed && (
          <div style={{background:'var(--bg2)',border:'1px solid var(--teal-border)',borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontSize:20}}>✓</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--teal2)'}}>{scope.summaryLine||scope.term}</div>
              <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>{scope.topics?.length} topics · {scope.hasMCQ===false?'Long answer only':'MCQ + Long answer'} · {scope.format?.timeMins||60} min</div>
            </div>
            <button onClick={async()=>{const t=await getToken();await fetch(`/api/docs?subjectId=${selectedSubjectId}&action=scope`,{method:'DELETE',headers:{Authorization:`Bearer ${t}`}});setScope(null)}} style={{fontSize:11,padding:'4px 12px',borderRadius:8,background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text3)',cursor:'pointer'}}>
              Re-analyse
            </button>
          </div>
        )}

        {error && <div style={{padding:'10px 14px',background:'var(--red-bg)',border:'1px solid rgba(220,38,38,0.3)',borderRadius:10,fontSize:13,color:'var(--red)',marginBottom:16}}>{error}</div>}

        {/* Stage 4: Papers grid — show if papers exist OR scope confirmed */}
        {(scopeConfirmed || subjectPapers.length > 0) && (
          <>
            {/* Pending banner */}
            {pendingPapers.length>0&&(
              <div style={{background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.3)',borderRadius:12,padding:'12px 16px',marginBottom:16}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:'#d97706',marginBottom:4}}>
                      {pendingPapers.map(p=>`Mock ${p.slotNumber}`).join(', ')} {pendingPapers.length===1?'is':'are'} being generated
                    </div>
                    <div style={{fontSize:12,color:'#92400e',marginBottom:8}}>
                      4 Claude calls — MCQ + short answer + extended response. Takes 2-3 minutes. Close the browser — we'll email you when ready.
                    </div>
                    {pendingPapers.map(p => {
                      const elapsed = Math.round((Date.now() - new Date(p.generatedAt).getTime()) / 1000)
                      const mins = Math.floor(elapsed / 60), secs = elapsed % 60
                      const isStuck = elapsed > 300 // 5+ minutes = stuck
                      return (
                        <div key={p.id} style={{fontSize:11,color:isStuck?'#dc2626':'#92400e',display:'flex',alignItems:'center',gap:6}}>
                          <div style={{width:6,height:6,borderRadius:'50%',background:isStuck?'#dc2626':'#d97706',flexShrink:0}}/>
                          Mock {p.slotNumber} — {isStuck?`⚠️ stuck for ${mins}m${secs}s — clear and retry`:`running for ${mins}m${secs}s`}
                          {p.progress>0 && <span style={{marginLeft:4,fontWeight:600,color:'var(--teal2)'}}>{p.progress}%</span>}
                        </div>
                      )
                    })}
                  </div>
                  <button
                    onClick={clearOrphans}
                    title="Clear stuck papers and free slots"
                    style={{fontSize:11,padding:'6px 12px',borderRadius:8,background:'rgba(217,119,6,0.2)',border:'1px solid rgba(217,119,6,0.4)',color:'#d97706',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,fontWeight:600}}
                  >
                    🗑 Clear stuck
                  </button>
                </div>
              </div>
            )}

            {/* Coverage tracker */}
            {readyPapers.length>0&&allScopeTopics.length>0&&(()=>{
              const covered=[...new Set(readyPapers.flatMap(p=>p.topicsCovered||[]))]
              const gaps=allScopeTopics.filter(t=>!covered.some(c=>c.toLowerCase().includes(t.toLowerCase().slice(0,8))))
              const pct=Math.round((covered.length/Math.max(allScopeTopics.length,covered.length))*100)
              return (
                <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 16px',marginBottom:14}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--text2)'}}>Topic coverage across all papers</div>
                    <div style={{fontSize:12,fontWeight:700,color:pct>=80?'var(--teal2)':'#d97706'}}>{pct}% covered</div>
                  </div>
                  <div style={{height:5,background:'var(--border)',borderRadius:3,marginBottom:8,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${pct}%`,background:pct>=80?'var(--teal2)':'#d97706',borderRadius:3,transition:'width 0.5s'}}/>
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:gaps.length>0?6:0}}>
                    {covered.map(t=><span key={t} style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.3)',color:'#10b981'}}>✓ {t}</span>)}
                  </div>
                  {gaps.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:4}}>{gaps.map(t=><span key={t} style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.3)',color:'#d97706'}}>→ {t}</span>)}</div>}
                </div>
              )
            })()}

            {/* 5 paper slots */}
            <div style={{fontSize:12,fontWeight:500,color:'var(--text2)',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.06em'}}>
              Mock papers — {readyPapers.length}/5 ready{pendingPapers.length>0&&<span style={{color:'#d97706',marginLeft:8}}>· {pendingPapers.length} generating</span>}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:16}}>
              {[1,2,3,4,5].map(slot => {
                const paper     = subjectPapers.find(p=>p.slotNumber===slot)
                const isEmpty   = !paper
                const status    = paper?.status
                const isReady   = status==='ready'
                const isPending = status==='queued'||status==='generating'
                const isFailed  = status==='failed'
                const isNextSlot= isEmpty && readyPapers.length+pendingPapers.length===slot-1
                const covered   = [...new Set(readyPapers.flatMap(p=>p.topicsCovered||[]))]
                const gaps      = allScopeTopics.filter(t=>!covered.some(c=>c.toLowerCase().includes(t.toLowerCase().slice(0,8))))
                return (
                  <div key={slot} style={{background:isEmpty?'var(--bg3)':'var(--bg2)',border:`1px solid ${isPending?'rgba(217,119,6,0.4)':isNextSlot?'rgba(217,119,6,0.2)':'var(--border)'}`,borderRadius:12,padding:14,display:'flex',flexDirection:'column',gap:8,minHeight:170}}>
                    <span style={{fontSize:11,fontWeight:600,color:isPending?'#d97706':isEmpty?'var(--text3)':'var(--text2)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Mock {slot}</span>

                    {isEmpty&&!isNextSlot&&<div style={{fontSize:11,color:'var(--text3)',flex:1}}>Empty</div>}

                    {isNextSlot&&(
                      <div style={{flex:1}}>
                        {gaps.length>0&&scopeConfirmed&&<><div style={{fontSize:10,color:'#d97706',marginBottom:4,fontWeight:600}}>Will cover gaps:</div>
                        {gaps.slice(0,4).map(t=><div key={t} style={{fontSize:9,padding:'1px 0',color:'#d97706'}}>→ {t.length>24?t.slice(0,24)+'…':t}</div>)}
                        {gaps.length>4&&<div style={{fontSize:9,color:'var(--text3)'}}>+{gaps.length-4} more</div>}</>}
                        {(scopeConfirmed || readyPapers.length > 0)
                          ? <button onClick={()=>generate()} disabled={submitting} style={{marginTop:8,fontSize:11,padding:'6px 0',borderRadius:8,background:'var(--teal-bg)',border:'1px solid var(--teal-border)',color:'var(--teal2)',cursor:'pointer',width:'100%',fontWeight:600}}>
                              {submitting?'Queuing...':'+ Generate'}
                            </button>
                          : <div style={{marginTop:8,fontSize:9,color:'var(--text3)',padding:'5px 6px',background:'var(--bg2)',borderRadius:6,border:'1px dashed var(--border)',textAlign:'center',lineHeight:1.4}}>
                              Analyse papers above to generate
                            </div>
                        }
                      </div>
                    )}

                    {isPending&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6}}>
                        <svg style={{width:22,height:22,border:'2px solid var(--teal-border)',borderTopColor:'var(--teal2)',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
                        <div style={{fontSize:11,fontWeight:600,color:'var(--teal2)',textAlign:'center'}}>Generating</div>
                        {paper?.progress&&<>
                          <div style={{width:'100%',height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${paper.progress}%`,background:'var(--teal2)',borderRadius:2,transition:'width 0.5s'}}/></div>
                          <div style={{fontSize:10,color:'var(--teal2)',fontWeight:600}}>{paper.progress}%</div>
                          <div style={{fontSize:9,color:'var(--text3)',textAlign:'center'}}>{paper.progress<50?'Writing MCQ...':paper.progress<75?'Adding SA questions...':'Writing extended response...'}</div>
                        </>}
                        {!paper?.progress&&<div style={{fontSize:9,color:'var(--text3)',textAlign:'center'}}>Close browser — email sent when ready</div>}
                      </div>
                    )}

                    {isFailed&&(
                      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8}}>
                        <div style={{fontSize:11,color:'var(--red)',textAlign:'center'}}>Generation failed</div>
                        <button onClick={()=>deletePaper(paper.id).then(()=>generate(slot))} style={{fontSize:11,padding:'5px 12px',borderRadius:8,background:'var(--red-bg)',border:'1px solid rgba(220,38,38,0.3)',color:'var(--red)',cursor:'pointer'}}>Retry</button>
                      </div>
                    )}

                    {isReady&&(
                      <>
                        <div style={{fontSize:11,color:'var(--text3)'}}>{new Date(paper.completedAt||paper.generatedAt).toLocaleDateString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                        {paper.comparison?.overallMatch&&(
                          <div style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:paper.comparison.overallMatch>=90?'rgba(16,185,129,0.15)':'rgba(217,119,6,0.15)',color:paper.comparison.overallMatch>=90?'#10b981':'#d97706',border:`1px solid ${paper.comparison.overallMatch>=90?'rgba(16,185,129,0.3)':'rgba(217,119,6,0.3)'}`,alignSelf:'flex-start'}}>
                            {paper.comparison.overallMatch>=90?'🎯 ':''}{paper.comparison.overallMatch}% match
                          </div>
                        )}
                        {paper.topicsCovered?.length>0&&(
                          <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                            {paper.topicsCovered.slice(0,3).map(t=><span key={t} style={{fontSize:9,padding:'1px 6px',borderRadius:8,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.25)',color:'#10b981'}}>✓ {t.length>16?t.slice(0,16)+'…':t}</span>)}
                            {paper.topicsCovered.length>3&&<span style={{fontSize:9,color:'var(--text3)'}}>+{paper.topicsCovered.length-3}</span>}
                          </div>
                        )}
                        <div style={{display:'flex',gap:5,marginTop:'auto'}}>
                          <button onClick={()=>setViewingPaper({...paper,subjectName:selectedSubject?.name})} style={{flex:1,fontSize:11,padding:'6px 0',borderRadius:7,background:'var(--teal-bg)',border:'1px solid var(--teal-border)',color:'var(--teal2)',cursor:'pointer',fontWeight:600}}>View</button>
                          <button onClick={()=>setConfirmReplace(slot)} style={{flex:1,fontSize:11,padding:'6px 0',borderRadius:7,background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text2)',cursor:'pointer'}}>Redo</button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            {slotsExhausted&&<div style={{fontSize:12,color:'var(--text3)',textAlign:'center',padding:'12px',background:'var(--bg3)',borderRadius:10}}>All 5 slots used. Redo a paper to generate a new one.</div>}

            {/* Redo confirmation */}
            {confirmReplace&&(
              <div style={{background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.3)',borderRadius:12,padding:'14px 16px',marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,color:'#d97706',marginBottom:8}}>Regenerate Mock {confirmReplace}?</div>
                <div style={{fontSize:12,color:'var(--text2)',marginBottom:12}}>This will replace the existing paper. The new paper will cover gap topics not yet tested.</div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>deletePaper(subjectPapers.find(p=>p.slotNumber===confirmReplace)?.id).then(()=>generate(confirmReplace))} style={{fontSize:12,padding:'6px 14px',borderRadius:7,background:'#d97706',border:'none',color:'#fff',cursor:'pointer',fontWeight:600}}>Yes, regenerate</button>
                  <button onClick={()=>setConfirmReplace(null)} style={{fontSize:12,padding:'6px 14px',borderRadius:7,background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text2)',cursor:'pointer'}}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Waiting state — docs uploaded, no scope yet, not analysed */}
        {hasDocs && !scope && !analysing && (
          <div style={{fontSize:12,color:'var(--text3)',textAlign:'center',padding:'8px',marginTop:8}}>
            ↑ Analyse your papers above to detect the exam format and topics
          </div>
        )}

      </>)}

      {/* No subject selected */}
      {!selectedSubjectId && (
        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:14,padding:40,textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:12}}>📚</div>
          <div style={{fontSize:16,fontWeight:600,color:'var(--text)',marginBottom:6}}>Universal exam prep engine</div>
          <div style={{fontSize:13,color:'var(--text2)',marginBottom:4}}>Select a subject above to begin · Upload past papers · AI mirrors the format exactly</div>
          <div style={{fontSize:12,color:'var(--text3)'}}>Works for any subject — BSSS Physics, Specialist Maths, HSC Chemistry, GAMSAT, Law, IELTS and more</div>
        </div>
      )}
    </div>
  )
}
