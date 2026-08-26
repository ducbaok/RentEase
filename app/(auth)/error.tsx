'use client'

import { ErrorState } from '@/components/shared/error-state'

/**
 * The sign-in and sign-up boundary.
 *
 * Nothing here may hint at whether an account exists — the sign-in form is
 * careful about that (see foundation.spec) and this must not undo it, which is
 * another reason the raw error never reaches the page.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-md px-6 py-16">
      <ErrorState
        title="We could not finish that"
        description="Something went wrong. Nothing was changed, so it is safe to try again."
        digest={error.digest}
        reset={reset}
      />
    </div>
  )
}
