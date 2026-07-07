import axios from 'axios'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function expectArray<T>(value: unknown, label: string): T[] {
  if (Array.isArray(value)) return value as T[]
  console.warn(`Expected ${label} API response to be an array.`, value)
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.email === 'string'
    && typeof value.created_at === 'string'
  )
}

export interface AuthUser {
  id: string
  email: string
  created_at: string
}

export interface AuthCredentials {
  email: string
  password: string
}

// Types matching our FastAPI schemas
export type JobStatus =
  | 'paused'
  | 'checking'
  | 'waiting'
  | 'hold_placed'
  // THR-122: hold worker hit an unexpected condition mid-funnel (unrecognized
  // dialog, locator timeout) and parked the session for manual takeover
  // instead of tearing it down. Treated like hold_placed everywhere a live
  // cart/browser is involved — see /pay/{job_id} and cart-expiry handling.
  | 'needs_attention'
  // THR-124: the requested date isn't inside the adapter's booking window
  // yet (Camis' rolling per-park/per-province release schedule). Monitoring
  // is off — see WatchJob.window_opens_at — until the poll worker auto-arms
  // it the moment the window opens.
  | 'awaiting_window'
  | 'booking_complete'
  | 'cancelled'
  | 'expired'

export type AvailabilityStatusStr =
  | 'available'
  | 'partially_available'
  | 'unavailable'
  | 'unknown'

export interface AvailabilityResult {
  site: string
  status: AvailabilityStatusStr
  evidence: string
  total_available?: number | null
  icon?: string | null
}

export interface ArtifactRecord {
  label: string
  png_url: string
  html_url: string | null
}

// last_result is either a list of AvailabilityResult or, on error, a list
// wrapping a single error dict { error: ... }. We accept either shape.
export type LastResultEntry = AvailabilityResult | Record<string, unknown>

