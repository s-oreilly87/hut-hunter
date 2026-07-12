import { ChevronDown } from 'lucide-react'
import type { AdapterInfo, Occupant } from '@/lib/api'
import { getDisplayStatus } from '@/lib/availability'
import { isJobOutdatedOnCampers } from '@/lib/occupantSnapshots'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { JobListMobileCard } from './JobListMobileCard'
import { JobListDesktopRow } from './JobListDesktopRow'
import type { JobGroup } from './useGroupedJobs'
import { cn } from '@/lib/utils'

/**
 * One collapsible adapter section in the list view.
 *
 * Renders both responsive variants — a stack of mobile cards (lg:hidden) and
 * a desktop table (hidden lg:block) — so the consumer can render groups
 * without thinking about layout. The header row is the toggle.
 */
export function JobGroupSection({
  group,
  isExpanded,
  onToggle,
  selectedJobId,
  pendingBookings,
  occupants,
  adapterById,
  adapterDateFieldKeyById,
  adapterTrackFieldKeyById,
  onSelectJob,
  setMobileRef,
  setDesktopRef,
}: {
  group: JobGroup
  isExpanded: boolean
  onToggle: (adapterId: string) => void
  selectedJobId: string | null
  pendingBookings: Set<string>
  occupants: Occupant[]
  adapterById: Map<string, AdapterInfo>
  adapterDateFieldKeyById: Map<string, string>
  adapterTrackFieldKeyById: Map<string, string>
  onSelectJob: (jobId: string) => void
  setMobileRef: (jobId: string, node: HTMLDivElement | null) => void
  setDesktopRef: (jobId: string, node: HTMLTableRowElement | null) => void
}) {
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/55 max-sm:border-x-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 bg-secondary/50 px-4 py-3.5 text-left hover:bg-secondary/70 sm:px-5"
        onClick={() => onToggle(group.adapterId)}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            {group.adapterName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {group.jobs.length} hunt{group.jobs.length === 1 ? '' : 's'}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground',
            isExpanded && 'rotate-180',
          )}
        />
      </button>

      {isExpanded && (
        <div className="p-0 sm:px-4 sm:py-3">
          <div className="grid gap-3 lg:hidden">
            {group.jobs.map((job) => {
              const displayStatus = getDisplayStatus(job, pendingBookings)
              const adapter = adapterById.get(job.adapter_id)
              const hasOutdatedCampers = isJobOutdatedOnCampers(job, occupants, adapter)
              return (
                <JobListMobileCard
                  key={job.id}
                  job={job}
                  displayStatus={displayStatus}
                  hasOutdatedCampers={hasOutdatedCampers}
                  adapterDateFieldKeyById={adapterDateFieldKeyById}
                  adapterTrackFieldKeyById={adapterTrackFieldKeyById}
                  onSelect={onSelectJob}
                  setRef={setMobileRef}
                />
              )
            })}
          </div>

          <div className="hidden overflow-hidden rounded-[1.2rem] border border-border/70 lg:block">
            <Table>
              <TableHeader className="bg-secondary/60">
                <TableRow className="border-border/80 hover:bg-secondary/60">
                  <TableHead className="w-[56%] pl-4 text-muted-foreground">Hunt</TableHead>
                  <TableHead className="w-[22%] text-muted-foreground">Automation</TableHead>
                  <TableHead className="pr-5 text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.jobs.map((job) => {
                  const displayStatus = getDisplayStatus(job, pendingBookings)
                  const adapter = adapterById.get(job.adapter_id)
                  const hasOutdatedCampers = isJobOutdatedOnCampers(job, occupants, adapter)
                  return (
                    <JobListDesktopRow
                      key={job.id}
                      job={job}
                      isSelected={selectedJobId === job.id}
                      displayStatus={displayStatus}
                      hasOutdatedCampers={hasOutdatedCampers}
                      adapterDateFieldKeyById={adapterDateFieldKeyById}
                      adapterTrackFieldKeyById={adapterTrackFieldKeyById}
                      onSelect={onSelectJob}
                      setRef={setDesktopRef}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  )
}
