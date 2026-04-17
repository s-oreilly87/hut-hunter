import { useQuery } from '@tanstack/react-query'
import { jobsApi } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function JobCard() {
  const { selectedJobId } = useJobsStore()

  const { data: job, isLoading } = useQuery({
    queryKey: ['jobs', selectedJobId],
    queryFn: () => jobsApi.get(selectedJobId!),
    enabled: !!selectedJobId,
  })

  if (!selectedJobId) return (
    <Card className="text-muted-foreground text-sm">
      <CardContent className="pt-6">Select a job to see details.</CardContent>
    </Card>
  )

  if (isLoading) return (
    <Card>
      <CardContent className="pt-6 text-sm text-muted-foreground">Loading...</CardContent>
    </Card>
  )

  if (!job) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{job.name}</CardTitle>
          <Badge variant={job.is_active ? 'default' : 'secondary'}>
            {job.is_active ? 'Active' : 'Paused'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <span className="text-muted-foreground">Adapter</span>
          <Badge variant="outline" className="w-fit">{job.adapter_id}</Badge>

          <span className="text-muted-foreground">Auto Book</span>
          <Badge variant={job.auto_book ? 'default' : 'outline'} className="w-fit">
            {job.auto_book ? 'Yes' : 'No'}
          </Badge>

          <span className="text-muted-foreground">Created</span>
          <span>{new Date(job.created_at).toLocaleString()}</span>

          <span className="text-muted-foreground">Last Checked</span>
          <span>{job.last_checked_at
            ? new Date(job.last_checked_at).toLocaleString()
            : 'Never'}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Params</p>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
            {JSON.stringify(job.params, null, 2)}
          </pre>
        </div>

        {job.last_result && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Last Result</p>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
              {JSON.stringify(job.last_result, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}