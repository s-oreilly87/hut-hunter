import { LayoutDashboard, Search } from 'lucide-react'
import { useElementHeightCssVar } from '@/lib/hooks'
import type { AppRoute } from '@/lib/navigation'
import { cn } from '@/lib/utils'

function getPrimarySection(route: AppRoute): 'dashboard' | 'jobs' {
  return route.name === 'dashboard' ? 'dashboard' : 'jobs'
}

export function MobilePrimaryNav({
  route,
  navigate,
}: {
  route: AppRoute
  navigate: (route: AppRoute) => void
}) {
  const navRef = useElementHeightCssVar<HTMLElement>('--app-mobile-nav-height')
  const activeSection = getPrimarySection(route)

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 px-3 py-2 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-md gap-1 rounded-2xl bg-secondary/60 p-1">
        <button
          type="button"
          className={cn(
            'relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-medium transition-all duration-150 sm:py-2.5 sm:text-sm',
            activeSection === 'dashboard'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => navigate({ name: 'dashboard' })}
        >
          <LayoutDashboard className="size-5 shrink-0 sm:size-4" />
          Dashboard
        </button>
        <button
          type="button"
          className={cn(
            'relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-medium transition-all duration-150 sm:py-2.5 sm:text-sm',
            activeSection === 'jobs'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => navigate({ name: 'jobs' })}
        >
          <Search className="size-5 shrink-0 sm:size-4" />
          Hunts
        </button>
      </div>
    </nav>
  )
}
