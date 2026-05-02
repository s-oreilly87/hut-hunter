import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Filter,
  Hand,
  LayoutDashboard,
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
import { occupantsApi, type WatchJob } from '@/lib/api'
import { type AppRoute, useAppRoute, useIsMobile } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useJobsStore } from '@/store/jobs'

function getPrimarySection(route: AppRoute): 'dashboard' | 'jobs' {
  return route.name === 'dashboard' ? 'dashboard' : 'jobs'
}

function getJobSelector(jobId: string): string {
  const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(jobId)
    : jobId.replace(/"/g, '\\"')

  return `[data-job-id="${escapedId}"]`
}

function getMobileStickyHeaderOffset(): number {
  if (typeof window === 'undefined') return 64

  const stickyHeader = document.querySelector<HTMLElement>('[data-sticky-header="true"]')
  const headerHeight = stickyHeader?.getBoundingClientRect().height ?? 0

  return headerHeight + 16
}

function getJobTitle(job: WatchJob): string {
  const trimmed = job.name.trim()
  return trimmed || 'Untitled Job'
}

type DashboardStat = {
  filterKey: JobFilterKey
  label: string
  value: number
  description: string
  icon: typeof Activity
  jobs: WatchJob[]
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
  onOpenOccupants,
  onCreateJob,
}: {
  onOpenOccupants: () => void
  onCreateJob: () => void
}) {
  return (
    <div data-sticky-header="true" className="sticky top-0 z-50 isolate">
      <div className="border-b border-border/30 bg-background/94 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <NavBrand />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenOccupants}
              className="gap-1.5 sm:min-w-36"
            >
              <Users className="size-4" />
              <span>Occupants</span>
            </Button>
            <Button
              onClick={onCreateJob}
              size="sm"
              className="gap-1.5 sm:min-w-40"
            >
              <Plus className="size-4" />
              New Watch Job
            </Button>
          </div>
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
    : 'All Jobs'

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
    <article className="app-panel flex min-h-52 flex-col px-5 py-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
        <Users className="size-5" />
      </div>
      <div className="mt-4 flex-1">
        <p className="text-sm font-semibold tracking-tight text-foreground">
          No Occupants Added
        </p>
        <p className="mt-2 text-sm leading-5 text-pretty text-muted-foreground">
          Add occupant details to enable the automated booking flow — Hut Hunter needs passenger info to complete checkout.
        </p>
      </div>
      <button
        type="button"
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-sm font-medium text-amber-700 ring-1 ring-amber-500/10 hover:bg-amber-500/14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        onClick={onOpen}
      >
        <Plus className="size-3.5" />
        Add Occupants
      </button>
    </article>
  )
}

function NoJobsTile({ onCreateJob }: { onCreateJob: () => void }) {
  return (
    <article className="flex min-h-52 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Clock3 className="size-5" />
      </div>
      <p className="mt-3 text-sm font-semibold tracking-tight text-foreground">
        No watch jobs yet
      </p>
      <p className="mt-1.5 max-w-[22ch] text-sm leading-5 text-pretty text-muted-foreground">
        Create a job to start monitoring availability.
      </p>
      <button
        type="button"
        className="mt-4 flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={onCreateJob}
      >
        <Plus className="size-3.5" />
        Create a Watch Job
      </button>
    </article>
  )
}

