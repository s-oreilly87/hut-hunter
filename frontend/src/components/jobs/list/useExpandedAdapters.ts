import { useMemo, useState } from 'react'

interface JobGroup {
  adapterId: string
}

/**
 * Owns the "which adapter groups are expanded" state for the JobList view.
 *
 * Default behaviour:
 *   - All groups expanded, unless `collapseGroupsByDefault` is true.
 *   - The group containing the selected job is always force-expanded so the
 *     selected row stays visible after a navigation.
 *
 * Once the user toggles any group, their explicit set takes over (we stop
 * auto-managing it).
 */
export function useExpandedAdapters({
  groups,
  selectedJobId,
  collapseGroupsByDefault,
}: {
  groups: Array<JobGroup & { jobs: { id: string }[] }>
  selectedJobId: string | null
  collapseGroupsByDefault: boolean
}) {
  const [expandedAdapters, setExpandedAdapters] = useState<Set<string> | null>(null)

  const selectedGroupId = useMemo(
    () =>
      groups.find((group) => group.jobs.some((job) => job.id === selectedJobId))?.adapterId ?? null,
    [groups, selectedJobId],
  )

  const effectiveExpandedAdapters = useMemo(() => {
    if (expandedAdapters) return expandedAdapters

    const defaultExpanded = collapseGroupsByDefault
      ? new Set<string>()
      : new Set(groups.map((group) => group.adapterId))

    if (selectedGroupId) {
      defaultExpanded.add(selectedGroupId)
    }

    return defaultExpanded
  }, [collapseGroupsByDefault, expandedAdapters, groups, selectedGroupId])

  const toggleAdapter = (adapterId: string) => {
    setExpandedAdapters((current) => {
      const next = new Set(current ?? effectiveExpandedAdapters)

      if (next.has(adapterId)) {
        next.delete(adapterId)
      } else {
        next.add(adapterId)
      }

      return next
    })
  }

  return { effectiveExpandedAdapters, toggleAdapter }
}
