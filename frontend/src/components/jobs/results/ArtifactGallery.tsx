import { FileCode2 } from 'lucide-react'
import type { ArtifactRecord } from '@/lib/api'
import { formatArtifactLabel } from '@/lib/availabilityResults'
import { ArtifactLinkButton } from './ArtifactActions'

/**
 * Grid of cart-stage / receipt screenshots attached to a job. Each card
 * shows a short "Reservation Details" / "Shopping Cart" / "Receipt" label,
 * the captured PNG (clickable to open full-size), and an optional HTML link.
 */
export function ArtifactGallery({
  artifacts,
}: {
  artifacts: ArtifactRecord[]
}) {
  if (!artifacts.length) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {artifacts.map((artifact, index) => (
        <div
          key={`${artifact.label}:${artifact.png_url}:${index}`}
          className="overflow-hidden rounded-2xl border border-border/70 bg-background/80"
        >
          <div className="border-b border-border/70 px-3.5 py-2">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
              {formatArtifactLabel(artifact.label)}
            </p>
          </div>

          {artifact.png_url && (
            <a
              href={artifact.png_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-muted/40"
            >
              <img
                src={artifact.png_url}
                alt={formatArtifactLabel(artifact.label)}
                className="aspect-4/3 w-full object-cover"
                loading="lazy"
              />
            </a>
          )}

          {artifact.html_url && (
            <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
              <ArtifactLinkButton href={artifact.html_url} icon={FileCode2}>
                HTML
              </ArtifactLinkButton>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
