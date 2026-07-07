import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getHeaderFields } from '@/components/jobs/jobParamDisplay'
import { cn } from '@/lib/utils'

/**
 * Renders a job's stored params as a compact, multi-row label/value list,
 * grouped by visual importance:
 *
 *   row 1: park (Camis) / facility / facility_park (DOC)
 *   row 2: track / date
 *   row 3: nights / people / direction
 *   row 4: sites
 *
 * Used in the JobCard header. The optional pencil button on the right opens
 * the edit flow at the booking-inputs step.
 *
 * `centered` reserves a leading spacer so the content stays visually centered
 * when the pencil button is rendered (used in the mobile-back header layout
 * where the title row is centered).
 *
 * `parkUrl` (THR-129 item 2) is the backend-computed Camis results-page
 * deep-link for the job's current params — threaded straight into the
 * `park` field's href, since (unlike the DOC facility link) it needs
 * adapter defaults only the backend knows.
 */
export function HeaderParamSummary({
  params,
  parkUrl,
  onEdit,
  centered = false,
  compact = false,
}: {
  params: Record<string, unknown>
  parkUrl?: string | null
  onEdit?: () => void
  centered?: boolean
  compact?: boolean
}) {
  const fields = getHeaderFields(params, parkUrl)

  const content = fields.length
    ? (() => {
        const facilityFields = fields.filter(
          (field) => field.key === 'park' || field.key === 'facility' || field.key === 'facility_park',
        )
        const primaryFields = fields.filter((field) => field.key === 'track' || field.key === 'date')
        const secondaryFields = fields.filter(
          (field) => field.key === 'nights' || field.key === 'people' || field.key === 'direction',
        )
        const tertiaryFields = fields.filter((field) => field.key === 'sites')
        const rows = [facilityFields, primaryFields, secondaryFields, tertiaryFields].filter((row) => row.length > 0)

        return (
          <div className="space-y-1.5">
            {rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={cn(
                  compact
                    ? 'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground/85'
                    : 'flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-5 text-muted-foreground',
                  centered && 'justify-center text-center',
                )}
              >
                {row.map((field) => {
                  const Icon = field.icon
                  const textClass = field.isSubtitle ? 'text-xs text-muted-foreground/70' : ''

                  return (
                    <span key={field.key} className={`inline-flex items-start gap-2 ${textClass}`}>
                      <Icon className={`mt-0.5 shrink-0 ${
                        compact
                          ? field.isSubtitle ? 'size-3 text-foreground/40' : 'size-3 text-foreground/60'
                          : field.isSubtitle ? 'size-3 text-foreground/45' : 'size-3.5 text-foreground/65'
                      }`} />
                      <span className="sr-only">{field.label}: </span>
                      {field.tags ? (
                        <span className={cn('flex flex-wrap gap-1', centered && 'justify-center')}>
                          {field.tags.map((tag) => (
                            <span
                              key={tag}
                              className={cn(
                                'rounded bg-muted px-1.5 py-0.5 font-medium text-foreground/75',
                                compact ? 'text-[11px]' : 'text-xs',
                              )}
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : field.href ? (
                        <a
                          href={field.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline underline-offset-2 decoration-muted-foreground/40 hover:text-foreground"
                        >
                          {field.value}
                        </a>
                      ) : (
                        <span>{field.value}</span>
                      )}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })()
    : (
      <span className={cn(compact ? 'text-xs text-muted-foreground/85' : 'text-sm text-muted-foreground', centered && 'text-center')}>
        No booking parameters stored.
      </span>
    )

  return (
    <div className={cn(
      centered
        ? 'grid grid-cols-[1fr_minmax(0,auto)_1fr] items-start gap-3'
        : 'flex items-start justify-between gap-3',
    )}>
      {centered && <div className="flex justify-start">{onEdit ? <span className="size-8 shrink-0" aria-hidden="true" /> : null}</div>}
      <div className={cn('min-w-0', centered && 'justify-self-center')}>
        {content}
      </div>
      {onEdit ? (
        <div className={cn('flex', centered ? 'justify-end' : 'shrink-0')}>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground/50"
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      ) : centered ? (
        <div />
      ) : null}
    </div>
  )
}
