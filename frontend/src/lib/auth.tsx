import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authApi, type AuthCredentials, type AuthUser } from '@/lib/api'

const AUTH_QUERY_KEY = ['auth', 'me'] as const

type AuthContextValue = {
  user: AuthUser | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  login: (credentials: AuthCredentials) => Promise<AuthUser>
  register: (credentials: AuthCredentials) => Promise<AuthUser>
  logout: () => Promise<void>
  loginPending: boolean
  registerPending: boolean
  logoutPending: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

function deriveStatus(
  isPending: boolean,
  user: AuthUser | null | undefined,
): AuthContextValue['status'] {
  if (isPending) return 'loading'
  return user ? 'authenticated' : 'unauthenticated'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const meQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: authApi.me,
    retry: false,
  })

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, user)
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['occupants'] })
    },
  })

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, user)
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['occupants'] })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null)
      queryClient.removeQueries({ queryKey: ['jobs'] })
      queryClient.removeQueries({ queryKey: ['occupants'] })
    },
  })

  const value = useMemo<AuthContextValue>(() => ({
    user: meQuery.data ?? null,
    status: deriveStatus(meQuery.isPending, meQuery.data),
    login: async (credentials) => loginMutation.mutateAsync(credentials),
    register: async (credentials) => registerMutation.mutateAsync(credentials),
    logout: async () => {
      await logoutMutation.mutateAsync()
    },
    loginPending: loginMutation.isPending,
    registerPending: registerMutation.isPending,
    logoutPending: logoutMutation.isPending,
  }), [
    loginMutation,
    logoutMutation,
    meQuery.data,
    meQuery.isPending,
    registerMutation,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
