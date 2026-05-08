import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BellRing,
  Check,
  ChevronDown,
  Clock3,
  Filter,
  Hand,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  TentTree,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { CredentialsDialog } from '@/components/credentials/CredentialsDialog'
import { NotificationsDialog } from '@/components/notifications/NotificationsDialog'
import {
  type JobFilterKey,
  JOB_FILTERS,
  getJobFilterDefinition,
  matchesJobFilter,
  matchesJobFilters,
} from '@/components/jobs/jobFilters'
import {
  CreateJobDialog,
  CreateJobPage,
  EditJobDialog,
  EditJobPage,
} from '@/components/jobs/CreateJobDialog'
import { OccupantsDialog } from '@/components/occupants/OccupantsDialog'
import { Button } from '@/components/ui/button'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { adaptersApi, credentialsApi, occupantsApi, type WatchJob } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type AppRoute, useAppRoute, useIsMobile } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useJobsStore } from '@/store/jobs'

function getPrimarySection(route: AppRoute): 'dashboard' | 'jobs' {
  return route.name === 'dashboard' ? 'dashboard' : 'jobs'
}

function useElementHeightCssVar<T extends HTMLElement>(cssVarName: string) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const root = document.documentElement
    const update = () => {
      root.style.setProperty(cssVarName, `${node.getBoundingClientRect().height}px`)
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(node)
    window.addEventListener('resize', update)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty(cssVarName)
    }
  }, [cssVarName])

  return ref
}

type DashboardStat = {
  filterKey: JobFilterKey
  label: string
  value: number
  description: string
  icon: typeof Activity
}

// ─── App Header ───────────────────────────────────────────────────────────────

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

