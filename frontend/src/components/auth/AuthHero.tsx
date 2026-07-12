import { TentTree } from 'lucide-react'
import { cn } from '@/lib/utils'

const FEATURES = [
  {
    title: 'Availability Checks',
    body: 'Run regular checks across NZ Great Walks and standard huts, plus BC Parks, Ontario Parks, and Parks Canada campsites, with your preferred dates, direction, and party setup.',
  },
  {
    title: 'Notifications',
    body: 'Route availability alerts to email or Gotify (*requires Gotify server configuration)',
  },
  {
    title: 'Booking Holds and Auto-Booking',
    body: "Save your site logins (encrypted at rest) and camper details once, and Hut Hunter can continue through booking to secure a hold at the payment screen on NZ DOC, BC Parks, and Ontario Parks. Parks Canada is watch & notify only — its SSO-only sign-in can't be automated.",
  },
] as const

export function AuthHero({ className }: { className?: string }) {
  return (
    <section className={cn('app-panel flex flex-col justify-between overflow-hidden px-6 py-6 sm:px-8 sm:py-8', className)}>
      <div>
        <div className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <TentTree className="size-6" />
          </div>
          Hut Hunter
        </div>
        <p className="mt-8 text-sm font-medium uppercase tracking-[0.2em] text-primary/80">
          Booking Assistant
        </p>
        <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Snag reservations for popular, hard to book huts and campsites
        </h1>
        <p className="text-sm text-muted-foreground place-self-end">(*cough* Mueller Hut . . . )</p>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Monitor hut/campsite availability, get notified fast, and secure reservation holds so you don't lose your spot!
        </p>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Hut Hunter keeps customizable availability checks, notifications, and auto-booking in one focused workflow across New Zealand DOC, BC Parks, Ontario Parks, and Parks Canada.
        </p>
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <AuthFeatureCard key={feature.title} title={feature.title} body={feature.body} />
        ))}
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground/80">
        Coming soon: Newfoundland and Yukon parks, plus an AI agent that builds new site adapters automatically.
      </p>
    </section>
  )
}

function AuthFeatureCard({
  title,
  body,
  className,
}: {
  title: string
  body: string
  className?: string
}) {
  return (
    <div className={cn('rounded-[1.5rem] border border-border/70 bg-background/70 p-4', className)}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  )
}
