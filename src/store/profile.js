import { create } from 'zustand'

export const useProfileStore = create((set) => ({
  profile: null,
  loading: false,

  fetchProfile: async (token) => {
    set({ loading: true })
    try {
      const res = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch profile')
      const data = await res.json()
      set({ profile: data.profile, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  saveProfile: async (token, profile) => {
    set({ loading: true })
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(profile)
    })
    if (!res.ok) throw new Error('Failed to save profile')
    const data = await res.json()
    set({ profile: data.profile, loading: false })
    return data.profile
  }
}))
