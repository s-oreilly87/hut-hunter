import type { AdapterInfo } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { InfoTooltip } from '@/components/ui/SectionHeading'

/**
 * Step-0 content of the wizard / top-left card of the dialog: hunt name
 * input + booking-site picker. The booking site is locked once a job
 * exists because each adapter has its own param schema.
 */
export function HuntSetupFields({
  mode,
  name,
  setName,
  adapters,
  selectedAdapterId,
  onAdapterChange,
  selectedAdapter,
  hasCredentialsForSelectedAdapter,
}: {
  mode: 'create' | 'edit'
  name: string
  setName: (value: string) => void
  adapters: AdapterInfo[]
  selectedAdapterId: string
  onAdapterChange: (adapterId: string) => void
  selectedAdapter: AdapterInfo | undefined
  hasCredentialsForSelectedAdapter: boolean
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label>Hunt Name</Label>
        <Input
          autoFocus
          placeholder="e.g. Routeburn Falls Hut – Apr 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label>Booking Site</Label>
          {mode === 'edit' && (
            <InfoTooltip content="Booking site is locked on existing hunts because each site has its own input schema." />
          )}
        </div>
        <Select
          value={selectedAdapterId}
          onValueChange={onAdapterChange}
          disabled={mode === 'edit'}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select booking site" />
          </SelectTrigger>
          <SelectContent>
            {adapters.map((a) => (
              <SelectItem key={a.adapter_id} value={a.adapter_id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedAdapter?.requires_credentials && !hasCredentialsForSelectedAdapter && (
          <p className="text-xs text-amber-700">
            No sign-in saved for this booking site. Booking actions will stay disabled.
          </p>
        )}
      </div>
    </>
  )
}
