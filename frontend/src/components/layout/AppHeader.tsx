import { useEffect, useRef, useState } from 'react'
import { BellRing, ChevronDown, LockKeyhole, LogOut, Plus, Users } from 'lucide-react'
import { useElementHeightCssVar } from '@/lib/hooks'
import { cn } from '@/lib/utils'

function NavBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
        <img src="/favicon.svg" alt="" className="size-5" />
      </div>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Hut Hunter
      </span>
    </div>
  )
}

function AccountMenu({
  userEmail,
  logoutPending,
  onOpenOccupants,
  onOpenCredentials,
  onOpenNotifications,
  onCreateJob,
  onLogout,
}: {
  userEmail: string
  logoutPending: boolean
  onOpenOccupants: () => void
  onOpenCredentials: () => void
  onOpenNotifications: () => void
  onCreateJob: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const runAction = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-2 text-left ring-1 ring-black/5 transition hover:bg-secondary/60"
        onClick={() => setOpen((current) => !current)}
      >
        <div className="min-w-0">
          <p className="max-w-[11rem] truncate text-sm font-medium text-foreground">
            {userEmail}
          </p>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg ring-1 ring-black/5">
          <div className="border-b border-border/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Account
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {userEmail}
            </p>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70"
              onClick={() => runAction(onOpenNotifications)}
            >
              <BellRing className="size-4 text-muted-foreground" />
              Notifications
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70"
              onClick={() => runAction(onOpenCredentials)}
            >
              <LockKeyhole className="size-4 text-muted-foreground" />
              Booking Site Sign-Ins
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70"
              onClick={() => runAction(onOpenOccupants)}
            >
              <Users className="size-4 text-muted-foreground" />
              Campers
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70"
              onClick={() => runAction(onCreateJob)}
            >
              <Plus className="size-4 text-muted-foreground" />
              New Hunt
            </button>
            <button
              type="button"
              disabled={logoutPending}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => runAction(onLogout)}
            >
              <LogOut className="size-4 text-muted-foreground" />
              {logoutPending ? 'Signing Out…' : 'Sign Out'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AppHeader({
  userEmail,
  onLogout,
  logoutPending,
  onOpenOccupants,
  onOpenCredentials,
  onOpenNotifications,
  onCreateJob,
}: {
  userEmail: string
  onLogout: () => void
  logoutPending: boolean
  onOpenOccupants: () => void
  onOpenCredentials: () => void
  onOpenNotifications: () => void
  onCreateJob: () => void
}) {
  const headerRef = useElementHeightCssVar<HTMLDivElement>('--app-header-height')

  return (
    <div ref={headerRef} data-sticky-header="true" className="sticky top-0 z-50 isolate">
      <div className="border-b border-border/30 bg-background/94 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <NavBrand />
          <AccountMenu
            userEmail={userEmail}
            logoutPending={logoutPending}
            onOpenOccupants={onOpenOccupants}
            onOpenCredentials={onOpenCredentials}
            onOpenNotifications={onOpenNotifications}
            onCreateJob={onCreateJob}
            onLogout={onLogout}
          />
        </div>
      </div>
      {/* Gradient fade extending below the header — softens content scrolling under it (desktop only) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full hidden h-14 sm:block"
        style={{
          background: 'linear-gradient(to bottom, var(--background), transparent)',
          opacity: 0.8,
        }}
      />
    </div>
  )
}