function AppHeader({
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
      {/* Gradient + side-vignette extending below — fades content scrolling under the header */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-14"
        style={{
          background: 'linear-gradient(to bottom, var(--background), transparent)',
          maskImage: 'linear-gradient(to right, transparent 0%, black 22%, black 78%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 22%, black 78%, transparent 100%)',
          opacity: 0.88,
        }}
      />
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

// ─── Filter Dropdown ──────────────────────────────────────────────────────────

function FilterDropdown({
  filters,
  onChange,
  filterCounts,
}: {
  filters: JobFilterKey[]
  onChange: (filters: JobFilterKey[]) => void
  filterCounts: Map<JobFilterKey, number>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const isFiltered = filters.length > 0 && !filters.includes('all')

  const label = isFiltered
    ? filters.map((k) => getJobFilterDefinition(k).label).join(', ')
    : 'All Hunts'

  const toggle = (key: JobFilterKey) => {
    if (key === 'all') {
      onChange([])
      setOpen(false)
      return
    }
    const without = filters.filter((f) => f !== 'all')
    const next = without.includes(key)
      ? without.filter((f) => f !== key)
      : [...without, key]
    onChange(next)
  }

  const isChecked = (key: JobFilterKey) => {
    if (key === 'all') return !isFiltered
    return filters.includes(key)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ring-1 ring-black/5',
          isFiltered
            ? 'border-primary/35 bg-primary/10 text-primary ring-primary/10'
            : 'border-border/70 bg-background/80 text-foreground hover:bg-secondary/60',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter className="size-3.5 shrink-0" />
        <span className="max-w-[180px] truncate">{label}</span>
        {isFiltered ? (
          <span
            role="button"
            aria-label="Clear filters"
            className="ml-0.5 flex size-4 cursor-pointer items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25"
            onClick={(e) => { e.stopPropagation(); onChange([]) }}
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground', open && 'rotate-180')} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[196px] overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg ring-1 ring-black/5">
          <div className="p-1.5">
            {JOB_FILTERS.map((filter) => {
              const count = filterCounts.get(filter.key) ?? 0
              const checked = isChecked(filter.key)

              return (
                <button
                  key={filter.key}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm font-medium',
                    checked
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-secondary/70',
                  )}
                  onClick={() => toggle(filter.key)}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border/80 bg-background',
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    {filter.label}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                      checked
                        ? 'bg-primary/15 text-primary'
                        : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stats Grid ───────────────────────────────────────────────────────────────

function OccupantsTile({ onOpen }: { onOpen: () => void }) {
  return (
    <article className="app-panel flex min-h-28 flex-col px-5 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
            <Users className="size-4" />
          </div>
          <p className="text-sm font-semibold tracking-tight text-foreground">
            Campers
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-500/10 hover:bg-amber-500/14"
          onClick={onOpen}
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-4 text-pretty text-muted-foreground">
        Add camper details to enable automated booking. Hut Hunter needs passenger info to complete checkout.
      </p>
    </article>
  )
}

function CredentialsTile({
  onOpen,
  missingCount,
}: {
  onOpen: () => void
  missingCount: number
}) {
  return (
    <article className="app-panel flex min-h-28 flex-col px-5 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
            <LockKeyhole className="size-4" />
          </div>
          <p className="text-sm font-semibold tracking-tight text-foreground">
            Sign-Ins
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/8 px-2 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-500/10 hover:bg-sky-500/14"
          onClick={onOpen}
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-4 text-pretty text-muted-foreground">
        Save your DOC login so Hut Hunter can continue from checks into booking.
        {missingCount > 1 ? ` ${missingCount} sites still need a sign-in.` : ''}
      </p>
    </article>
  )
}

function NoJobsTile({ onCreateJob }: { onCreateJob: () => void }) {
  return (
    <article className="flex min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock3 className="size-4.5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              No hunts yet
            </p>
            <p className="text-xs text-muted-foreground">
              Create a hunt to start monitoring.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onCreateJob}
        >
          <Plus className="size-4" />
          Create a Hunt
        </button>
      </div>
    </article>
  )
}

function CreateMoreJobsTile({ onCreateJob }: { onCreateJob: () => void }) {
  return (
    <article className="flex min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              New Hunt
            </p>
            <p className="text-xs text-muted-foreground">
              Monitor more routes or dates.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onCreateJob}
        >
          <Plus className="size-4" />
          Create
        </button>
      </div>
    </article>
  )
}

function StatsGrid({
  stats,
  totalJobs,
  activeFilters,
  hasOccupants,
  missingCredentialCount,
  onFilterSelect,
  onCreateJob,
  onOpenOccupants,
  onOpenCredentials,
  showNewHuntTile = true,
}: {
  stats: DashboardStat[]
  totalJobs: number
  activeFilters: JobFilterKey[]
  hasOccupants: boolean
  missingCredentialCount: number
  onFilterSelect: (filterKey: JobFilterKey) => void
  onCreateJob: () => void
  onOpenOccupants: () => void
  onOpenCredentials: () => void
  showNewHuntTile?: boolean
}) {
  const visibleStats = stats.filter((s) => s.value > 0)
  const showOccupantsTile = !hasOccupants
  const showCredentialsTile = missingCredentialCount > 0
  const showNoJobsTile = totalJobs === 0 && showNewHuntTile

  return (
    <section className="flex flex-wrap items-start gap-3">
      {showNoJobsTile ? (
        <div className="w-full sm:w-80">
          <NoJobsTile onCreateJob={onCreateJob} />
        </div>
      ) : (
        <>
          {visibleStats.map((stat) => {
            const isActive = activeFilters.includes(stat.filterKey)
            return (
              <article
                key={stat.filterKey}
                className={cn(
                  'app-panel w-full min-h-28 overflow-hidden px-5 py-3.5 sm:w-64',
                  isActive && 'ring-2 ring-primary/25',
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => onFilterSelect(stat.filterKey)}
                >
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                      {stat.value}
                    </p>
                  </div>
                  <div className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-2xl',
                    isActive ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary',
                  )}>
                    <stat.icon className="size-5" />
                  </div>
                </button>

                <p className="mt-2 text-xs leading-4 text-pretty text-muted-foreground">
                  {stat.description}
                </p>
              </article>
            )
          })}

          {showNewHuntTile && (
            <div className="w-full sm:w-80">
              <CreateMoreJobsTile onCreateJob={onCreateJob} />
            </div>
          )}
        </>
      )}

      {showOccupantsTile && (
        <div className="w-full sm:w-80">
          <OccupantsTile onOpen={onOpenOccupants} />
        </div>
      )}

      {showCredentialsTile && (
        <div className="w-full sm:w-80">
          <CredentialsTile onOpen={onOpenCredentials} missingCount={missingCredentialCount} />
        </div>
      )}
    </section>
  )
}

function MobilePrimaryNav({
  route,
  navigate,
}: {
  route: AppRoute
  navigate: (route: AppRoute) => void
}) {
  const navRef = useElementHeightCssVar<HTMLElement>('--app-mobile-nav-height')
  const activeSection = getPrimarySection(route)

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-0 border-t border-border/70 bg-background/96 px-4 py-3 backdrop-blur"
    >
      <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
        <Button
          variant={activeSection === 'dashboard' ? 'default' : 'outline'}
          onClick={() => navigate({ name: 'dashboard' })}
        >
          <LayoutDashboard className="size-4" />
          Dashboard
        </Button>
        <Button
          variant={activeSection === 'jobs' ? 'default' : 'outline'}
          onClick={() => navigate({ name: 'jobs' })}
        >
          <Search className="size-4" />
          Hunts
        </Button>
      </div>
    </nav>
  )
}

// ─── Shared prop type ─────────────────────────────────────────────────────────

type AppViewProps = {
  userEmail: string
  onLogout: () => void
  logoutPending: boolean
  stats: DashboardStat[]
  totalJobs: number
  route: AppRoute
  navigate: (route: AppRoute, options?: { replace?: boolean }) => void
  selectedJob: WatchJob | null
  setSelectedJobId: (jobId: string | null) => void
  statusFilters: JobFilterKey[]
  filterCounts: Map<JobFilterKey, number>
  onStatusFiltersChange: (filters: JobFilterKey[]) => void
  occupantsOpen: boolean
  setOccupantsOpen: (open: boolean) => void
  credentialsOpen: boolean
  setCredentialsOpen: (open: boolean) => void
  notificationsOpen: boolean
  setNotificationsOpen: (open: boolean) => void
  hasOccupants: boolean
  missingCredentialCount: number
}

// ─── Desktop App ──────────────────────────────────────────────────────────────

function DesktopApp({
  userEmail,
  onLogout,
  logoutPending,
  stats,
  totalJobs,
  route,
  navigate,
  selectedJob,
  setSelectedJobId,
  statusFilters,
  filterCounts,
  onStatusFiltersChange,
  occupantsOpen,
  setOccupantsOpen,
  credentialsOpen,
  setCredentialsOpen,
  notificationsOpen,
  setNotificationsOpen,
  hasOccupants,
  missingCredentialCount,
}: AppViewProps) {
  return (
    <div className="app-shell flex h-dvh flex-col overflow-y-auto">
      <AppHeader
        userEmail={userEmail}
        onLogout={onLogout}
        logoutPending={logoutPending}
        onOpenOccupants={() => setOccupantsOpen(true)}
        onOpenCredentials={() => setCredentialsOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onCreateJob={() => navigate({ name: 'create-job' })}
      />

      <div className="mx-auto flex w-full max-w-7xl flex-1 min-h-0 flex-col px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="dashboard-enter">
          <StatsGrid
            stats={stats}
            totalJobs={totalJobs}
            activeFilters={statusFilters}
            hasOccupants={hasOccupants}
            missingCredentialCount={missingCredentialCount}
            onFilterSelect={(key) => onStatusFiltersChange([key])}
            onCreateJob={() => navigate({ name: 'create-job' })}
            onOpenOccupants={() => setOccupantsOpen(true)}
            onOpenCredentials={() => setCredentialsOpen(true)}
            showNewHuntTile={false}
          />
        </div>

        <main className="dashboard-enter-delay mt-5 grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)] xl:grid-rows-[minmax(0,1fr)]">
          <section className="app-panel app-panel-frame">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4 sm:px-6">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Hunts
              </h2>
              <div className="flex items-center gap-2">
                <FilterDropdown
                  filters={statusFilters}
                  onChange={onStatusFiltersChange}
                  filterCounts={filterCounts}
                />
                <Button size="sm" onClick={() => navigate({ name: 'create-job' })}>
                  <Plus className="size-4" />
                  New Hunt
                </Button>
              </div>
            </div>
            <div className="app-panel-body-scroll px-4 sm:px-6">
              <div className="pt-6 pb-6">
                <JobList
                  statusFilters={statusFilters}
                  onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
                />
              </div>
            </div>
          </section>

          <aside className="min-h-0">
            <JobCard
              className="h-full"
              onRequestEdit={(job) => navigate({ name: 'edit-job', jobId: job.id })}
            />
          </aside>
        </main>
      </div>

      <OccupantsDialog open={occupantsOpen} onOpenChange={setOccupantsOpen} />
      <NotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      <CredentialsDialog open={credentialsOpen} onOpenChange={setCredentialsOpen} />

      <CreateJobDialog
        open={route.name === 'create-job'}
        onDone={(job) => {
          setSelectedJobId(job.id)
          navigate({ name: 'dashboard' }, { replace: true })
        }}
        onOpenChange={(open) => {
          if (!open) navigate({ name: 'dashboard' }, { replace: true })
        }}
        hideTrigger
      />
      {selectedJob && (
        <EditJobDialog
          open={route.name === 'edit-job'}
          onOpenChange={(open) => {
            if (!open) navigate({ name: 'job-detail', jobId: selectedJob.id }, { replace: true })
          }}
          job={selectedJob}
        />
      )}
    </div>
  )
}

// ─── Mobile App ───────────────────────────────────────────────────────────────

function MobileApp({
  userEmail,
  onLogout,
  logoutPending,
  stats,
  totalJobs,
  route,
  navigate,
  selectedJob,
  setSelectedJobId,
  statusFilters,
  filterCounts,
  onStatusFiltersChange,
  occupantsOpen,
  setOccupantsOpen,
  credentialsOpen,
  setCredentialsOpen,
  notificationsOpen,
  setNotificationsOpen,
  hasOccupants,
  missingCredentialCount,
}: AppViewProps) {
  const hasFullscreenCardRoute = route.name !== 'dashboard'
  const mobileNavPadding = 'calc(var(--app-mobile-nav-height, 0px) + 1rem)'

  return (
    <div className="app-shell flex h-dvh flex-col overflow-y-auto">
      <AppHeader
        userEmail={userEmail}
        onLogout={onLogout}
        logoutPending={logoutPending}
        onOpenOccupants={() => setOccupantsOpen(true)}
        onOpenCredentials={() => setCredentialsOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onCreateJob={() => navigate({ name: 'create-job' })}
      />

      <div
        className={cn(
          'mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col gap-4 px-4 pt-4',
        )}
        style={{ paddingBottom: hasFullscreenCardRoute ? mobileNavPadding : mobileNavPadding }}
      >
        {route.name === 'dashboard' && (
          <StatsGrid
            stats={stats}
            totalJobs={totalJobs}
            activeFilters={statusFilters}
            hasOccupants={hasOccupants}
            missingCredentialCount={missingCredentialCount}
            onFilterSelect={(key) => {
              onStatusFiltersChange([key])
              navigate({ name: 'jobs' })
            }}
            onCreateJob={() => navigate({ name: 'create-job' })}
            onOpenOccupants={() => setOccupantsOpen(true)}
            onOpenCredentials={() => setCredentialsOpen(true)}
          />
        )}

        {route.name === 'jobs' && (
          <section className="app-panel app-panel-frame flex-1">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Hunts
              </h2>
              <div className="flex items-center gap-2">
                <FilterDropdown
                  filters={statusFilters}
                  onChange={onStatusFiltersChange}
                  filterCounts={filterCounts}
                />
                <Button size="sm" onClick={() => navigate({ name: 'create-job' })}>
                  <Plus className="size-4" />
                  New Hunt
                </Button>
              </div>
            </div>
            <div className="app-panel-body-scroll px-4 sm:px-5">
              <div className="pt-6 pb-6">
                <JobList
                  collapseGroupsByDefault
                  statusFilters={statusFilters}
                  onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
                />
              </div>
            </div>
          </section>
        )}

        {route.name === 'job-detail' && (
          <JobCard
            className="flex-1"
            backLabel="Hunts"
            onBack={() => navigate({ name: 'jobs' })}
            onRequestEdit={(job) => navigate({ name: 'edit-job', jobId: job.id })}
            onDeleted={() => navigate({ name: 'jobs' }, { replace: true })}
          />
        )}

        {route.name === 'create-job' && (
          <CreateJobPage
            backLabel="Hunts"
            onBack={() => navigate({ name: 'jobs' })}
            onDone={(job) => {
              setSelectedJobId(job.id)
              navigate({ name: 'jobs' }, { replace: true })
            }}
          />
        )}

        {route.name === 'edit-job' && selectedJob && (
          <EditJobPage
            job={selectedJob}
            backLabel="Hunt"
            onBack={() => navigate({ name: 'job-detail', jobId: selectedJob.id })}
            onDone={(job) => navigate({ name: 'job-detail', jobId: job.id }, { replace: true })}
          />
        )}
      </div>

      <OccupantsDialog open={occupantsOpen} onOpenChange={setOccupantsOpen} />
      <NotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      <CredentialsDialog open={credentialsOpen} onOpenChange={setCredentialsOpen} />
      <MobilePrimaryNav route={route} navigate={navigate} />
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="app-shell min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-3xl items-center justify-center px-4 py-6">
        <div className="app-panel w-full max-w-md px-6 py-10 text-center sm:px-8">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <TentTree className="size-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
            Loading your workspace
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Checking your session and restoring your hunts.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function AuthenticatedApp({
  userEmail,
  onLogout,
  logoutPending,
}: {
  userEmail: string
  onLogout: () => void
  logoutPending: boolean
}) {
  const isMobile = useIsMobile()
  const { route, navigate } = useAppRoute()
  const {
    pendingBookings,
    selectedJobId,
    setSelectedJobId,
  } = useJobsStore()
  const { data: jobs = [], isFetched } = useJobsQuery()
  const [statusFilters, setStatusFilters] = useState<JobFilterKey[]>([])
  const [occupantsOpen, setOccupantsOpen] = useState(false)
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const { data: occupants = [] } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })
  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })
  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials'],
    queryFn: credentialsApi.list,
  })
  const hasOccupants = occupants.length > 0
  const missingCredentialCount = useMemo(() => {
    const configuredAdapterIds = new Set(credentials.map((credential) => credential.adapter_id))
    return adapters.filter(
      (adapter) => adapter.requires_credentials && !configuredAdapterIds.has(adapter.adapter_id),
    ).length
  }, [adapters, credentials])

  const sortedJobs = useMemo(
    () => [...jobs].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [jobs],
  )

  const filteredJobs = useMemo(
    () => sortedJobs.filter((job) => matchesJobFilters(job, statusFilters, pendingBookings)),
    [pendingBookings, sortedJobs, statusFilters],
  )

  const filterCounts = useMemo(
    () => new Map(
      JOB_FILTERS.map((filter) => [
        filter.key,
        sortedJobs.filter((job) => filter.matches(job, pendingBookings)).length,
      ]),
    ),
    [sortedJobs, pendingBookings],
  )

  const selectedJob = selectedJobId
    ? sortedJobs.find((job) => job.id === selectedJobId) ?? null
    : null

  const applyStatusFilters = (nextFilters: JobFilterKey[]) => {
    setStatusFilters(nextFilters)

    const nextJobs = sortedJobs.filter((job) => matchesJobFilters(job, nextFilters, pendingBookings))
    if (!selectedJobId || !nextJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(null)
    }

    if (isMobile && route.name === 'dashboard') {
      navigate({ name: 'jobs' })
    }
  }

  const stats: DashboardStat[] = [
    {
      filterKey: 'active',
      label: 'Active',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'active', pendingBookings)).length,
      description: 'Hunts still in play and ready for action.',
      icon: Activity,
    },
    {
      filterKey: 'ready',
      label: 'Ready To Book',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'ready', pendingBookings)).length,
      description: 'Latest checks show every requested site available.',
      icon: TentTree,
    },
    {
      filterKey: 'holds',
      label: 'Live Holds',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'holds', pendingBookings)).length,
      description: 'Hunts currently holding inventory pending checkout.',
      icon: Hand,
    },
    {
      filterKey: 'booking_complete',
      label: 'Completed',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'booking_complete', pendingBookings)).length,
      description: 'Bookings that reached a confirmed receipt state.',
      icon: Check,
    },
    {
      filterKey: 'cancelled',
      label: 'Cancelled',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'cancelled', pendingBookings)).length,
      description: 'Hunts manually stopped before completion.',
      icon: XCircle,
    },
    {
      filterKey: 'expired',
      label: 'Expired',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'expired', pendingBookings)).length,
      description: 'Hunts whose booking windows have already passed.',
      icon: Clock3,
    },
  ]

  useEffect(() => {
    if (route.name === 'job-detail' || route.name === 'edit-job') {
      if (selectedJobId !== route.jobId) {
        setSelectedJobId(route.jobId)
      }
    }
  }, [route, selectedJobId, setSelectedJobId])

  useEffect(() => {
    if (
      isFetched
      && (route.name === 'job-detail' || route.name === 'edit-job')
      && !sortedJobs.some((job) => job.id === route.jobId)
    ) {
      navigate({ name: 'jobs' }, { replace: true })
    }
  }, [isFetched, navigate, route, sortedJobs])

  useEffect(() => {
    if (route.name === 'job-detail' || route.name === 'edit-job') return
    if (!selectedJobId) return
    if (filteredJobs.some((job) => job.id === selectedJobId)) return

    setSelectedJobId(null)
  }, [filteredJobs, route, selectedJobId, setSelectedJobId])

  useEffect(() => {
    if (!isMobile) return
    if (route.name === 'jobs' && selectedJobId) return
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [isMobile, route, selectedJobId])

  const sharedProps: AppViewProps = {
    userEmail,
    onLogout,
    logoutPending,
    stats,
    totalJobs: sortedJobs.length,
    route,
    navigate,
    selectedJob,
    setSelectedJobId,
    statusFilters,
    filterCounts,
    onStatusFiltersChange: applyStatusFilters,
    occupantsOpen,
    setOccupantsOpen,
    credentialsOpen,
    setCredentialsOpen,
    notificationsOpen,
    setNotificationsOpen,
    hasOccupants,
    missingCredentialCount,
  }

  if (isMobile) {
    return <MobileApp {...sharedProps} />
  }

  return <DesktopApp {...sharedProps} />
}

export default function App() {
  const { user, status, logout, logoutPending } = useAuth()

  if (status === 'loading') {
    return <LoadingScreen />
  }

  if (!user) {
    return <AuthScreen />
  }

  return (
    <AuthenticatedApp
      userEmail={user.email}
      onLogout={() => {
        void logout()
      }}
      logoutPending={logoutPending}
    />
  )
}
