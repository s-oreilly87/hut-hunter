import { useEffect, type ComponentProps, type ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  Clock3,
  LayoutDashboard,
  Plus,
  Radar,
  Search,
  TentTree,
} from 'lucide-react'
import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
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
import { getDisplayStatus } from '@/lib/availability'
import { type AppRoute, useAppRoute, useIsMobile } from '@/lib/navigation'
import { formatDueIn } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useJobsStore } from '@/store/jobs'

function isLiveJob(job: WatchJob): boolean {
  return (
    job.status !== 'booking_complete'
    && job.status !== 'cancelled'
    && job.status !== 'expired'
  )
}

function getPrimarySection(route: AppRoute): 'dashboard' | 'jobs' {
  return route.name === 'dashboard' ? 'dashboard' : 'jobs'
}

function getJobSelector(jobId: string): string {
  const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(jobId)
    : jobId.replace(/"/g, '\\"')

  return `[data-job-id="${escapedId}"]`
}

function StatsGrid({
  stats,
}: {
  stats: Array<{
    label: string
    value: number | string
    description: string
    icon: typeof Activity
  }>
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <article
          key={stat.label}
          className="app-panel flex min-h-36 flex-col justify-between px-5 py-5"
        >
          <div className="flex items-start justify-between gap-3">
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
          </div>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            {stat.description}
          </p>
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

function MobileActionBar({
  backLabel,
  onBack,
  actions,
}: {
  backLabel?: string
  onBack?: () => void
  actions?: ReactNode
}) {
  if (!onBack && !actions) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <div className="flex flex-wrap gap-2">
        {onBack && (
          <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel ?? 'Back'}
          </Button>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
}: {
  stats: Array<{
    label: string
    value: number | string
    description: string
    icon: typeof Activity
  }>
  activeJobsCount: number
  route: AppRoute
  navigate: (route: AppRoute, options?: { replace?: boolean }) => void
  selectedJob: WatchJob | null
}) {
  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <header className="dashboard-enter app-panel relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
          <div className="absolute inset-y-0 right-0 hidden w-2/5 bg-[radial-gradient(circle_at_top,rgba(48,120,86,0.2),transparent_60%)] lg:block" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="space-y-3">
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
          <StatsGrid stats={stats} />
        </div>

        <main className="dashboard-enter-late mt-5 grid flex-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)]">
          <section className="app-panel flex min-h-104 flex-col overflow-hidden">
            <div className="border-b border-border/80 px-5 py-5 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Watch Jobs
              </h2>
            </div>
            <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
              <JobList onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })} />
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
        onOpenChange={(open) => {
          if (!open) {
            navigate(selectedJob ? { name: 'job-detail', jobId: selectedJob.id } : { name: 'dashboard' }, { replace: true })
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
}: {
  stats: Array<{
    label: string
    value: number | string
    description: string
    icon: typeof Activity
  }>
  route: AppRoute
  navigate: (route: AppRoute, options?: { replace?: boolean }) => void
  selectedJob: WatchJob | null
}) {
  return (
    <div className="app-shell min-h-screen pb-24">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-4">
        {route.name === 'dashboard' && (
          <>
            <MobileActionBar
              actions={(
                <>
                  <OccupantsDialog />
                  <CreateJobButton
                    onClick={() => navigate({ name: 'create-job' })}
                    size="sm"
                    className="flex-1 sm:flex-none"
                  />
                </>
              )}
            />
            <StatsGrid stats={stats} />
          </>
        )}

        {route.name === 'jobs' && (
          <>
            <MobileActionBar
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
                onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
              />
            </section>
          </>
        )}

        {route.name === 'job-detail' && (
          <>
            <MobileActionBar
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
            <MobileActionBar
              backLabel="Watch Jobs"
              onBack={() => navigate({ name: 'jobs' })}
            />
            <CreateJobPage onDone={() => navigate({ name: 'jobs' }, { replace: true })} />
          </>
        )}

        {route.name === 'edit-job' && selectedJob && (
          <>
            <MobileActionBar
              backLabel="Job Card"
              onBack={() => navigate({ name: 'job-detail', jobId: selectedJob.id })}
            />
            <EditJobPage
              job={selectedJob}
              onDone={() => navigate({ name: 'job-detail', jobId: selectedJob.id }, { replace: true })}
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

  const activeJobs = jobs.filter(isLiveJob)
  const availableJobs = jobs.filter(
    (job) => getDisplayStatus(job, pendingBookings) === 'result_available',
  ).length
  const holdCount = jobs.filter((job) => job.status === 'hold_placed').length
  const monitoringCount = jobs.filter(
    (job) => job.enable_monitoring && isLiveJob(job),
  ).length
  const nextCheck = activeJobs
    .filter((job) => job.next_check_at)
    .sort((a, b) => {
      const aTime = new Date(a.next_check_at ?? 0).getTime()
      const bTime = new Date(b.next_check_at ?? 0).getTime()
      return aTime - bTime
    })[0]?.next_check_at ?? null
  const selectedJob = selectedJobId
    ? jobs.find((job) => job.id === selectedJobId) ?? null
    : null

  const stats = [
    {
      label: 'Live Holds',
      value: holdCount,
      description: 'Jobs waiting on payment completion',
      icon: Activity,
    },
    {
      label: 'Ready To Book',
      value: availableJobs,
      description: 'Latest results show all sites available',
      icon: TentTree,
    },
    {
      label: 'Watching',
      value: monitoringCount,
      description: 'Jobs on an automatic check schedule',
      icon: Radar,
    },
    {
      label: 'Next Check',
      value: formatDueIn(nextCheck),
      description: 'Earliest scheduled monitoring run',
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
      && !jobs.some((job) => job.id === route.jobId)
    ) {
      navigate({ name: 'jobs' }, { replace: true })
    }
  }, [isFetched, jobs, navigate, route])

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
    />
  )
}
