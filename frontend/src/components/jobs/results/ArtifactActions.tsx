import { FileCode2, ImageIcon } from 'lucide-react'

/**
 * Small pill-style external link used in the result-tile family for
 * "Screenshot" / "HTML" links to captured artifacts.
 */
export function ArtifactLinkButton({
  href,
  icon: Icon,
  children,
}: {
  href: string
  icon: typeof ImageIcon
  children: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground hover:bg-muted"
    >
      <Icon className="size-3.5" />
      {children}
    </a>
  )
}

/**
 * Footer row that surfaces the screenshot + HTML artifacts attached to a
 * result tile. Returns null when no artifacts are present so callers don't
 * have to guard.
 */
export function ArtifactActions({
  artifactPng,
  artifactHtml,
  borderClass = 'border-border/70',
}: {
  artifactPng?: string | null
  artifactHtml?: string | null
  borderClass?: string
}) {
  if (!artifactPng && !artifactHtml) return null

  return (
    <div className={`flex flex-wrap gap-1.5 border-t pt-3 ${borderClass}`}>
      {artifactPng && (
        <ArtifactLinkButton href={artifactPng} icon={ImageIcon}>
          Screenshot
        </ArtifactLinkButton>
      )}
      {artifactHtml && (
        <ArtifactLinkButton href={artifactHtml} icon={FileCode2}>
          HTML
        </ArtifactLinkButton>
      )}
    </div>
  )
}
