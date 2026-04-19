import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi, type WatchJob } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { getDisplayStatus } from '@/lib/availability'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { BookButton } from '@/components/jobs/BookButton'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table'

export function JobList() {
  const qc = useQueryClient()
  const { selectedJobId, setSelectedJobId, markTriggered, clearTriggered, optimisticTriggers, pendingBookings } = useJobsStore()

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobsApi.list,
    refetchInterval: 5000,  // poll every 5s to pick up last_checked_at updates
    select: (data) =>
      [...data].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
  })

  const trigger = useMutation({
    mutationFn: jobsApi.trigger,
    onMutate: (id) => markTriggered(id),
    onSettled: (_, __, id) => {
      clearTriggered(id)
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading jobs...</p>
  if (!jobs.length) return <p className="text-muted-foreground text-sm">No watch jobs yet.</p>

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Adapter</TableHead>
          <TableHead>Auto Book</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
          <TableHead>Last Checked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job: WatchJob) => {
          const displayStatus = getDisplayStatus(job, pendingBookings)
          const hideTrigger =
            job.status === 'booking_complete' ||
            job.status === 'expired' ||
            displayStatus === 'booking'
          return (
          <TableRow
            key={job.id}
            className={`cursor-pointer ${selectedJobId === job.id ? 'bg-muted' : ''}`}
            onClick={() => setSelectedJobId(job.id)}
          >
            <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
              {new Date(job.created_at).toLocaleString()}
            </TableCell>
            <TableCell className="font-medium">{job.name}</TableCell>
            <TableCell>
              <Badge variant="outline">{job.adapter_id}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={job.auto_book ? 'default' : 'outline'}>
                {job.auto_book ? 'Yes' : 'No'}
              </Badge>
            </TableCell>
            <TableCell>
              <StatusBadge
                status={displayStatus}
                jobId={job.id}
                artifactUrl={job.last_artifact_png}
              />
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                {!hideTrigger && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={optimisticTriggers.has(job.id)}
                    onClick={e => { e.stopPropagation(); trigger.mutate(job.id) }}
                  >
                    {optimisticTriggers.has(job.id) ? 'Queued...' : 'Trigger'}
                  </Button>
                )}
                <BookButton job={job} />
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
              {job.last_checked_at
                ? new Date(job.last_checked_at).toLocaleString()
                : 'Never'}
            </TableCell>
          </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}