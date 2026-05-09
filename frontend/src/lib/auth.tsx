import {
  useMemo,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/lib/api'
import { formatAppRoute } from '@/lib/navigation'
import {
  AUTH_QUERY_KEY,
  AuthContext,
  deriveStatus,
  type AuthContextValue,
} from '@/lib/auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const landOnDashboard = () => {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${formatAppRoute({ name: 'dashboard' })}`,
    )
  }

  const meQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: authApi.me,
    retry: false,
  })

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => {
      landOnDashboard()
      queryClient.setQueryData(AUTH_QUERY_KEY, user)
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['occupants'] })
    },
  })

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (user) => {
      landOnDashboard()
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
