import { AlertTriangle, Settings2, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'

const OUTDATED_CAMPERS_MESSAGE =
  'Campers attached to this hunt have been edited since this job was created. Save this job again to update the camper details.'

/**
 * Inline icon-with-tooltip used next to a job title in the list view to
 * signal that the job's stored camper snapshots are out of date.
 *
 * The wrapping span swallows clicks so tapping the warning doesn't also
 * select the row it lives in.
 */
export function OutdatedCampersIcon() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-amber-700"
          onClick={(event) => event.stopPropagation()}
          aria-label="Camper details changed"
          tabIndex={0}
        >
          <AlertTriangle className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {OUTDATED_CAMPERS_MESSAGE}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Full-width amber notice card used at the top of JobCard when a hunt's
 * stored camper snapshots are out of date. Offers two actions: edit the hunt
 * (which re-snapshots the campers) or jump to the camper roster to fix the
 * underlying camper records first.
 */
export function OutdatedCampersNotice({
  onEditJob,
  onEditCampers,
}: {
  onEditJob: () => void
  onEditCampers: () => void
}) {
  return (
    <section>
      <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700">
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-medium tracking-tight text-foreground">
              Camper Details Changed
            </p>
            <p className="mt-1.5 text-sm/5 text-muted-foreground">
              Campers attached to this hunt have been edited since this job was created. To use the current campers and ensure all required fields are still filled out, save this job again to update the camper details.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20"
                onClick={onEditJob}
              >
                <Settings2 className="mr-1.5 size-3.5" />
                Edit Hunt
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20"
                onClick={onEditCampers}
              >
                <Users className="mr-1.5 size-3.5" />
                Edit Campers
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
