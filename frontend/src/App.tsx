import {
  Activity,
  Clock3,
  Radar,
  TentTree,
} from 'lucide-react'
import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog'
import { OccupantsDialog } from '@/components/occupants/OccupantsDialog'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { getDisplayStatus } from '@/lib/availability'
import { useJobsStore } from '@/store/jobs'

function formatNextCheck(nextCheckAt: string | null): string {
  if (!nextCheckAt) return 'No scheduled checks'

  const deltaMinutes = Math.round(
    (new Date(nextCheckAt).getTime() - Date.now()) / 60_000,
  )

  if (deltaMinutes <= 1) return 'Due within a minute'
  if (deltaMinutes < 60) return `Due in ${deltaMinutes} min`

  const deltaHours = Math.round(deltaMinutes / 60)
  return `Due in ${deltaHours} hr`
}

export default function App() {
  const { pendingBookings } = useJobsStore()
  const { data: jobs = [] } = useJobsQuery()

  const activeJobs = jobs.filter(
    (job) =>
      job.status !== 'booking_complete'
      && job.status !== 'cancelled'
      && job.status !== 'expired',
  )
  const availableJobs = jobs.filter(
    (job) => getDisplayStatus(job, pendingBookings) === 'result_available',
  ).length
  const holdCount = jobs.filter((job) => job.status === 'hold_placed').length
  const monitoringCount = jobs.filter(
    (job) =>
      job.enable_monitoring
      && job.status !== 'booking_complete'
      && job.status !== 'cancelled'
      && job.status !== 'expired',
  ).length
  const nextCheck = activeJobs
    .filter((job) => job.next_check_at)
    .sort((a, b) => {
      const aTime = new Date(a.next_check_at ?? 0).getTime()
      const bTime = new Date(b.next_check_at ?? 0).getTime()
      return aTime - bTime
    })[0]?.next_check_at ?? null

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
      value: formatNextCheck(nextCheck),
      description: 'Earliest scheduled monitoring run',
      icon: Clock3,
    },
  ]

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
                  {activeJobs.length} bookings being watched
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <OccupantsDialog />
              <CreateJobDialog />
            </div>
          </div>
        </header>

        <section className="dashboard-enter-delay mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

        <main className="dashboard-enter-late mt-5 grid flex-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)]">
          <section className="app-panel flex min-h-104 flex-col overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-border/80 px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    Watch Jobs
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Recent jobs, live status, and fast actions for checks and booking.
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Polling every 5 seconds
                </p>
              </div>
            </div>
            <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
              <JobList />
            </div>
          </section>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <JobCard />
          </aside>
        </main>
      </div>
    </div>
  )
}
