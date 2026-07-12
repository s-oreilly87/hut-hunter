import type { AdapterCredential } from '@/lib/api'

export type VerificationBadge = {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}

// THR-126: while a verification is PENDING (server-side — set the instant a
// check is enqueued, see mark_credential_pending), poll the credentials list
// on a short interval so the badge flips without a manual refresh. There is
// deliberately no client-side timeout that reverts the badge on its own
// anymore — THR-123 shipped one, and a slow/never-completing worker made it
// spin for ~25s and then silently fall back to "Unverified" with zero
// explanation. Every outcome (including INCONCLUSIVE) is now persisted
// server-side, so polling just keeps refetching until verification_status
// actually leaves 'pending'.
export const VERIFYING_POLL_MS = 2_000

export function verificationBadge(credential: AdapterCredential | undefined): VerificationBadge {
  if (!credential) {
    return { label: 'Missing', tone: 'warning' }
  }
  switch (credential.verification_status) {
    case 'pending':
      return { label: 'Verifying…', tone: 'info' }
    case 'verified':
      return { label: 'Verified', tone: 'success' }
    case 'failed':
      return { label: 'Invalid credentials', tone: 'danger' }
    case 'inconclusive':
      return { label: 'Couldn’t verify — retry', tone: 'warning' }
    default:
      return { label: 'Not yet verified', tone: 'warning' }
  }
}
