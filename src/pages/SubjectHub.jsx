import React, { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'

const SubjectHub = () => {
  const { getToken, isLoaded } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')

  useEffect(() => {
    if (isLoaded) {
      loadSubjects()
    }
  }, [isLoaded, getToken])

  const loadSubjects = async () => {
    try {
      setLoading(true)
      setError('')
      const token = await getToken()
      const res = await fetch('/api/subjects', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `Failed to load subjects (${res.status})`)
      }
      const data = await res.json()
      setSubjects(data.subjects || [])
    } catch (e) {
      console.error('Load subjects error:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAddSubject = async (e) => {
    e.preventDefault()
    if (!newSubjectName.trim()) return
    try {
      const token = await getToken()
      const res = await fetch('/api/subjects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newSubjectName,
          examBoard: 'ACT',
          year: 12
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create subject')
      }
      const newSubject = await res.json()
      setSubjects([...subjects, newSubject])
      setNewSubjectName('')
      setShowAddSubject(false)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleSelectSubject = (subjectId) => {
    navigate(`/subjects/${subjectId}/mock-paper`)
  }

  if (!isLoaded) {
    return <div style={{padding: '2rem'}}>Loading...</div>
  }

  return (
    <div style={{padding: '2rem'}}>
      <h1 style={{marginBottom: '2rem'}}>My Subjects</h1>

      {error && <div style={{color: 'red', marginBottom: '1rem'}}>{error}</div>}

      {loading ? (
        <div>Loading subjects...</div>
      ) : (
        <>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem'}}>
            {subjects.map((subject) => (
              <div 
                key={subject.id} 
                onClick={() => handleSelectSubject(subject.id)}
                style={{
                  padding: '1rem',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: '#1e293b',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#0ea5e9'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(14, 165, 233, 0.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#444'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <h3 style={{margin: '0 0 0.5rem 0', color: '#fff'}}>{subject.name}</h3>
                <p style={{margin: '0.25rem 0', color: '#888', fontSize: '0.9rem'}}>
                  {subject.examBoard} • Year {subject.year}
                </p>
                <p style={{margin: '0.25rem 0', color: '#0ea5e9', fontSize: '0.9rem'}}>
                  {subject.topics?.length || 0} topics
                </p>
              </div>
            ))}

            {!showAddSubject && (
              <div 
                onClick={() => setShowAddSubject(true)}
                style={{
                  padding: '1rem',
                  border: '2px dashed #444',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '120px',
                  fontSize: '2rem'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#0ea5e9'
                  e.currentTarget.style.color = '#0ea5e9'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#444'
                  e.currentTarget.style.color = 'inherit'
                }}
              >
                +
              </div>
            )}
          </div>

          {showAddSubject && (
            <form onSubmit={handleAddSubject} style={{marginBottom: '2rem'}}>
              <input
                type="text"
                placeholder="Subject name (e.g., Physics)"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                autoFocus
                style={{
                  padding: '0.5rem',
                  marginRight: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #444',
                  background: '#0f172a',
                  color: '#fff',
                  minWidth: '200px'
                }}
              />
              <button type="submit" style={{padding: '0.5rem 1rem', borderRadius: '4px', background: '#0ea5e9', color: '#fff', border: 'none', cursor: 'pointer'}}>
                Add
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowAddSubject(false)
                  setNewSubjectName('')
                }}
                style={{padding: '0.5rem 1rem', marginLeft: '0.5rem', borderRadius: '4px', background: '#444', color: '#fff', border: 'none', cursor: 'pointer'}}
              >
                Cancel
              </button>
            </form>
          )}

          {subjects.length === 0 && !showAddSubject && (
            <div style={{textAlign: 'center', color: '#888'}}>
              <p>No subjects yet. Add one to get started!</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default SubjectHub
