import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi, type WatchJob } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table'

export function JobList() {
  const qc = useQueryClient()
  const { selectedJobId, setSelectedJobId, markTriggered, clearTriggered, optimisticTriggers } = useJobsStore()

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobsApi.list,
    refetchInterval: 5000,  // poll every 5s to pick up last_checked_at updates
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
          <TableHead>Name</TableHead>
          <TableHead>Adapter</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last Checked</TableHead>
          <TableHead>Auto Book</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job: WatchJob) => (
          <TableRow
            key={job.id}
            className={`cursor-pointer ${selectedJobId === job.id ? 'bg-muted' : ''}`}
            onClick={() => setSelectedJobId(job.id)}
          >
            <TableCell className="font-medium">{job.name}</TableCell>
            <TableCell>
              <Badge variant="outline">{job.adapter_id}</Badge>
            </TableCell>
            <TableCell>
              <StatusBadge status={job.status} jobId={job.id} />
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {job.last_checked_at
                ? new Date(job.last_checked_at).toLocaleString()
                : 'Never'}
            </TableCell>
            <TableCell>
              <Badge variant={job.auto_book ? 'default' : 'outline'}>
                {job.auto_book ? 'Yes' : 'No'}
              </Badge>
            </TableCell>
            <TableCell>
              <Button
                size="sm"
                variant="outline"
                disabled={optimisticTriggers.has(job.id)}
                onClick={e => { e.stopPropagation(); trigger.mutate(job.id) }}
              >
                {optimisticTriggers.has(job.id) ? 'Queued...' : 'Trigger'}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}