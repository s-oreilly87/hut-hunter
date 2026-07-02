import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { Input } from './Input'
import {
  POPOVER_LAYER_ATTR,
  POPOVER_LAYER_Z_INDEX,
  popoverLayerEventHandlers,
} from '@/lib/popoverLayer'
import { cn } from '@/lib/utils'

export type SearchableOptionGroup = {
  label?: string
  options: string[]
}

/**
 * Combobox-style picker.
 *
 * Positioning strategy (same as DatePicker):
 * - Dropdown is portal'd into document.body (position: fixed) — never clipped
 *   by an overflow:auto parent.
 * - Position tracks the trigger on scroll/resize instead of closing.
 * - Flips to open above the trigger when space below is insufficient.
 * - Click-outside uses separate triggerRef + popoverRef so clicking empty
 *   space beside the narrow trigger/dropdown correctly dismisses.
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
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const renderValue = useMemo(
    () => displayValue ?? ((opt: string) => opt),
    [displayValue],
  )

  const selectedLabel = value ? renderValue(value) : ''
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})

  const visibleQuery  = open ? query : selectedLabel
  const deferredQuery = useDeferredValue(visibleQuery)

  // ── Positioning ──────────────────────────────────────────────────────────
  const DROPDOWN_HEIGHT = 300 // conservative estimate (max-h-72 = 288px + padding)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const popH  = popoverRef.current?.getBoundingClientRect().height ?? DROPDOWN_HEIGHT
    const spaceBelow = window.innerHeight - rect.bottom - 8

    if (spaceBelow < popH && rect.top > spaceBelow) {
      setPopoverStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        width: rect.width,
        zIndex: POPOVER_LAYER_Z_INDEX,
        pointerEvents: 'auto',
      })
    } else {
      setPopoverStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        zIndex: POPOVER_LAYER_Z_INDEX,
        pointerEvents: 'auto',
      })
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // ── Click-outside ─────────────────────────────────────────────────────────
  const openRef = useRef(false)
  openRef.current = open
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!openRef.current) return
      const target = e.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [])

  // ── Options filtering ─────────────────────────────────────────────────────
  const totalOptions    = groups.reduce((n, g) => n + g.options.length, 0)
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
        .map(g => {
          const slice = remaining > 0 ? g.options.slice(0, remaining) : []
          remaining -= slice.length
          return { label: g.label, options: slice }
        })
        .filter(g => g.options.length > 0)
    }
    return groups
      .map(g => ({
        label: g.label,
        options: g.options.filter(opt => {
          const label = renderValue(opt).toLowerCase()
          return label.includes(normalizedQuery) || opt.toLowerCase().includes(normalizedQuery)
        }),
      }))
      .filter(g => g.options.length > 0)
  }, [groups, normalizedQuery, renderValue])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Trigger */}
      <div ref={triggerRef} className="relative">
        <Input
          ref={inputRef}
          value={visibleQuery}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => { setQuery(selectedLabel); setOpen(true) }}
          onChange={e => { setOpen(true); setQuery(e.target.value) }}
          className={cn(canClear ? 'pr-16' : 'pr-9')}
        />
        {canClear && (
          <button
            type="button"
            aria-label="Clear selection"
            className="absolute inset-y-1 right-8 flex w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
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
          onClick={() => setOpen(c => !c)}
        >
          <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
        </button>
      </div>

      {/* Dropdown portal */}
      {open && createPortal(
        <div
          ref={popoverRef}
          {...{ [POPOVER_LAYER_ATTR]: '' }}
          style={popoverStyle}
          className="max-h-72 overflow-y-auto rounded-2xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/5"
          {...popoverLayerEventHandlers}
        >
          {value && (
            <button
              type="button"
              className="mb-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              onMouseDown={e => e.preventDefault()}
              onClick={clearSelection}
            >
              Clear selection
            </button>
          )}

          {filteredGroups.length > 0 ? (
            filteredGroups.map(group => (
              <div key={group.label ?? 'options'} className="space-y-1">
                {group.label && (
                  <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {group.label}
                  </p>
                )}
                {group.options.map(opt => {
                  const selected = opt === value
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={cn(
                        'flex w-full items-start rounded-xl px-3 py-2 text-left text-sm hover:bg-secondary/70',
                        selected && 'bg-primary/10 text-primary',
                      )}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { onChange(opt); setQuery(renderValue(opt)); setOpen(false) }}
                    >
                      {renderValue(opt)}
                    </button>
                  )
                })}
              </div>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">No matches found.</p>
          )}

          {showTruncatedHint && (
            <p className="px-3 pt-3 text-xs text-muted-foreground">
              Showing the first 24 options. Start typing to narrow the list.
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
