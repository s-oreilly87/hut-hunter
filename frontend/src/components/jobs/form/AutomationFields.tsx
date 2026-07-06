import { LockKeyhole } from 'lucide-react'
import type { AdapterInfo } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Switch } from '@/components/ui/Switch'
import { InfoTooltip } from '@/components/ui/SectionHeading'

/**
 * Step-2 content: auto-book toggle, monitoring on/off, and the check
 * interval slider. Auto-book is gated on three things — campers must be
 * selected, the adapter's required camper fields must all be filled, and
 * the adapter's sign-in must be saved — so its switch can disable itself
 * and surface a contextual hint.
 */
export function AutomationFields({
  selectedAdapter,
  autoBook,
  setAutoBook,
  enableMonitoring,
  setEnableMonitoring,
  intervalMinutes,
  setIntervalMinutes,
  selectedOccupantsPresent,
  hasCredentialsForSelectedAdapter,
  selectedOccupantDetailsComplete,
  onOpenCredentials,
}: {
  selectedAdapter: AdapterInfo | undefined
  autoBook: boolean
  setAutoBook: (v: boolean) => void
  enableMonitoring: boolean
  setEnableMonitoring: (v: boolean) => void
  intervalMinutes: string
  setIntervalMinutes: (v: string) => void
  selectedOccupantsPresent: boolean
  hasCredentialsForSelectedAdapter: boolean
  selectedOccupantDetailsComplete: boolean
  onOpenCredentials?: () => void
}) {
  if (!selectedAdapter) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Select a booking site first to reveal its inputs and automation settings.
        </p>
      </div>
    )
  }

  return (
    <>
      {!selectedAdapter.supports_automated_booking ? (
        // Watch/notify-only sites (third-party-SSO sign-in, e.g. Parks
        // Canada) can't be booked automatically — explain instead of
        // rendering the auto-book toggle.
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {selectedAdapter.name} signs in with a third-party account (e.g.
            Google or GCKey), which Hut Hunter can't automate — so automated
            booking isn't available. You'll still be notified the moment
            availability is found and can book manually on the site.
          </p>
        </div>
      ) : (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="auto-book">Auto-book when available</Label>
            <InfoTooltip content="Lets Hut Hunter continue directly into the booking flow instead of stopping after availability is found." />
          </div>
          <Switch
            checked={autoBook}
            onCheckedChange={setAutoBook}
            id="auto-book"
            disabled={
              !selectedOccupantsPresent
              || !hasCredentialsForSelectedAdapter
              || !selectedOccupantDetailsComplete
            }
          />
        </div>
        {!selectedOccupantsPresent && (
          <p className="text-xs text-muted-foreground">
            Select campers to enable auto-book.
          </p>
        )}
        {selectedOccupantsPresent && !selectedOccupantDetailsComplete && (
          <p className="text-xs text-muted-foreground">
            Fill the required camper details for {selectedAdapter.name} before enabling auto-book.
          </p>
        )}
        {selectedOccupantsPresent && !hasCredentialsForSelectedAdapter && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              A saved sign-in for this booking site is required before enabling auto-book.
            </p>
            {onOpenCredentials && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onOpenCredentials}
              >
                <LockKeyhole className="size-3.5" />
                Manage Sign-ins
              </Button>
            )}
          </div>
        )}
      </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="enable-monitoring">Enable monitoring</Label>
        <Switch
          checked={enableMonitoring}
          onCheckedChange={setEnableMonitoring}
          id="enable-monitoring"
        />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="interval-minutes"
          className={enableMonitoring ? '' : 'text-muted-foreground'}
        >
          Check interval
        </Label>
        <div className="flex items-center gap-3">
          <Input
            id="interval-minutes"
            type="number"
            min={1}
            max={120}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            disabled={!enableMonitoring}
            className="w-24"
          />
          <span className={`text-sm ${enableMonitoring ? 'text-foreground' : 'text-muted-foreground'}`}>
            minutes
          </span>
        </div>
      </div>
    </>
  )
}
