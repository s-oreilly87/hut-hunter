import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogTrigger
} from '@/components/ui/dialog'

export function CreateJobDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [adapterId, setAdapterId] = useState('doc_nz')
  const [paramsRaw, setParamsRaw] = useState('{\n  \n}')
  const [autoBook, setAutoBook] = useState(false)
  const [paramsError, setParamsError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: jobsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      setOpen(false)
      setName('')
      setParamsRaw('{\n  \n}')
    }
  })

  const handleSubmit = () => {
    setParamsError(null)
    let params: Record<string, unknown>
    try {
      params = JSON.parse(paramsRaw)
    } catch {
      setParamsError('Invalid JSON')
      return
    }
    create.mutate({ name, adapter_id: adapterId, params, auto_book: autoBook })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New Watch Job</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Watch Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Tongariro Alpine Crossing"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Adapter</Label>
            <Input
              placeholder="e.g. doc_nz"
              value={adapterId}
              onChange={e => setAdapterId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Params (JSON)</Label>
            <textarea
              className="w-full font-mono text-sm border rounded-md p-2 min-h-[120px] bg-background"
              value={paramsRaw}
              onChange={e => setParamsRaw(e.target.value)}
            />
            {paramsError && <p className="text-destructive text-xs">{paramsError}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={autoBook} onCheckedChange={setAutoBook} id="auto-book" />
            <Label htmlFor="auto-book">Auto-book when available</Label>
          </div>
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!name || !adapterId || create.isPending}
          >
            {create.isPending ? 'Creating...' : 'Create Job'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}