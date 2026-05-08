import { Plus } from 'lucide-react'
import { AppHeader } from '@/components/layout/AppHeader'
import { MobilePrimaryNav } from '@/components/layout/MobilePrimaryNav'
import { StatsGrid } from '@/components/dashboard/StatsGrid'
import { FilterDropdown } from '@/components/jobs/FilterDropdown'
import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import { CreateJobPage, EditJobPage } from '@/components/jobs/CreateJobDialog'
import { OccupantsDialog } from '@/components/occupants/OccupantsDialog'
import { NotificationsDialog } from '@/components/notifications/NotificationsDialog'
import { CredentialsDialog } from '@/components/credentials/CredentialsDialog'
import { Button } from '@/components/ui/button'
import type { AppViewProps } from '@/components/layout/types'

export function MobileApp({
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
        className="mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col gap-4 px-4 pt-4"
        style={{ paddingBottom: mobileNavPadding }}
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
