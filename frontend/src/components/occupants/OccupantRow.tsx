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
        <p className="truncate font-medium text-foreground">
          {occupant.first_name} {occupant.last_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {occupant.age}y · {occupant.gender} · {occupant.country}
        </p>
        {adapterSummaries.map(summary => (
          <p key={summary} className="text-xs text-muted-foreground">{summary}</p>
        ))}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" className="size-7 p-0" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
