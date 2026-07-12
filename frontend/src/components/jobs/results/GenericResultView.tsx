import { AlertTriangle } from 'lucide-react'
import { formatResultValue, titleize } from '@/lib/availabilityResults'
import { Badge } from '@/components/ui/Badge'
import { ArtifactActions } from './ArtifactActions'

/**
 * Catch-all tile for last-result entries that don't match any of the known
 * shapes (availability, unavailable, hold_failed). Shows the primary error
 * or message field prominently and dumps the rest of the payload as
 * label/value pairs so nothing is silently swallowed.
 */
export function GenericResultView({
  entry,
  artifactPng,
  artifactHtml,
}: {
  entry: Record<string, unknown>
  artifactPng?: string | null
  artifactHtml?: string | null
}) {
  const primaryMessage = typeof entry.error === 'string'
    ? entry.error
    : typeof entry.message === 'string'
      ? entry.message
      : null
  const detailEntries = Object.entries(entry).filter(([key]) =>
    key !== 'error' && key !== 'message',
  )

  return (
    <div className="rounded-[1.25rem] border border-destructive/30 bg-destructive/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium tracking-tight text-foreground">
                Automation Error
              </p>
              <p className="text-sm leading-5 text-foreground/85">
                {primaryMessage ?? 'The latest run returned an unstructured error payload.'}
              </p>
            </div>
            <Badge variant="destructive">Needs Review</Badge>
          </div>

          {detailEntries.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {detailEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-destructive/15 bg-background/70 p-3"
                >
                  <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                    {titleize(key)}
                  </p>
                  <p className="mt-1 text-sm wrap-break-word text-foreground">
                    {formatResultValue(value)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <ArtifactActions
            artifactPng={artifactPng}
            artifactHtml={artifactHtml}
            borderClass="border-destructive/15"
          />
        </div>
      </div>
    </div>
  )
}
