import { useAuth, RedirectToSignIn } from '@clerk/clerk-react'

export default function ProtectedRoute({ children }) {
  const { isSignedIn, isLoaded } = useAuth()
  if (!isLoaded) return null
  if (!isSignedIn) return <RedirectToSignIn />
  return children
}
