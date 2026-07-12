import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'

export function ChannelCardHeader({
  icon: Icon,
  iconClassName,
  title,
  description,
  enabled,
  className,
}: {
  icon: LucideIcon
  iconClassName: string
  title: string
  description: string
  enabled: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex items-start gap-3">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl', iconClassName)}>
          <Icon className="size-4.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <StatusPill tone={enabled ? 'success' : 'neutral'}>
        {enabled ? 'Enabled' : 'Disabled'}
      </StatusPill>
    </div>
  )
}

export function ChannelEnableRow({
  configured,
  configuredHint,
  lockedHint,
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
  className,
}: {
  configured: boolean
  configuredHint: string
  lockedHint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled: boolean
  ariaLabel: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-3 py-3',
        className,
      )}
    >
      <div>
        <p className="text-sm font-medium text-foreground">Enable channel</p>
        <p className="text-xs text-muted-foreground">
          {configured ? configuredHint : lockedHint}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
    </div>
  )
}

export function NotificationChannelCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <InsetPanel as="section" className={cn(className)}>
      {children}
    </InsetPanel>
  )
}
