import { create } from 'zustand'

export const useSubjectsStore = create((set, get) => ({
  subjects: [],
  loading: false,
  error: null,

  fetchSubjects: async (token) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subjects', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch subjects')
      const data = await res.json()
      set({ subjects: data.subjects || [], loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  saveSubject: async (token, subject) => {
    const res = await fetch('/api/subjects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(subject)
    })
    if (!res.ok) throw new Error('Failed to save subject')
    const data = await res.json()
    // Refresh subjects list
    get().fetchSubjects(token)
    return data.subject
  },

  deleteSubject: async (token, subjectId) => {
    const res = await fetch(`/api/subjects?id=${subjectId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('Failed to delete subject')
    set(state => ({
      subjects: state.subjects.filter(s => s.id !== subjectId)
    }))
  }
}))
