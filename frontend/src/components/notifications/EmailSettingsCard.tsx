import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail } from 'lucide-react'

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

export function EmailSettingsCard({
  settings,
  className,
}: {
  settings: NotificationSettings
  className?: string
}) {
  const queryClient = useQueryClient()
  const [emailAddress, setEmailAddress] = useState(settings.email_address ?? '')
  const [enabled, setEnabled] = useState(settings.email_enabled)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const payload: UpdateNotificationSettingsDto = {
        email_enabled: enabled,
      }
      if (emailAddress.trim()) {
        payload.email_address = emailAddress.trim()
      }
      return notificationsApi.update(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setError(null)
    },
    onError: (mutationError: Error) => setError(getErrorMessage(mutationError)),
  })

  const canSave = emailAddress.trim().length > 0 || enabled !== settings.email_enabled

  return (
    <NotificationChannelCard className={className}>
      <ChannelCardHeader
        icon={Mail}
        iconClassName="bg-emerald-500/10 text-emerald-700"
        title="Email Notifications"
        description="Send availability and booking updates to one email address."
        enabled={settings.email_enabled}
      />

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="notification-email-address">Email Address</Label>
          <Input
            id="notification-email-address"
            type="email"
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
            placeholder="alerts@example.com"
          />
          <p className="text-xs text-muted-foreground">
            {settings.email_configured
              ? 'Saved. Update it here if needed.'
              : 'Save an address to enable email alerts.'}
          </p>
        </div>

        <ChannelEnableRow
          configured={settings.email_configured}
          configuredHint="Turn on email delivery for this account."
          lockedHint="Save an address to unlock this toggle."
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!settings.email_configured || save.isPending}
          ariaLabel="Enable email notifications"
        />
      </div>

      {error && (
        <FormErrorAlert className="mt-3">{error}</FormErrorAlert>
      )}

      <div className="mt-4">
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Save Email
        </Button>
      </div>
    </NotificationChannelCard>
  )
}
