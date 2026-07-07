import {
  ArrowRight,
  CalendarDays,
  Map as MapIcon,
  MapPinned,
  MoonStar,
  type LucideIcon,
  Users,
} from 'lucide-react'
import type { AdapterInfo, WatchJob } from '@/lib/api'

export type JobHeaderField = {
  key: string
  label: string
  value: string
  icon: LucideIcon
  href?: string
  isSubtitle?: boolean
  tags?: string[]
}

function parseDateParts(value: string): { day: number; month: number; year: number } | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number)
    if ([day, month, year].some(Number.isNaN)) return null
    return { day, month, year }
  }

  const parts = trimmed.split('/')
  if (parts.length !== 3) return null
  const [day, month, year] = parts.map(Number)
  if ([day, month, year].some(Number.isNaN)) return null
  return { day, month, year }
}

export function formatDateLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = parseDateParts(value)
  if (!parsed) return value
  return new Date(parsed.year, parsed.month - 1, parsed.day).toLocaleDateString(undefined, {
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

// THR-129 item 2: Camis (BC Parks / Ontario Parks / Parks Canada) jobs store
// their selected park as "Name (resource_location_id)" — mirrors the
// backend's `_PARK_OPTION_RE` convention in base_camis.py. Unlike the DOC
// facility link (built entirely client-side from the parsed id), the Camis
// results-page link needs the adapter's map_id/booking_category defaults,
// which only the backend knows — so this parser only extracts the display
// name; the href comes from `WatchJob.park_url` (computed server-side).
const CAMIS_PARK_OPTION_RE = /^(.+?)\s*\((-?\d+)\)$/

interface ParsedCamisPark {
  name: string
}

export function parseCamisParkOption(value: unknown): ParsedCamisPark | null {
  if (typeof value !== 'string') return null
  const m = CAMIS_PARK_OPTION_RE.exec(value.trim())
  if (!m) return null
  return { name: m[1].trim() }
}

export function getJobParamIcon(key: string): LucideIcon | null {
  switch (key) {
    case 'track':
      return MapIcon
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

export function getHeaderFields(
  params: Record<string, unknown>,
  parkUrl?: string | null,
): JobHeaderField[] {
  const parkParsed = parseCamisParkOption(params.park)
  const park: JobHeaderField | null = parkParsed
    ? {
        key: 'park',
        label: 'Park',
        value: parkParsed.name,
        icon: MapPinned,
        href: parkUrl ?? undefined,
      }
    : null

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
        icon: MapIcon,
        href: facilityParsed.href,
        isSubtitle: true,
      }
    : null

  const track = typeof params.track === 'string' && params.track.trim()
    ? {
        key: 'track',
        label: 'Track',
        value: params.track.trim(),
        icon: MapIcon,
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

  return [park, facility, facilityPark, track, date, nights, people, direction, sites].filter(
    (field): field is JobHeaderField => Boolean(field),
  )
}

// ─── Adapter field lookup maps ───────────────────────────────────────────────
//
// JobList renders many jobs grouped by adapter; precomputing per-adapter maps
// once and reusing them across rows is much cheaper than scanning each
// adapter's `param_fields` on every render.

export interface AdapterFieldMaps {
  /** Adapter id → display name. */
  nameById: Map<string, string>
  /** Adapter id → AdapterInfo. */
  byId: Map<string, AdapterInfo>
  /** Adapter id → key of the adapter's date field, if any. */
  dateFieldKeyById: Map<string, string>
  /** Adapter id → key of the adapter's "track" field, if any. */
  trackFieldKeyById: Map<string, string>
}

export function buildAdapterFieldMaps(adapters: AdapterInfo[]): AdapterFieldMaps {
  const nameById = new Map(adapters.map((adapter) => [adapter.adapter_id, adapter.name]))
  const byId = new Map(adapters.map((adapter) => [adapter.adapter_id, adapter]))

  const dateFieldKeyById = new Map(
    adapters.flatMap((adapter) => {
      const dateField = adapter.param_fields.find((field) => field.type === 'date')
      return dateField ? [[adapter.adapter_id, dateField.key] as const] : []
    }),
  )

  const trackFieldKeyById = new Map(
    adapters.flatMap((adapter) => {
      const trackField = adapter.param_fields.find(
        (field) => field.key === 'track' || field.label.toLowerCase() === 'track',
      )
      return trackField ? [[adapter.adapter_id, trackField.key] as const] : []
    }),
  )

  return { nameById, byId, dateFieldKeyById, trackFieldKeyById }
}

export function getAdapterDisplayName(
  adapterId: string,
  nameById: Map<string, string>,
): string {
  return nameById.get(adapterId) ?? adapterId
}

function getDateFieldKey(
  job: WatchJob,
  dateFieldKeyById: Map<string, string>,
): string | null {
  return dateFieldKeyById.get(job.adapter_id) ?? ('date' in job.params ? 'date' : null)
}

function getTrackFieldKey(
  job: WatchJob,
  trackFieldKeyById: Map<string, string>,
): string | null {
  return trackFieldKeyById.get(job.adapter_id) ?? ('track' in job.params ? 'track' : null)
}

// ─── Compact one-line summaries used by the list view ────────────────────────

export function getJobTitle(job: WatchJob): string {
  const trimmed = job.name.trim()
  return trimmed || 'Untitled Hunt'
}

export function getJobSubtitle(
  job: WatchJob,
  dateFieldKeyById: Map<string, string>,
  trackFieldKeyById: Map<string, string>,
): string {
  const dateFieldKey = getDateFieldKey(job, dateFieldKeyById)

  const facilityStr = typeof job.params.facility === 'string' ? job.params.facility.trim() : ''
  if (facilityStr) {
    const parsedFacility = parseFacilityOption(facilityStr)
    const facilityName = parsedFacility?.facilityName ?? facilityStr
    const startDate = dateFieldKey ? formatDateLabel(job.params[dateFieldKey]) : null
    if (facilityName && startDate) return `${facilityName}, ${startDate}`
    if (facilityName) return facilityName
  }

  const parkStr = typeof job.params.park === 'string' ? job.params.park.trim() : ''
  if (parkStr) {
    const parsedPark = parseCamisParkOption(parkStr)
    const parkName = parsedPark?.name ?? parkStr
    const parkStartDate = dateFieldKey ? formatDateLabel(job.params[dateFieldKey]) : null
    if (parkName && parkStartDate) return `${parkName}, ${parkStartDate}`
    if (parkName) return parkName
  }

  const trackFieldKey = getTrackFieldKey(job, trackFieldKeyById)
  const trackName = trackFieldKey ? String(job.params[trackFieldKey] ?? '').trim() : ''
  const startDate = dateFieldKey ? formatDateLabel(job.params[dateFieldKey]) : null

  if (trackName && startDate) return `${trackName}, ${startDate}`
  if (trackName) return trackName
  if (startDate) return startDate
  return 'No track selected'
}

export function getJobMetaLine(job: WatchJob): string {
  const nights = formatCountLabel(job.params.nights, 'Night', 'Nights')
  const people = formatCountLabel(job.params.people, 'Person', 'People')

  if (nights && people) return `${nights}, ${people}`
  if (nights) return nights
  if (people) return people
  return 'Party details not set'
}
