import { useEffect, useRef, useState, type ComponentType } from 'react'
import { BellRing, ChevronDown, LockKeyhole, LogOut, Plus, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AccountMenu({
  userEmail,
  logoutPending,
  onOpenOccupants,
  onOpenCredentials,
  onOpenNotifications,
  onCreateJob,
  onLogout,
  className,
}: {
  userEmail: string
  logoutPending: boolean
  onOpenOccupants: () => void
  onOpenCredentials: () => void
  onOpenNotifications: () => void
  onCreateJob: () => void
  onLogout: () => void
  className?: string
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
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-2 text-left ring-1 ring-black/5 transition hover:bg-secondary/60 dark:ring-white/5"
        onClick={() => setOpen((current) => !current)}
      >
        <div className="min-w-0">
          <p className="max-w-44 truncate text-sm font-medium text-foreground">
            {userEmail}
          </p>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg ring-1 ring-black/5 dark:ring-white/5">
          <div className="border-b border-border/70 px-4 py-3">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground/70 uppercase">
              Account
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {userEmail}
            </p>
          </div>
          <div className="p-1.5">
            <AccountMenuItem
              icon={BellRing}
              label="Notifications"
              onClick={() => runAction(onOpenNotifications)}
            />
            <AccountMenuItem
              icon={LockKeyhole}
              label="Booking Site Sign-Ins"
              onClick={() => runAction(onOpenCredentials)}
            />
            <AccountMenuItem
              icon={Users}
              label="Campers"
              onClick={() => runAction(onOpenOccupants)}
            />
            <AccountMenuItem
              icon={Plus}
              label="New Hunt"
              onClick={() => runAction(onCreateJob)}
            />
            <AccountMenuItem
              icon={LogOut}
              label={logoutPending ? 'Signing Out…' : 'Sign Out'}
              onClick={() => runAction(onLogout)}
              disabled={logoutPending}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function AccountMenuItem({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onClick}
    >
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </button>
  )
}
