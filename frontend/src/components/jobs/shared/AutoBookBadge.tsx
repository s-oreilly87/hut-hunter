import type { WatchJob } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'

/**
 * Compact badge showing whether a job will auto-book or only notify.
 *
 * "Auto-book" only when both the auto_book flag is set AND credentials are
 * configured for the adapter; otherwise the badge degrades to "Notify only"
 * (the job will still report availability, just won't act on it).
 *
 * Used in JobList rows and inside the JobCard monitoring section.
 */
export function AutoBookBadge({ job }: { job: WatchJob }) {
  const isAutoBook = job.auto_book && job.credentials_configured
  return (
    <Badge variant={isAutoBook ? 'default' : 'outline'}>
      {isAutoBook ? 'Auto-book' : 'Notify only'}
    </Badge>
  )
}

/**
 * Amber "No sign-in" pill called out in the JobCard monitoring section when
 * an adapter that requires credentials hasn't had any saved.
 *
 * Pulled out so the AutoBookBadge stays single-purpose.
 */
export function NoSignInBadge() {
  return (
    <Badge className="bg-amber-500 text-white hover:bg-amber-500">
      No sign-in
    </Badge>
  )
}
