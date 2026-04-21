import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarDays,
  CircleHelp,
  Map,
  MapPinned,
  MoonStar,
  Plus,
  Settings2,
  Users,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

// For the DOC standard hut "facility" select, each option value encodes:
//   "Mueller Hut (747/2487) — Aoraki/Mount Cook National Park"
// We strip the IDs and park suffix so the select shows only the facility name.
// Items are already grouped by park via SelectGroup, so the park is visible
// as the group header label.
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

function FormSection({
  title,
  tooltip,
  children,
}: {
  title: string
  tooltip: string
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
  tooltip: string
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

function InfoTooltip({
  content,
  align = 'center',
}: {
  content: string
  align?: 'center' | 'start' | 'end'
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label="More information"
          >
            <CircleHelp className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent align={align} side="bottom">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function SectionHeading({
  title,
  tooltip,
  tone = 'section',
}: {
  title: string
  tooltip: string
  tone?: 'section' | 'body'
}) {
  return (
    <div className="flex items-center gap-2">
      <h3 className={tone === 'section'
        ? 'text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground'
        : 'font-medium text-foreground'}
      >
        {title}
      </h3>
      <InfoTooltip content={tooltip} />
    </div>
  )
}

function renderParamIcon(fieldKey: string) {
  switch (fieldKey) {
    case 'track':
      return <Map className="h-3.5 w-3.5 text-muted-foreground" />
    case 'date':
      return <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
    case 'nights':
      return <MoonStar className="h-3.5 w-3.5 text-muted-foreground" />
    case 'people':
    case 'occupants':
      return <Users className="h-3.5 w-3.5 text-muted-foreground" />
    case 'direction':
      return <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    case 'sites':
      return <MapPinned className="h-3.5 w-3.5 text-muted-foreground" />
    default:
      return null
  }
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
  return (
    <Label className="inline-flex items-center gap-2">
      {renderParamIcon(fieldKey)}
      <span>{children}</span>
      {required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  )
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
      <DialogContent className="max-h-[92vh] sm:max-w-3xl overflow-y-auto">
        <JobFormBody
          key={`${mode}:${initialJob?.id ?? 'new'}`}
          mode={mode}
          initialJob={initialJob}
          onDone={() => onOpenChange(false)}
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
  onDone: () => void
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
      {presentation === 'dialog' ? (
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{title}</DialogTitle>
            <InfoTooltip
              content="Set the adapter inputs, choose the saved occupants, and decide whether this job should monitor on a schedule or only run on demand."
              align="start"
            />
          </div>
        </DialogHeader>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <InfoTooltip
              content="Set the adapter inputs, choose the saved occupants, and decide whether this job should monitor on a schedule or only run on demand."
              align="start"
            />
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Configure the booking adapter, confirm the party details, and choose whether this job should watch automatically or stay manual.
          </p>
        </div>
      )}
      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <div className="space-y-4">
          <FormSection
            title="Job Setup"
            tooltip="Name the workflow and pick the booking adapter it should target."
          >
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
            <FormSection
              title="Booking Inputs"
              tooltip="These fields mirror the adapter’s required search and booking parameters."
            >
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
          <FormSection
            title="Automation"
            tooltip="Control whether the job books automatically and how aggressively it monitors."
          >
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
                  tooltip="Keep polling this job on a schedule instead of only checking when you trigger it manually."
                >
                  <Switch
                    checked={enableMonitoring}
                    onCheckedChange={setEnableMonitoring}
                    id="enable-monitoring"
                  />
                </SettingRow>

                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="interval-minutes"
                      className={enableMonitoring ? '' : 'text-muted-foreground'}
                    >
                      Check interval
                    </Label>
                    <InfoTooltip content="The backend will clamp invalid values on submit, but keeping a sane interval here keeps scheduled checks predictable." />
                  </div>
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

          <FormSection
            title="Submit"
            tooltip="Review validation errors here before creating or updating the job."
          >
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
              <Settings2 className="h-4 w-4" />
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
  onDone: () => void
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

// ---------------------------------------------------------------------------
// Public wrappers
// ---------------------------------------------------------------------------

export function CreateJobDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
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
          <Plus className="h-4 w-4" />
          New Watch Job
        </Button>
      )}
      <JobFormDialog open={open} onOpenChange={handleOpenChange} mode="create" />
    </>
  )
}

export function CreateJobPage({
  onDone,
}: {
  onDone: () => void
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
  onDone: () => void
}) {
  return <JobFormPage mode="edit" initialJob={job} onDone={onDone} />
}