export interface WatchJob {
  id: string
  name: string
  adapter_id: string
  params: Record<string, unknown>
  status: JobStatus
  auto_book: boolean
  // THR-123: "usable" — a credential row exists AND it hasn't failed
  // verification. True when the adapter doesn't require credentials.
  credentials_configured: boolean
  // THR-123: true when a stored credential exists but failed its login
  // check — distinct from "no credential at all" so the UI can show the
  // right notice.
  credentials_failed: boolean
  // False for watch/notify-only booking sites (third-party-SSO sign-in, e.g.
  // Parks Canada) — the UI hides auto-book and manual-booking affordances.
  supports_automated_booking: boolean
  // Scheduler state for periodic polling. When enable_monitoring=true, the
  // backend scheduler dispatches check_availability every interval_minutes
  // and next_check_at reflects when the next dispatch is due. next_check_at
  // is null when monitoring is off or the job is in a terminal / live-hold
  // state where polling is paused.
  enable_monitoring: boolean
  interval_minutes: number
  next_check_at: string | null
  cart_expires_at: string | null
  created_at: string
  last_checked_at: string | null
  last_result: LastResultEntry[] | null
  // URLs (relative to the API host) of the most recent debug/receipt
  // snapshot captured by the worker. Both are set together (same base path
  // with .png / .html extensions) or both are null.
  last_artifact_png: string | null
  last_artifact_html: string | null
  artifact_history: ArtifactRecord[] | null
  // THR-124: set while status === 'awaiting_window' — the computed UTC
  // go-live time. window_opens_precise is false when it's a best-effort
  // fallback (e.g. local midnight) rather than a confirmed go-live moment.
  window_opens_at: string | null
  window_opens_precise: boolean
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  paused: 'Paused',
  checking: 'Checking',
  waiting: 'Waiting',
  hold_placed: 'Hold Placed',
  needs_attention: 'Needs Attention',
  awaiting_window: 'Awaiting Window',
  booking_complete: 'Booking Complete',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export interface CreateWatchJobDto {
  name: string
  adapter_id: string
  params: Record<string, unknown>
  auto_book: boolean
  enable_monitoring: boolean
  interval_minutes: number
}

export interface UpdateWatchJobDto {
  name?: string
  params?: Record<string, unknown>
  auto_book?: boolean
  enable_monitoring?: boolean
  interval_minutes?: number
}

export interface ParamField {
  key: string
  label: string
  type: 'text' | 'date' | 'number' | 'select' | 'multiselect'
  options: string[] | null
  default: unknown
  required: boolean
  // When set, this field's options depend on the value of the field named
  // `filter_by`. Use options_by[<value of filter_by>] as the options.
  filter_by?: string | null
  options_by?: Record<string, string[]> | null
  // When set, the select should be rendered as a grouped dropdown with one
  // <SelectGroup> per entry. Each entry is { group: string; items: string[] }.
  // `options` is still present as the flattened list for backwards compat.
  options_tree?: { group: string; items: string[] }[] | null
  // For number fields: inclusive bounds for the <input type="number">.
  min?: number | null
  max?: number | null
}

export interface AdapterInfo {
  adapter_id: string
  name: string
  param_fields: ParamField[]
  occupant_fields: ParamField[]
  requires_credentials: boolean
  // False when the site's sign-in is third-party SSO that can't be automated
  // (e.g. Parks Canada: Google/Facebook/GCKey) — watch & notify only.
  supports_automated_booking: boolean
  // THR-124: True for adapters with a rolling booking window (Camis) —
  // tells the wizard whether it's worth calling jobsApi.checkWindow at all.
  has_booking_windows: boolean
  // Set when the adapter has a time-bounded booking window. Used by the
  // frontend for date validation and stale-job display.
  // null timezone means "use client local timezone"
  booking_timezone: string | null
  booking_cutoff_time: string  // HH:MM:SS — informational, expiry enforced server-side
}

export interface WindowCheckResult {
  is_open: boolean
  opens_at: string | null
  opens_at_precise: boolean
  evidence: string
}

export interface Occupant {
  id: string
  first_name: string
  last_name: string
  age: number
  gender: string
  country: string
  adapter_values: Record<string, Record<string, unknown>>
  created_at: string
}

export interface OccupantCreate {
  first_name: string
  last_name: string
  age: number
  gender: string
  country: string
  adapter_values: Record<string, Record<string, unknown>>
}

export interface AdapterCredential {
  id: string
  adapter_id: string
  username: string
  has_password: boolean
  // THR-123: null = never checked (legacy row, or a fresh save whose
  // verification hasn't landed yet). true/false only ever come from an
  // actual login check.
  is_verified: boolean | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface AdapterCredentialUpsert {
  username: string
  password?: string | null
}

export interface NotificationSettings {
  email_enabled: boolean
  email_configured: boolean
  email_address: string | null
  gotify_enabled: boolean
  gotify_configured: boolean
  gotify_url: string | null
  gotify_has_token: boolean
}

export interface UpdateNotificationSettingsDto {
  email_enabled?: boolean
  email_address?: string | null
  gotify_enabled?: boolean
  gotify_url?: string | null
  gotify_token?: string | null
}

export const adaptersApi = {
  list: () => api.get<AdapterInfo[] | unknown>('/adapters').then(r => expectArray<AdapterInfo>(r.data, 'adapters')),
}

export const authApi = {
  me: async () => {
    try {
      const data = (await api.get<AuthUser | unknown>('/auth/me')).data
      if (isAuthUser(data)) {
        return data
      }
      console.warn('Expected auth/me API response to be an auth user object.', data)
      return null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return null
      }
      throw error
    }
  },
  register: (data: AuthCredentials) =>
    api.post<AuthUser>('/auth/register', data).then(r => r.data),
  login: (data: AuthCredentials) =>
    api.post<AuthUser>('/auth/login', data).then(r => r.data),
  logout: () => api.post('/auth/logout').then(r => r.data),
}

export const occupantsApi = {
  list: () => api.get<Occupant[] | unknown>('/occupants').then(r => expectArray<Occupant>(r.data, 'occupants')),
  create: (data: OccupantCreate) => api.post<Occupant>('/occupants', data).then(r => r.data),
  update: (id: string, data: Partial<OccupantCreate>) =>
    api.patch<Occupant>(`/occupants/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/occupants/${id}`),
}

export const credentialsApi = {
  list: () => api.get<AdapterCredential[] | unknown>('/credentials').then(r => expectArray<AdapterCredential>(r.data, 'credentials')),
  upsert: (adapterId: string, data: AdapterCredentialUpsert) =>
    api.put<AdapterCredential>(`/credentials/${adapterId}`, data).then(r => r.data),
  remove: (adapterId: string) => api.delete(`/credentials/${adapterId}`),
  verify: (adapterId: string) =>
    api.post<{ status: string }>(`/credentials/${adapterId}/verify`).then(r => r.data),
}

export const notificationsApi = {
  get: () => api.get<NotificationSettings>('/notifications').then(r => r.data),
  update: (data: UpdateNotificationSettingsDto) =>
    api.put<NotificationSettings>('/notifications', data).then(r => r.data),
}

export const jobsApi = {
  list: () => api.get<WatchJob[] | unknown>('/jobs').then(r => expectArray<WatchJob>(r.data, 'jobs')),
  get: (id: string) => api.get<WatchJob>(`/jobs/${id}`).then(r => r.data),
  create: (data: CreateWatchJobDto) => api.post<WatchJob>('/jobs', data).then(r => r.data),
  update: (id: string, data: UpdateWatchJobDto) =>
    api.patch<WatchJob>(`/jobs/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/jobs/${id}`).then(r => r.data),
  trigger: (id: string) => api.post(`/jobs/${id}/trigger`).then(r => r.data),
  // Manual hold dispatch. Backend rejects with 409 unless the last check
  // shows every site fully available; the UI hides this button otherwise.
  book: (id: string) => api.post(`/jobs/${id}/book`).then(r => r.data),
  // THR-124: "is this date released yet?" — the wizard calls this before
  // save so the not-yet-released case can be explained up front. Never
  // rejects on an unknown/non-windowed adapter (see the backend's fail-open
  // contract), so callers don't need special error handling here.
  checkWindow: (data: { adapter_id: string; params: Record<string, unknown> }) =>
    api.post<WindowCheckResult>('/jobs/window-check', data).then(r => r.data),
}
