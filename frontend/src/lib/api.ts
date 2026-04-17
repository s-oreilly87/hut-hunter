import axios from 'axios'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' }
})

// Types matching our FastAPI schemas
export interface WatchJob {
  id: string
  name: string
  adapter_id: string
  params: Record<string, unknown>
  is_active: boolean
  auto_book: boolean
  created_at: string
  last_checked_at: string | null
  last_result: Record<string, unknown> | null
}

export interface CreateWatchJobDto {
  name: string
  adapter_id: string
  params: Record<string, unknown>
  auto_book: boolean
}

export interface ParamField {
  key: string
  label: string
  type: 'text' | 'date' | 'number' | 'select'
  options: string[] | null
  default: unknown
  required: boolean
}

export interface AdapterInfo {
  adapter_id: string
  name: string
  param_fields: ParamField[]
}

export const adaptersApi = {
  list: () => api.get<AdapterInfo[]>('/adapters').then(r => r.data),
}

export const jobsApi = {
  list: () => api.get<WatchJob[]>('/jobs').then(r => r.data),
  get: (id: string) => api.get<WatchJob>(`/jobs/${id}`).then(r => r.data),
  create: (data: CreateWatchJobDto) => api.post<WatchJob>('/jobs', data).then(r => r.data),
  trigger: (id: string) => api.post(`/jobs/${id}/trigger`).then(r => r.data),
}