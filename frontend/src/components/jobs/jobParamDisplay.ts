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
  href?: string
  isSubtitle?: boolean
  tags?: string[]
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

function parseSitesArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

const FACILITY_OPTION_RE = /^(.+?)\s*\((\d+)\/(\d+)\)(?:\s*—\s*(.+))?$/

interface ParsedFacility {
  facilityName: string
  parkId: string
  facilityId: string
  parkName: string
  href: string
}

export function parseFacilityOption(value: unknown): ParsedFacility | null {
  if (typeof value !== 'string') return null
  const m = FACILITY_OPTION_RE.exec(value.trim())
  if (!m) return null
  const parkId = m[2]
  const facilityId = m[3]
  return {
    facilityName: m[1].trim(),
    parkId,
    facilityId,
    parkName: m[4]?.trim() ?? '',
    href: `https://bookings.doc.govt.nz/Web/#!park/${parkId}/${facilityId}`,
  }
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
  const facilityParsed = parseFacilityOption(params.facility)
  const facility: JobHeaderField | null = facilityParsed
    ? {
        key: 'facility',
        label: 'Facility',
        value: facilityParsed.facilityName,
        icon: MapPinned,
        href: facilityParsed.href,
      }
    : null
  const facilityPark: JobHeaderField | null = facilityParsed?.parkName
    ? {
        key: 'facility_park',
        label: 'Park',
        value: facilityParsed.parkName,
        icon: Map,
        href: facilityParsed.href,
        isSubtitle: true,
      }
    : null

  const track = typeof params.track === 'string' && params.track.trim()
    ? {
        key: 'track',
        label: 'Track',
        value: params.track.trim(),
        icon: Map,
      }
    : null
  const dateLabel = formatDateLabel(params.date)
  const nightsLabel = formatCountLabel(params.nights, 'Night', 'Nights')
  const peopleLabel = formatCountLabel(params.people, 'Person', 'People')
  const date = dateLabel
    ? {
        key: 'date',
        label: 'Start Date',
        value: dateLabel,
        icon: CalendarDays,
      }
    : null
  const nights = nightsLabel
    ? {
        key: 'nights',
        label: 'Stay Length',
        value: nightsLabel,
        icon: MoonStar,
      }
    : null
  const people = peopleLabel
    ? {
        key: 'people',
        label: 'Party Size',
        value: peopleLabel,
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
  const sitesArr = parseSitesArray(params.sites)
  const sites = sitesArr.length
    ? {
        key: 'sites',
        label: 'Sites',
        value: sitesArr.join(' / '),
        tags: sitesArr,
        icon: MapPinned,
      }
    : null

  return [facility, facilityPark, track, date, nights, people, direction, sites].filter(
    (field): field is JobHeaderField => Boolean(field),
  )
}
