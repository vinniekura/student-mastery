import { useState, useEffect } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useProfileStore } from '../store/profile.js'

export default function Settings() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const { profile, fetchProfile, saveProfile } = useProfileStore()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    school: '', timezone: 'Australia/Sydney', parentEmail: '', tutorId: '',
    digestEnabled: true, digestTime: '07:00'
  })

  useEffect(() => {
    getToken().then(token => fetchProfile(token))
  }, [])

  useEffect(() => {
    if (profile) setForm(f => ({ ...f, ...profile }))
  }, [profile])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    setSaving(true)
    try {
      const token = await getToken()
      await saveProfile(token, form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 580 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>Manage your profile and notification preferences</p>
      </div>

      {/* Account info (read-only from Clerk) */}
      <Card title="Account">
        <Row label="Name">{user?.fullName || '—'}</Row>
        <Row label="Email">{user?.emailAddresses?.[0]?.emailAddress || '—'}</Row>
        <Row label="Account created">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-AU') : '—'}</Row>
      </Card>

      {/* Profile */}
      <Card title="Profile">
        <Field label="School / institution">
          <input placeholder="e.g. Sydney Grammar School, UNSW" value={form.school} onChange={e => set('school', e.target.value)} />
        </Field>
        <Field label="Timezone">
          <select value={form.timezone} onChange={e => set('timezone', e.target.value)}>
            {['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Hobart'].map(tz => (
              <option key={tz} value={tz}>{tz.replace('Australia/', '')}</option>
            ))}
          </select>
        </Field>
        <Field label="Parent / guardian email (for digest copy)">
          <input type="email" placeholder="parent@example.com" value={form.parentEmail} onChange={e => set('parentEmail', e.target.value)} />
        </Field>
        <Field label="TutorMastery ID (if linked by your tutor)">
          <input placeholder="Tutor ID from TutorMastery" value={form.tutorId} onChange={e => set('tutorId', e.target.value)} />
        </Field>
      </Card>

      {/* Notifications */}
      <Card title="Email digest">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Daily schedule digest</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Receive a daily summary of due dates and upcoming exams</div>
          </div>
          <ToggleSwitch
            value={form.digestEnabled}
            onChange={v => set('digestEnabled', v)}
          />
        </div>
        {form.digestEnabled && (
          <Field label="Send time (AEDT)">
            <input type="time" value={form.digestTime} onChange={e => set('digestTime', e.target.value)} style={{ width: 120 }} />
          </Field>
        )}
      </Card>

      {/* Save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            background: 'var(--teal)', border: 'none', color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1
          }}
        >
          {saving ? 'Saving...' : 'Save settings'}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--teal2)' }}>Saved</span>}
      </div>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text2)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{children}</span>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 6, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  )
}

function ToggleSwitch({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11,
        background: value ? 'var(--teal)' : 'var(--border2)',
        cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: value ? 20 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left .2s'
      }} />
    </div>
  )
}
