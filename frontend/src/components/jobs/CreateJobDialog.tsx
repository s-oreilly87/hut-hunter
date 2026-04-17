import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { jobsApi, adaptersApi, type ParamField } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogTrigger
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue
} from '@/components/ui/select'

function ParamFieldInput({
  field,
  value,
  onChange,
}: {
  field: ParamField
  value: unknown
  onChange: (val: unknown) => void
}) {
  if (field.type === 'select' && field.options) {
    return (
      <Select value={String(value ?? '')} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          {field.options.map(opt => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <Input
        type="text"
        placeholder="DD/MM/YYYY"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  // text — check if it looks like a JSON array (occupants field)
  if (field.key === 'occupants') {
    return (
      <textarea
        className="w-full font-mono text-xs border rounded-md p-2 min-h-30 bg-background"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
    />
  )
}

function buildDefaultParams(fields: ParamField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map(f => [f.key, f.default ?? ''])
  )
}

export function CreateJobDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [selectedAdapterId, setSelectedAdapterId] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [autoBook, setAutoBook] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })

  const selectedAdapter = adapters.find(a => a.adapter_id === selectedAdapterId)

  const handleAdapterChange = (adapterId: string) => {
    setSelectedAdapterId(adapterId)
    const adapter = adapters.find(a => a.adapter_id === adapterId)
    if (adapter) {
      setParams(buildDefaultParams(adapter.param_fields))
    }
  }

  const handleParamChange = (key: string, value: unknown) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const create = useMutation({
    mutationFn: jobsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      setOpen(false)
      setName('')
      setSelectedAdapterId('')
      setParams({})
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const handleSubmit = () => {
    setError(null)
    if (!selectedAdapter) {
      setError('Please select an adapter')
      return
    }

    // Parse any JSON fields (occupants)
    const parsedParams: Record<string, unknown> = {}
    for (const field of selectedAdapter.param_fields) {
      const val = params[field.key]
      if (field.key === 'occupants' && typeof val === 'string') {
        try {
          parsedParams[field.key] = JSON.parse(val)
        } catch {
          setError('Occupants field contains invalid JSON')
          return
        }
      } else {
        parsedParams[field.key] = val
      }
    }

    create.mutate({
      name,
      adapter_id: selectedAdapterId,
      params: parsedParams,
      auto_book: autoBook,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New Watch Job</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Watch Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">

          {/* Job name */}
          <div className="space-y-1">
            <Label>Job Name</Label>
            <Input
              placeholder="e.g. Routeburn Falls Hut – Apr 2026"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* Adapter selector */}
          <div className="space-y-1">
            <Label>Adapter</Label>
            <Select value={selectedAdapterId} onValueChange={handleAdapterChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select booking site" />
              </SelectTrigger>
              <SelectContent>
                {adapters.map(a => (
                  <SelectItem key={a.adapter_id} value={a.adapter_id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic param fields */}
          {selectedAdapter && selectedAdapter.param_fields.map(field => (
            <div key={field.key} className="space-y-1">
              <Label>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <ParamFieldInput
                field={field}
                value={params[field.key]}
                onChange={val => handleParamChange(field.key, val)}
              />
            </div>
          ))}

          {/* Auto book toggle */}
          {selectedAdapter && (
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={autoBook}
                onCheckedChange={setAutoBook}
                id="auto-book"
              />
              <Label htmlFor="auto-book">
                Auto-book when available
                <span className="text-muted-foreground text-xs ml-2">
                  (requires stored session)
                </span>
              </Label>
            </div>
          )}

          {error && <p className="text-destructive text-xs">{error}</p>}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!name || !selectedAdapterId || create.isPending}
          >
            {create.isPending ? 'Creating...' : 'Create Job'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}