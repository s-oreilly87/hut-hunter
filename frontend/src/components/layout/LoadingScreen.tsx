import { TentTree } from 'lucide-react'

export function LoadingScreen() {
  return (
    <div className="app-shell min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-3xl items-center justify-center px-4 py-6">
        <div className="app-panel w-full max-w-md px-6 py-10 text-center sm:px-8">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <TentTree className="size-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
            Loading your workspace
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Checking your session and restoring your hunts.
          </p>
        </div>
      </div>
    </div>
  )
}
