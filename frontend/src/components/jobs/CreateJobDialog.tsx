import {
  createElement,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Settings2,
} from 'lucide-react'
import {
  jobsApi, adaptersApi, credentialsApi, occupantsApi,
  type AdapterInfo, type ParamField, type WatchJob, type Occupant,
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
import { InfoTooltip, SectionHeading } from '@/components/ui/section-heading'
import { getJobParamIcon } from '@/components/jobs/jobParamDisplay'
import { cn } from '@/lib/utils'

const FACILITY_OPTION_DISPLAY_RE = /^(.+?)\s*\(\d+\/\d+\)(?:\s*—\s*.+)?$/

function facilityDisplayName(opt: string): string {
  const m = FACILITY_OPTION_DISPLAY_RE.exec(opt.trim())
  return m ? m[1].trim() : opt
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

function isDayFirstDate(value: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())
}

function toInputDateValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isIsoDate(trimmed)) return trimmed
  const [day, month, year] = trimmed.split('/')
  if (!day || !month || !year) return ''
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function toAdapterDateValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isDayFirstDate(trimmed)) return trimmed
  const [year, month, day] = trimmed.split('-')
  if (!year || !month || !day) return ''
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year.padStart(4, '0')}`
}

type SearchableOptionGroup = {
  label?: string
  options: string[]
}

function SearchableSelectInput({
  value,
  onChange,
  groups,
  placeholder,
  disabled = false,
  required = false,
  displayValue,
}: {
  value: string
  onChange: (value: string) => void
  groups: SearchableOptionGroup[]
  placeholder: string
  disabled?: boolean
  required?: boolean
  displayValue?: (value: string) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const renderValue = displayValue ?? ((option: string) => option)
  const selectedLabel = value ? renderValue(value) : ''
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(selectedLabel)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open) {
      setQuery(selectedLabel)
    }
  }, [selectedLabel, open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const totalOptions = groups.reduce((count, group) => count + group.options.length, 0)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const showTruncatedHint = !normalizedQuery && totalOptions > 24

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) {
      let remaining = 24
      return groups
        .map((group) => {
          const slice = remaining > 0 ? group.options.slice(0, remaining) : []
          remaining -= slice.length
          return { label: group.label, options: slice }
        })
        .filter((group) => group.options.length > 0)
    }

    return groups
      .map((group) => ({
        label: group.label,
        options: group.options.filter((option) => {
          const label = renderValue(option).toLowerCase()
          return label.includes(normalizedQuery) || option.toLowerCase().includes(normalizedQuery)
        }),
      }))
      .filter((group) => group.options.length > 0)
  }, [groups, normalizedQuery, renderValue])

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Input
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setOpen(true)
            setQuery(event.target.value)
          }}
          className="pr-9"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-hidden="true"
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground disabled:opacity-60"
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-black/5">
          {!required && value && (
            <button
              type="button"
              className="mb-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange('')
                setQuery('')
                setOpen(false)
              }}
            >
              Clear selection
            </button>
          )}

          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <div key={group.label ?? 'options'} className="space-y-1">
                {group.label && (
                  <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {group.label}
                  </p>
                )}
                {group.options.map((option) => {
                  const selected = option === value
                  return (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        'flex w-full items-start rounded-xl px-3 py-2 text-left text-sm hover:bg-secondary/70',
                        selected && 'bg-primary/10 text-primary',
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onChange(option)
                        setQuery(renderValue(option))
                        setOpen(false)
                      }}
                    >
                      {renderValue(option)}
                    </button>
                  )
                })}
              </div>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No matches found.
            </p>
          )}

          {showTruncatedHint && (
            <p className="px-3 pt-3 text-xs text-muted-foreground">
              Showing the first 24 options. Start typing to narrow the list.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ParamFieldInput({
  field,
  value,
  onChange,
  options,
  disabled = false,
}: {
  field: ParamField
  value: unknown
  onChange: (val: unknown) => void
  options?: string[] | null
  disabled?: boolean
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
    const isFacility = field.key === 'facility'
    const groups: SearchableOptionGroup[] = field.options_tree
      ? field.options_tree.map((group) => ({
          label: group.group,
          options: group.items,
        }))
      : [{ options: selectOptions ?? [] }]

    return (
      <SearchableSelectInput
        value={String(value ?? '')}
        onChange={(nextValue) => onChange(nextValue)}
        groups={groups}
        placeholder={`Select ${field.label}`}
        disabled={disabled}
        required={field.required}
        displayValue={isFacility ? facilityDisplayName : undefined}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <Input
        type="date"
        value={toInputDateValue(String(value ?? ''))}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      />
    )
  }

  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    />
  )
}

function isBlankValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function getMissingOccupantFields(
  occupant: Occupant,
  adapter: AdapterInfo | undefined,
): string[] {
  if (!adapter) return []
  const adapterValues = occupant.adapter_values[adapter.adapter_id] ?? {}
  return adapter.occupant_fields
    .filter(field => field.required && isBlankValue(adapterValues[field.key]))
    .map(field => field.label)
}

function formatOccupantAdapterSummary(
  occupant: Occupant,
  adapter: AdapterInfo | undefined,
): string | null {
  if (!adapter) return null
  const adapterValues = occupant.adapter_values[adapter.adapter_id] ?? {}
  const parts = adapter.occupant_fields
    .map(field => {
      const value = adapterValues[field.key]
      return isBlankValue(value) ? null : `${field.label}: ${String(value)}`
    })
    .filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join(' · ') : null
}

function buildOccupantSnapshot(
  occupant: Occupant,
  adapter: AdapterInfo | undefined,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    id: occupant.id,
    first_name: occupant.first_name,
    last_name: occupant.last_name,
    age: occupant.age,
    gender: occupant.gender,
    country: occupant.country,
  }
  if (!adapter) return snapshot

  const adapterValues = occupant.adapter_values[adapter.adapter_id] ?? {}
  for (const field of adapter.occupant_fields) {
    const value = adapterValues[field.key]
    if (!isBlankValue(value)) {
      snapshot[field.key] = value
    }
  }
  return snapshot
}

function OccupantSelector({
  roster,
  adapter,
  selectedIds,
  onChange,
  peopleCount,
  loading = false,
}: {
  roster: Occupant[]
  adapter?: AdapterInfo
  selectedIds: string[]
  onChange: (ids: string[]) => void
  peopleCount: number
  loading?: boolean
}) {
  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(i => i !== id)
        : [...selectedIds, id]
    )
  }

  const countLabel = selectedIds.length > 0
    ? `${selectedIds.length} selected — party size will be inferred from campers`
    : peopleCount > 0
      ? `No campers selected — optional for checks, required for booking`
      : 'Select campers to enable booking'

  if (loading) return <p className="text-xs text-muted-foreground">Loading campers...</p>

  if (roster.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No saved campers. Add some via the{' '}
        <span className="font-medium">Campers</span>{' '}
        menu in the header first.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-1">
        {roster.map((o: Occupant) => {
          const checked = selectedIds.includes(o.id)
          const missing = getMissingOccupantFields(o, adapter)
          const adapterSummary = formatOccupantAdapterSummary(o, adapter)
          return (
            <label
              key={o.id}
              className={`flex items-start gap-2.5 rounded px-2 py-1.5 cursor-pointer text-sm
                ${checked ? 'bg-primary/10' : 'hover:bg-muted'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(o.id)}
                className="mt-0.5 accent-primary"
              />
              <span className="min-w-0">
                <span className="font-medium">{o.first_name} {o.last_name}</span>
                <span className="block text-muted-foreground text-xs">
                  {o.age}y · {o.gender} · {o.country}
                </span>
                {adapterSummary && (
                  <span className="block text-muted-foreground text-xs">
                    {adapterSummary}
                  </span>
                )}
                {missing.length > 0 && (
                  <span className="block text-[11px] text-amber-700">
                    Missing {adapter?.name}: {missing.join(', ')}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {countLabel}
      </p>
      {adapter && adapter.occupant_fields.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {adapter.name} also needs camper details: {adapter.occupant_fields.map(field => field.label).join(', ')}.
        </p>
      )}
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

function normalizeDateParamValue(field: ParamField, value: unknown): unknown {
  if (field.type !== 'date' || typeof value !== 'string') return value
  return toInputDateValue(value)
}

function buildDefaultParams(fields: ParamField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map(f => [f.key, normalizeDateParamValue(f, f.default ?? '')])
  )
}

