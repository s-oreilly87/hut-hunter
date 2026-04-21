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
  /** If set, the value renders as an external link pointing to this URL. */
  href?: string
  /** When true, renders the field in a smaller, muted subtitle typeface. */
  isSubtitle?: boolean
  /** If set, render the field value as a row of badge tags instead of plain text. */
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

/** Parse a sites param into an ordered list of site name strings.
 *  Accepts both the new array format and the legacy comma-separated string. */
function parseSitesArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

// ---------------------------------------------------------------------------
// DOC standard hut facility option parsing.
// Option strings are encoded as:
//   "Mueller Hut (747/2487) — Aoraki/Mount Cook National Park"
// ---------------------------------------------------------------------------

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
  // DOC standard hut — facility encodes name + IDs + park name in one string.
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
