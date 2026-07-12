import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Smartphone } from 'lucide-react'

import {
  notificationsApi,
  type NotificationSettings,
  type UpdateNotificationSettingsDto,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { FormErrorAlert } from '@/components/ui/FormErrorAlert'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  ChannelCardHeader,
  ChannelEnableRow,
  NotificationChannelCard,
} from './ChannelCard'
import { getErrorMessage } from './notificationHelpers'

export function GotifySettingsCard({
  settings,
  className,
}: {
  settings: NotificationSettings
  className?: string
}) {
  const queryClient = useQueryClient()
  const [gotifyUrl, setGotifyUrl] = useState(settings.gotify_url ?? '')
  const [gotifyToken, setGotifyToken] = useState('')
  const [enabled, setEnabled] = useState(settings.gotify_enabled)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const payload: UpdateNotificationSettingsDto = {
        gotify_enabled: enabled,
      }
      if (gotifyUrl.trim()) {
        payload.gotify_url = gotifyUrl.trim()
      }
      if (gotifyToken.trim()) {
        payload.gotify_token = gotifyToken.trim()
      }
      return notificationsApi.update(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setGotifyToken('')
      setError(null)
    },
    onError: (mutationError: Error) => setError(getErrorMessage(mutationError)),
  })

  const canSave = (
    gotifyUrl.trim().length > 0
    || gotifyToken.trim().length > 0
    || enabled !== settings.gotify_enabled
  )

  return (
    <NotificationChannelCard className={className}>
      <ChannelCardHeader
        icon={Smartphone}
        iconClassName="bg-sky-500/10 text-sky-700"
        title="Gotify Notifications"
        description="Send push alerts through your Gotify server."
        enabled={settings.gotify_enabled}
      />

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="notification-gotify-url">Gotify URL</Label>
          <Input
            id="notification-gotify-url"
            value={gotifyUrl}
            onChange={(event) => setGotifyUrl(event.target.value)}
            placeholder="https://gotify.example.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notification-gotify-token">Token</Label>
          <Input
            id="notification-gotify-token"
            type="password"
            value={gotifyToken}
            onChange={(event) => setGotifyToken(event.target.value)}
            placeholder={settings.gotify_has_token ? 'Leave blank to keep current token' : 'Gotify application token'}
          />
          <p className="text-xs text-muted-foreground">
            {settings.gotify_configured
              ? 'Saved. Update the URL or rotate the token here.'
              : 'Save the URL and token to enable Gotify alerts.'}
          </p>
        </div>

        <ChannelEnableRow
          configured={settings.gotify_configured}
          configuredHint="Turn on Gotify delivery for this account."
          lockedHint="Save the URL and token to unlock this toggle."
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!settings.gotify_configured || save.isPending}
          ariaLabel="Enable Gotify notifications"
        />
      </div>

      {error && (
        <FormErrorAlert className="mt-3">{error}</FormErrorAlert>
      )}

      <div className="mt-4">
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
          Save Gotify
        </Button>
      </div>
    </NotificationChannelCard>
  )
}
