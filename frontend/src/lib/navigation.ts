import { useEffect, useState } from 'react'

export type AppRoute
  = { name: 'dashboard' }
  | { name: 'jobs' }
  | { name: 'create-job' }
  | { name: 'job-detail'; jobId: string }
  | { name: 'edit-job'; jobId: string }

function getHashPath(hash: string): string {
  const trimmed = hash.trim()
  if (!trimmed) return '/'

  const withoutMarker = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (!withoutMarker) return '/'

  return withoutMarker.startsWith('/') ? withoutMarker : `/${withoutMarker}`
}

export function parseAppRoute(hash: string): AppRoute {
  const segments = getHashPath(hash)
    .split('/')
    .filter(Boolean)

  if (segments.length === 0 || segments[0] === 'dashboard') {
    return { name: 'dashboard' }
  }

  if (segments[0] !== 'jobs') {
    return { name: 'dashboard' }
  }

  if (segments.length === 1) {
    return { name: 'jobs' }
  }

  if (segments[1] === 'new') {
    return { name: 'create-job' }
  }

  const jobId = decodeURIComponent(segments[1])
  if (!jobId) return { name: 'jobs' }

  if (segments[2] === 'edit') {
    return { name: 'edit-job', jobId }
  }

  return { name: 'job-detail', jobId }
}

export function formatAppRoute(route: AppRoute): string {
  switch (route.name) {
    case 'dashboard':
      return '#/'
    case 'jobs':
      return '#/jobs'
    case 'create-job':
      return '#/jobs/new'
    case 'job-detail':
      return `#/jobs/${encodeURIComponent(route.jobId)}`
    case 'edit-job':
      return `#/jobs/${encodeURIComponent(route.jobId)}/edit`
  }
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.hash))

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseAppRoute(window.location.hash))
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (nextRoute: AppRoute, options?: { replace?: boolean }) => {
    const nextHash = formatAppRoute(nextRoute)
    if (options?.replace) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${nextHash}`,
      )
      setRoute(nextRoute)
      return
    }

    if (window.location.hash === nextHash) {
      setRoute(nextRoute)
      return
    }

    window.location.hash = nextHash
  }

  return { route, navigate }
}

export function useIsMobile(query = '(max-width: 1599px)') {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [query])

  return isMobile
}
