import type { LucideIcon } from 'lucide-react'
import type { WatchJob } from '@/lib/api'
import type { AppRoute } from '@/lib/navigation'
import type { JobFilterKey } from '@/components/jobs/jobFilters'

export type DashboardStat = {
  filterKey: JobFilterKey
  label: string
  value: number
  description: string
  icon: LucideIcon
}

export type AppViewProps = {
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
