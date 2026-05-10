import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Input } from './Input'
import { cn } from '@/lib/utils'

export type SearchableOptionGroup = {
  label?: string
  options: string[]
}

/**
 * Combobox-style picker built on top of the existing Input primitive.
 *
 * - Supports grouped options (header label per group), optional custom
 *   `displayValue` rendering, and a clear button.
 * - Filters by both the rendered display label and the underlying option
 *   value, so adapter-encoded options like `Routeburn (12/34) — Mt Aspiring`
 *   match either "Routeburn" or the raw token.
 * - When no query is entered, only the first 24 options across all groups
 *   are shown along with a "start typing to narrow" hint, to keep large
 *   facility lists snappy.
 */
export function SearchableSelect({
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
  const renderValue = useMemo(
    () => displayValue ?? ((option: string) => option),
    [displayValue],
  )
  const selectedLabel = value ? renderValue(value) : ''
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const visibleQuery = open ? query : selectedLabel
  const deferredQuery = useDeferredValue(visibleQuery)

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
  const canClear = !disabled && (Boolean(value) || Boolean(visibleQuery))

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
          value={visibleQuery}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            setQuery(selectedLabel)
            setOpen(true)
          }}
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
