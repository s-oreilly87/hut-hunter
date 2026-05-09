import axios from 'axios'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

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
  credentials_configured: boolean
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
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  paused: 'Paused',
  checking: 'Checking',
  waiting: 'Waiting',
  hold_placed: 'Hold Placed',
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
}

export interface AdapterInfo {
  adapter_id: string
  name: string
  param_fields: ParamField[]
  occupant_fields: ParamField[]
  requires_credentials: boolean
  // Set when the adapter has a time-bounded booking window. Used by the
  // frontend for date validation and stale-job display.
  // null timezone means "use client local timezone"
  booking_timezone: string | null
  booking_cutoff_time: string  // HH:MM:SS — informational, expiry enforced server-side
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
  list: () => api.get<AdapterInfo[]>('/adapters').then(r => r.data),
}

export const authApi = {
  me: async () => {
    try {
      return (await api.get<AuthUser>('/auth/me')).data
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
  list: () => api.get<Occupant[]>('/occupants').then(r => r.data),
  create: (data: OccupantCreate) => api.post<Occupant>('/occupants', data).then(r => r.data),
  update: (id: string, data: Partial<OccupantCreate>) =>
    api.patch<Occupant>(`/occupants/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/occupants/${id}`),
}

export const credentialsApi = {
  list: () => api.get<AdapterCredential[]>('/credentials').then(r => r.data),
  upsert: (adapterId: string, data: AdapterCredentialUpsert) =>
    api.put<AdapterCredential>(`/credentials/${adapterId}`, data).then(r => r.data),
  remove: (adapterId: string) => api.delete(`/credentials/${adapterId}`),
}

export const notificationsApi = {
  get: () => api.get<NotificationSettings>('/notifications').then(r => r.data),
  update: (data: UpdateNotificationSettingsDto) =>
    api.put<NotificationSettings>('/notifications', data).then(r => r.data),
}

export const jobsApi = {
  list: () => api.get<WatchJob[]>('/jobs').then(r => r.data),
  get: (id: string) => api.get<WatchJob>(`/jobs/${id}`).then(r => r.data),
  create: (data: CreateWatchJobDto) => api.post<WatchJob>('/jobs', data).then(r => r.data),
  update: (id: string, data: UpdateWatchJobDto) =>
    api.patch<WatchJob>(`/jobs/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/jobs/${id}`).then(r => r.data),
  trigger: (id: string) => api.post(`/jobs/${id}/trigger`).then(r => r.data),
  // Manual hold dispatch. Backend rejects with 409 unless the last check
  // shows every site fully available; the UI hides this button otherwise.
  book: (id: string) => api.post(`/jobs/${id}/book`).then(r => r.data),
}
