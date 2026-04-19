import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

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
  if (field.type === 'select' && selectOptions) {
    return (
      <Select value={String(value ?? '')} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map(opt => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
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

// ---------------------------------------------------------------------------
// OccupantSelector — multiselect from saved roster
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Date validation (adapter-timezone-aware)
// ---------------------------------------------------------------------------

/** Return true if the DD/MM/YYYY date string is today or in the future
 *  when interpreted in the given IANA timezone. */
function isDateValidInTz(dateStr: string, timezone: string): boolean {
  const parts = dateStr.split('/')
  if (parts.length !== 3) return false
  const [dd, mm, yyyy] = parts
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return false

  // Resolve "today" in the adapter's timezone via Intl
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const tzY = Number(tzParts.find(p => p.type === 'year')?.value)
  const tzM = Number(tzParts.find(p => p.type === 'month')?.value)
  const tzD = Number(tzParts.find(p => p.type === 'day')?.value)

  const jobY = Number(yyyy), jobM = Number(mm), jobD = Number(dd)
  if ([jobY, jobM, jobD, tzY, tzM, tzD].some(isNaN)) return false

  // Compare as YYYYMMDD integers — timezone-safe, no UTC conversion needed
  const tzInt = tzY * 10000 + tzM * 100 + tzD
  const jobInt = jobY * 10000 + jobM * 100 + jobD
  return jobInt >= tzInt
}

function buildDefaultParams(fields: ParamField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map(f => [f.key, f.default ?? ''])
  )
}

// In the DB, occupants is a parsed array; in the form, it's a JSON string in a
// textarea. Round-trip it back when loading a job for edit. We operate purely
// on job.params (no adapter fields needed) so this can run before the adapter
// definition has loaded.
function buildParamsFromJob(job: WatchJob): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(job.params)) {
    if (k === 'occupants') continue  // handled by OccupantSelector, not params state
    out[k] = v ?? ''
  }
  return out
}

// ---------------------------------------------------------------------------
// Shared controlled dialog
// ---------------------------------------------------------------------------

type Mode = 'create' | 'edit'

