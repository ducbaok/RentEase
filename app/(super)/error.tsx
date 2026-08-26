'use client'

import { PageHeader } from '@/components/shared/page-header'
import { ErrorState } from '@/components/shared/error-state'

/** The back office's error boundary. */
export default function SuperError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <>
      <PageHeader title="Something went wrong" />
      <ErrorState
        description="The account list could not be loaded. Nothing was changed. The server log has the full error against the reference below."
        digest={error.digest}
        reset={reset}
      />
    </>
  )
}
