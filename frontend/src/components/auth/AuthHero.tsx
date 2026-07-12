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
    <section className={cn('app-panel flex flex-col justify-between overflow-hidden p-5 sm:p-6 lg:p-7', className)}>
      <div>
        <div className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-foreground sm:gap-3 sm:text-2xl">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary sm:size-11">
            <TentTree className="size-5" />
          </div>
          Hut Hunter
        </div>
        <p className="mt-5 text-base font-medium tracking-[0.2em] text-primary/80 uppercase sm:mt-6 sm:text-sm">
          Booking Assistant
        </p>
        <h1 className="mt-2 max-w-[22ch] text-3xl font-semibold tracking-tight text-foreground sm:mt-2.5 sm:max-w-xl sm:text-4xl">
          Snag reservations for popular, hard to book huts and campsites
        </h1>
        <p className="place-self-end text-base text-muted-foreground sm:text-sm">(*cough* Mueller Hut . . . )</p>
        <p className="mt-3 max-w-2xl text-base/7 text-muted-foreground sm:mt-3.5 sm:text-sm/6">
          Monitor hut/campsite availability, get notified fast, and secure reservation holds so you don't lose your spot!
        </p>
        <p className="mt-2.5 max-w-2xl text-base/7 text-muted-foreground sm:text-sm/6">
          Hut Hunter keeps customizable availability checks, notifications, and auto-booking in one focused workflow across New Zealand DOC, BC Parks, Ontario Parks, and Parks Canada.
        </p>
      </div>

      <div className="@container mt-6 sm:mt-7">
        <div className="grid gap-2.5 @[28rem]:grid-cols-2 @[48rem]:grid-cols-3 sm:gap-3">
          {FEATURES.map((feature) => (
            <AuthFeatureCard key={feature.title} title={feature.title} body={feature.body} />
          ))}
        </div>
      </div>

      <p className="mt-3 max-w-2xl text-base leading-6 text-muted-foreground/80 sm:mt-3.5 sm:text-sm sm:leading-5">
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
    <div className={cn('min-w-0 rounded-2xl border border-border/70 bg-background/70 p-3.5 sm:rounded-[1.25rem] sm:p-4', className)}>
      <p className="text-base font-semibold text-foreground sm:text-sm">{title}</p>
      <p className="mt-1.5 text-base/6 text-muted-foreground sm:mt-2 sm:text-sm/5">{body}</p>
    </div>
  )
}
