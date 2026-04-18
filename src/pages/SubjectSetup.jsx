import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useSubjectsStore } from '../store/subjects.js'
import { detectStudentLocation } from '../lib/geo.js'

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']

const EXAM_BOARDS = {
  NSW: ['NESA'], VIC: ['VCAA'], QLD: ['QCAA'], WA: ['SCSA (WACE)'],
  SA: ['SACE'], TAS: ['TASC (TCE)'], ACT: ['BSSS'], NT: ['NTBOS']
}

const YEAR_LEVELS = ['7','8','9','10','11','12','Year 1 Uni','Year 2 Uni','Year 3 Uni','TAFE','Other']
const QUESTION_TYPES = ['Multiple choice','Short answer','Extended response','Practical report','Essay','Case study']

const sel = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg3)',
  color: 'var(--text)', fontSize: 13, cursor: 'pointer',
  appearance: 'none', WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b92a8' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 32
}

const inp = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg3)',
  color: 'var(--text)', fontSize: 13
}

const addBtnStyle = {
  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
  background: 'var(--teal-bg)', border: '1px solid var(--teal-border)',
  color: 'var(--teal2)', cursor: 'pointer', whiteSpace: 'nowrap'
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

export default function SubjectSetup() {
  const { subjectId } = useParams()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { subjects, saveSubject } = useSubjectsStore()
  const isEdit = Boolean(subjectId)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [geoStatus, setGeoStatus] = useState('idle')
  const [geoMsg, setGeoMsg] = useState('')
  const [form, setForm] = useState({
    name: '', state: 'NSW', examBoard: 'NESA', yearLevel: '12',
    topics: [], examDates: [], assignmentDueDates: [],
    paperFormat: { sections: ['Multiple choice','Short answer','Extended response'], totalMarks: 100, timeLimitMins: 180 }
  })
  const [newTopic, setNewTopic] = useState('')
  const [newExam, setNewExam] = useState({ title: '', date: '', durationMins: 180 })
  const [newAssign, setNewAssign] = useState({ title: '', date: '', weight: 20 })

  useEffect(() => {
    if (isEdit && subjectId) {
      const ex = subjects.find(s => s.id === subjectId)
      if (ex) setForm({ ...ex })
    }
  }, [subjectId, subjects])

  useEffect(() => {
    if (!isEdit) autoDetect(true)
  }, [isEdit])

  useEffect(() => {
    if (!isEdit) {
      const boards = EXAM_BOARDS[form.state] || ['Other']
      setForm(f => ({ ...f, examBoard: boards[0] }))
    }
  }, [form.state])

  async function autoDetect(silent = false) {
    setGeoStatus('detecting')
    if (!silent) setGeoMsg('Detecting your location...')
    try {
      const loc = await detectStudentLocation()
      setForm(f => ({ ...f, state: loc.state, examBoard: loc.examBoard }))
      setGeoStatus('detected')
      setGeoMsg(`Detected: ${loc.state} (${loc.examBoard})${loc.city ? ' · ' + loc.city : ''}`)
    } catch (err) {
      if (silent) { setGeoStatus('idle'); return }
      setGeoStatus(err.code === 1 ? 'denied' : 'error')
      setGeoMsg(err.code === 1 ? 'Location denied — select your state manually' : 'Could not detect location — select manually')
    }
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function addTopic() {
    if (!newTopic.trim()) return
    set('topics', [...form.topics, { id: genId(), name: newTopic.trim(), weight: 10, mastery: 0 }])
    setNewTopic('')
  }
  function addExam() {
    if (!newExam.title || !newExam.date) return
    set('examDates', [...form.examDates, { ...newExam, id: genId() }])
    setNewExam({ title: '', date: '', durationMins: 180 })
  }
  function addAssign() {
    if (!newAssign.title || !newAssign.date) return
    set('assignmentDueDates', [...form.assignmentDueDates, { ...newAssign, id: genId() }])
    setNewAssign({ title: '', date: '', weight: 20 })
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Subject name is required'); return }
    setSaving(true); setError(null)
    try {
      const token = await getToken()
      const subject = isEdit
        ? { ...form, updatedAt: new Date().toISOString() }
        : { ...form, id: genId(), createdAt: new Date().toISOString() }
      await saveSubject(token, subject)
      navigate('/subjects')
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const geoTheme = {
    detected: { color: 'var(--teal2)', bg: 'var(--teal-bg)', border: 'var(--teal-border)' },
    denied:   { color: 'var(--amber)', bg: 'var(--amber-bg)', border: 'rgba(217,119,6,0.3)' },
    error:    { color: 'var(--red)', bg: 'var(--red-bg)', border: 'rgba(220,38,38,0.3)' },
    detecting:{ color: 'var(--text2)', bg: 'var(--bg3)', border: 'var(--border)' },
  }
  const gt = geoTheme[geoStatus] || {}

  return (
    <div style={{ maxWidth: 680 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} select option{background:#1c2333;color:#e8eaf0}`}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <button onClick={() => navigate('/subjects')} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>← Back</button>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{isEdit ? 'Edit subject' : 'Add subject'}</h1>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>Configure your subject, topics, and assessment dates</p>
        </div>
      </div>

      {error && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, color: 'var(--red)', fontSize: 13 }}>{error}</div>}

      <Section title="Subject details">
        {!isEdit && geoStatus !== 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, marginBottom: 14, background: gt.bg, border: `1px solid ${gt.border}`, fontSize: 12, color: gt.color }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {geoStatus === 'detecting' && <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--border)', borderTopColor: 'var(--text2)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />}
              {geoStatus === 'detected' && '✓ '}
              {geoMsg}
            </div>
            <button onClick={() => autoDetect(false)} style={{ background: 'none', border: 'none', color: gt.color, cursor: 'pointer', fontSize: 11, opacity: 0.7, padding: 0 }}>
              {geoStatus === 'detected' ? 'Re-detect' : 'Try again'}
            </button>
          </div>
        )}

        <Field label="Subject name">
          <input type="text" placeholder="e.g. Mathematics Advanced, Chemistry, English Standard" value={form.name} onChange={e => set('name', e.target.value)} style={inp} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="State">
            <select value={form.state} onChange={e => set('state', e.target.value)} style={sel}>
              {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Exam board">
            <select value={form.examBoard} onChange={e => set('examBoard', e.target.value)} style={sel}>
              {(EXAM_BOARDS[form.state] || ['Other']).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Year level">
            <select value={form.yearLevel} onChange={e => set('yearLevel', e.target.value)} style={sel}>
              {YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
        </div>

        {!isEdit && geoStatus === 'idle' && (
          <button onClick={() => autoDetect(false)} style={{ marginTop: 4, padding: '7px 14px', borderRadius: 8, fontSize: 12, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--teal2)', cursor: 'pointer' }}>
            ◎ Auto-detect my state
          </button>
        )}
      </Section>

      <Section title="Topics / units">
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Add the topics covered in this subject — used to scope mock papers and quizzes.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="text" placeholder="e.g. Calculus, Organic Chemistry, Module 1..." value={newTopic} onChange={e => setNewTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTopic()} style={{ ...inp, flex: 1 }} />
          <button onClick={addTopic} style={addBtnStyle}>+ Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {form.topics.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, background: 'var(--teal-bg)', border: '1px solid var(--teal-border)', fontSize: 12, color: 'var(--teal2)' }}>
              {t.name}
              <button onClick={() => set('topics', form.topics.filter(x => x.id !== t.id))} style={{ background: 'none', border: 'none', color: 'var(--teal2)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            </div>
          ))}
          {form.topics.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>No topics added yet</span>}
        </div>
      </Section>

      <Section title="Mock paper format">
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>How is the real exam structured? This shapes how mock papers are generated.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <Field label="Total marks">
            <input type="number" value={form.paperFormat.totalMarks} onChange={e => set('paperFormat', { ...form.paperFormat, totalMarks: Number(e.target.value) })} style={inp} />
          </Field>
          <Field label="Time limit (minutes)">
            <input type="number" value={form.paperFormat.timeLimitMins} onChange={e => set('paperFormat', { ...form.paperFormat, timeLimitMins: Number(e.target.value) })} style={inp} />
          </Field>
        </div>
        <Field label="Question types included">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {QUESTION_TYPES.map(qt => {
              const active = (form.paperFormat.sections || []).includes(qt)
              return (
                <button key={qt} onClick={() => {
                  const sections = active ? form.paperFormat.sections.filter(s => s !== qt) : [...(form.paperFormat.sections || []), qt]
                  set('paperFormat', { ...form.paperFormat, sections })
                }} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: active ? 'var(--teal-bg)' : 'var(--bg3)', border: `1px solid ${active ? 'var(--teal-border)' : 'var(--border)'}`, color: active ? 'var(--teal2)' : 'var(--text2)', transition: 'all .15s' }}>
                  {qt}
                </button>
              )
            })}
          </div>
        </Field>
      </Section>

      <Section title="Exam dates">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <Field label="Exam name" style={{ margin: 0 }}><input placeholder="e.g. Trial HSC, Final Exam" value={newExam.title} onChange={e => setNewExam(x => ({ ...x, title: e.target.value }))} style={inp} /></Field>
          <Field label="Date" style={{ margin: 0 }}><input type="date" value={newExam.date} onChange={e => setNewExam(x => ({ ...x, date: e.target.value }))} style={inp} /></Field>
          <Field label="Duration (min)" style={{ margin: 0 }}><input type="number" value={newExam.durationMins} onChange={e => setNewExam(x => ({ ...x, durationMins: Number(e.target.value) }))} style={{ ...inp, width: 80 }} /></Field>
          <button onClick={addExam} style={{ ...addBtnStyle, marginBottom: 0, alignSelf: 'flex-end', height: 38 }}>+ Add</button>
        </div>
        <DateList items={form.examDates} onRemove={id => set('examDates', form.examDates.filter(e => e.id !== id))} renderRight={e => `${e.durationMins} min`} color="var(--red)" bg="var(--red-bg)" label="EXAM" />
      </Section>

      <Section title="Assignment due dates">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <Field label="Assignment name" style={{ margin: 0 }}><input placeholder="e.g. Research essay, Lab report" value={newAssign.title} onChange={e => setNewAssign(x => ({ ...x, title: e.target.value }))} style={inp} /></Field>
          <Field label="Due date" style={{ margin: 0 }}><input type="date" value={newAssign.date} onChange={e => setNewAssign(x => ({ ...x, date: e.target.value }))} style={inp} /></Field>
          <Field label="Weight %" style={{ margin: 0 }}><input type="number" value={newAssign.weight} onChange={e => setNewAssign(x => ({ ...x, weight: Number(e.target.value) }))} style={{ ...inp, width: 70 }} /></Field>
          <button onClick={addAssign} style={{ ...addBtnStyle, marginBottom: 0, alignSelf: 'flex-end', height: 38 }}>+ Add</button>
        </div>
        <DateList items={form.assignmentDueDates} onRemove={id => set('assignmentDueDates', form.assignmentDueDates.filter(a => a.id !== id))} renderRight={a => `${a.weight}% weight`} color="var(--amber)" bg="var(--amber-bg)" label="DUE" />
      </Section>

      <div style={{ display: 'flex', gap: 12, paddingTop: 8, paddingBottom: 32 }}>
        <button onClick={handleSave} disabled={saving} style={{ padding: '11px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: 'var(--teal)', border: 'none', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create subject'}
        </button>
        <button onClick={() => navigate('/subjects')} style={{ padding: '11px 20px', borderRadius: 10, fontSize: 14, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 6, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  )
}

function DateList({ items, onRemove, renderRight, color, bg, label }) {
  if (items.length === 0) return <p style={{ fontSize: 12, color: 'var(--text3)' }}>None added yet</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: bg, color, fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{item.title}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{new Date(item.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{renderRight(item)}</span>
            <button onClick={() => onRemove(item.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
          </div>
        </div>
      ))}
    </div>
  )
}
