import React, { useState, useEffect } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import '../styles/SubjectHub.css'

const SubjectHub = () => {
  const { user, isLoaded } = useUser()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')

  useEffect(() => {
    if (isLoaded && user) {
      loadSubjects()
    }
  }, [isLoaded, user])

  const loadSubjects = async () => {
    try {
      setLoading(true)
      setError('')
      
      // Get the Clerk token
      const token = await user.getIdToken()
      
      // Include Authorization header
      const res = await fetch('/api/subjects', {
        headers: {
          Authorization: `Bearer ${token}`
        }
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
      const token = await user.getIdToken()
      
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
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="subject-hub">
      <h1>My Subjects</h1>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading subjects...</div>
      ) : (
        <>
          <div className="subjects-grid">
            {subjects.map((subject) => (
              <div 
                key={subject.id} 
                className="subject-card"
                onClick={() => handleSelectSubject(subject.id)}
              >
                <h3>{subject.name}</h3>
                <p className="subject-meta">
                  {subject.examBoard} • Year {subject.year}
                </p>
                <p className="subject-topics">
                  {subject.topics?.length || 0} topics
                </p>
              </div>
            ))}

            {/* Add new subject card */}
            {!showAddSubject && (
              <div 
                className="subject-card add-subject-card"
                onClick={() => setShowAddSubject(true)}
              >
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>+</div>
                <p>Add Subject</p>
              </div>
            )}
          </div>

          {/* Add subject form */}
          {showAddSubject && (
            <div className="add-subject-form">
              <form onSubmit={handleAddSubject}>
                <input
                  type="text"
                  placeholder="Subject name (e.g., Physics)"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary">
                  Add
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowAddSubject(false)
                    setNewSubjectName('')
                  }}
                >
                  Cancel
                </button>
              </form>
            </div>
          )}

          {subjects.length === 0 && !showAddSubject && (
            <div className="empty-state">
              <p>No subjects yet. Add one to get started!</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default SubjectHub