function buildParamsFromJob(
  job: WatchJob,
  fields: ParamField[],
): Record<string, unknown> {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(job.params)) {
    if (k === 'occupants') continue
    if (k === 'sites' && typeof v === 'string') {
      // Keep legacy string payloads editable after the multiselect migration.
      out[k] = v.split(',').map(s => s.trim()).filter(Boolean)
    } else {
      const field = fieldsByKey.get(k)
      out[k] = field ? normalizeDateParamValue(field, v ?? '') : (v ?? '')
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
  showPageHeading = true,
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  presentation: 'dialog' | 'page'
  showPageHeading?: boolean
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(
    mode === 'edit' && initialJob ? initialJob.name : '',
  )
  const [selectedAdapterId, setSelectedAdapterId] = useState(
    mode === 'edit' && initialJob ? initialJob.adapter_id : '',
  )
  const [params, setParams] = useState<Record<string, unknown>>({})
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

  const { data: roster = [], isLoading: occupantsLoading } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })
  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials'],
    queryFn: credentialsApi.list,
  })

  const selectedAdapter = adapters.find(a => a.adapter_id === selectedAdapterId)
  const hasCredentialsForSelectedAdapter = !selectedAdapter?.requires_credentials
    || credentials.some((credential) => credential.adapter_id === selectedAdapterId)
  const selectedRosterOccupants = selectedOccupantIds
    .map(id => roster.find((occupant: Occupant) => occupant.id === id))
    .filter((occupant): occupant is Occupant => Boolean(occupant))
  const selectedOccupantsMissingFromRoster = (
    selectedRosterOccupants.length !== selectedOccupantIds.length
  )
  const selectedOccupantFieldIssues = selectedAdapter
    ? selectedRosterOccupants
      .map((occupant) => ({
        occupant,
        missing: getMissingOccupantFields(occupant, selectedAdapter),
      }))
      .filter((issue) => issue.missing.length > 0)
    : []
  const selectedOccupantDetailsComplete = (
    !selectedOccupantsMissingFromRoster
    && selectedOccupantFieldIssues.length === 0
  )
  const selectedOccupantCount = selectedOccupantIds.length
  const selectedOccupantsPresent = selectedOccupantCount > 0
  const enteredPeopleCount = parseInt(String(params.people ?? '0'), 10)
  const effectivePeopleCount = selectedOccupantsPresent
    ? selectedOccupantCount
    : enteredPeopleCount

  useEffect(() => {
    if (
      mode !== 'edit'
      || !initialJob
      || !selectedAdapter
      || Object.keys(params).length > 0
    ) {
      return
    }
    setParams(buildParamsFromJob(initialJob, selectedAdapter.param_fields))
  }, [initialJob, mode, params, selectedAdapter])

  useEffect(() => {
    if (
      (!selectedOccupantsPresent
        || !hasCredentialsForSelectedAdapter
        || !selectedOccupantDetailsComplete)
      && autoBook
    ) {
      setAutoBook(false)
    }
  }, [
    selectedOccupantsPresent,
    hasCredentialsForSelectedAdapter,
    selectedOccupantDetailsComplete,
    autoBook,
  ])

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
      setError('Please select a booking site')
      return
    }

    const parsedParams: Record<string, unknown> = {}
    for (const field of selectedAdapter.param_fields) {
      if (field.key === 'occupants') continue
      const value = params[field.key]
      parsedParams[field.key] = (
        field.type === 'date' && typeof value === 'string'
          ? toAdapterDateValue(value)
          : value
      )
    }

    if (!(effectivePeopleCount > 0)) {
      setError('Enter a party size or select campers')
      return
    }

    parsedParams.people = String(effectivePeopleCount)

    if (autoBook && !selectedOccupantsPresent) {
      setError('Select campers before enabling auto-book')
      return
    }
    if (autoBook && !hasCredentialsForSelectedAdapter) {
      setError('Save a sign-in for this booking site before enabling auto-book')
      return
    }
    if (selectedOccupantsPresent && selectedOccupantsMissingFromRoster) {
      setError('Some selected campers could not be found — please re-select')
      return
    }
    if (selectedOccupantsPresent && !selectedOccupantDetailsComplete) {
      const issue = selectedOccupantFieldIssues[0]
      setError(
        `${issue.occupant.first_name} ${issue.occupant.last_name} is missing ${selectedAdapter.name} details: ${issue.missing.join(', ')}`
      )
      return
    }

    if (selectedOccupantsPresent) {
      parsedParams.occupants = selectedRosterOccupants.map((occupant) => (
        buildOccupantSnapshot(occupant, selectedAdapter)
      ))
    } else {
      parsedParams.occupants = []
    }

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

  const title = mode === 'create' ? 'Create Hunt' : 'Edit Hunt'
  const submitIdle = mode === 'create' ? 'Create Hunt' : 'Save Changes'
  const submitBusy = mode === 'create' ? 'Creating...' : 'Saving...'

  return (
    <>
      {presentation === 'dialog' ? (
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
      ) : showPageHeading ? (
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      ) : null}
      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <div className="space-y-4">
          <FormSection title="Hunt Setup">
            <div className="space-y-1.5">
              <Label>Hunt Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Routeburn Falls Hut – Apr 2026"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Booking Site</Label>
                {mode === 'edit' && (
                  <InfoTooltip content="Booking site is locked on existing hunts because each site has its own input schema." />
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
              {selectedAdapter?.requires_credentials && !hasCredentialsForSelectedAdapter && (
                <p className="text-xs text-amber-700">
                  No sign-in saved for this booking site. Booking actions will stay disabled.
                </p>
              )}
            </div>
          </FormSection>

          {selectedAdapter && (
            <FormSection title="Booking Inputs">
              {selectedAdapter.param_fields.map(field => {
                if (field.key === 'occupants') {
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <ParamLabel fieldKey={field.key}>
                        Campers
                      </ParamLabel>
                      <OccupantSelector
                        roster={roster}
                        adapter={selectedAdapter}
                        selectedIds={selectedOccupantIds}
                        onChange={setSelectedOccupantIds}
                        peopleCount={effectivePeopleCount}
                        loading={occupantsLoading}
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
                      value={
                        field.key === 'people' && selectedOccupantsPresent
                          ? String(selectedOccupantCount)
                          : params[field.key]
                      }
                      onChange={val => handleParamChange(field.key, val)}
                      options={opts}
                      disabled={field.key === 'people' && selectedOccupantsPresent}
                    />
                    {field.key === 'people' && (
                      <p className="text-xs text-muted-foreground">
                        {selectedOccupantsPresent
                          ? `Party size is being inferred from ${selectedOccupantCount} selected camper${selectedOccupantCount === 1 ? '' : 's'}.`
                          : 'Used for availability checks when no campers are selected.'}
                      </p>
                    )}
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
                  tooltip="Lets Hut Hunter continue directly into the booking flow instead of stopping after availability is found."
                >
                  <div className="space-y-2 text-right">
                    <Switch
                      checked={autoBook}
                      onCheckedChange={setAutoBook}
                      id="auto-book"
                      disabled={
                        !selectedOccupantsPresent
                        || !hasCredentialsForSelectedAdapter
                        || !selectedOccupantDetailsComplete
                      }
                    />
                    {!selectedOccupantsPresent && (
                      <p className="max-w-56 text-xs text-muted-foreground">
                        Select campers to enable auto-book.
                      </p>
                    )}
                    {selectedOccupantsPresent && !selectedOccupantDetailsComplete && (
                      <p className="max-w-56 text-xs text-muted-foreground">
                        Fill the required camper details for {selectedAdapter.name} before enabling auto-book.
                      </p>
                    )}
                    {selectedOccupantsPresent && !hasCredentialsForSelectedAdapter && (
                      <p className="max-w-56 text-xs text-muted-foreground">
                        Save a sign-in for this booking site in the header before enabling auto-book.
                      </p>
                    )}
                  </div>
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
                  Select a booking site first to reveal its inputs and automation settings.
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
  onBack,
  backLabel = 'Back',
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
}) {
  const title = mode === 'create' ? 'Create Hunt' : 'Edit Hunt'

  return (
    <section className="app-panel app-panel-frame flex-1">
      <div className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            {onBack && (
              <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
                <ArrowLeft className="size-4" />
                {backLabel}
              </Button>
            )}
          </div>
          <h1 className="text-center text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {title}
          </h1>
          <div />
        </div>
      </div>
      <div className="app-panel-body-scroll px-4 sm:px-6">
        <div>
          <JobFormBody
            key={`${mode}:${initialJob?.id ?? 'new'}:page`}
            mode={mode}
            initialJob={initialJob}
            onDone={onDone}
            presentation="page"
            showPageHeading={false}
          />
        </div>
      </div>
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
          New Hunt
        </Button>
      )}
      <JobFormDialog open={open} onOpenChange={handleOpenChange} mode="create" onDone={onDone} />
    </>
  )
}

export function CreateJobPage({
  onDone,
  onBack,
  backLabel,
}: {
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
}) {
  return <JobFormPage mode="create" onDone={onDone} onBack={onBack} backLabel={backLabel} />
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
  onBack,
  backLabel,
}: {
  job: WatchJob
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <JobFormPage
      mode="edit"
      initialJob={job}
      onDone={onDone}
      onBack={onBack}
      backLabel={backLabel}
    />
  )
}
