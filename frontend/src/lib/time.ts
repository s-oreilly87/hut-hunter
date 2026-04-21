const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
})

const RELATIVE_TIME_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 60 * 60],
  ['day', 60 * 60 * 24],
  ['week', 60 * 60 * 24 * 7],
  ['month', 60 * 60 * 24 * 30],
  ['year', 60 * 60 * 24 * 365],
]

type RelativeTimeOptions = {
  emptyLabel?: string
  justNowLabel?: string
  prefix?: string
}

export function formatRelativeTimeFromNow(
  value: string | null,
  {
    emptyLabel = 'Never',
    justNowLabel = 'just now',
    prefix = '',
  }: RelativeTimeOptions = {},
): string {
  if (!value) return emptyLabel

  const diffSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 45) {
    return prefix ? `${prefix} ${justNowLabel}` : justNowLabel
  }

  for (let index = RELATIVE_TIME_UNITS.length - 1; index >= 0; index -= 1) {
    const [unit, unitSeconds] = RELATIVE_TIME_UNITS[index]
    if (absSeconds >= unitSeconds || unit === 'minute') {
      const label = relativeTimeFormatter.format(
        Math.round(diffSeconds / unitSeconds),
        unit,
      )
      return prefix ? `${prefix} ${label}` : label
    }
  }

  return prefix ? `${prefix} ${justNowLabel}` : justNowLabel
}

export function formatDateTime(
  value: string | null,
  emptyLabel = '—',
): string {
  if (!value) return emptyLabel

  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDueIn(value: string | null): string {
  if (!value) return 'No scheduled checks'

  const deltaMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)

  if (deltaMinutes <= 1) return 'Due within a minute'
  if (deltaMinutes < 60) return `Due in ${deltaMinutes} min`

  const deltaHours = Math.round(deltaMinutes / 60)
  return `Due in ${deltaHours} hr`
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}
