import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  formatDateForInput,
  isSameCalendarDay,
} from '@/lib/jobDate'
import { cn } from '@/lib/utils'

export function DatePickerCalendar({
  monthLabel,
  cells,
  selectedDate,
  today,
  minDate,
  onShiftMonth,
  onChooseDate,
  onClear,
  onChooseToday,
  className,
}: {
  monthLabel: string
  cells: Array<Date | null>
  selectedDate: Date | null
  today: Date
  minDate: Date | null
  onShiftMonth: (delta: number) => void
  onChooseDate: (date: Date) => void
  onClear: () => void
  onChooseToday: () => void
  className?: string
}) {
  return (
    <div className={cn('w-[min(20rem,calc(100vw-3rem))] rounded-2xl border border-border/80 bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/5', className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onShiftMonth(-1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-sm font-semibold tracking-tight text-foreground">{monthLabel}</p>
        <button
          type="button"
          aria-label="Next month"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onShiftMonth(1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={`${d}-${i}`} className="flex h-7 items-center justify-center text-[11px] font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
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
              onMouseDown={e => e.preventDefault()}
              onClick={() => onChooseDate(date)}
            >
              {date.getDate()}
            </button>
          ) : (
            <div key={`blank-${i}`} className="h-8" />
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          onMouseDown={e => e.preventDefault()}
          onClick={onClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
          onMouseDown={e => e.preventDefault()}
          onClick={onChooseToday}
        >
          Today
        </button>
      </div>
    </div>
  )
}
