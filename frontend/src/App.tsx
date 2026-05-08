import { useEffect, useMemo, useState } from 'react'
import { Activity, Check, Clock3, Hand, TentTree, XCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { DesktopApp } from '@/components/layout/DesktopApp'
import { MobileApp } from '@/components/layout/MobileApp'
import { LoadingScreen } from '@/components/layout/LoadingScreen'
import {
  type JobFilterKey,
  JOB_FILTERS,
  matchesJobFilter,
  matchesJobFilters,
} from '@/components/jobs/jobFilters'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { adaptersApi, credentialsApi, occupantsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useAppRoute, useIsMobile } from '@/lib/navigation'
import { useJobsStore } from '@/store/jobs'
import type { AppViewProps } from '@/components/layout/types'

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
  const { pendingBookings, selectedJobId, setSelectedJobId } = useJobsStore()
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
    const configuredAdapterIds = new Set(credentials.map((c) => c.adapter_id))
    return adapters.filter(
      (a) => a.requires_credentials && !configuredAdapterIds.has(a.adapter_id),
    ).length
  }, [adapters, credentials])

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
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

  const stats: AppViewProps['stats'] = [
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

  // Sync selectedJobId from URL
  useEffect(() => {
    if (route.name === 'job-detail' || route.name === 'edit-job') {
      if (selectedJobId !== route.jobId) {
        setSelectedJobId(route.jobId)
      }
    }
  }, [route, selectedJobId, setSelectedJobId])

  // Redirect to jobs list if a job referenced in the URL no longer exists
  useEffect(() => {
    if (
      isFetched
      && (route.name === 'job-detail' || route.name === 'edit-job')
      && !sortedJobs.some((job) => job.id === route.jobId)
    ) {
      navigate({ name: 'jobs' }, { replace: true })
    }
  }, [isFetched, navigate, route, sortedJobs])

  // Clear selected job when it no longer matches active filters
  useEffect(() => {
    if (route.name === 'job-detail' || route.name === 'edit-job') return
    if (!selectedJobId) return
    if (filteredJobs.some((job) => job.id === selectedJobId)) return
    setSelectedJobId(null)
  }, [filteredJobs, route, selectedJobId, setSelectedJobId])

  // Scroll to top on mobile route changes
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
      onLogout={() => { void logout() }}
      logoutPending={logoutPending}
    />
  )
}
