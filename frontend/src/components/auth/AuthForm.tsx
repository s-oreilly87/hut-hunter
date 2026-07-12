import { useState } from 'react'
import axios from 'axios'
import { LockKeyhole, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { FormErrorAlert } from '@/components/ui/FormErrorAlert'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'

type Mode = 'login' | 'register'

export function AuthForm({ className }: { className?: string }) {
  const {
    login,
    register,
    loginPending,
    registerPending,
  } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const pending = loginPending || registerPending

  const handleSubmit = async () => {
    setError(null)

    try {
      if (mode === 'register') {
        await register({ email, password })
        return
      }
      await login({ email, password })
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (typeof err.response?.data?.detail === 'string'
            ? err.response.data.detail
            : err.message)
        : (err instanceof Error ? err.message : 'Authentication failed.')
      setError(message)
    }
  }

  return (
    <section className={cn('app-panel flex flex-col justify-center p-6 sm:p-8', className)}>
      <div className="flex justify-center">
        <div className="inline-flex w-fit rounded-full border border-border/80 bg-secondary/55 p-1">
          <button
            type="button"
            className={cn(
              'rounded-full px-5 py-2 text-sm font-medium transition',
              mode === 'login'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setMode('login')}
          >
            Log In
          </button>
          <button
            type="button"
            className={cn(
              'rounded-full px-5 py-2 text-sm font-medium transition',
              mode === 'register'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {mode === 'register' ? <UserPlus className="size-5" /> : <LockKeyhole className="size-5" />}
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {mode === 'register' ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === 'register'
              ? 'Set up your roster and start creating hunts.'
              : 'Sign in to get back to your hunts, holds, and saved campers.'}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSubmit()
              }
            }}
          />
        </div>

        {error && (
          <FormErrorAlert className="px-4 py-3">{error}</FormErrorAlert>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={() => void handleSubmit()}
          disabled={pending}
        >
          {pending
            ? (mode === 'register' ? 'Creating account…' : 'Signing in…')
            : (mode === 'register' ? 'Create Account' : 'Log In')}
        </Button>
      </div>
    </section>
  )
}
