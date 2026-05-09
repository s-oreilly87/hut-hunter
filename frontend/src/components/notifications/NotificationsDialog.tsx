import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Loader2, Mail, Smartphone } from 'lucide-react'

import {
  notificationsApi,
  type NotificationSettings,
  type UpdateNotificationSettingsDto,
} from '@/lib/api'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Switch } from '../ui/Switch'

function getErrorMessage(error: Error) {
  return error.message || 'Unable to save notification settings.'
}

function EmailSettingsCard({
  settings,
}: {
  settings: NotificationSettings
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
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700">
            <Mail className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Email Notifications
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Send availability and booking updates to one email address.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            settings.email_enabled
              ? 'bg-emerald-500/12 text-emerald-700'
              : 'bg-secondary text-muted-foreground'
          }`}
        >
          {settings.email_enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

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

        <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable channel</p>
            <p className="text-xs text-muted-foreground">
              {settings.email_configured
                ? 'Turn on email delivery for this account.'
                : 'Save an address to unlock this toggle.'}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!settings.email_configured || save.isPending}
            aria-label="Enable email notifications"
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Save Email
        </Button>
      </div>
    </section>
  )
}

function GotifySettingsCard({
  settings,
}: {
  settings: NotificationSettings
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
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700">
            <Smartphone className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Gotify Notifications
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Send push alerts through your Gotify server.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            settings.gotify_enabled
              ? 'bg-emerald-500/12 text-emerald-700'
              : 'bg-secondary text-muted-foreground'
          }`}
        >
          {settings.gotify_enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

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

        <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable channel</p>
            <p className="text-xs text-muted-foreground">
              {settings.gotify_configured
                ? 'Turn on Gotify delivery for this account.'
                : 'Save the URL and token to unlock this toggle.'}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!settings.gotify_configured || save.isPending}
            aria-label="Enable Gotify notifications"
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
          Save Gotify
        </Button>
      </div>
    </section>
  )
}

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
          <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-4 text-xs text-muted-foreground">
            Delivery targets are encrypted at rest and only decrypted when a hunt sends an alert.
          </div>

          {isLoading || !settings ? (
            <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-8 text-sm text-muted-foreground">
              Loading notification settings…
            </div>
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
