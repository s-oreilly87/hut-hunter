import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adaptersApi,
  credentialsApi,
  jobsApi,
  occupantsApi,
  type AdapterInfo,
  type Occupant,
  type ParamField,
  type WatchJob,
  type WindowCheckResult,
} from '@/lib/api'
import { isDateValidInTz, toAdapterDateValue } from '@/lib/jobDate'
import { buildCurrentOccupantSnapshot } from '@/lib/occupantSnapshots'
import { getMissingOccupantFields } from './occupantHelpers'
import {
  buildDefaultParams,
  buildInitialParamsFromJob,
} from './paramHelpers'
import type { FormMode } from './wizardSteps'

export interface JobFormController {
  // Mode
  mode: FormMode

  // Form state
  name: string
  setName: (name: string) => void
  selectedAdapterId: string
  params: Record<string, unknown>
  autoBook: boolean
  setAutoBook: (v: boolean) => void
  enableMonitoring: boolean
  setEnableMonitoring: (v: boolean) => void
  intervalMinutes: string
  setIntervalMinutes: (v: string) => void
  selectedOccupantIds: string[]
  setSelectedOccupantIds: (ids: string[]) => void
  // THR-129 item 3: which selected camper is the Camis permit holder.
  // Already resolved to a valid choice — defaults to the first selected
  // camper when nothing has been explicitly picked (or the previous pick
  // is no longer selected). Only meaningful when
  // selectedAdapter?.uses_single_permit_holder and >1 camper is selected;
  // harmless to read/set otherwise.
  permitHolderOccupantId: string | null
  setPermitHolderOccupantId: (occupantId: string) => void
  error: string | null

  // THR-124: "is the requested date released yet?" — live-checked against
  // /jobs/window-check for adapters with a rolling booking window (Camis).
  // windowCheck is undefined while loading/not-applicable. When is_open is
  // false, the wizard must show the notice and the user must acknowledge()
  // before submit is allowed.
  windowCheck: WindowCheckResult | undefined
  windowCheckLoading: boolean
  windowAcknowledged: boolean
  acknowledgeWindow: () => void

  // External data
  adapters: AdapterInfo[]
  roster: Occupant[]
  occupantsLoading: boolean

  // Derived
  selectedAdapter: AdapterInfo | undefined
  // THR-129 item 3: full Occupant records for the current selection, in
  // selection order — the permit-holder picker needs names, not just ids.
  selectedRosterOccupants: Occupant[]
  hasCredentialsForSelectedAdapter: boolean
  // THR-127: distinct from hasCredentialsForSelectedAdapter — a credential
  // can be STORED but not yet (or no longer) VERIFIED. Auto-book gates on
  // this stricter flag; hasCredentialsForSelectedAdapter stays the looser
  // "is anything saved at all" check used for the generic sign-in notice.
  credentialVerifiedForSelectedAdapter: boolean
  selectedOccupantCount: number
  selectedOccupantsPresent: boolean
  selectedOccupantDetailsComplete: boolean
  effectivePeopleCount: number
  effectiveAutoBook: boolean

  // Handlers
  handleAdapterChange: (adapterId: string) => void
  handleParamChange: (key: string, value: unknown) => void
  resolveOptions: (field: ParamField, params: Record<string, unknown>) => string[] | null
  handleSubmit: () => void

  // Submit-button state
  pending: boolean
  submitLabel: string
  submitBusyLabel: string
}

/**
 * Owns all state and validation for the create/edit job form.
 *
 * Returns a `JobFormController` that the wizard and dialog presentations
 * both consume. The two presentation components (`JobFormWizard`,
 * `JobFormGrid`) only differ in layout — every input wire-up, every
 * derived flag, and the submit pipeline live here.
 *
 * Notes on a couple of subtleties:
 *
 * - We do NOT prune `selectedOccupantIds` when a camper disappears from the
 *   roster (the previous implementation did so in a useEffect, which
 *   triggered the react-hooks/set-state-in-effect lint and a redundant
 *   render). Instead, downstream we filter through the roster at render
 *   time — stale ids are silently ignored, and if the missing camper is
 *   re-added later their selection comes back automatically.
 *
 * - `effectiveAutoBook` is the auto-book flag actually sent to the API.
 *   It collapses to false unless the form's preconditions (campers
 *   present, sign-in saved, camper details complete) are met, so we
 *   never persist an unsatisfiable auto-book.
 */
