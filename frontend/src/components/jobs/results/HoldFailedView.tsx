import { XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { ArtifactActions } from './ArtifactActions'

/**
 * Tile shown when the most recent automation result was a `hold_failed`
 * payload — i.e. availability was found but the booking flow couldn't
 * advance. Surfaces the captured screenshot/HTML so the user can see what
 * the remote site returned at the moment of failure.
 */
export function HoldFailedView({
  entry,
  artifactPng,
  artifactHtml,
}: {
  entry: Record<string, unknown>
  artifactPng?: string | null
  artifactHtml?: string | null
}) {
  const errorMsg = typeof entry.error === 'string'
    ? entry.error
    : 'The hold attempt did not complete successfully.'

  return (
    <div className="rounded-[1.25rem] border border-rose-500/30 bg-rose-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600">
          <XCircle className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium tracking-tight text-foreground">
                Hold Failed
              </p>
              <p className="text-sm/5 text-foreground/85">
                {errorMsg}
              </p>
            </div>
            <Badge className="bg-rose-500 text-white hover:bg-rose-500">
              Hold Failed
            </Badge>
          </div>

          <ArtifactActions
            artifactPng={artifactPng}
            artifactHtml={artifactHtml}
            borderClass="border-rose-500/15"
          />
        </div>
      </div>
    </div>
  )
}
