import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  Clock3,
  Hand,
  LayoutDashboard,
  Plus,
  Search,
  TentTree,
  XCircle,
} from 'lucide-react'
import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import {
  type JobFilterKey,
  getJobFilterDefinition,
  isLiveJob,
  matchesJobFilter,
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
import type { WatchJob } from '@/lib/api'
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

function StatsGrid({
  stats,
  activeFilter,
  onFilterSelect,
  onJobSelect,
}: {
  stats: DashboardStat[]
  activeFilter: JobFilterKey
  onFilterSelect: (filterKey: JobFilterKey) => void
  onJobSelect: (filterKey: JobFilterKey, jobId: string) => void
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {stats.map((stat) => (
        <article
          key={stat.filterKey}
          className={cn(
            'app-panel flex min-h-60 flex-col px-5 py-5 transition-all',
            activeFilter === stat.filterKey && 'ring-2 ring-primary/25',
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
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                {stat.value}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <stat.icon className="h-5 w-5" />
            </div>
          </button>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {stat.description}
          </p>

          <div className="mt-4 min-h-0 flex-1">
            {stat.jobs.length ? (
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {stat.jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="block w-full truncate rounded-xl px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 hover:text-primary"
                    onClick={(event) => {
                      event.stopPropagation()
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
      ))}
    </section>
  )
}

function CreateJobButton({
  onClick,
  className,
  size,
}: {
  onClick: () => void
  className?: string
  size?: ComponentProps<typeof Button>['size']
}) {
  return (
    <Button
      onClick={onClick}
      size={size}
      className={cn('sm:min-w-40', className)}
    >
      <Plus className="h-4 w-4" />
      New Watch Job
    </Button>
  )
}

function BrandLockup({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean
  className?: string
}) {
  if (iconOnly) {
    return (
      <div className={cn('inline-flex items-center', className)}>
        <img src="/favicon.svg" alt="Hut Hunter" className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-3 rounded-2xl border border-border/70 bg-background/88 px-3 py-2 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
        <img src="/favicon.svg" alt="" className="h-6 w-6" />
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Hut Hunter
      </span>
    </div>
  )
}

function MobileActionBar({
  leading,
  actions,
}: {
  leading?: ReactNode
  actions?: ReactNode
}) {
  if (!leading && !actions) return null

  return (
    <div className="-mx-4 sticky top-0 z-30 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">{leading}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

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
        <ArrowLeft className="h-4 w-4" />
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
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Button>
        <Button
          variant={activeSection === 'jobs' ? 'default' : 'outline'}
          onClick={() => navigate({ name: 'jobs' })}
        >
          <Search className="h-4 w-4" />
          Watch Jobs
        </Button>
      </div>
    </nav>
  )
}

function DesktopApp({
  stats,
  activeJobsCount,
  route,
  navigate,
  selectedJob,
  setSelectedJobId,
  statusFilter,
  onStatusFilterChange,
  onDashboardJobSelect,
}: {
  stats: DashboardStat[]
  activeJobsCount: number
  route: AppRoute
  navigate: (route: AppRoute, options?: { replace?: boolean }) => void
  selectedJob: WatchJob | null
  setSelectedJobId: (jobId: string | null) => void
  statusFilter: JobFilterKey
  onStatusFilterChange: (filterKey: JobFilterKey) => void
  onDashboardJobSelect: (filterKey: JobFilterKey, jobId: string) => void
}) {
  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <header className="dashboard-enter app-panel relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
          <div className="absolute inset-y-0 right-0 hidden w-2/5 bg-[radial-gradient(circle_at_top,rgba(48,120,86,0.2),transparent_60%)] lg:block" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="space-y-3">
                <BrandLockup />
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Never miss a chance to book your hut!
                </h1>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
                  {activeJobsCount} bookings being watched
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <OccupantsDialog />
              <CreateJobButton onClick={() => navigate({ name: 'create-job' })} />
            </div>
          </div>
        </header>

        <div className="dashboard-enter-delay mt-5">
          <StatsGrid
            stats={stats}
            activeFilter={statusFilter}
            onFilterSelect={onStatusFilterChange}
            onJobSelect={onDashboardJobSelect}
          />
        </div>

        <main className="dashboard-enter-late mt-5 grid flex-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)]">
          <section className="app-panel flex min-h-104 flex-col overflow-hidden">
            <div className="border-b border-border/80 px-5 py-5 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Watch Jobs
              </h2>
            </div>
            <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
              <JobList
                statusFilter={statusFilter}
                onStatusFilterChange={onStatusFilterChange}
                onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
              />
            </div>
          </section>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <JobCard
              onRequestEdit={(job) => navigate({ name: 'edit-job', jobId: job.id })}
            />
          </aside>
        </main>
      </div>

      <CreateJobDialog
        open={route.name === 'create-job'}
        onDone={(job) => {
          setSelectedJobId(job.id)
          navigate({ name: 'dashboard' }, { replace: true })
        }}
        onOpenChange={(open) => {
          if (!open) {
            navigate({ name: 'dashboard' }, { replace: true })
          }
        }}
        hideTrigger
      />
      {selectedJob && (
        <EditJobDialog
          open={route.name === 'edit-job'}
          onOpenChange={(open) => {
            if (!open) {
              navigate({ name: 'job-detail', jobId: selectedJob.id }, { replace: true })
            }
          }}
          job={selectedJob}
        />
      )}
    </div>
  )
}

function MobileApp({
  stats,
  route,
  navigate,
  selectedJob,
  setSelectedJobId,
  statusFilter,
  onStatusFilterChange,
  onDashboardJobSelect,
}: {
  stats: DashboardStat[]
  route: AppRoute
  navigate: (route: AppRoute, options?: { replace?: boolean }) => void
  selectedJob: WatchJob | null
  setSelectedJobId: (jobId: string | null) => void
  statusFilter: JobFilterKey
  onStatusFilterChange: (filterKey: JobFilterKey) => void
  onDashboardJobSelect: (filterKey: JobFilterKey, jobId: string) => void
}) {
  return (
    <div className="app-shell min-h-screen pb-24">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 pb-4 pt-0">
        {route.name === 'dashboard' && (
          <>
            <MobileActionBar
              leading={<BrandLockup iconOnly className="shrink-0" />}
              actions={(
                <>
                  <OccupantsDialog />
                  <CreateJobButton
                    onClick={() => navigate({ name: 'create-job' })}
                    size="sm"
                    className="sm:flex-none"
                  />
                </>
              )}
            />
            <StatsGrid
              stats={stats}
              activeFilter={statusFilter}
              onFilterSelect={onStatusFilterChange}
              onJobSelect={onDashboardJobSelect}
            />
          </>
        )}

        {route.name === 'jobs' && (
          <>
            <MobileActionBar
              leading={<BrandLockup iconOnly className="shrink-0" />}
              actions={(
                <>
                  <OccupantsDialog />
                  <CreateJobButton
                    onClick={() => navigate({ name: 'create-job' })}
                    size="sm"
                  />
                </>
              )}
            />
            <section className="app-panel px-4 py-5">
              <div className="mb-4 border-b border-border/80 pb-4">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  Watch Jobs
                </h2>
              </div>
              <JobList
                collapseGroupsByDefault
                showIndexes
                statusFilter={statusFilter}
                onStatusFilterChange={onStatusFilterChange}
                onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
              />
            </section>
          </>
        )}

        {route.name === 'job-detail' && (
          <>
            <MobileActionBar leading={<BrandLockup iconOnly className="shrink-0" />} />
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

      <MobilePrimaryNav route={route} navigate={navigate} />
    </div>
  )
}

export default function App() {
  const isMobile = useIsMobile()
  const { route, navigate } = useAppRoute()
  const {
    pendingBookings,
    selectedJobId,
    setSelectedJobId,
  } = useJobsStore()
  const { data: jobs = [], isFetched } = useJobsQuery()
  const [statusFilter, setStatusFilter] = useState<JobFilterKey>('all')

  const sortedJobs = useMemo(
    () => [...jobs].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [jobs],
  )

  const activeJobs = useMemo(
    () => sortedJobs.filter(isLiveJob),
    [sortedJobs],
  )

  const filteredJobs = useMemo(
    () => sortedJobs.filter((job) => matchesJobFilter(job, statusFilter, pendingBookings)),
    [pendingBookings, sortedJobs, statusFilter],
  )

  const selectedJob = selectedJobId
    ? sortedJobs.find((job) => job.id === selectedJobId) ?? null
    : null

  const applyStatusFilter = (nextFilter: JobFilterKey) => {
    setStatusFilter(nextFilter)

    const nextJobs = sortedJobs.filter((job) => matchesJobFilter(job, nextFilter, pendingBookings))
    if (!selectedJobId || !nextJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(null)
    }

    if (isMobile && route.name === 'dashboard') {
      navigate({ name: 'jobs' })
    }
  }

  const handleDashboardJobSelect = (filterKey: JobFilterKey, jobId: string) => {
    setStatusFilter(filterKey)
    setSelectedJobId(jobId)

    if (isMobile) {
      navigate({ name: 'job-detail', jobId })
    }
  }

  const stats: DashboardStat[] = [
    {
      filterKey: 'active',
      label: 'Active',
      value: activeJobs.length,
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

      const top = Math.max(0, selectedNode.getBoundingClientRect().top + window.scrollY - 16)
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

  if (isMobile) {
    return (
      <MobileApp
        stats={stats}
        route={route}
        navigate={navigate}
        selectedJob={selectedJob}
        setSelectedJobId={setSelectedJobId}
        statusFilter={statusFilter}
        onStatusFilterChange={applyStatusFilter}
        onDashboardJobSelect={handleDashboardJobSelect}
      />
    )
  }

  return (
    <DesktopApp
      stats={stats}
      activeJobsCount={activeJobs.length}
      route={route}
      navigate={navigate}
      selectedJob={selectedJob}
      setSelectedJobId={setSelectedJobId}
      statusFilter={statusFilter}
      onStatusFilterChange={applyStatusFilter}
      onDashboardJobSelect={handleDashboardJobSelect}
    />
  )
}
