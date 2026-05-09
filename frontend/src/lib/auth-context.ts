import { createContext, useContext } from 'react'

import type { AuthCredentials, AuthUser } from '@/lib/api'

export const AUTH_QUERY_KEY = ['auth', 'me'] as const

export type AuthContextValue = {
  user: AuthUser | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  login: (credentials: AuthCredentials) => Promise<AuthUser>
  register: (credentials: AuthCredentials) => Promise<AuthUser>
  logout: () => Promise<void>
  loginPending: boolean
  registerPending: boolean
  logoutPending: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function deriveStatus(
  isPending: boolean,
  user: AuthUser | null | undefined,
): AuthContextValue['status'] {
  if (isPending) return 'loading'
  return user ? 'authenticated' : 'unauthenticated'
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
