import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  jobsApi, adaptersApi,
  type AvailabilityResult, type LastResultEntry, type ParamField,
} from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { EditJobDialog } from '@/components/jobs/CreateJobDialog'
import {
  BookButton,
  PartialAvailabilityHelp,
} from '@/components/jobs/BookButton'
import { getDisplayStatus, jobHasPartialAvailability } from '@/lib/availability'

function titleize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatParamValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—'
  if (Array.isArray(val)) {
    // Occupants lists: show one line per entry as "First Last (category)"
    const lines = val.map(item => {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
        const parts: string[] = []
        if (name) parts.push(name)
        if (o.category) parts.push(String(o.category))
        return parts.join(' — ') || JSON.stringify(o)
      }
      return String(item)
    })
    return lines.join('\n')
  }
  if (typeof val === 'object') {
    return JSON.stringify(val)
  }
  return String(val)
}

function ParamsTable({
  params,
  paramFields,
}: {
  params: Record<string, unknown>
  paramFields: ParamField[] | undefined
}) {
  // Prefer the order and labels defined by the adapter; fall back to raw keys.
  const rows = paramFields && paramFields.length
    ? paramFields
        .filter(f => f.key in params)
        .map(f => ({ key: f.key, label: f.label, value: params[f.key] }))
    : Object.entries(params).map(([k, v]) => ({
        key: k, label: titleize(k), value: v,
      }))

  if (!rows.length) {
    return <p className="text-xs text-muted-foreground">No params.</p>
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(row => (
        <div key={row.key} className="contents">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="whitespace-pre-wrap break-words">
            {formatParamValue(row.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

const AVAIL_VARIANT: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  available: 'default',
  partially_available: 'secondary',
  unavailable: 'outline',
  unknown: 'outline',
}

function isAvailabilityResult(entry: LastResultEntry): entry is AvailabilityResult {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'site' in entry &&
    'status' in entry
  )
}

function LastResultView({
  result,
  artifactPng,
  artifactHtml,
}: {
  result: LastResultEntry[]
  artifactPng?: string | null
  artifactHtml?: string | null
}) {
  if (!result.length) {
    return <p className="text-xs text-muted-foreground">No results yet.</p>
  }

  return (
    <div className="space-y-2">
      {result.map((entry, i) => {
        if (isAvailabilityResult(entry)) {
          return (
            <div
              key={i}
              className="rounded-md border px-3 py-2 text-sm space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{entry.site}</span>
                <Badge variant={AVAIL_VARIANT[entry.status] ?? 'outline'}>
                  {titleize(entry.status)}
                </Badge>
              </div>
              {entry.total_available != null && (
                <div className="text-xs text-muted-foreground">
                  {entry.total_available} available
                </div>
              )}
              {entry.evidence && (
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {entry.evidence}
                </div>
              )}
            </div>
          )
        }
        // Error-shaped entry — show all fields plus artifact links if present
        const obj = entry as Record<string, unknown>
        return (
          <div
            key={i}
            className="rounded-md border border-destructive/40 px-3 py-2 text-sm space-y-1"
          >
            {Object.entries(obj).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[auto_1fr] gap-x-3">
                <span className="text-muted-foreground">{titleize(k)}</span>
                <span className="whitespace-pre-wrap break-words">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
            {(artifactPng || artifactHtml) && (
              <div className="flex items-center gap-3 pt-1 border-t border-destructive/20 mt-1">
                <span className="text-muted-foreground">Artifact</span>
                {artifactPng && (
                  <a href={artifactPng} target="_blank" rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:no-underline">
                    Screenshot
                  </a>
                )}
                {artifactHtml && (
                  <a href={artifactHtml} target="_blank" rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:no-underline">
                    HTML
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function JobCard() {
  const qc = useQueryClient()
  const {
    selectedJobId, setSelectedJobId,
    markTriggered, clearTriggered, optimisticTriggers,
    pendingBookings,
  } = useJobsStore()
  const [editOpen, setEditOpen] = useState(false)

  // Derive the selected job from the already-polling list query rather than
  // making a separate per-job request. JobList keeps ['jobs'] fresh every 5s,
  // so JobCard automatically reflects status/result changes without its own
  // polling interval or manual invalidation after mutations.
  const { data: job, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobsApi.list,
    refetchInterval: 5000,
    select: (jobs) => jobs.find(j => j.id === selectedJobId),
    enabled: !!selectedJobId,
  })

  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })

  const trigger = useMutation({
    mutationFn: jobsApi.trigger,
    onMutate: (id: string) => markTriggered(id),
    onSettled: (_, __, id) => {
      clearTriggered(id)
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  const remove = useMutation({
    mutationFn: jobsApi.remove,
    onSuccess: (_, id) => {
      // Deselect before invalidating so the card doesn't briefly re-fetch
      // a 404 on the now-deleted job.
      if (selectedJobId === id) setSelectedJobId(null)
      qc.removeQueries({ queryKey: ['jobs', id] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(
      `Delete "${name}"?\n\n` +
      `This removes the job and any stored cart session. ` +
      `You can't undo this.`
    )) return
    remove.mutate(id)
  }

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

  const adapter = adapters.find(a => a.adapter_id === job.adapter_id)
  const queued = optimisticTriggers.has(job.id)
  const deleting = remove.isPending
  const displayStatus = getDisplayStatus(job, pendingBookings)
  // Terminal states: job is done or in-flight booking — hide Trigger
  const hideTrigger =
    job.status === 'booking_complete' ||
    job.status === 'expired' ||
    displayStatus === 'booking'

  return (
    <>
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">{job.name}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <StatusBadge
              status={displayStatus}
              jobId={job.id}
              artifactUrl={job.last_artifact_png}
            />
            <MonitoringBadge job={job} />
            {!hideTrigger && (
              <Button
                size="sm"
                variant="outline"
                disabled={queued}
                onClick={() => trigger.mutate(job.id)}
              >
                {queued
                  ? 'Queued...'
                  : job.enable_monitoring ? 'Force Check' : 'Check Now'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={() => handleDelete(job.id, job.name)}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
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

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Params</p>
          <ParamsTable params={job.params} paramFields={adapter?.param_fields} />
        </div>

        {job.last_result && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Last Result</p>
              <BookButton job={job} />
            </div>
            <LastResultView
              result={job.last_result}
              artifactPng={job.last_artifact_png}
              artifactHtml={job.last_artifact_html}
            />
            {jobHasPartialAvailability(job) && (
              <PartialAvailabilityHelp />
            )}
          </div>
        )}

        {(job.last_artifact_png || job.last_artifact_html) && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Last Artifact</p>
            <div className="flex items-center gap-3 text-sm">
              {job.last_artifact_png && (
                <a
                  href={job.last_artifact_png}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Screenshot
                </a>
              )}
              {job.last_artifact_html && (
                <a
                  href={job.last_artifact_html}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  HTML
                </a>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    <EditJobDialog open={editOpen} onOpenChange={setEditOpen} job={job} />
    </>
  )
}
