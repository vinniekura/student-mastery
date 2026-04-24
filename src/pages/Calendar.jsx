import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'

const EVENT_TYPES = {
  exam:       { label: 'Exam',          color: '#dc2626', bg: 'rgba(220,38,38,0.1)',   border: 'rgba(220,38,38,0.3)',   icon: '📝' },
  assignment: { label: 'Assignment',    color: '#d97706', bg: 'rgba(217,119,6,0.1)',   border: 'rgba(217,119,6,0.3)',   icon: '📋' },
  mock:       { label: 'Mock paper',    color: '#7c3aed', bg: 'rgba(124,58,237,0.1)',  border: 'rgba(124,58,237,0.3)',  icon: '📄' },
  training:   { label: 'Study session', color: '#2563eb', bg: 'rgba(37,99,235,0.1)',   border: 'rgba(37,99,235,0.3)',   icon: '📚' },
  reminder:   { label: 'Reminder',      color: '#059669', bg: 'rgba(5,150,105,0.1)',   border: 'rgba(5,150,105,0.3)',   icon: '🔔' },
}

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function firstDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }
function today() { return new Date().toISOString().split('T')[0] }
function formatDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
function daysUntil(d) {
  const diff = Math.ceil((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d ago`
  return `In ${diff} days`
}

export default function Calendar() {
  const { getToken, user } = useAuth()
  const { subjects, fetchSubjects } = useSubjectsStore()

  const [events, setEvents]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [showAdd, setShowAdd]           = useState(false)
  const [editEvent, setEditEvent]       = useState(null)
  const [filterType, setFilterType]     = useState('all')
  const [calMonth, setCalMonth]         = useState(new Date().getMonth())
  const [calYear, setCalYear]           = useState(new Date().getFullYear())
  const [view, setView]                 = useState('list') // 'list' | 'month'
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState(null)

  // Form state
  const [form, setForm] = useState({ title: '', type: 'exam', date: '', subjectId: '', notes: '' })

  useEffect(() => {
    getToken().then(t => {
      fetchSubjects(t)
      loadEvents(t)
    })
  }, [])

  async function loadEvents(token) {
    setLoading(true)
    try {
      const res  = await fetch('/api/events', { headers: { Authorization: `Bearer ${token || await getToken()}` } })
      const data = await res.json()
      setEvents(data.events || [])
    } catch {}
    finally { setLoading(false) }
  }

  async function saveEvent() {
    if (!form.title || !form.date) { setError('Title and date are required'); return }
    setSaving(true); setError(null)
    try {
      const token = await getToken()
      const payload = editEvent
        ? { ...form, id: editEvent.id }
        : { ...form, id: Date.now().toString(36) + Math.random().toString(36).slice(2,5) }
      const res  = await fetch('/api/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Failed to save')
      await loadEvents(token)
      setShowAdd(false); setEditEvent(null)
      setForm({ title: '', type: 'exam', date: '', subjectId: '', notes: '' })
    } catch(e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function deleteEvent(id) {
    try {
      const token = await getToken()
      await fetch(`/api/events?eventId=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      await loadEvents(token)
    } catch {}
  }

  function openEdit(evt) {
    setForm({ title: evt.title, type: evt.type, date: evt.date, subjectId: evt.subjectId || '', notes: evt.notes || '' })
    setEditEvent(evt)
    setShowAdd(true)
  }

  // Merge subject events + custom events
  const subjectEvents = subjects.flatMap(s => [
    ...(s.examDates || []).map(e => ({ id:`sx-${s.id}-${e.date}`, title: e.title || `${s.name} Exam`, date: e.date, type: 'exam', subjectId: s.id, subjectName: s.name, fromSubject: true })),
    ...(s.assignmentDueDates || []).map(a => ({ id:`sa-${s.id}-${a.date}`, title: a.title || `${s.name} Assignment`, date: a.date, type: 'assignment', subjectId: s.id, subjectName: s.name, fromSubject: true })),
  ])

  const allEvents = [...events, ...subjectEvents]
    .map(e => ({ ...e, subjectName: e.subjectName || subjects.find(s=>s.id===e.subjectId)?.name || '' }))
    .filter(e => filterType === 'all' || e.type === filterType)
    .sort((a, b) => a.date.localeCompare(b.date))

  const upcomingEvents = allEvents.filter(e => e.date >= today())
  const pastEvents     = allEvents.filter(e => e.date < today())

  // Calendar grid
  const dInMonth = daysInMonth(calYear, calMonth)
  const firstDay = firstDayOfMonth(calYear, calMonth)
  const monthName = new Date(calYear, calMonth).toLocaleString('en-AU', { month: 'long', year: 'numeric' })
  const eventsByDate = {}
  allEvents.forEach(e => { if (!eventsByDate[e.date]) eventsByDate[e.date] = []; eventsByDate[e.date].push(e) })

  const inp = { width:'100%', padding:'8px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--text)', marginBottom:4 }}>Calendar</h1>
          <div style={{ fontSize:13, color:'var(--text3)' }}>{upcomingEvents.length} upcoming · {allEvents.length} total events</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {/* View toggle */}
          <div style={{ display:'flex', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {['list','month'].map(v => (
              <button key={v} onClick={()=>setView(v)} style={{ padding:'7px 14px', fontSize:12, fontWeight:view===v?600:400, background:view===v?'var(--teal-bg)':'transparent', color:view===v?'var(--teal2)':'var(--text2)', border:'none', cursor:'pointer' }}>
                {v==='list'?'≡ List':'⊞ Month'}
              </button>
            ))}
          </div>
          <button onClick={()=>{ setShowAdd(true); setEditEvent(null); setForm({ title:'', type:'exam', date:'', subjectId:'', notes:'' }) }} style={{ padding:'8px 18px', borderRadius:8, background:'var(--teal)', color:'#fff', border:'none', cursor:'pointer', fontSize:13, fontWeight:600 }}>
            + Add event
          </button>
        </div>
      </div>

      {/* Add / Edit modal */}
      {showAdd && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:16, padding:28, width:480, maxWidth:'90vw' }}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--text)', marginBottom:20 }}>
              {editEvent ? 'Edit event' : 'Add event'}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:11, color:'var(--text3)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Title</label>
                <input style={inp} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Physics Unit Test, Assignment 2 due..." autoFocus/>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:11, color:'var(--text3)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Type</label>
                  <select style={inp} value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                    {Object.entries(EVENT_TYPES).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, color:'var(--text3)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Date</label>
                  <input style={inp} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} min={today()}/>
                </div>
              </div>

              <div>
                <label style={{ fontSize:11, color:'var(--text3)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Subject (optional)</label>
                <select style={inp} value={form.subjectId} onChange={e=>setForm(f=>({...f,subjectId:e.target.value}))}>
                  <option value="">No subject</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize:11, color:'var(--text3)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Notes (optional)</label>
                <textarea style={{ ...inp, height:64, resize:'vertical' }} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Topics to revise, location, materials needed..."/>
              </div>

              {error && <div style={{ fontSize:12, color:'var(--red)', padding:'6px 10px', background:'var(--red-bg)', borderRadius:6 }}>{error}</div>}

              <div style={{ display:'flex', gap:10 }}>
                <button onClick={saveEvent} disabled={saving} style={{ flex:1, padding:'10px 0', borderRadius:9, background:'var(--teal)', color:'#fff', border:'none', cursor:'pointer', fontSize:14, fontWeight:600 }}>
                  {saving ? 'Saving...' : editEvent ? 'Save changes' : 'Add to calendar'}
                </button>
                <button onClick={()=>{ setShowAdd(false); setEditEvent(null); setError(null) }} style={{ padding:'10px 16px', borderRadius:9, background:'var(--bg2)', color:'var(--text2)', border:'1px solid var(--border)', cursor:'pointer', fontSize:13 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:20 }}>
        <button onClick={()=>setFilterType('all')} style={{ padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:filterType==='all'?600:400, background:filterType==='all'?'var(--teal-bg)':'var(--bg2)', color:filterType==='all'?'var(--teal2)':'var(--text3)', border:`1px solid ${filterType==='all'?'var(--teal-border)':'var(--border)'}`, cursor:'pointer' }}>All</button>
        {Object.entries(EVENT_TYPES).map(([k,v]) => (
          <button key={k} onClick={()=>setFilterType(k)} style={{ padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:filterType===k?600:400, background:filterType===k?v.bg:'var(--bg2)', color:filterType===k?v.color:'var(--text3)', border:`1px solid ${filterType===k?v.border:'var(--border)'}`, cursor:'pointer' }}>
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {/* Month view */}
      {view === 'month' && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:20, marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <button onClick={()=>{ const d=new Date(calYear,calMonth-1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()) }} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', cursor:'pointer', color:'var(--text2)', fontSize:14 }}>‹</button>
            <div style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>{monthName}</div>
            <button onClick={()=>{ const d=new Date(calYear,calMonth+1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()) }} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', cursor:'pointer', color:'var(--text2)', fontSize:14 }}>›</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} style={{ fontSize:11, color:'var(--text3)', textAlign:'center', padding:'4px 0', fontWeight:600 }}>{d}</div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
            {Array.from({ length: firstDay }).map((_,i) => <div key={`e${i}`}/>)}
            {Array.from({ length: dInMonth }).map((_,i) => {
              const day = i + 1
              const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const dayEvents = eventsByDate[dateStr] || []
              const isToday = dateStr === today()
              return (
                <div key={day} style={{ minHeight:60, padding:4, borderRadius:6, background:isToday?'var(--teal-bg)':'var(--bg3)', border:`1px solid ${isToday?'var(--teal-border)':'transparent'}` }}>
                  <div style={{ fontSize:12, fontWeight:isToday?700:400, color:isToday?'var(--teal2)':'var(--text3)', marginBottom:2 }}>{day}</div>
                  {dayEvents.slice(0,2).map(e => {
                    const t = EVENT_TYPES[e.type] || EVENT_TYPES.reminder
                    return <div key={e.id} style={{ fontSize:9, padding:'1px 4px', borderRadius:3, background:t.bg, color:t.color, marginBottom:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{t.icon} {e.title}</div>
                  })}
                  {dayEvents.length > 2 && <div style={{ fontSize:9, color:'var(--text3)' }}>+{dayEvents.length-2}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div>
          {loading && <div style={{ fontSize:13, color:'var(--text3)', textAlign:'center', padding:40 }}>Loading events...</div>}

          {!loading && upcomingEvents.length === 0 && pastEvents.length === 0 && (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:48, textAlign:'center' }}>
              <div style={{ fontSize:36, marginBottom:12 }}>📅</div>
              <div style={{ fontSize:16, fontWeight:600, color:'var(--text)', marginBottom:6 }}>No events yet</div>
              <div style={{ fontSize:13, color:'var(--text3)', marginBottom:20 }}>Add exams, assignments, study sessions and mock paper dates</div>
              <button onClick={()=>setShowAdd(true)} style={{ padding:'9px 20px', borderRadius:9, background:'var(--teal)', color:'#fff', border:'none', cursor:'pointer', fontSize:13, fontWeight:600 }}>+ Add your first event</button>
            </div>
          )}

          {upcomingEvents.length > 0 && (
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>Upcoming</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {upcomingEvents.map(e => <EventCard key={e.id} event={e} onEdit={()=>openEdit(e)} onDelete={()=>deleteEvent(e.id)} />)}
              </div>
            </div>
          )}

          {pastEvents.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>Past</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8, opacity:0.6 }}>
                {pastEvents.slice(0,5).map(e => <EventCard key={e.id} event={e} onEdit={()=>openEdit(e)} onDelete={()=>deleteEvent(e.id)} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EventCard({ event, onEdit, onDelete }) {
  const t   = EVENT_TYPES[event.type] || EVENT_TYPES.reminder
  const due = daysUntil(event.date)
  const isUrgent = event.date >= today() && new Date(event.date + 'T00:00:00') - new Date() < 7 * 86400000

  return (
    <div style={{ background:'var(--bg2)', border:`1px solid ${isUrgent?t.border:'var(--border)'}`, borderRadius:12, padding:'14px 16px', display:'flex', alignItems:'flex-start', gap:14, borderLeft:`4px solid ${t.color}` }}>
      <div style={{ fontSize:22, flexShrink:0 }}>{t.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{event.title}</div>
          <div style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:t.bg, color:t.color, border:`1px solid ${t.border}`, fontWeight:600 }}>{t.label}</div>
          {event.subjectName && <div style={{ fontSize:11, color:'var(--text3)' }}>{event.subjectName}</div>}
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ fontSize:12, color:'var(--text2)' }}>{formatDate(event.date)}</div>
          <div style={{ fontSize:12, fontWeight:600, color: due==='Today'?t.color:due.includes('ago')?'var(--text3)':isUrgent?t.color:'var(--teal2)' }}>{due}</div>
        </div>
        {event.notes && <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>{event.notes}</div>}
      </div>
      {!event.fromSubject && (
        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          <button onClick={onEdit} style={{ fontSize:11, padding:'4px 10px', borderRadius:6, background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text2)', cursor:'pointer' }}>Edit</button>
          <button onClick={onDelete} style={{ fontSize:11, padding:'4px 10px', borderRadius:6, background:'var(--red-bg)', border:'1px solid rgba(220,38,38,0.3)', color:'var(--red)', cursor:'pointer' }}>Delete</button>
        </div>
      )}
    </div>
  )
}
