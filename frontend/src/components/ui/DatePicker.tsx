import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, X } from 'lucide-react'
import {
  formatDateForDisplay,
  formatDateForInput,
  parseInputDateValue,
} from '@/lib/jobDate'
import {
  POPOVER_LAYER_ATTR,
  POPOVER_LAYER_Z_INDEX,
  popoverLayerEventHandlers,
} from '@/lib/popoverLayer'
import { cn } from '@/lib/utils'
import { DatePickerCalendar } from './DatePickerCalendar'

/**
 * Date input that pairs a typeable mm/dd/yyyy field with a popover calendar.
 *
 * Positioning strategy:
 * - The calendar is portal'd into document.body (position: fixed) so it is
 *   never clipped by an overflow:auto scroll container.
 * - On scroll/resize the position is recalculated (not closed), so the
 *   calendar tracks the trigger while the user scrolls the parent form.
 * - When there is insufficient space below the trigger, the calendar opens
 *   above instead.
 * - Click-outside uses two separate refs (trigger row + calendar) so that
 *   empty space beside the calendar correctly dismisses it.
 */
export function DatePicker({
  value,
  onChange,
  disabled = false,
  minValue,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  minValue?: string
}) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const selectedDate = parseInputDateValue(value)
  const today   = new Date()
  const minDate = parseInputDateValue(minValue ?? '')

  const [open, setOpen]       = useState(false)
  const [draft, setDraft]     = useState('')
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = selectedDate ?? minDate ?? today
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const visibleDraft = open ? draft : formatDateForDisplay(value)

  // ── Positioning ──────────────────────────────────────────────────────────
  const CALENDAR_HEIGHT = 340 // conservative estimate (px)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const popH  = popoverRef.current?.getBoundingClientRect().height ?? CALENDAR_HEIGHT
    const spaceBelow = window.innerHeight - rect.bottom - 8

    if (spaceBelow < popH && rect.top > spaceBelow) {
      setPopoverStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        zIndex: POPOVER_LAYER_Z_INDEX,
        pointerEvents: 'auto',
      })
    } else {
      setPopoverStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.left,
        zIndex: POPOVER_LAYER_Z_INDEX,
        pointerEvents: 'auto',
      })
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    // Re-run after the portal has painted to pick up the actual height.
    const raf = requestAnimationFrame(updatePosition)
    // Track on scroll/resize — don't close, just reposition.
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // ── Click-outside ─────────────────────────────────────────────────────────
  // Stable capture-phase listener with a ref so there's no add/remove race.
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

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(visibleMonth)

  const firstWeekday = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay()
  const daysInMonth  = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate()
  // Always render a fixed 6-row (42-cell) grid, padding with trailing blanks.
  // Some months only need 4-5 rows, which otherwise shrinks the popover and
  // shifts the prev/next-month buttons — awkward to click through months
  // when the calendar keeps resizing under the cursor.
  const WEEKS_SHOWN = 6
  const totalCells = WEEKS_SHOWN * 7
  const cells: Array<Date | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => (
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), i + 1)
    )),
  ]
  while (cells.length < totalCells) cells.push(null)

  const shiftMonth = (amount: number) =>
    setVisibleMonth(c => new Date(c.getFullYear(), c.getMonth() + amount, 1))

  const chooseDate = (date: Date) => {
    if (minDate && formatDateForInput(date) < formatDateForInput(minDate)) return
    onChange(formatDateForInput(date))
    setDraft(formatDateForDisplay(formatDateForInput(date)))
    setOpen(false)
  }

  const chooseToday = () => {
    const target =
      minDate && formatDateForInput(today) < formatDateForInput(minDate) ? minDate : today
    chooseDate(target)
    setVisibleMonth(new Date(target.getFullYear(), target.getMonth(), 1))
  }

  const commitDraft = () => {
    const trimmed = draft.trim()
    if (!trimmed) { onChange(''); return }

    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
    if (!match) { setDraft(formatDateForDisplay(value)); return }

    const [, monthRaw, dayRaw, yearRaw] = match
    const month = Number(monthRaw), day = Number(dayRaw), year = Number(yearRaw)
    const date  = new Date(year, month - 1, day)
    if (
      date.getFullYear() !== year ||
      date.getMonth()    !== month - 1 ||
      date.getDate()     !== day ||
      (minDate && formatDateForInput(date) < formatDateForInput(minDate))
    ) {
      setDraft(formatDateForDisplay(value))
      return
    }
    onChange(formatDateForInput(date))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Trigger row */}
      <div
        ref={triggerRef}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-left text-base shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm',
          open     && 'border-ring ring-3 ring-ring/50',
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
        )}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-left outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          placeholder="mm/dd/yyyy"
          value={visibleDraft}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => {
            setDraft(formatDateForDisplay(value))
            const focusDate = selectedDate ?? minDate
            if (focusDate) setVisibleMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1))
            setOpen(true)
          }}
          onBlur={commitDraft}
          onKeyDown={e => {
            if (e.key === 'Enter')  { commitDraft(); inputRef.current?.blur() }
            if (e.key === 'Escape') { setDraft(formatDateForDisplay(value)); setOpen(false); inputRef.current?.blur() }
          }}
        />
        <span className="flex items-center gap-1 text-muted-foreground">
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear date"
              className="flex size-6 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground"
              onClick={() => { onChange(''); setDraft(''); inputRef.current?.focus() }}
            >
              <X className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className="flex size-6 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground disabled:pointer-events-none"
            onClick={() => {
              setDraft(formatDateForDisplay(value))
              const focusDate = selectedDate ?? minDate
              if (focusDate) setVisibleMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1))
              setOpen(c => !c)
            }}
          >
            <Calendar className="size-4" />
          </button>
        </span>
      </div>

      {/* Calendar portal */}
      {open && createPortal(
        <div
          ref={popoverRef}
          {...{ [POPOVER_LAYER_ATTR]: '' }}
          style={popoverStyle}
          {...popoverLayerEventHandlers}
        >
          <DatePickerCalendar
            monthLabel={monthLabel}
            cells={cells}
            selectedDate={selectedDate}
            today={today}
            minDate={minDate}
            onShiftMonth={shiftMonth}
            onChooseDate={chooseDate}
            onClear={() => { onChange(''); setOpen(false) }}
            onChooseToday={chooseToday}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
