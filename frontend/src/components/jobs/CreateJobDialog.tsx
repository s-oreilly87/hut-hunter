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
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  X,
} from 'lucide-react'
import {
  jobsApi, adaptersApi, credentialsApi, occupantsApi,
  type AdapterInfo, type ParamField, type WatchJob, type Occupant,
} from '@/lib/api'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Switch } from '../ui/Switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '../ui/Select'
import { InfoTooltip, SectionHeading } from '../ui/SectionHeading'
import { getJobParamIcon } from '@/components/jobs/jobParamDisplay'
import { cn } from '@/lib/utils'

// ─── Wizard step definitions ─────────────────────────────────────────────────

const WIZARD_STEPS = ['Hunt Setup', 'Booking Inputs', 'Automation'] as const
type WizardStep = 0 | 1 | 2

// ─── Utility helpers ─────────────────────────────────────────────────────────

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

function parseInputDateValue(value: string): Date | null {
  const inputValue = toInputDateValue(value)
  if (!inputValue) return null
  const [year, month, day] = inputValue.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null
  }
  return date
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateForDisplay(value: string): string {
  const date = parseInputDateValue(value)
  if (!date) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()
  return `${month}/${day}/${year}`
}

function isSameCalendarDay(a: Date | null, b: Date): boolean {
  return (
    Boolean(a)
    && a?.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
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
  displayValue,
}: {
  value: string
  onChange: (value: string) => void
  groups: SearchableOptionGroup[]
  placeholder: string
  disabled?: boolean
  displayValue?: (value: string) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
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
  const canClear = !disabled && (Boolean(value) || Boolean(query))

  const clearSelection = () => {
    if (value) onChange('')
    setQuery('')
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

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
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setOpen(true)
            setQuery(event.target.value)
          }}
          className={cn(canClear ? 'pr-16' : 'pr-9')}
        />
        {canClear && (
          <button
            type="button"
            aria-label="Clear selection"
            className="absolute inset-y-1 right-8 flex w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSelection}
          >
            <X className="size-3.5" />
          </button>
        )}
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
          {value && (
            <button
              type="button"
              className="mb-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSelection}
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

function DatePickerInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedDate = parseInputDateValue(value)
  const today = new Date()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => formatDateForDisplay(value))
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = selectedDate ?? today
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  useEffect(() => {
    setDraft(formatDateForDisplay(value))
  }, [value])

  useEffect(() => {
    if (selectedDate && !open) {
      setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
    }
  }, [selectedDate, open])

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

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(visibleMonth)
  const firstWeekday = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1,
  ).getDay()
  const daysInMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    0,
  ).getDate()
  const cells: Array<Date | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => (
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)
    )),
  ]

  const shiftMonth = (amount: number) => {
    setVisibleMonth((current) => (
      new Date(current.getFullYear(), current.getMonth() + amount, 1)
    ))
  }

  const chooseDate = (date: Date) => {
    onChange(formatDateForInput(date))
    setDraft(formatDateForDisplay(formatDateForInput(date)))
    setOpen(false)
  }

  const chooseToday = () => {
    chooseDate(today)
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  const commitDraft = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      onChange('')
      return
    }

    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
    if (!match) {
      setDraft(formatDateForDisplay(value))
      return
    }

    const [, monthRaw, dayRaw, yearRaw] = match
    const month = Number(monthRaw)
    const day = Number(dayRaw)
    const year = Number(yearRaw)
    const date = new Date(year, month - 1, day)
    if (
      date.getFullYear() !== year
      || date.getMonth() !== month - 1
      || date.getDate() !== day
    ) {
      setDraft(formatDateForDisplay(value))
      return
    }

    onChange(formatDateForInput(date))
  }

  return (
    <div ref={ref} className="relative">
      <div
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-left text-base shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm',
          open && 'border-ring ring-3 ring-ring/50',
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
        )}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-left outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed',
          )}
          placeholder="mm/dd/yyyy"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitDraft()
              inputRef.current?.blur()
            }
            if (event.key === 'Escape') {
              setDraft(formatDateForDisplay(value))
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
        />
        <span className="flex items-center gap-1 text-muted-foreground">
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear date"
              className="flex size-6 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground"
              onClick={() => {
                onChange('')
                setDraft('')
                inputRef.current?.focus()
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className="flex size-6 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground disabled:pointer-events-none"
            onClick={() => setOpen((current) => !current)}
          >
            <Calendar className="size-4" />
          </button>
        </span>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-3rem))] rounded-2xl border border-border/80 bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous month"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft className="size-4" />
            </button>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {monthLabel}
            </p>
            <button
              type="button"
              aria-label="Next month"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div
                key={`${day}-${index}`}
                className="flex h-7 items-center justify-center text-[11px] font-semibold text-muted-foreground"
              >
                {day}
              </div>
            ))}
            {cells.map((date, index) => {
              const selected = date ? isSameCalendarDay(selectedDate, date) : false
              const isToday = date ? isSameCalendarDay(today, date) : false
              return date ? (
                <button
                  key={date.toISOString()}
                  type="button"
                  className={cn(
                    'flex h-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-secondary',
                    selected && 'bg-primary text-primary-foreground hover:bg-primary',
                    !selected && isToday && 'border border-primary/30 text-primary',
                  )}
                  onClick={() => chooseDate(date)}
                >
                  {date.getDate()}
                </button>
              ) : (
                <div key={`blank-${index}`} className="h-8" />
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              onClick={chooseToday}
            >
              Today
            </button>
          </div>
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
        <div className="flex min-h-7 items-center justify-between gap-2">
          <p className={`text-xs ${selected.length === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {selected.length === 0
              ? 'Select at least one site to watch'
              : `${selected.length} of ${opts.length} selected`}
          </p>
          {selected.length > 0 && !disabled && (
            <button
              type="button"
              aria-label="Clear selected sites"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => onChange([])}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
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
        displayValue={isFacility ? facilityDisplayName : undefined}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        min={field.key === 'people' ? 1 : undefined}
        max={field.key === 'people' ? 25 : undefined}
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <DatePickerInput
        value={toInputDateValue(String(value ?? ''))}
        onChange={onChange}
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

function shouldHideBookingInputField(
  field: ParamField,
  params: Record<string, unknown>,
  options: string[] | null,
): boolean {
  if (field.filter_by && !params[field.filter_by]) {
    return true
  }

  return (
    field.type === 'select'
    && Boolean(field.filter_by)
    && !field.required
    && (!options || options.length === 0)
    && Boolean(params[field.filter_by ?? ''])
  )
}

function FormSection({
  title,
  tooltip,
  children,
}: {
  title?: string
  tooltip?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
      {title && (
        <div className="mb-4">
          <SectionHeading title={title} tooltip={tooltip} />
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </section>
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

// ─── Booking Inputs step content (shared between wizard and dialog) ───────────

function BookingInputsFields({
  selectedAdapter,
  params,
  roster,
  occupantsLoading,
  selectedOccupantIds,
  setSelectedOccupantIds,
  effectivePeopleCount,
  selectedOccupantCount,
  selectedOccupantsPresent,
  resolveOptions,
  handleParamChange,
}: {
  selectedAdapter: AdapterInfo
  params: Record<string, unknown>
  roster: Occupant[]
  occupantsLoading: boolean
  selectedOccupantIds: string[]
  setSelectedOccupantIds: (ids: string[]) => void
  effectivePeopleCount: number
  selectedOccupantCount: number
  selectedOccupantsPresent: boolean
  resolveOptions: (field: ParamField, params: Record<string, unknown>) => string[] | null
  handleParamChange: (key: string, value: unknown) => void
}) {
  return (
    <>
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

        if (shouldHideBookingInputField(field, params, opts)) {
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
    </>
  )
}

// ─── Automation step content (shared between wizard and dialog) ───────────────

function AutomationFields({
  selectedAdapter,
  autoBook,
  setAutoBook,
  enableMonitoring,
  setEnableMonitoring,
  intervalMinutes,
  setIntervalMinutes,
  selectedOccupantsPresent,
  hasCredentialsForSelectedAdapter,
  selectedOccupantDetailsComplete,
}: {
  selectedAdapter: AdapterInfo | undefined
  autoBook: boolean
  setAutoBook: (v: boolean) => void
  enableMonitoring: boolean
  setEnableMonitoring: (v: boolean) => void
  intervalMinutes: string
  setIntervalMinutes: (v: string) => void
  selectedOccupantsPresent: boolean
  hasCredentialsForSelectedAdapter: boolean
  selectedOccupantDetailsComplete: boolean
}) {
  if (!selectedAdapter) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Select a booking site first to reveal its inputs and automation settings.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Auto-book */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="auto-book">Auto-book when available</Label>
            <InfoTooltip content="Lets Hut Hunter continue directly into the booking flow instead of stopping after availability is found." />
          </div>
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
        </div>
        {!selectedOccupantsPresent && (
          <p className="text-xs text-muted-foreground">
            Select campers to enable auto-book.
          </p>
        )}
        {selectedOccupantsPresent && !selectedOccupantDetailsComplete && (
          <p className="text-xs text-muted-foreground">
            Fill the required camper details for {selectedAdapter.name} before enabling auto-book.
          </p>
        )}
        {selectedOccupantsPresent && !hasCredentialsForSelectedAdapter && (
          <p className="text-xs text-muted-foreground">
            Save a sign-in for this booking site in the header before enabling auto-book.
          </p>
        )}
      </div>

      {/* Enable monitoring */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="enable-monitoring">Enable monitoring</Label>
        <Switch
          checked={enableMonitoring}
          onCheckedChange={setEnableMonitoring}
          id="enable-monitoring"
        />
      </div>

      {/* Check interval */}
      <div className="space-y-1.5">
        <Label
          htmlFor="interval-minutes"
          className={enableMonitoring ? '' : 'text-muted-foreground'}
        >
          Check interval
        </Label>
        <div className="flex items-center gap-3">
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
          <span className={`text-sm ${enableMonitoring ? 'text-foreground' : 'text-muted-foreground'}`}>
            minutes
          </span>
        </div>
      </div>
    </>
  )
}

// ─── Core form body ───────────────────────────────────────────────────────────

function JobFormBody({
  mode,
  initialJob,
  onDone,
  presentation,
  onBack,
  backLabel = 'Back',
  initialStep,
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  presentation: 'dialog' | 'page'
  onBack?: () => void
  backLabel?: string
  initialStep?: WizardStep
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

  // Wizard step state (page presentation only)
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    initialStep ?? (mode === 'edit' ? 1 : 0),
  )

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
          // Reset nights when track changes — will be re-synced when sites are picked
          next['nights'] = '1'
        }

        if (key === 'direction') {
          const sitesField = selectedAdapter.param_fields.find(f => f.key === 'sites')
          if (sitesField?.type === 'multiselect') {
            next['sites'] = []
          }
        }

        // Sync nights to the number of selected sites for Great Walk bookings
        if (key === 'sites') {
          const siteList = Array.isArray(value) ? (value as string[]) : []
          if (siteList.length > 0) {
            next['nights'] = String(siteList.length)
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

  const submitIdle = mode === 'create' ? 'Create Hunt' : 'Save Changes'
  const submitBusy = mode === 'create' ? 'Creating...' : 'Saving...'

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

  // ── Shared booking inputs props ─────────────────────────────────────────────

  const bookingInputsProps = {
    selectedAdapter: selectedAdapter!,
    params,
    roster,
    occupantsLoading,
    selectedOccupantIds,
    setSelectedOccupantIds,
    effectivePeopleCount,
    selectedOccupantCount,
    selectedOccupantsPresent,
    resolveOptions,
    handleParamChange,
  }

  const automationProps = {
    selectedAdapter,
    autoBook,
    setAutoBook,
    enableMonitoring,
    setEnableMonitoring,
    intervalMinutes,
    setIntervalMinutes,
    selectedOccupantsPresent,
    hasCredentialsForSelectedAdapter,
    selectedOccupantDetailsComplete,
  }

  // ── Page presentation: multi-step wizard ────────────────────────────────────

  if (presentation === 'page') {
    const bookingInputsComplete = selectedAdapter
      ? selectedAdapter.param_fields.every((field) => {
          if (field.key === 'occupants') return true

          const opts = resolveOptions(field, params)
          if (shouldHideBookingInputField(field, params, opts)) return true

          if (field.key === 'people' && selectedOccupantsPresent) {
            return selectedOccupantCount > 0
          }

          if (field.type === 'multiselect') {
            const hasChoices = opts ? opts.length > 0 : true
            if (!field.required && !hasChoices) return true
            const value = params[field.key]
            return Array.isArray(value) && value.length > 0
          }

          return !field.required || !isBlankValue(params[field.key])
        })
      : false
    const stepBackLabels = [backLabel, WIZARD_STEPS[0], 'Details']
    const wizardBackLabel = stepBackLabels[wizardStep] ?? backLabel
    const isLastStep = wizardStep === (WIZARD_STEPS.length - 1) as WizardStep
    const canAdvance = wizardStep === 0
      ? (!!name.trim() && !!selectedAdapterId)
      : wizardStep === 1
        ? bookingInputsComplete
        : true

    const handleWizardBack = () => {
      if (wizardStep > 0) {
        setWizardStep((s) => (s - 1) as WizardStep)
      } else {
        onBack?.()
      }
    }

    const handleWizardNext = () => {
      if (!isLastStep) {
        setWizardStep((s) => (s + 1) as WizardStep)
      }
    }

    return (
      <>
        {/* Step header */}
        <div className="shrink-0 border-b border-border/70 px-4 py-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div>
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2 w-fit"
                onClick={handleWizardBack}
              >
                <ArrowLeft className="size-4" />
                {wizardBackLabel}
              </Button>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold tracking-tight text-foreground">
                {wizardStep === 1 && selectedAdapter
                  ? selectedAdapter.name
                  : WIZARD_STEPS[wizardStep]}
              </p>
              <div className="mt-2 flex justify-center gap-1.5">
                {WIZARD_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'size-1.5 rounded-full transition-colors duration-200',
                      i === wizardStep
                        ? 'bg-primary'
                        : i < wizardStep
                          ? 'bg-primary/35'
                          : 'bg-border',
                    )}
                  />
                ))}
              </div>
            </div>
            <div />
          </div>
        </div>

        {/* Step content */}
        <div className="app-panel-body-scroll px-4 sm:px-5">
          <div className="space-y-5 pt-6 pb-8">

            {/* Step 0: Hunt Setup */}
            {wizardStep === 0 && (
              <>
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
              </>
            )}

            {/* Step 1: Booking Inputs */}
            {wizardStep === 1 && selectedAdapter && (
              <BookingInputsFields {...bookingInputsProps} />
            )}

            {/* Step 2: Automation */}
            {wizardStep === 2 && (
              <AutomationFields {...automationProps} />
            )}

            {/* Navigation */}
            {isLastStep ? (
              <>
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
              </>
            ) : (
              <Button
                className="w-full"
                onClick={handleWizardNext}
                disabled={!canAdvance}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </>
    )
  }

  // ── Dialog presentation: all sections visible ───────────────────────────────

  const title = mode === 'create' ? 'Create Hunt' : 'Edit Hunt'

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pl-2 text-2xl tracking-tight sm:pl-3">
          {title}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <div className="space-y-4">
          <FormSection>
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
            <FormSection>
              <BookingInputsFields {...bookingInputsProps} />
            </FormSection>
          )}
        </div>

        <div className="space-y-4">
          <FormSection>
            <AutomationFields {...automationProps} />
          </FormSection>

          <FormSection>
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

// ─── Page shell ───────────────────────────────────────────────────────────────

function JobFormPage({
  mode,
  initialJob,
  onDone,
  onBack,
  backLabel = 'Back',
  initialStep,
}: {
  mode: Mode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
  initialStep?: WizardStep
}) {
  return (
    <section className="app-panel app-panel-frame flex-1">
      <JobFormBody
        key={`${mode}:${initialJob?.id ?? 'new'}:page`}
        mode={mode}
        initialJob={initialJob}
        onDone={onDone}
        presentation="page"
        onBack={onBack}
        backLabel={backLabel}
        initialStep={initialStep}
      />
    </section>
  )
}

// ─── Dialog shell ─────────────────────────────────────────────────────────────

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

// ─── Public exports ───────────────────────────────────────────────────────────

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
      initialStep={1}
    />
  )
}
