import { useState } from 'react'
import axios from 'axios'
import { LockKeyhole, TentTree, UserPlus } from 'lucide-react'

import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { useAuth } from '@/lib/auth-context'

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
            <div className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <TentTree className="size-6" />
              </div>
                Hut Hunter
            </div>
            <p className="mt-8 text-sm font-medium uppercase tracking-[0.2em] text-primary/80">
              Booking Assistant
            </p>
            <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Snag reservations for popular, hard to book huts and campsites
            </h1>
            <p className="text-sm text-muted-foreground place-self-end">(*cough* Mueller Hut . . . )</p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Monitor hut/campsite availability, get notified fast, and secure reservation holds so you don't lose your spot!
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Hut Hunter keeps customizable availability checks, notifications, and auto-booking in one focused workflow across New Zealand DOC, BC Parks, Ontario Parks, and Parks Canada.
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-semibold text-foreground">Availability Checks</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Run regular checks across NZ Great Walks and standard huts, plus BC Parks, Ontario Parks, and Parks Canada campsites, with your preferred dates, direction, and party setup.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Route availability alerts to email or Gotify (*requires Gotify server configuration)
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-semibold text-foreground">Booking Holds and Auto-Booking</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Save your site logins (encrypted at rest) and camper details once, and Hut Hunter can continue through booking to secure a hold at the payment screen on NZ DOC, BC Parks, and Ontario Parks. Parks Canada is watch &amp; notify only — its SSO-only sign-in can't be automated.
              </p>
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground/80">
            Coming soon: Newfoundland and Yukon parks, plus an AI agent that builds new site adapters automatically.
          </p>
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
