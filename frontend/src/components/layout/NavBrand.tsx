import { cn } from '@/lib/utils'

export function NavBrand({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-2.5 rounded-2xl text-left transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      onClick={onClick}
      aria-label="Go to dashboard"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
        <img src="/favicon.svg" alt="" className="size-5" />
      </div>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Hut Hunter
      </span>
    </button>
  )
}
