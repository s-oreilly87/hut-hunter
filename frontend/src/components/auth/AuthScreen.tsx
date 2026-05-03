import { useState } from 'react'
import axios from 'axios'
import { LockKeyhole, TentTree, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

type Mode = 'login' | 'register'

export function AuthScreen() {
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
    <div className="app-shell min-h-dvh">
      <div className="mx-auto grid min-h-dvh max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,460px)] lg:px-8">
        <section className="app-panel flex flex-col justify-between overflow-hidden px-6 py-6 sm:px-8 sm:py-8">
          <div>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <TentTree className="size-6" />
            </div>
            <p className="mt-8 text-sm font-medium uppercase tracking-[0.2em] text-primary/80">
              Availability Tracking
            </p>
            <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Track NZ DOC availability, catch live holds, and keep every booking run organized in one place.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Hut Hunter watches huts and campsites for you, highlights when your requested nights open up, and helps you move quickly from detection to checkout.
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-semibold text-foreground">Monitor routes</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Create watch jobs for Great Walks, standard huts, and campsites with your preferred date, direction, and party setup.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-semibold text-foreground">Move fast on holds</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                When a site opens up, Hut Hunter can capture the booking flow, preserve artifacts, and hand you off to payment.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-semibold text-foreground">Reuse your roster</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Save occupants once, attach them to future jobs, and enable auto-booking when you want the worker to continue past availability checks.
              </p>
            </div>
          </div>
        </section>

        <section className="app-panel flex flex-col justify-center px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex justify-center">
            <div className="inline-flex w-fit rounded-full border border-border/80 bg-secondary/55 p-1">
              <button
                type="button"
                className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                  mode === 'login'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMode('login')}
              >
                Log In
              </button>
              <button
                type="button"
                className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                  mode === 'register'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
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
                  ? 'Set up your roster and start building watch jobs.'
                  : 'Sign in to get back to your watchlist, holds, and saved occupants.'}
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
              <p className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
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
      </div>
    </div>
  )
}
