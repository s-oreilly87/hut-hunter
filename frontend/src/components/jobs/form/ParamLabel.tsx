import { createElement, type ReactNode } from 'react'
import { Label } from '@/components/ui/Label'
import { getJobParamIcon } from '@/components/jobs/jobParamDisplay'

/**
 * Form-row label that automatically renders the icon associated with a
 * known param key (track, date, nights, people, sites, …) plus an optional
 * required-marker.
 */
export function ParamLabel({
  fieldKey,
  children,
  required = false,
}: {
  fieldKey: string
  children: ReactNode
  required?: boolean
}) {
  const Icon = getJobParamIcon(fieldKey)

  return (
    <Label className="inline-flex items-center gap-2">
      {Icon && createElement(Icon, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
      <span>{children}</span>
      {required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  )
}