function StatsGrid({
  stats,
  activeFilters,
  hasOccupants,
  onFilterSelect,
  onJobSelect,
  onCreateJob,
  onOpenOccupants,
}: {
  stats: DashboardStat[]
  activeFilters: JobFilterKey[]
  hasOccupants: boolean
  onFilterSelect: (filterKey: JobFilterKey) => void
  onJobSelect: (filterKey: JobFilterKey, jobId: string) => void
  onCreateJob: () => void
  onOpenOccupants: () => void
}) {
  const visibleStats = stats.filter((s) => s.value > 1)
  const showOccupantsTile = !hasOccupants
  const noJobTiles = visibleStats.length === 0

  return (
    <section className="flex flex-wrap gap-3">
      {noJobTiles ? (
        <div className={cn('min-w-[220px] flex-1', !showOccupantsTile && 'basis-full')}>
          <NoJobsTile onCreateJob={onCreateJob} />
        </div>
      ) : (
        visibleStats.map((stat) => {
          const isActive = activeFilters.includes(stat.filterKey)
          return (
            <article
              key={stat.filterKey}
              className={cn(
                'app-panel min-w-[180px] flex-1 px-5 py-5',
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

              <p className="mt-3 text-sm leading-5 text-pretty text-muted-foreground">
                {stat.description}
              </p>

              <div className="mt-4 min-h-0 flex-1">
                {stat.jobs.length > 0 ? (
                  <div className="max-h-40 space-y-0.5 overflow-y-auto pr-0.5">
                    {stat.jobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        className="block w-full truncate rounded-xl px-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-secondary/70 hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation()
                          onJobSelect(stat.filterKey, job.id)
                        }}
                        title={getJobTitle(job)}
                      >
                        {getJobTitle(job)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center">
                    <p className="text-sm text-muted-foreground">
                      {getJobFilterDefinition(stat.filterKey).emptyLabel}
                    </p>
                  </div>
                )}
              </div>
            </article>
          )
        })
      )}

      {showOccupantsTile && (
        <div className="min-w-[220px] flex-1">
          <OccupantsTile onOpen={onOpenOccupants} />
        </div>
      )}
    </section>
  )
}

// ─── Mobile Navigation ────────────────────────────────────────────────────────

function MobileBackBar({
  backLabel,
  onBack,
}: {
  backLabel?: string
  onBack: () => void
}) {
  return (
    <div className="px-1 pt-3">
      <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
        <ArrowLeft className="size-4" />
        {backLabel ?? 'Back'}
      </Button>
    </div>
  )
}

function MobilePrimaryNav({
  route,
  navigate,
}: {
  route: AppRoute
  navigate: (route: AppRoute) => void
}) {
  const activeSection = getPrimarySection(route)

  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-border/70 bg-background/96 px-4 py-3 backdrop-blur">
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
          Watch Jobs
        </Button>
      </div>
    </nav>
  )
}

// ─── Shared prop type ─────────────────────────────────────────────────────────

type AppViewProps = {
  stats: DashboardStat[]
  route: AppRoute
  navigate: (route: AppRoute, options?: { replace?: boolean }) => void
  selectedJob: WatchJob | null
  setSelectedJobId: (jobId: string | null) => void
  statusFilters: JobFilterKey[]
  filterCounts: Map<JobFilterKey, number>
  onStatusFiltersChange: (filters: JobFilterKey[]) => void
  onDashboardJobSelect: (filterKey: JobFilterKey, jobId: string) => void
  occupantsOpen: boolean
  setOccupantsOpen: (open: boolean) => void
  hasOccupants: boolean
}

// ─── Desktop App ──────────────────────────────────────────────────────────────

function DesktopApp({
  stats,
  route,
  navigate,
  selectedJob,
  setSelectedJobId,
  statusFilters,
  filterCounts,
  onStatusFiltersChange,
  onDashboardJobSelect,
  occupantsOpen,
  setOccupantsOpen,
  hasOccupants,
}: AppViewProps) {
  return (
    <div className="app-shell min-h-dvh">
      <AppHeader
        onOpenOccupants={() => setOccupantsOpen(true)}
        onCreateJob={() => navigate({ name: 'create-job' })}
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="dashboard-enter">
          <StatsGrid
            stats={stats}
            activeFilters={statusFilters}
            hasOccupants={hasOccupants}
            onFilterSelect={(key) => onStatusFiltersChange([key])}
            onJobSelect={onDashboardJobSelect}
            onCreateJob={() => navigate({ name: 'create-job' })}
            onOpenOccupants={() => setOccupantsOpen(true)}
          />
        </div>

        <main className="dashboard-enter-delay mt-5 grid flex-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)]">
          <section className="app-panel flex min-h-[26rem] flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4 sm:px-6">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Watch Jobs
              </h2>
              <FilterDropdown
                filters={statusFilters}
                onChange={onStatusFiltersChange}
                filterCounts={filterCounts}
              />
            </div>
            <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
              <JobList
                statusFilters={statusFilters}
                onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
              />
            </div>
          </section>

          <aside className="xl:sticky xl:top-20 xl:self-start">
            <JobCard
              onRequestEdit={(job) => navigate({ name: 'edit-job', jobId: job.id })}
            />
          </aside>
        </main>
      </div>

      <OccupantsDialog open={occupantsOpen} onOpenChange={setOccupantsOpen} />

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
  stats,
  route,
  navigate,
  selectedJob,
  setSelectedJobId,
  statusFilters,
  filterCounts,
  onStatusFiltersChange,
  onDashboardJobSelect,
  occupantsOpen,
  setOccupantsOpen,
  hasOccupants,
}: AppViewProps) {
  return (
    <div className="app-shell min-h-dvh pb-24">
      <AppHeader
        onOpenOccupants={() => setOccupantsOpen(true)}
        onCreateJob={() => navigate({ name: 'create-job' })}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-4 pt-4">
        {route.name === 'dashboard' && (
          <StatsGrid
            stats={stats}
            activeFilters={statusFilters}
            hasOccupants={hasOccupants}
            onFilterSelect={(key) => {
              onStatusFiltersChange([key])
              navigate({ name: 'jobs' })
            }}
            onJobSelect={onDashboardJobSelect}
            onCreateJob={() => navigate({ name: 'create-job' })}
            onOpenOccupants={() => setOccupantsOpen(true)}
          />
        )}

        {route.name === 'jobs' && (
          <section className="app-panel flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Watch Jobs
              </h2>
              <FilterDropdown
                filters={statusFilters}
                onChange={onStatusFiltersChange}
                filterCounts={filterCounts}
              />
            </div>
            <div className="px-4 py-4 sm:px-5">
              <JobList
                collapseGroupsByDefault
                showIndexes
                statusFilters={statusFilters}
                onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
              />
            </div>
          </section>
        )}

        {route.name === 'job-detail' && (
          <>
            <MobileBackBar
              backLabel="Watch Jobs"
              onBack={() => navigate({ name: 'jobs' })}
            />
            <JobCard
              onRequestEdit={(job) => navigate({ name: 'edit-job', jobId: job.id })}
              onDeleted={() => navigate({ name: 'jobs' }, { replace: true })}
            />
          </>
        )}

        {route.name === 'create-job' && (
          <>
            <MobileBackBar
              backLabel="Watch Jobs"
              onBack={() => navigate({ name: 'jobs' })}
            />
            <CreateJobPage
              onDone={(job) => {
                setSelectedJobId(job.id)
                navigate({ name: 'jobs' }, { replace: true })
              }}
            />
          </>
        )}

        {route.name === 'edit-job' && selectedJob && (
          <>
            <MobileBackBar
              backLabel="Job Card"
              onBack={() => navigate({ name: 'job-detail', jobId: selectedJob.id })}
            />
            <EditJobPage
              job={selectedJob}
              onDone={(job) => navigate({ name: 'job-detail', jobId: job.id }, { replace: true })}
            />
          </>
        )}
      </div>

      <OccupantsDialog open={occupantsOpen} onOpenChange={setOccupantsOpen} />
      <MobilePrimaryNav route={route} navigate={navigate} />
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
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

  const { data: occupants = [] } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })
  const hasOccupants = occupants.length > 0

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

  const handleDashboardJobSelect = (filterKey: JobFilterKey, jobId: string) => {
    setStatusFilters([filterKey])
    setSelectedJobId(jobId)

    if (isMobile) {
      navigate({ name: 'job-detail', jobId })
    }
  }

  const stats: DashboardStat[] = [
    {
      filterKey: 'active',
      label: 'Active',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'active', pendingBookings)).length,
      description: 'Jobs still in play and ready for action.',
      icon: Activity,
      jobs: sortedJobs.filter((job) => matchesJobFilter(job, 'active', pendingBookings)),
    },
    {
      filterKey: 'ready',
      label: 'Ready To Book',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'ready', pendingBookings)).length,
      description: 'Latest checks show every requested site available.',
      icon: TentTree,
      jobs: sortedJobs.filter((job) => matchesJobFilter(job, 'ready', pendingBookings)),
    },
    {
      filterKey: 'holds',
      label: 'Live Holds',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'holds', pendingBookings)).length,
      description: 'Jobs currently holding inventory pending checkout.',
      icon: Hand,
      jobs: sortedJobs.filter((job) => matchesJobFilter(job, 'holds', pendingBookings)),
    },
    {
      filterKey: 'cancelled',
      label: 'Cancelled',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'cancelled', pendingBookings)).length,
      description: 'Jobs manually stopped before completion.',
      icon: XCircle,
      jobs: sortedJobs.filter((job) => matchesJobFilter(job, 'cancelled', pendingBookings)),
    },
    {
      filterKey: 'expired',
      label: 'Expired',
      value: sortedJobs.filter((job) => matchesJobFilter(job, 'expired', pendingBookings)).length,
      description: 'Jobs whose booking windows have already passed.',
      icon: Clock3,
      jobs: sortedJobs.filter((job) => matchesJobFilter(job, 'expired', pendingBookings)),
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

  useEffect(() => {
    if (!isMobile) return
    if (route.name !== 'jobs' || !selectedJobId) return

    let cancelled = false

    const scrollSelectedJobIntoView = () => {
      if (cancelled) return

      const selectedNode = document.querySelector<HTMLElement>(getJobSelector(selectedJobId))
      if (!selectedNode) return

      const top = Math.max(
        0,
        selectedNode.getBoundingClientRect().top + window.scrollY - getMobileStickyHeaderOffset(),
      )
      window.scrollTo({ top, left: 0, behavior: 'auto' })
    }

    const timeoutId = window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(scrollSelectedJobIntoView)
      })
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [isMobile, route, selectedJobId])

  const sharedProps: AppViewProps = {
    stats,
    route,
    navigate,
    selectedJob,
    setSelectedJobId,
    statusFilters,
    filterCounts,
    onStatusFiltersChange: applyStatusFilters,
    onDashboardJobSelect: handleDashboardJobSelect,
    occupantsOpen,
    setOccupantsOpen,
    hasOccupants,
  }

  if (isMobile) {
    return <MobileApp {...sharedProps} />
  }

  return <DesktopApp {...sharedProps} />
}
