import { useElementHeightCssVar } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { NavBrand } from './NavBrand'
import { ThemeToggle } from './ThemeToggle'

export function AppHeader({
  userEmail,
  onLogout,
  logoutPending,
  onOpenOccupants,
  onOpenCredentials,
  onOpenNotifications,
  onCreateJob,
  onGoToDashboard,
  className,
}: {
  userEmail: string
  onLogout: () => void
  logoutPending: boolean
  onOpenOccupants: () => void
  onOpenCredentials: () => void
  onOpenNotifications: () => void
  onCreateJob: () => void
  onGoToDashboard: () => void
  className?: string
}) {
  const headerRef = useElementHeightCssVar<HTMLDivElement>('--app-header-height')

  return (
    <div ref={headerRef} data-sticky-header="true" className={cn('sticky top-0 z-50 isolate', className)}>
      <div className="border-b border-border/30 bg-background/94 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <NavBrand onClick={onGoToDashboard} />
          <div className="flex items-center gap-2">
            <ThemeToggle />
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
