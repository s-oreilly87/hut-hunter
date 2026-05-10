// Date helpers shared across the job form (create/edit) and any other
// surface that needs to translate between the adapter-native dd/MM/yyyy
// format and the HTML <input type="date"> yyyy-MM-dd format.

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

export function isDayFirstDate(value: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())
}

export function toInputDateValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isIsoDate(trimmed)) return trimmed
  const [day, month, year] = trimmed.split('/')
  if (!day || !month || !year) return ''
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export function toAdapterDateValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isDayFirstDate(trimmed)) return trimmed
  const [year, month, day] = trimmed.split('-')
  if (!year || !month || !day) return ''
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year.padStart(4, '0')}`
}

export function parseInputDateValue(value: string): Date | null {
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

export function formatDateForInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateForDisplay(value: string): string {
  const date = parseInputDateValue(value)
  if (!date) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()
  return `${month}/${day}/${year}`
}

export function currentInputDateInTimeZone(timezone: string): string {
  const tzParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = tzParts.find((part) => part.type === 'year')?.value
  const month = tzParts.find((part) => part.type === 'month')?.value
  const day = tzParts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return ''
  return `${year}-${month}-${day}`
}

export function isSameCalendarDay(a: Date | null, b: Date): boolean {
  return (
    Boolean(a)
    && a?.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

/**
 * Validate a `dd/MM/yyyy` adapter-native date string against the current day in the
 * adapter's booking timezone. Returns true when the date is today or later.
 */
export function isDateValidInTz(dateStr: string, timezone: string): boolean {
  const jobDate = toInputDateValue(dateStr)
  const currentDate = currentInputDateInTimeZone(timezone)
  if (!jobDate || !currentDate) return false
  return jobDate >= currentDate
}
