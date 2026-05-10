import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getHeaderFields } from '@/components/jobs/jobParamDisplay'

/**
 * Renders a job's stored params as a compact, multi-row label/value list,
 * grouped by visual importance:
 *
 *   row 1: facility / facility_park
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
 */
export function HeaderParamSummary({
  params,
  onEdit,
  centered = false,
}: {
  params: Record<string, unknown>
  onEdit?: () => void
  centered?: boolean
}) {
  const fields = getHeaderFields(params)

  if (!fields.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          No booking parameters stored.
        </span>
        {onEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground/50"
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
    )
  }

  const facilityFields = fields.filter((field) => field.key === 'facility' || field.key === 'facility_park')
  const primaryFields = fields.filter((field) => field.key === 'track' || field.key === 'date')
  const secondaryFields = fields.filter(
    (field) => field.key === 'nights' || field.key === 'people' || field.key === 'direction',
  )
  const tertiaryFields = fields.filter((field) => field.key === 'sites')
  const rows = [facilityFields, primaryFields, secondaryFields, tertiaryFields].filter((row) => row.length > 0)

  return (
    <div className="flex items-center gap-2">
      {centered && onEdit && <span className="size-8 shrink-0" aria-hidden="true" />}
      <div className="space-y-1.5">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-5 text-muted-foreground"
          >
            {row.map((field) => {
              const Icon = field.icon
              const textClass = field.isSubtitle ? 'text-xs text-muted-foreground/70' : ''

              return (
                <span key={field.key} className={`inline-flex items-start gap-2 ${textClass}`}>
                  <Icon className={`mt-0.5 shrink-0 ${field.isSubtitle ? 'size-3 text-foreground/45' : 'size-3.5 text-foreground/65'}`} />
                  <span className="sr-only">{field.label}: </span>
                  {field.tags ? (
                    <span className="flex flex-wrap gap-1">
                      {field.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground/75"
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
      {onEdit && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground/50"
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </Button>
      )}
    </div>
  )
}
