'use client'

import { ErrorState } from '@/components/shared/error-state'

/**
 * The resident portal's error boundary.
 *
 * The wording is gentler than the operator one on purpose: a resident cannot
 * fix anything here and has no support channel except their landlord, so the
 * message says what to do rather than what broke.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="We could not load this"
      description="Your bills are safe — this is a problem showing them, not a problem with your account. Try again, and if it keeps happening let your landlord know."
      digest={error.digest}
      reset={reset}
    />
  )
}
