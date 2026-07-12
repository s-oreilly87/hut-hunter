import { Pencil, Trash2 } from 'lucide-react'
import type { AdapterInfo, Occupant } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { summarizeAdapterValues } from './occupantHelpers'
import { cn } from '@/lib/utils'

export function OccupantRow({
  occupant,
  adaptersById,
  onEdit,
  onDelete,
  className,
}: {
  occupant: Occupant
  adaptersById: Map<string, AdapterInfo>
  onEdit: () => void
  onDelete: () => void
  className?: string
}) {
  const adapterSummaries = summarizeAdapterValues(occupant, adaptersById)

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <p className="truncate text-base font-medium text-foreground sm:text-sm">
          {occupant.first_name} {occupant.last_name}
        </p>
        <p className="text-base text-muted-foreground sm:text-sm">
          {occupant.age}y · {occupant.gender} · {occupant.country}
        </p>
        {adapterSummaries.map(summary => (
          <p key={summary} className="text-base text-muted-foreground sm:text-sm">{summary}</p>
        ))}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" className="relative size-7 p-0" onClick={onEdit}>
          <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="relative size-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
