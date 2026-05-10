import { LayoutDashboard } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'
import { cn } from '@/lib/utils'

const PANEL_CLASSES = 'app-panel app-panel-frame gap-0 py-0 border-border/80 bg-card/85'

/**
 * "No job selected" placeholder rendered in the JobCard slot before the
 * user picks a hunt. Sets expectations for what the panel will show once
 * something is selected.
 */
export function JobCardEmptySelection({ className }: { className?: string }) {
  return (
    <Card className={cn(PANEL_CLASSES, className)}>
      <CardHeader className="pt-6 pb-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LayoutDashboard className="size-5" />
        </div>
        <CardTitle className="mt-4 text-base font-semibold tracking-tight">
          Hunt details stay here
        </CardTitle>
        <CardDescription className="max-w-md text-sm leading-5 text-pretty">
          Select any hunt to inspect its inputs, latest availability
          evidence, and booking controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="app-panel-body-scroll px-6">
        <div className="grid gap-3 pt-6 pb-6">
          <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
            <p className="text-sm font-medium text-foreground">What you get here</p>
            <p className="mt-1.5 text-sm leading-5 text-pretty text-muted-foreground">
              Stored inputs, current state, latest automation result, and artifact links in one focused view.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Loading skeleton shown while the selected job's data is in flight.
 */
export function JobCardLoadingSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(PANEL_CLASSES, className)}>
      <CardContent className="app-panel-body-scroll px-6">
        <div className="grid gap-3 pt-6 pb-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl bg-muted/60"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
