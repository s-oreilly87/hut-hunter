import { LayoutDashboard, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useElementHeightCssVar } from '@/lib/hooks'
import type { AppRoute } from '@/lib/navigation'

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
      className="fixed inset-x-0 bottom-0 border-t border-border/70 bg-background/96 px-4 py-3 backdrop-blur"
    >
      <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
        <Button
          variant={activeSection === 'dashboard' ? 'default' : 'outline'}
          onClick={() => navigate({ name: 'dashboard' })}
        >
          <LayoutDashboard className="size-4" />
          Dashboard
        </Button>
        <Button
          variant={activeSection === 'jobs' ? 'default' : 'outline'}
          onClick={() => navigate({ name: 'jobs' })}
        >
          <Search className="size-4" />
          Hunts
        </Button>
      </div>
    </nav>
  )
}