export function useJobForm({
  mode,
  initialJob,
  onDone,
}: {
  mode: FormMode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
}): JobFormController {
  const qc = useQueryClient()

  // ── Form state ──
  const [name, setName] = useState(
    mode === 'edit' && initialJob ? initialJob.name : '',
  )
  const [selectedAdapterId, setSelectedAdapterId] = useState(
    mode === 'edit' && initialJob ? initialJob.adapter_id : '',
  )
  const [params, setParams] = useState<Record<string, unknown>>(
    mode === 'edit' && initialJob ? buildInitialParamsFromJob(initialJob) : {},
  )
  const [autoBook, setAutoBook] = useState(
    mode === 'edit' && initialJob ? initialJob.auto_book : false,
  )
  const [enableMonitoring, setEnableMonitoring] = useState(
    mode === 'edit' && initialJob ? initialJob.enable_monitoring : true,
  )
  const [intervalMinutes, setIntervalMinutes] = useState<string>(
    mode === 'edit' && initialJob ? String(initialJob.interval_minutes) : '15',
  )
  const [error, setError] = useState<string | null>(null)
  // THR-124: keyed rather than a plain boolean so changing the date/park
  // after acknowledging automatically un-acknowledges (see windowAckKey
  // below) without needing a state-resetting effect.
  const [acknowledgedWindowKey, setAcknowledgedWindowKey] = useState<string | null>(null)
  const [selectedOccupantIds, setSelectedOccupantIds] = useState<string[]>(() => {
    if (mode === 'edit' && initialJob) {
      const snapped = initialJob.params.occupants
      if (Array.isArray(snapped)) {
        return snapped.map((o: Record<string, unknown>) => String(o.id ?? '')).filter(Boolean)
      }
    }
    return []
  })
  // THR-129 item 3: the user's explicit pick, if any. Read directly at
  // render time against `effectivePermitHolderOccupantId` below (which
  // defaults to the first selected camper) rather than reset via effect —
  // same pattern as the rest of this file's derived-default fields.
  const [permitHolderOccupantId, setPermitHolderOccupantId] = useState<string | null>(() => {
    if (mode === 'edit' && initialJob) {
      const stored = initialJob.params.permit_holder_occupant_id
      return typeof stored === 'string' && stored ? stored : null
    }
    return null
  })

  // ── External data ──
  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })
  const { data: roster = [], isLoading: occupantsLoading } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })
  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials'],
    queryFn: credentialsApi.list,
  })

  // ── Derived ──
  const selectedAdapter = adapters.find((a) => a.adapter_id === selectedAdapterId)
  const credentialForSelectedAdapter = credentials.find(
    (credential) => credential.adapter_id === selectedAdapterId,
  )
  const hasCredentialsForSelectedAdapter =
    !selectedAdapter?.requires_credentials
    || Boolean(credentialForSelectedAdapter)
  // THR-127: auto-book requires the stored credential to have actually
  // PASSED verification — a stored-but-unverified/pending/inconclusive/
  // failed credential is untested (or known-bad) and must not enable it.
  const credentialVerifiedForSelectedAdapter =
    !selectedAdapter?.requires_credentials
    || credentialForSelectedAdapter?.verification_status === 'verified'

  // THR-124: live "is this date released yet?" check. Only the date +
  // park/booking-category fields matter for window gating (see the
  // backend's BaseCamisAdapter.check_booking_window), so those are what key
  // the query — changing party size, campers, etc. doesn't refetch it.
  const dateField = selectedAdapter?.param_fields.find((f) => f.type === 'date')
  const dateValue = dateField ? String(params[dateField.key] ?? '') : ''
  const windowCheckAdapterDate = dateValue ? toAdapterDateValue(dateValue) : ''
  const windowCheckEnabled = Boolean(
    selectedAdapter?.has_booking_windows && dateField && windowCheckAdapterDate,
  )
  const windowCheckQuery = useQuery({
    queryKey: [
      'jobs', 'window-check', selectedAdapterId, windowCheckAdapterDate,
      params.park, params.booking_category,
    ],
    queryFn: () => jobsApi.checkWindow({
      adapter_id: selectedAdapterId,
      params: {
        ...params,
        [dateField!.key]: windowCheckAdapterDate,
      },
    }),
    enabled: windowCheckEnabled,
    staleTime: 60_000,
    retry: false,
  })
  const windowCheck = windowCheckEnabled ? windowCheckQuery.data : undefined
  const windowAckKey = (windowCheck && !windowCheck.is_open)
    ? `${selectedAdapterId}|${windowCheckAdapterDate}|${String(params.park ?? '')}|${windowCheck.opens_at ?? ''}`
    : null
  const windowNotOpen = windowAckKey !== null
  const windowAcknowledged = windowNotOpen ? acknowledgedWindowKey === windowAckKey : true
  const acknowledgeWindow = () => setAcknowledgedWindowKey(windowAckKey)

  // Filter to currently-present roster occupants. Stale ids (campers since
  // deleted) are dropped silently — see comment at the top of the file.
  const selectedRosterOccupants = selectedOccupantIds
    .map((id) => roster.find((occupant) => occupant.id === id))
    .filter((occupant): occupant is Occupant => Boolean(occupant))
  const selectedOccupantsMissingFromRoster =
    selectedRosterOccupants.length !== selectedOccupantIds.length
  // THR-129 item 3: default to the first selected camper (user's decision)
  // whenever nothing has been explicitly picked yet, or the previous pick
  // is no longer among the selected campers (deselected, or a stale value
  // from a job saved before this field existed) — computed here rather
  // than reset via effect, matching this file's existing pattern.
  const effectivePermitHolderOccupantId =
    selectedRosterOccupants.some((o) => o.id === permitHolderOccupantId)
      ? permitHolderOccupantId
      : (selectedRosterOccupants[0]?.id ?? null)

  const selectedOccupantFieldIssues = selectedAdapter
    ? selectedRosterOccupants
      .map((occupant) => ({
        occupant,
        missing: getMissingOccupantFields(occupant, selectedAdapter),
      }))
      .filter((issue) => issue.missing.length > 0)
    : []
  const selectedOccupantDetailsComplete =
    !selectedOccupantsMissingFromRoster
    && selectedOccupantFieldIssues.length === 0

  const selectedOccupantCount = selectedOccupantIds.length
  const selectedOccupantsPresent = selectedOccupantCount > 0
  const enteredPeopleCount = parseInt(String(params.people ?? '0'), 10)
  const effectivePeopleCount = selectedOccupantsPresent
    ? selectedOccupantCount
    : enteredPeopleCount
  const canAutoBook =
    // Watch/notify-only sites (third-party-SSO sign-in) never auto-book.
    (selectedAdapter?.supports_automated_booking ?? true)
    && selectedOccupantsPresent
    && credentialVerifiedForSelectedAdapter
    && selectedOccupantDetailsComplete
  const effectiveAutoBook = autoBook && canAutoBook

  // ── Handlers ──
  const resolveOptions = (
    field: ParamField,
    currentParams: Record<string, unknown>,
  ): string[] | null => {
    if (field.filter_by && field.options_by) {
      const key = String(currentParams[field.filter_by] ?? '')
      let opts: string[] = field.options_by[key] ?? []

      // DOC returns site order for the outbound direction; reverse for the return trip.
      if (field.key === 'sites' && field.filter_by === 'track' && opts.length > 0) {
        const direction = String(currentParams['direction'] ?? '')
        if (direction) {
          const dirField = selectedAdapter?.param_fields.find((f) => f.key === 'direction')
          const trackDirs = dirField?.options_by?.[key] ?? []
          if (trackDirs.length >= 2 && trackDirs.indexOf(direction) >= 1) {
            opts = [...opts].reverse()
          }
        }
      }

      return opts
    }
    return field.options ?? null
  }

  const handleAdapterChange = (adapterId: string) => {
    setSelectedAdapterId(adapterId)
    const adapter = adapters.find((a) => a.adapter_id === adapterId)
    if (adapter) {
      setParams(buildDefaultParams(adapter.param_fields))
    }
  }

  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => {
      const next: Record<string, unknown> = { ...prev, [key]: value }
      if (selectedAdapter) {
        for (const f of selectedAdapter.param_fields) {
          if (f.filter_by !== key || !f.options_by) continue
          if (f.type === 'multiselect') {
            next[f.key] = []
          } else {
            const valid = f.options_by[String(value ?? '')] ?? []
            const current = next[f.key]
            if (current && !valid.includes(String(current))) {
              next[f.key] = ''
            }
          }
        }

        if (key === 'track') {
          const dirField = selectedAdapter.param_fields.find((f) => f.key === 'direction')
          if (dirField?.options_by) {
            const dirs = dirField.options_by[String(value ?? '')] ?? []
            next['direction'] = dirs.length > 0 ? dirs[0] : ''
          }
          // Reset nights when track changes — re-synced when sites are picked.
          next['nights'] = '1'
        }

        if (key === 'direction') {
          const sitesField = selectedAdapter.param_fields.find((f) => f.key === 'sites')
          if (sitesField?.type === 'multiselect') {
            next['sites'] = []
          }
        }

        // For Great Walks, nights == site count.
        if (key === 'sites') {
          const siteList = Array.isArray(value) ? (value as string[]) : []
          if (siteList.length > 0) {
            next['nights'] = String(siteList.length)
          }
        }
      }
      return next
    })
  }

  // ── Cache helpers ──
  const upsertJob = (job: WatchJob) => {
    qc.setQueryData<WatchJob[]>(['jobs'], (current = []) => {
      const withoutCurrent = current.filter((candidate) => candidate.id !== job.id)
      return [job, ...withoutCurrent]
    })
    qc.setQueryData(['jobs', job.id], job)
  }

  const invalidateJob = (id?: string) => {
    qc.invalidateQueries({ queryKey: ['jobs'] })
    if (id) qc.invalidateQueries({ queryKey: ['jobs', id] })
  }

  // ── Mutations ──
  const create = useMutation({
    mutationFn: jobsApi.create,
    onSuccess: (job) => {
      upsertJob(job)
      invalidateJob(job.id)
      onDone(job)
    },
    onError: (e: Error) => setError(e.message),
  })

  const update = useMutation({
    mutationFn: (payload: { id: string; patch: Parameters<typeof jobsApi.update>[1] }) =>
      jobsApi.update(payload.id, payload.patch),
    onSuccess: (job) => {
      upsertJob(job)
      invalidateJob(job.id)
      onDone(job)
    },
    onError: (e: Error) => setError(e.message),
  })

  const pending = mode === 'create' ? create.isPending : update.isPending
  const submitLabel = mode === 'create' ? 'Create Hunt' : 'Save Changes'
  const submitBusyLabel = mode === 'create' ? 'Creating...' : 'Saving...'

  // ── Submit ──
  const handleSubmit = () => {
    setError(null)
    if (!selectedAdapter) {
      setError('Please select a booking site')
      return
    }

    const parsedParams: Record<string, unknown> = {}
    for (const field of selectedAdapter.param_fields) {
      if (field.key === 'occupants') continue
      const value = params[field.key]
      parsedParams[field.key] = (
        field.type === 'date' && typeof value === 'string'
          ? toAdapterDateValue(value)
          : value
      )
    }

    if (!(effectivePeopleCount > 0)) {
      setError('Enter a party size or select campers')
      return
    }

    parsedParams.people = String(effectivePeopleCount)

    if (effectiveAutoBook && !selectedOccupantsPresent) {
      setError('Select campers before enabling auto-book')
      return
    }
    if (effectiveAutoBook && !credentialVerifiedForSelectedAdapter) {
      setError('Verify your sign-in for this booking site before enabling auto-book')
      return
    }
    if (selectedOccupantsPresent && selectedOccupantsMissingFromRoster) {
      setError('Some selected campers could not be found — please re-select')
      return
    }
    if (selectedOccupantsPresent && !selectedOccupantDetailsComplete) {
      const issue = selectedOccupantFieldIssues[0]
      setError(
        `${issue.occupant.first_name} ${issue.occupant.last_name} is missing ${selectedAdapter.name} details: ${issue.missing.join(', ')}`,
      )
      return
    }

    if (selectedOccupantsPresent) {
      parsedParams.occupants = selectedRosterOccupants.map((occupant) => (
        buildCurrentOccupantSnapshot(occupant, selectedAdapter)
      ))
      // THR-129 item 3: only meaningful for adapters with a single-holder
      // concept (Camis) — stored even for a single-camper job (harmless,
      // and keeps resolve_permit_holder_name's fallback-to-first-occupant
      // path purely defensive rather than the normal case).
      if (selectedAdapter.uses_single_permit_holder && effectivePermitHolderOccupantId) {
        parsedParams.permit_holder_occupant_id = effectivePermitHolderOccupantId
      }
    } else {
      parsedParams.occupants = []
    }

    for (const field of selectedAdapter.param_fields) {
      if (field.type === 'multiselect') {
        const val = parsedParams[field.key]
        const opts = field.options_by
          ? field.options_by[String(parsedParams[field.filter_by ?? ''] ?? '')] ?? []
          : field.options ?? []
        if (opts.length > 0 && (!Array.isArray(val) || val.length === 0)) {
          setError('Please select at least one site to watch')
          return
        }
      }
    }

    const dateField = selectedAdapter.param_fields.find((f) => f.type === 'date')
    if (dateField) {
      const tz = selectedAdapter.booking_timezone
        ?? Intl.DateTimeFormat().resolvedOptions().timeZone
      const dateVal = String(parsedParams[dateField.key] ?? '')
      if (!dateVal) {
        setError(`${dateField.label} is required`)
        return
      }
      if (!isDateValidInTz(dateVal, tz)) {
        const tzLabel = selectedAdapter.booking_timezone ?? 'local time'
        setError(`${dateField.label} must be today or a future date (${tzLabel})`)
        return
      }
    }

    if (windowNotOpen && !windowAcknowledged) {
      setError('Please acknowledge the booking-window notice before saving this hunt.')
      return
    }

    const intervalNum = parseInt(intervalMinutes, 10)
    if (
      enableMonitoring
      && (isNaN(intervalNum) || intervalNum < 1 || intervalNum > 120)
    ) {
      setError('Interval must be between 1 and 120 minutes')
      return
    }
    const safeInterval =
      !isNaN(intervalNum) && intervalNum >= 1 && intervalNum <= 120
        ? intervalNum
        : 15

    if (mode === 'create') {
      create.mutate({
        name,
        adapter_id: selectedAdapterId,
        params: parsedParams,
        auto_book: effectiveAutoBook,
        enable_monitoring: enableMonitoring,
        interval_minutes: safeInterval,
      })
    } else if (initialJob) {
      update.mutate({
        id: initialJob.id,
        patch: {
          name,
          params: parsedParams,
          auto_book: effectiveAutoBook,
          enable_monitoring: enableMonitoring,
          interval_minutes: safeInterval,
        },
      })
    }
  }

  return {
    mode,
    name,
    setName,
    selectedAdapterId,
    params,
    autoBook,
    setAutoBook,
    enableMonitoring,
    setEnableMonitoring,
    intervalMinutes,
    setIntervalMinutes,
    selectedOccupantIds,
    setSelectedOccupantIds,
    permitHolderOccupantId: effectivePermitHolderOccupantId,
    setPermitHolderOccupantId,
    error,
    windowCheck,
    windowCheckLoading: windowCheckEnabled && windowCheckQuery.isFetching,
    windowAcknowledged,
    acknowledgeWindow,
    adapters,
    roster,
    occupantsLoading,
    selectedAdapter,
    selectedRosterOccupants,
    hasCredentialsForSelectedAdapter,
    credentialVerifiedForSelectedAdapter,
    selectedOccupantCount,
    selectedOccupantsPresent,
    selectedOccupantDetailsComplete,
    effectivePeopleCount,
    effectiveAutoBook,
    handleAdapterChange,
    handleParamChange,
    resolveOptions,
    handleSubmit,
    pending,
    submitLabel,
    submitBusyLabel,
  }
}