function JobFormDialog({
  open,
  onOpenChange,
  mode,
  initialJob,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: Mode
  initialJob?: WatchJob
}) {
  // Radix Dialog unmounts children when closed, but we also key the body on
  // mode + job id so that opening the same dialog for a different job reliably
  // remounts the form and re-runs its useState initializers. This is how we
  // get "fresh state per open" without a prop-sync effect.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <JobFormBody
          key={`${mode}:${initialJob?.id ?? 'new'}`}
          mode={mode}
          initialJob={initialJob}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function JobFormBody({
  mode,
  initialJob,
  onDone,
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: () => void
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
  // Monitoring — default on for new jobs so the user opts *out* rather than
  // discovering the toggle buried in the dialog. For existing jobs we echo
  // whatever's persisted.
  const [enableMonitoring, setEnableMonitoring] = useState(
    mode === 'edit' && initialJob ? initialJob.enable_monitoring : true,
  )
  const [intervalMinutes, setIntervalMinutes] = useState<string>(
    mode === 'edit' && initialJob
      ? String(initialJob.interval_minutes)
      : '15',
  )
  const [error, setError] = useState<string | null>(null)

  // Occupant IDs selected from the roster. Initialise from the job's existing
  // occupant snapshots (match by id if present, otherwise leave empty).
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

  // Resolve the effective options for a field, accounting for filter_by.
  const resolveOptions = (
    field: ParamField,
    currentParams: Record<string, unknown>,
  ): string[] | null => {
    if (field.filter_by && field.options_by) {
      const key = String(currentParams[field.filter_by] ?? '')
      return field.options_by[key] ?? []
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
      // If this field is used as a `filter_by` source for any other field,
      // clear those dependent fields whose current value is no longer valid.
      if (selectedAdapter) {
        for (const f of selectedAdapter.param_fields) {
          if (f.filter_by !== key || !f.options_by) continue
          const valid = f.options_by[String(value ?? '')] ?? []
          const current = next[f.key]
          if (current && !valid.includes(String(current))) {
            next[f.key] = ''
          }
        }
      }
      return next
    })
  }

  const invalidateJob = (id?: string) => {
    qc.invalidateQueries({ queryKey: ['jobs'] })
    if (id) qc.invalidateQueries({ queryKey: ['jobs', id] })
  }

  const create = useMutation({
    mutationFn: jobsApi.create,
    onSuccess: (job) => {
      invalidateJob(job.id)
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  const update = useMutation({
    mutationFn: (payload: { id: string; patch: Parameters<typeof jobsApi.update>[1] }) =>
      jobsApi.update(payload.id, payload.patch),
    onSuccess: (job) => {
      invalidateJob(job.id)
      onDone()
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

    // Build parsedParams — occupants come from the roster selector, not raw JSON
    const parsedParams: Record<string, unknown> = {}
    for (const field of selectedAdapter.param_fields) {
      if (field.key === 'occupants') continue  // handled separately below
      parsedParams[field.key] = params[field.key]
    }

    // Validate occupant count matches party size
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

    // Snapshot the selected occupants' current data into the job params
    const snapshotOccupants = selectedOccupantIds
      .map(id => roster.find((o: Occupant) => o.id === id))
      .filter(Boolean)
    if (snapshotOccupants.length !== selectedOccupantIds.length) {
      setError('Some selected occupants could not be found — please re-select')
      return
    }
    parsedParams.occupants = snapshotOccupants

    // Validate any date field is today-or-future in the adapter's timezone.
    // Falls back to the browser's local timezone when the adapter doesn't
    // specify one (matches the server-side default of local server time).
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

    // Validate interval (only matters when monitoring is on, but we still
    // want a sane value so toggling monitoring back on later works)
    const intervalNum = parseInt(intervalMinutes, 10)
    if (
      enableMonitoring
      && (isNaN(intervalNum) || intervalNum < 1 || intervalNum > 120)
    ) {
      setError('Interval must be between 1 and 120 minutes')
      return
    }
    // If monitoring is off, a bad interval in the disabled input is fine —
    // clamp to a sensible default on submit so the backend still gets a
    // valid int.
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
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">

        {/* Job name */}
        <div className="space-y-1">
          <Label>Job Name</Label>
          <Input
            placeholder="e.g. Routeburn Falls Hut – Apr 2026"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

          {/* Adapter selector — disabled in edit mode since params are
              adapter-specific. To change adapters, delete + recreate. */}
          <div className="space-y-1">
            <Label>Adapter</Label>
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

          {/* Dynamic param fields */}
          {selectedAdapter && selectedAdapter.param_fields.map(field => {
            // Occupants are managed via the roster selector, not a raw input
            if (field.key === 'occupants') {
              const peopleCount = parseInt(String(params.people ?? '0'), 10)
              return (
                <div key={field.key} className="space-y-1">
                  <Label>
                    Occupants
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <OccupantSelector
                    selectedIds={selectedOccupantIds}
                    onChange={setSelectedOccupantIds}
                    required={peopleCount}
                  />
                </div>
              )
            }

            const opts = resolveOptions(field, params)
            // Hide dependent selects when the filter value has no valid options
            // (e.g. Milford Track has no direction). Still render when the
            // parent value hasn't been chosen yet (opts === []), so the user
            // sees a disabled/empty select rather than a vanished field.
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
              <div key={field.key} className="space-y-1">
                <Label>
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                <ParamFieldInput
                  field={field}
                  value={params[field.key]}
                  onChange={val => handleParamChange(field.key, val)}
                  options={opts}
                />
              </div>
            )
          })}

          {/* Auto book toggle */}
          {selectedAdapter && (
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={autoBook}
                onCheckedChange={setAutoBook}
                id="auto-book"
              />
              <Label htmlFor="auto-book">
                Auto-book when available
                <span className="text-muted-foreground text-xs ml-2">
                  (requires stored session)
                </span>
              </Label>
            </div>
          )}

          {/* Monitoring toggle + interval. Interval input is visible but
              disabled when monitoring is off — less jarring than popping in
              and out of the layout. */}
          {selectedAdapter && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={enableMonitoring}
                  onCheckedChange={setEnableMonitoring}
                  id="enable-monitoring"
                />
                <Label htmlFor="enable-monitoring">
                  Enable monitoring
                  <span className="text-muted-foreground text-xs ml-2">
                    (auto-check on a schedule)
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-2 pl-10">
                <Label
                  htmlFor="interval-minutes"
                  className={enableMonitoring ? '' : 'text-muted-foreground'}
                >
                  Check every
                </Label>
                <Input
                  id="interval-minutes"
                  type="number"
                  min={1}
                  max={120}
                  value={intervalMinutes}
                  onChange={e => setIntervalMinutes(e.target.value)}
                  disabled={!enableMonitoring}
                  className="w-20"
                />
                <span
                  className={`text-sm ${enableMonitoring ? '' : 'text-muted-foreground'}`}
                >
                  minutes
                </span>
              </div>
            </div>
          )}

          {error && <p className="text-destructive text-xs">{error}</p>}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!name || !selectedAdapterId || pending}
          >
            {pending ? submitBusy : submitIdle}
          </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Public wrappers
// ---------------------------------------------------------------------------

export function CreateJobDialog() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>New Watch Job</Button>
      <JobFormDialog open={open} onOpenChange={setOpen} mode="create" />
    </>
  )
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
