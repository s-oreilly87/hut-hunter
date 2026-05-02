import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function InfoTooltip({
  content,
  align = 'center',
}: {
  content: string
  align?: 'center' | 'start' | 'end'
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label="More information"
          >
            <CircleHelp className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent align={align} side="bottom">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function SectionHeading({
  title,
  tooltip,
  tone = 'section',
  className,
}: {
  title: ReactNode
  tooltip?: string
  tone?: 'section' | 'body'
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <h3
        className={
          tone === 'section'
            ? 'text-xs font-semibold tracking-wide text-muted-foreground/70'
            : 'font-medium text-foreground'
        }
      >
        {title}
      </h3>
      {tooltip && <InfoTooltip content={tooltip} />}
    </div>
  )
}
