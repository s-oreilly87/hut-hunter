import { Plus } from 'lucide-react'
import { AppHeader } from '@/components/layout/AppHeader'
import { StatsGrid } from '@/components/dashboard/StatsGrid'
import { FilterDropdown } from '@/components/jobs/FilterDropdown'
import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import { CreateJobDialog, EditJobDialog } from '@/components/jobs/CreateJobDialog'
import { OccupantsDialog } from '@/components/occupants/OccupantsDialog'
import { NotificationsDialog } from '@/components/notifications/NotificationsDialog'
import { CredentialsDialog } from '@/components/credentials/CredentialsDialog'
import { Button } from '../ui/Button'
import type { AppViewProps } from '@/components/layout/types'

export function DesktopApp({
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
        onGoToDashboard={() => navigate({ name: 'dashboard' })}
      />

      <div className="mx-auto flex min-h-0 w-full max-w-[100rem] flex-1 flex-col px-4 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-6 lg:px-8">
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
            compact
          />
        </div>

        <main className="dashboard-enter-delay mt-4 grid min-h-0 flex-1 gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.95fr)] xl:grid-rows-[minmax(0,1fr)]">
          <section className="app-panel app-panel-frame min-w-0">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3 sm:px-6 sm:py-3.5">
              <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-sm">
                Hunts
              </h2>
              <div className="flex shrink-0 items-center gap-2">
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
              <div className="py-6">
                <JobList
                  statusFilters={statusFilters}
                  onJobSelect={(jobId) => navigate({ name: 'job-detail', jobId })}
                />
              </div>
            </div>
          </section>

          <aside className="min-h-0 min-w-0">
            <JobCard
              className="h-full"
              onRequestEdit={(job, step) => navigate({ name: 'edit-job', jobId: job.id, step })}
              onOpenOccupants={() => setOccupantsOpen(true)}
            />
          </aside>
        </main>
      </div>

      <OccupantsDialog open={occupantsOpen} onOpenChange={setOccupantsOpen} />
      <NotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      <CredentialsDialog open={credentialsOpen} onOpenChange={setCredentialsOpen} userEmail={userEmail} />

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
        onOpenOccupants={() => setOccupantsOpen(true)}
        onOpenCredentials={() => setCredentialsOpen(true)}
      />
      {selectedJob && (
        <EditJobDialog
          open={route.name === 'edit-job'}
          onOpenChange={(open) => {
            if (!open) navigate({ name: 'job-detail', jobId: selectedJob.id }, { replace: true })
          }}
          job={selectedJob}
          step={route.name === 'edit-job' ? route.step : undefined}
          onOpenOccupants={() => setOccupantsOpen(true)}
          onOpenCredentials={() => setCredentialsOpen(true)}
        />
      )}
    </div>
  )
}
