import { BadgeInfo } from 'lucide-react'

/**
 * Inline informational banners that the JobCard may stack above its
 * monitoring section to call out missing prerequisites — campers and
 * booking-site sign-ins.
 *
 * The visuals are deliberately quiet (amber and sky tints) since they're
 * not errors; they're "fix this when you can" reminders.
 */
export function MissingOccupantsNotice() {
  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        <BadgeInfo className="inline-block size-5 mr-2 text-gray-400" />
        Campers are required on this hunt before booking can start. Add them in Edit to enable auto-book and manual booking.
      </p>
    </div>
  )
}

export function ManualBookingOnlyNotice({ siteName }: { siteName?: string }) {
  return (
    <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        <BadgeInfo className="inline-block size-5 mr-2 text-gray-400" />
        {siteName ?? 'This booking site'} signs in with a third-party account
        (e.g. Google or GCKey), which Hut Hunter can't automate — automated
        booking isn't available. You'll be notified when availability is found
        so you can book manually on the site.
      </p>
    </div>
  )
}

export function MissingCredentialsNotice() {
  return (
    <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-4 py-3">
      <p className="text-sm text-muted-foreground flex items-center">
        <BadgeInfo className="inline-block size-5 mr-2 h-full text-gray-400" />
        A saved sign-in is required on this hunt before booking can start. Add it from Booking Site Sign-Ins in the header.
      </p>
    </div>
  )
}
