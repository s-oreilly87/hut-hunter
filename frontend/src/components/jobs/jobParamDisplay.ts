import {
  ArrowRight,
  CalendarDays,
  Map,
  MapPinned,
  MoonStar,
  type LucideIcon,
  Users,
} from 'lucide-react'

export type JobHeaderField = {
  key: string
  label: string
  value: string
  icon: LucideIcon
}

export function formatDateLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parts = value.split('/')
  if (parts.length !== 3) return value
  const [dd, mm, yyyy] = parts.map(Number)
  if ([dd, mm, yyyy].some(Number.isNaN)) return value
  return new Date(yyyy, mm - 1, dd).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatCountLabel(
  value: unknown,
  singular: string,
  plural: string,
): string | null {
  const raw = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(raw) || raw <= 0) return null
  return `${raw} ${raw === 1 ? singular : plural}`
}

function formatSitesLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sites = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (!sites.length) return null
  return sites.join(' / ')
}

export function getJobParamIcon(key: string): LucideIcon | null {
  switch (key) {
    case 'track':
      return Map
    case 'date':
      return CalendarDays
    case 'nights':
      return MoonStar
    case 'people':
    case 'occupants':
      return Users
    case 'direction':
      return ArrowRight
    case 'sites':
      return MapPinned
    default:
      return null
  }
}

export function getHeaderFields(params: Record<string, unknown>): JobHeaderField[] {
  const track = typeof params.track === 'string' && params.track.trim()
    ? {
        key: 'track',
        label: 'Track',
        value: params.track.trim(),
        icon: Map,
      }
    : null
  const date = formatDateLabel(params.date)
    ? {
        key: 'date',
        label: 'Start Date',
        value: formatDateLabel(params.date) as string,
        icon: CalendarDays,
      }
    : null
  const nights = formatCountLabel(params.nights, 'Night', 'Nights')
    ? {
        key: 'nights',
        label: 'Stay Length',
        value: formatCountLabel(params.nights, 'Night', 'Nights') as string,
        icon: MoonStar,
      }
    : null
  const people = formatCountLabel(params.people, 'Person', 'People')
    ? {
        key: 'people',
        label: 'Party Size',
        value: formatCountLabel(params.people, 'Person', 'People') as string,
        icon: Users,
      }
    : null
  const direction = typeof params.direction === 'string' && params.direction.trim()
    ? {
        key: 'direction',
        label: 'Direction',
        value: params.direction.trim(),
        icon: ArrowRight,
      }
    : null
  const sites = formatSitesLabel(params.sites)
    ? {
        key: 'sites',
        label: 'Campsites',
        value: formatSitesLabel(params.sites) as string,
        icon: MapPinned,
      }
    : null

  return [track, date, nights, people, direction, sites].filter(
    (field): field is JobHeaderField => Boolean(field),
  )
}
