import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Filter, X } from 'lucide-react'
import { type JobFilterKey, JOB_FILTERS, getJobFilterDefinition } from '@/components/jobs/jobFilters'
import { cn } from '@/lib/utils'

export function FilterDropdown({
  filters,
  onChange,
  filterCounts,
}: {
  filters: JobFilterKey[]
  onChange: (filters: JobFilterKey[]) => void
  filterCounts: Map<JobFilterKey, number>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const isFiltered = filters.length > 0 && !filters.includes('all')

  const label = isFiltered
    ? filters.map((k) => getJobFilterDefinition(k).label).join(', ')
    : 'All Hunts'

  const toggle = (key: JobFilterKey) => {
    if (key === 'all') {
      onChange([])
      setOpen(false)
      return
    }
    const without = filters.filter((f) => f !== 'all')
    const next = without.includes(key)
      ? without.filter((f) => f !== key)
      : [...without, key]
    onChange(next)
  }

  const isChecked = (key: JobFilterKey) => {
    if (key === 'all') return !isFiltered
    return filters.includes(key)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ring-1 ring-black/5 dark:ring-white/5',
          isFiltered
            ? 'border-primary/35 bg-primary/10 text-primary ring-primary/10'
            : 'border-border/70 bg-background/80 text-foreground hover:bg-secondary/60',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter className="size-3.5 shrink-0" />
        <span className="max-w-[180px] truncate">{label}</span>
        {isFiltered ? (
          <span
            role="button"
            aria-label="Clear filters"
            className="ml-0.5 flex size-4 cursor-pointer items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25"
            onClick={(e) => { e.stopPropagation(); onChange([]) }}
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground', open && 'rotate-180')} />
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 min-w-[196px] overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg ring-1 ring-black/5 dark:ring-white/5">
          <div className="p-1.5">
            {JOB_FILTERS.map((filter) => {
              const count = filterCounts.get(filter.key) ?? 0
              const checked = isChecked(filter.key)

              return (
                <button
                  key={filter.key}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm font-medium',
                    checked
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-secondary/70',
                  )}
                  onClick={() => toggle(filter.key)}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border/80 bg-background',
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    {filter.label}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                      checked
                        ? 'bg-primary/15 text-primary'
                        : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
