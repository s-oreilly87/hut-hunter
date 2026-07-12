import { useQuery } from '@tanstack/react-query'
import { BellRing } from 'lucide-react'

import { notificationsApi } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { EmailSettingsCard } from './EmailSettingsCard'
import { GotifySettingsCard } from './GotifySettingsCard'

export function NotificationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: settings, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.get,
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <BellRing className="size-5" />
            </div>
            <div>
              <DialogTitle>Notifications</DialogTitle>
              <DialogDescription className="mt-1">
                Notifications are opt-in. Save a delivery target, then enable the channels you want to use.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <InsetPanel className="p-4 text-xs text-muted-foreground">
            Delivery targets are encrypted at rest and only decrypted when a hunt sends an alert.
          </InsetPanel>

          {isLoading || !settings ? (
            <InsetPanel className="px-4 py-8 text-sm text-muted-foreground">
              Loading notification settings…
            </InsetPanel>
          ) : (
            <>
              <EmailSettingsCard
                key={`${settings.email_address ?? ''}:${settings.email_enabled}`}
                settings={settings}
              />
              <GotifySettingsCard
                key={`${settings.gotify_url ?? ''}:${settings.gotify_enabled}:${settings.gotify_has_token}`}
                settings={settings}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
