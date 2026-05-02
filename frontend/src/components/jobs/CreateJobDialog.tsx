import { createElement, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Settings2,
} from 'lucide-react'
import {
  jobsApi, adaptersApi, occupantsApi,
  type ParamField, type WatchJob, type Occupant,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { InfoTooltip, SectionHeading } from '@/components/ui/section-heading'
import { getJobParamIcon } from '@/components/jobs/jobParamDisplay'

const FACILITY_OPTION_DISPLAY_RE = /^(.+?)\s*\(\d+\/\d+\)(?:\s*—\s*.+)?$/

function facilityDisplayName(opt: string): string {
  const m = FACILITY_OPTION_DISPLAY_RE.exec(opt.trim())
  return m ? m[1].trim() : opt
}

function ParamFieldInput({
  field,
  value,
  onChange,
  options,
}: {
  field: ParamField
  value: unknown
  onChange: (val: unknown) => void
  options?: string[] | null
}) {
  const selectOptions = options ?? field.options

  if (field.type === 'multiselect') {
    const opts = selectOptions ?? []
    const selected = Array.isArray(value) ? (value as string[]) : []

    if (opts.length === 0) {
      return (
        <p className="text-xs text-muted-foreground italic">
          Select a track first to see available sites.
        </p>
      )
    }

    const toggle = (site: string) => {
      onChange(
        selected.includes(site)
          ? selected.filter(s => s !== site)
          : [...selected, site],
      )
    }

    return (
      <div className="space-y-1.5">
        <div className="max-h-52 overflow-y-auto rounded-md border p-1 space-y-0.5">
          {opts.map(opt => {
            const checked = selected.includes(opt)
            return (
              <label
                key={opt}
                className={`flex items-center gap-2.5 rounded px-2 py-1.5 cursor-pointer text-sm select-none
                  ${checked ? 'bg-primary/10' : 'hover:bg-muted'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="accent-primary"
                />
                <span>{opt}</span>
              </label>
            )
          })}
        </div>
        <p className={`text-xs ${selected.length === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
          {selected.length === 0
            ? 'Select at least one site to watch'
            : `${selected.length} of ${opts.length} selected`}
        </p>
      </div>
    )
  }

  if (field.type === 'select' && (field.options_tree || selectOptions)) {
    const tree = field.options_tree
    const isFacility = field.key === 'facility'
    return (
      <Select value={String(value ?? '')} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          {tree
            ? tree.map(group => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.items.map(opt => (
                    <SelectItem key={opt} value={opt}>
                      {isFacility ? facilityDisplayName(opt) : opt}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))
            : selectOptions!.map(opt => (
                <SelectItem key={opt} value={opt}>
                  {isFacility ? facilityDisplayName(opt) : opt}
                </SelectItem>
              ))
          }
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <Input
        type="text"
        placeholder="DD/MM/YYYY"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
    />
  )
}

function OccupantSelector({
  selectedIds,
  onChange,
  required,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  required: number  // how many must be selected (= params.people)
}) {
  const { data: roster = [], isLoading } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(i => i !== id)
        : [...selectedIds, id]
    )
  }

  const countOk = selectedIds.length === required
  const countLabel = required > 0
    ? `${selectedIds.length} / ${required} selected`
    : `${selectedIds.length} selected`

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading occupants…</p>

  if (roster.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No saved occupants. Add some via the{' '}
        <span className="font-medium">Occupants</span>{' '}
        button in the header first.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-1">
        {roster.map((o: Occupant) => {
          const checked = selectedIds.includes(o.id)
          return (
            <label
              key={o.id}
              className={`flex items-center gap-2.5 rounded px-2 py-1.5 cursor-pointer text-sm
                ${checked ? 'bg-primary/10' : 'hover:bg-muted'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(o.id)}
                className="accent-primary"
              />
              <span className="font-medium">{o.first_name} {o.last_name}</span>
              <span className="text-muted-foreground text-xs">
                {o.age}y · {o.category}
              </span>
            </label>
          )
        })}
      </div>
      <p className={`text-xs ${countOk ? 'text-muted-foreground' : 'text-destructive'}`}>
        {countLabel}{!countOk && required > 0 && ` — must match party size (${required})`}
      </p>
    </div>
  )
}

function isDateValidInTz(dateStr: string, timezone: string): boolean {
  const parts = dateStr.split('/')
  if (parts.length !== 3) return false
  const [dd, mm, yyyy] = parts
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return false

  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const tzY = Number(tzParts.find(p => p.type === 'year')?.value)
  const tzM = Number(tzParts.find(p => p.type === 'month')?.value)
  const tzD = Number(tzParts.find(p => p.type === 'day')?.value)

  const jobY = Number(yyyy), jobM = Number(mm), jobD = Number(dd)
  if ([jobY, jobM, jobD, tzY, tzM, tzD].some(isNaN)) return false

  const tzInt = tzY * 10000 + tzM * 100 + tzD
  const jobInt = jobY * 10000 + jobM * 100 + jobD
  return jobInt >= tzInt
}

function buildDefaultParams(fields: ParamField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map(f => [f.key, f.default ?? ''])
  )
}

function buildParamsFromJob(job: WatchJob): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(job.params)) {
    if (k === 'occupants') continue
    if (k === 'sites' && typeof v === 'string') {
      // Keep legacy string payloads editable after the multiselect migration.
      out[k] = v.split(',').map(s => s.trim()).filter(Boolean)
    } else {
      out[k] = v ?? ''
    }
  }
  return out
}

function FormSection({
  title,
  tooltip,
  children,
}: {
  title: string
  tooltip?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
      <div className="mb-4">
        <SectionHeading title={title} tooltip={tooltip} />
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  tooltip,
  children,
}: {
  title: string
  tooltip?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <SectionHeading title={title} tooltip={tooltip} tone="body" />
        </div>
        <div className="sm:pt-1">{children}</div>
      </div>
    </div>
  )
}

function ParamLabel({
  fieldKey,
  children,
  required = false,
}: {
  fieldKey: string
  children: ReactNode
  required?: boolean
}) {
  const Icon = getJobParamIcon(fieldKey)

  return (
    <Label className="inline-flex items-center gap-2">
      {Icon && createElement(Icon, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
      <span>{children}</span>
      {required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  )
}

type Mode = 'create' | 'edit'

function JobFormDialog({
  open,
  onOpenChange,
  mode,
  initialJob,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: Mode
  initialJob?: WatchJob
  onDone?: (job: WatchJob) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] sm:max-w-3xl overflow-y-auto">
        <JobFormBody
          // Force a remount so each open gets fresh local form state.
          key={`${mode}:${initialJob?.id ?? 'new'}`}
          mode={mode}
          initialJob={initialJob}
          onDone={(job) => {
            onDone?.(job)
            onOpenChange(false)
          }}
          presentation="dialog"
        />
      </DialogContent>
    </Dialog>
  )
}

function JobFormBody({
  mode,
  initialJob,
  onDone,
  presentation,
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  presentation: 'dialog' | 'page'
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(
    mode === 'edit' && initialJob ? initialJob.name : '',
  )
  const [selectedAdapterId, setSelectedAdapterId] = useState(
    mode === 'edit' && initialJob ? initialJob.adapter_id : '',
  )
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    mode === 'edit' && initialJob ? buildParamsFromJob(initialJob) : {},
  )
  const [autoBook, setAutoBook] = useState(
    mode === 'edit' && initialJob ? initialJob.auto_book : false,
  )
  const [enableMonitoring, setEnableMonitoring] = useState(
    mode === 'edit' && initialJob ? initialJob.enable_monitoring : true,
  )
  const [intervalMinutes, setIntervalMinutes] = useState<string>(
    mode === 'edit' && initialJob
      ? String(initialJob.interval_minutes)
      : '15',
  )
  const [error, setError] = useState<string | null>(null)

  const [selectedOccupantIds, setSelectedOccupantIds] = useState<string[]>(() => {
    if (mode === 'edit' && initialJob) {
      const snapped = initialJob.params.occupants
      if (Array.isArray(snapped)) {
        return snapped.map((o: Record<string, unknown>) => String(o.id ?? '')).filter(Boolean)
      }
    }
    return []
  })

  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })

  const { data: roster = [] } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })

  const selectedAdapter = adapters.find(a => a.adapter_id === selectedAdapterId)

  const resolveOptions = (
    field: ParamField,
    currentParams: Record<string, unknown>,
  ): string[] | null => {
    if (field.filter_by && field.options_by) {
      const key = String(currentParams[field.filter_by] ?? '')
      let opts: string[] = field.options_by[key] ?? []

      // DOC returns site order for the outbound direction; reverse it for return trips.
      if (field.key === 'sites' && field.filter_by === 'track' && opts.length > 0) {
        const direction = String(currentParams['direction'] ?? '')
        if (direction) {
          const dirField = selectedAdapter?.param_fields.find(f => f.key === 'direction')
          const trackDirs = dirField?.options_by?.[key] ?? []
          if (trackDirs.length >= 2 && trackDirs.indexOf(direction) >= 1) {
            opts = [...opts].reverse()
          }
        }
      }

      return opts
    }
    return field.options ?? null
  }

  const handleAdapterChange = (adapterId: string) => {
    setSelectedAdapterId(adapterId)
    const adapter = adapters.find(a => a.adapter_id === adapterId)
    if (adapter) {
      setParams(buildDefaultParams(adapter.param_fields))
    }
  }

  const handleParamChange = (key: string, value: unknown) => {
    setParams(prev => {
      const next: Record<string, unknown> = { ...prev, [key]: value }
      if (selectedAdapter) {
        for (const f of selectedAdapter.param_fields) {
          if (f.filter_by !== key || !f.options_by) continue
          if (f.type === 'multiselect') {
            next[f.key] = []
          } else {
            const valid = f.options_by[String(value ?? '')] ?? []
            const current = next[f.key]
            if (current && !valid.includes(String(current))) {
              next[f.key] = ''
            }
          }
        }

        if (key === 'track') {
          const dirField = selectedAdapter.param_fields.find(f => f.key === 'direction')
          if (dirField?.options_by) {
            const dirs = dirField.options_by[String(value ?? '')] ?? []
            next['direction'] = dirs.length > 0 ? dirs[0] : ''
          }
        }

        if (key === 'direction') {
          const sitesField = selectedAdapter.param_fields.find(f => f.key === 'sites')
          if (sitesField?.type === 'multiselect') {
            next['sites'] = []
          }
        }
      }
      return next
    })
  }

  const upsertJob = (job: WatchJob) => {
    qc.setQueryData<WatchJob[]>(['jobs'], (current = []) => {
      const withoutCurrent = current.filter((candidate) => candidate.id !== job.id)
      return [job, ...withoutCurrent]
    })
    qc.setQueryData(['jobs', job.id], job)
  }

  const invalidateJob = (id?: string) => {
    qc.invalidateQueries({ queryKey: ['jobs'] })
    if (id) qc.invalidateQueries({ queryKey: ['jobs', id] })
  }

  const create = useMutation({
    mutationFn: jobsApi.create,
    onSuccess: (job) => {
      upsertJob(job)
      invalidateJob(job.id)
      onDone(job)
    },
    onError: (e: Error) => setError(e.message),
  })

  const update = useMutation({
    mutationFn: (payload: { id: string; patch: Parameters<typeof jobsApi.update>[1] }) =>
      jobsApi.update(payload.id, payload.patch),
    onSuccess: (job) => {
      upsertJob(job)
      invalidateJob(job.id)
      onDone(job)
    },
    onError: (e: Error) => setError(e.message),
  })

  const pending = mode === 'create' ? create.isPending : update.isPending

  const handleSubmit = () => {
    setError(null)
    if (!selectedAdapter) {
      setError('Please select an adapter')
      return
    }

    const parsedParams: Record<string, unknown> = {}
    for (const field of selectedAdapter.param_fields) {
      if (field.key === 'occupants') continue
      parsedParams[field.key] = params[field.key]
    }

    const peopleCount = parseInt(String(parsedParams.people ?? '0'), 10)
    if (peopleCount > 0 && selectedOccupantIds.length !== peopleCount) {
      setError(
        `Select exactly ${peopleCount} occupant${peopleCount === 1 ? '' : 's'} to match the party size`
      )
      return
    }
    if (selectedOccupantIds.length === 0) {
      setError('At least one occupant must be selected')
      return
    }

    const snapshotOccupants = selectedOccupantIds
      .map(id => roster.find((o: Occupant) => o.id === id))
      .filter(Boolean)
    if (snapshotOccupants.length !== selectedOccupantIds.length) {
      setError('Some selected occupants could not be found — please re-select')
      return
    }
    parsedParams.occupants = snapshotOccupants

    for (const field of selectedAdapter.param_fields) {
      if (field.type === 'multiselect') {
        const val = parsedParams[field.key]
        const opts = field.options_by
          ? field.options_by[String(parsedParams[field.filter_by ?? ''] ?? '')] ?? []
          : field.options ?? []
        if (opts.length > 0 && (!Array.isArray(val) || val.length === 0)) {
          setError(`Please select at least one site to watch`)
          return
        }
      }
    }

    const dateField = selectedAdapter.param_fields.find(f => f.type === 'date')
    if (dateField) {
      const tz = selectedAdapter.booking_timezone
        ?? Intl.DateTimeFormat().resolvedOptions().timeZone
      const dateVal = String(parsedParams[dateField.key] ?? '')
      if (!dateVal) {
        setError(`${dateField.label} is required`)
        return
      }
      if (!isDateValidInTz(dateVal, tz)) {
        const tzLabel = selectedAdapter.booking_timezone ?? 'local time'
        setError(`${dateField.label} must be today or a future date (${tzLabel})`)
        return
      }
    }

    const intervalNum = parseInt(intervalMinutes, 10)
    if (
      enableMonitoring
      && (isNaN(intervalNum) || intervalNum < 1 || intervalNum > 120)
    ) {
      setError('Interval must be between 1 and 120 minutes')
      return
    }
    const safeInterval = (!isNaN(intervalNum) && intervalNum >= 1 && intervalNum <= 120)
      ? intervalNum
      : 15

    if (mode === 'create') {
      create.mutate({
        name,
        adapter_id: selectedAdapterId,
        params: parsedParams,
        auto_book: autoBook,
        enable_monitoring: enableMonitoring,
        interval_minutes: safeInterval,
      })
    } else if (initialJob) {
      update.mutate({
        id: initialJob.id,
        patch: {
          name,
          params: parsedParams,
          auto_book: autoBook,
          enable_monitoring: enableMonitoring,
          interval_minutes: safeInterval,
        },
      })
    }
  }

  const title = mode === 'create' ? 'Create Watch Job' : 'Edit Watch Job'
  const submitIdle = mode === 'create' ? 'Create Job' : 'Save Changes'
  const submitBusy = mode === 'create' ? 'Creating...' : 'Saving...'

  return (
    <>
      {presentation === 'dialog' ? (
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
      ) : (
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      )}
      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <div className="space-y-4">
          <FormSection title="Job Setup">
            <div className="space-y-1.5">
              <Label>Job Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Routeburn Falls Hut – Apr 2026"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Adapter</Label>
                {mode === 'edit' && (
                  <InfoTooltip content="Adapter choice is locked for existing jobs because the param schema is adapter-specific." />
                )}
              </div>
              <Select
                value={selectedAdapterId}
                onValueChange={handleAdapterChange}
                disabled={mode === 'edit'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select booking site" />
                </SelectTrigger>
                <SelectContent>
                  {adapters.map(a => (
                    <SelectItem key={a.adapter_id} value={a.adapter_id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </FormSection>

          {selectedAdapter && (
            <FormSection title="Booking Inputs">
              {selectedAdapter.param_fields.map(field => {
                if (field.key === 'occupants') {
                  const peopleCount = parseInt(String(params.people ?? '0'), 10)
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <ParamLabel fieldKey={field.key} required>
                        Occupants
                      </ParamLabel>
                      <OccupantSelector
                        selectedIds={selectedOccupantIds}
                        onChange={setSelectedOccupantIds}
                        required={peopleCount}
                      />
                    </div>
                  )
                }

                const opts = resolveOptions(field, params)
                if (
                  field.type === 'select'
                  && field.filter_by
                  && !field.required
                  && (!opts || opts.length === 0)
                  && params[field.filter_by]
                ) {
                  return null
                }

                return (
                  <div key={field.key} className="space-y-1.5">
                    <ParamLabel fieldKey={field.key} required={field.required}>
                      {field.label}
                    </ParamLabel>
                    <ParamFieldInput
                      field={field}
                      value={params[field.key]}
                      onChange={val => handleParamChange(field.key, val)}
                      options={opts}
                    />
                  </div>
                )
              })}
            </FormSection>
          )}
        </div>

        <div className="space-y-4">
          <FormSection title="Automation">
            {selectedAdapter ? (
              <>
                <SettingRow
                  title="Auto-book when available"
                  tooltip="Lets the worker continue directly into the booking flow instead of stopping at manual confirmation."
                >
                  <Switch
                    checked={autoBook}
                    onCheckedChange={setAutoBook}
                    id="auto-book"
                  />
                </SettingRow>

                <SettingRow
                  title="Enable monitoring"
                >
                  <Switch
                    checked={enableMonitoring}
                    onCheckedChange={setEnableMonitoring}
                    id="enable-monitoring"
                  />
                </SettingRow>

                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                  <Label
                    htmlFor="interval-minutes"
                    className={enableMonitoring ? '' : 'text-muted-foreground'}
                  >
                    Check interval
                  </Label>
                  <div className="mt-3 flex items-center gap-3">
                    <Input
                      id="interval-minutes"
                      type="number"
                      min={1}
                      max={120}
                      value={intervalMinutes}
                      onChange={e => setIntervalMinutes(e.target.value)}
                      disabled={!enableMonitoring}
                      className="w-24"
                    />
                    <span
                      className={`text-sm ${enableMonitoring ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      minutes
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Select an adapter first to reveal its booking fields and automation settings.
                </p>
              </div>
            )}
          </FormSection>

          <FormSection title="Submit">
            {error && (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={!name || !selectedAdapterId || pending}
            >
              <Settings2 className="size-4" />
              {pending ? submitBusy : submitIdle}
            </Button>
          </FormSection>
        </div>
      </div>
    </>
  )
}

function JobFormPage({
  mode,
  initialJob,
  onDone,
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
}) {
  return (
    <section className="app-panel px-4 py-5 sm:px-6">
      <JobFormBody
        key={`${mode}:${initialJob?.id ?? 'new'}:page`}
        mode={mode}
        initialJob={initialJob}
        onDone={onDone}
        presentation="page"
      />
    </section>
  )
}

export function CreateJobDialog({
  open: controlledOpen,
  onOpenChange,
  onDone,
  hideTrigger = false,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onDone?: (job: WatchJob) => void
  hideTrigger?: boolean
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen == null) {
      setUncontrolledOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  return (
    <>
      {!hideTrigger && (
        <Button onClick={() => handleOpenChange(true)} className="sm:min-w-40">
          <Plus className="size-4" />
          New Watch Job
        </Button>
      )}
      <JobFormDialog open={open} onOpenChange={handleOpenChange} mode="create" onDone={onDone} />
    </>
  )
}

export function CreateJobPage({
  onDone,
}: {
  onDone: (job: WatchJob) => void
}) {
  return <JobFormPage mode="create" onDone={onDone} />
}

export function EditJobDialog({
  open,
  onOpenChange,
  job,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  job: WatchJob
}) {
  return (
    <JobFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="edit"
      initialJob={job}
    />
  )
}

export function EditJobPage({
  job,
  onDone,
}: {
  job: WatchJob
  onDone: (job: WatchJob) => void
}) {
  return <JobFormPage mode="edit" initialJob={job} onDone={onDone} />
}
