import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  formatDateForDisplay,
  formatDateForInput,
  isSameCalendarDay,
  parseInputDateValue,
} from '@/lib/jobDate'
import { cn } from '@/lib/utils'

/**
 * Date input that pairs a typeable mm/dd/yyyy field with a popover calendar
 * for picking dates by clicking. Stores its value in the underlying ISO
 * `yyyy-MM-dd` form so callers can parse / serialise consistently; the
 * display format (US-style mm/dd/yyyy) is purely visual.
 *
 * Used for the booking-input date field on adapter forms, but is generic
 * enough to use elsewhere if needed.
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
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedDate = parseInputDateValue(value)
  const today = new Date()
  const minDate = parseInputDateValue(minValue ?? '')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = selectedDate ?? minDate ?? today
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const visibleDraft = open ? draft : formatDateForDisplay(value)

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
    if (minDate && formatDateForInput(date) < formatDateForInput(minDate)) {
      return
    }
    onChange(formatDateForInput(date))
    setDraft(formatDateForDisplay(formatDateForInput(date)))
    setOpen(false)
  }

  const chooseToday = () => {
    const target = minDate && formatDateForInput(today) < formatDateForInput(minDate)
      ? minDate
      : today
    chooseDate(target)
    setVisibleMonth(new Date(target.getFullYear(), target.getMonth(), 1))
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
      || (minDate && formatDateForInput(date) < formatDateForInput(minDate))
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
          value={visibleDraft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            setDraft(formatDateForDisplay(value))
            const focusDate = selectedDate ?? minDate
            if (focusDate) {
              setVisibleMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1))
            }
            setOpen(true)
          }}
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
          onClick={() => {
            setDraft(formatDateForDisplay(value))
            const focusDate = selectedDate ?? minDate
            if (focusDate) {
              setVisibleMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1))
            }
            setOpen((current) => !current)
          }}
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
              const isPastMinDate = date
                ? Boolean(minDate && formatDateForInput(date) < formatDateForInput(minDate))
                : false
              return date ? (
                <button
                  key={date.toISOString()}
                  type="button"
                  disabled={isPastMinDate}
                  className={cn(
                    'flex h-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent',
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
