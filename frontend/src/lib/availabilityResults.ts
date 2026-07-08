// Pure helpers for rendering the "last result" payloads attached to a job:
// availability tiles, hold-failed payloads, and artifact selection / labelling.
//
// This module is React-free — UI components import the visuals (icon, class
// names, copy) and render them. Keeping it pure makes the result-tile family
// easy to test and easy to reuse across surfaces.

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type {
  ArtifactRecord,
  AvailabilityResult,
  LastResultEntry,
} from '@/lib/api'

export function titleize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatResultValue(value: unknown): string {
  if (value == null) return 'Not provided'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || 'Not provided'
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ─── Availability evidence ────────────────────────────────────────────────────

export function parseAvailabilityEvidence(evidence: string): {
  totalAvailable: number | null
  peopleWanted: number | null
} {
  const totalMatch = evidence.match(/total=([0-9]+|None|null)/i)
  const peopleMatch = evidence.match(/peopleWanted=([0-9]+)/i)

  const totalAvailable = totalMatch
    ? (/none|null/i.test(totalMatch[1]) ? null : Number(totalMatch[1]))
    : null
  const peopleWanted = peopleMatch ? Number(peopleMatch[1]) : null

  return {
    totalAvailable: Number.isFinite(totalAvailable) ? totalAvailable : null,
    peopleWanted: Number.isFinite(peopleWanted) ? peopleWanted : null,
  }
}

export interface AvailabilityVisual {
  icon: LucideIcon
  tileClass: string
  iconClass: string
  badgeClass: string
}

export function getAvailabilityVisual(
  status: AvailabilityResult['status'],
): AvailabilityVisual {
  switch (status) {
    case 'available':
      return {
        icon: CheckCircle2,
        tileClass: 'border-emerald-500/25 bg-emerald-500/8',
        iconClass: 'bg-emerald-500/12 text-emerald-700',
        badgeClass: 'bg-emerald-600 text-white hover:bg-emerald-600',
      }
    case 'partially_available':
      return {
        icon: AlertTriangle,
        tileClass: 'border-amber-500/25 bg-amber-500/10',
        iconClass: 'bg-amber-500/12 text-amber-700',
        badgeClass: 'bg-amber-500 text-white hover:bg-amber-500',
      }
    case 'restricted':
      // THR-133: distinct from both partially_available's amber and
      // unavailable's rose — reuses an orange token consistent with
      // StatusBadge's result_restricted color.
      return {
        icon: AlertTriangle,
        tileClass: 'border-orange-500/25 bg-orange-500/10',
        iconClass: 'bg-orange-500/12 text-orange-700',
        badgeClass: 'bg-orange-600 text-white hover:bg-orange-600',
      }
    case 'unavailable':
      return {
        icon: XCircle,
        tileClass: 'border-rose-500/25 bg-rose-500/8',
        iconClass: 'bg-rose-500/12 text-rose-700',
        badgeClass: 'bg-rose-500 text-white hover:bg-rose-500',
      }
    default:
      return {
        icon: CircleHelp,
        tileClass: 'border-border/70 bg-background/80',
        iconClass: 'bg-secondary text-muted-foreground',
        badgeClass: '',
      }
  }
}

export interface AvailabilityCopy {
  summary: string
  details: string[]
}

export function getAvailabilityCopy(entry: AvailabilityResult): AvailabilityCopy {
  const parsed = parseAvailabilityEvidence(entry.evidence)
  const totalAvailable = entry.total_available ?? parsed.totalAvailable
  const peopleWanted = parsed.peopleWanted

  // Only include spot count when the summary text doesn't already state it
  // (people count is always in the summary, so never add it as a redundant detail)
  switch (entry.status) {
    case 'available':
      return {
        summary:
          totalAvailable != null && peopleWanted != null
            ? `${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} cover the requested party of ${peopleWanted}.`
            : 'Availability is open for this site.',
        // Spot count is already in the summary when both values present; show when only total known
        details: totalAvailable != null && peopleWanted == null
          ? [`${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} found`]
          : [],
      }
    case 'partially_available':
      return {
        summary:
          totalAvailable != null && peopleWanted != null
            ? `${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} available — fewer than the requested ${peopleWanted}.`
            : 'Some capacity exists, but not enough for the full party.',
        details: totalAvailable != null && peopleWanted == null
          ? [`${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} found`]
          : [],
      }
    case 'restricted': {
      // THR-133: sites have capacity but the requested stay pattern isn't
      // bookable (arrival/departure changeover, min/max-stay) — surface the
      // evidence so the actual constraint is visible, same as 'unavailable'.
      const evidence = entry.evidence?.trim()
      return {
        summary: 'Restricted for these dates — sites exist but this stay '
          + "pattern isn't bookable.",
        details: evidence ? [evidence] : [],
      }
    }
    case 'unavailable': {
      // THR-129 Finding E: surface the evidence string instead of always
      // rendering an empty details list — the backend now names actual
      // site states (e.g. "67 sites restricted, 5 booked out") or the
      // booking-window/no-data reason instead of a raw dict dump.
      const evidence = entry.evidence?.trim()
      return {
        summary:
          peopleWanted != null
            ? `Unavailable for a party of ${peopleWanted}.`
            : 'No availability was found for this site.',
        details: evidence ? [evidence] : [],
      }
    }
    default:
      if (entry.evidence.includes('not found in results table')) {
        return {
          summary: 'This site did not appear in the returned results.',
          details: ['The latest search did not include this stop.'],
        }
      }
      if (entry.evidence.includes('No cell found')) {
        return {
          summary: 'The availability table was missing the expected date cell.',
          details: ['The returned page shape did not match the requested site and date.'],
        }
      }
      return {
        summary: 'Availability could not be classified from the latest check.',
        details: ['Check the underlying artifact if you need the raw page state.'],
      }
  }
}

// ─── Result entry type guards ────────────────────────────────────────────────

export function isAvailabilityResult(entry: LastResultEntry): entry is AvailabilityResult {
  return (
    typeof entry === 'object'
    && entry !== null
    && 'site' in entry
    && 'status' in entry
  )
}

export function isHoldFailedEntry(
  entry: LastResultEntry,
): entry is Record<string, unknown> & { type: 'hold_failed' } {
  return (
    typeof entry === 'object'
    && entry !== null
    && 'type' in entry
    && (entry as Record<string, unknown>).type === 'hold_failed'
  )
}

// ─── Artifact selection / labelling ──────────────────────────────────────────

const ARTIFACT_LABELS: Record<string, string> = {
  unavailable: 'Unavailable Snapshot',
  reservation_details: 'Reservation Details',
  shopping_cart: 'Shopping Cart',
  payment_page_success: 'Payment Page',
  booking_complete: 'Receipt',
  book_great_walk_timeout: 'Book Great Walk Timeout',
  shopping_cart_timeout: 'Shopping Cart Timeout',
  payment_page_timeout: 'Payment Page Timeout',
}

export function formatArtifactLabel(label: string): string {
  return ARTIFACT_LABELS[label] ?? titleize(label)
}

export function getReceiptArtifact(
  artifacts: ArtifactRecord[] | null | undefined,
): ArtifactRecord | null {
  if (!artifacts?.length) return null
  return [...artifacts].reverse().find((artifact) => artifact.label === 'booking_complete') ?? null
}

export function getUnavailableArtifact(
  artifacts: ArtifactRecord[] | null | undefined,
): ArtifactRecord | null {
  if (!artifacts?.length) return null
  return [...artifacts].reverse().find((artifact) => artifact.label === 'unavailable') ?? null
}

export function getHoldFlowArtifacts(
  artifacts: ArtifactRecord[] | null | undefined,
): ArtifactRecord[] {
  if (!artifacts?.length) return []

  const orderedLabels = [
    'reservation_details',
    'shopping_cart',
  ]

  const relevant = artifacts.filter((artifact) => orderedLabels.includes(artifact.label))
  if (!relevant.length) return []

  return orderedLabels.flatMap((label) =>
    relevant.filter((artifact) => artifact.label === label),
  )
}

export function getCompletedBookingArtifacts(
  holdArtifacts: ArtifactRecord[],
  receiptArtifact: ArtifactRecord | null,
): ArtifactRecord[] {
  if (!receiptArtifact) return holdArtifacts
  return [...holdArtifacts, receiptArtifact]
}
