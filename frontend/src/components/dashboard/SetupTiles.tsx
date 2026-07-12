import { Clock3, LockKeyhole, Plus, Users } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/SectionHeading'
import { cn } from '@/lib/utils'

const CREDENTIALS_TILE_DESCRIPTION =
  'Save your booking site logins so Hut Hunter can seamlessly move from availability checks into the booking flow.'

export function OccupantsTile({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <article className={cn('app-panel flex min-h-28 flex-col px-5 py-3.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
            <Users className="size-4" />
          </div>
          <p className="text-base font-semibold tracking-tight text-foreground sm:text-sm">
            Campers
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/8 px-2.5 py-1.5 text-base font-medium text-amber-700 ring-1 ring-amber-500/10 hover:bg-amber-500/14 sm:px-2 sm:py-1 sm:text-xs"
          onClick={onOpen}
        >
          <Plus className="size-3.5 sm:size-3" />
          Add
        </button>
      </div>
      <p className="mt-2.5 text-base/5 text-pretty text-muted-foreground sm:text-sm/5">
        Add camper details to enable automated booking. Hut Hunter needs this info to complete checkout.
      </p>
    </article>
  )
}

export function CredentialsTile({
  onOpen,
  missingCount,
  compact = false,
  className,
}: {
  onOpen: () => void
  missingCount: number
  compact?: boolean
  className?: string
}) {
  if (compact) {
    // Mirror StatFilterTile: label + tooltip, large value, icon — the whole
    // tile is the CTA so we don't need a separate Add button crowding the row.
    return (
      <article
        role="button"
        tabIndex={0}
        aria-label={`Add booking site sign-ins, ${missingCount} missing`}
        className={cn(
          'app-panel w-full cursor-pointer overflow-hidden px-5 py-3.5 text-left transition-colors hover:bg-muted/40',
          className,
        )}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
      >
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-base font-medium text-muted-foreground sm:text-sm">
                Sign-Ins
              </p>
              <span onClick={(e) => e.stopPropagation()}>
                <InfoTooltip content={CREDENTIALS_TILE_DESCRIPTION} align="start" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              <span className="tabular-nums">{missingCount}</span>
              {' '}
              <span className="text-xl font-medium text-muted-foreground">missing</span>
            </p>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700">
            <LockKeyhole className="size-5" />
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className={cn('app-panel flex min-h-28 flex-col px-5 py-3.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
            <LockKeyhole className="size-4" />
          </div>
          <p className="text-base font-semibold tracking-tight text-foreground sm:text-sm">
            Sign-Ins
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/8 px-2.5 py-1.5 text-base font-medium text-sky-800 ring-1 ring-sky-500/10 hover:bg-sky-500/14 sm:px-2 sm:py-1 sm:text-xs"
          onClick={onOpen}
        >
          <Plus className="size-3.5 sm:size-3" />
          Add
        </button>
      </div>
      <p className="mt-2.5 text-base/5 text-pretty text-muted-foreground sm:text-sm/5">
        {CREDENTIALS_TILE_DESCRIPTION}
        {missingCount > 1 ? ` ${missingCount} sites still need a sign-in.` : ''}
      </p>
    </article>
  )
}

export function NoJobsTile({ onCreateJob, className }: { onCreateJob: () => void; className?: string }) {
  return (
    <article className={cn('flex min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock3 className="size-4.5" />
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight text-foreground sm:text-sm">
              No hunts yet
            </p>
            <p className="text-base text-muted-foreground sm:text-sm">
              Create a hunt to start monitoring.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onCreateJob}
        >
          <Plus className="size-4" />
          Create a Hunt
        </button>
      </div>
    </article>
  )
}

export function CreateMoreJobsTile({ onCreateJob, className }: { onCreateJob: () => void; className?: string }) {
  return (
    <article className={cn('flex min-h-28 w-full flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-base font-semibold tracking-tight text-foreground sm:text-sm">
            New Hunt
          </p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Monitor more routes or dates.
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onCreateJob}
        >
          <Plus className="size-4" />
          Create
        </button>
      </div>
    </article>
  )
}
