'use client'

import { PageHeader } from '@/components/shared/page-header'
import { ErrorState } from '@/components/shared/error-state'

/**
 * The operator side's error boundary.
 *
 * It replaces the page, not the layout, so the navigation stays usable — a
 * landlord whose invoice list failed can still reach their properties instead
 * of being dropped onto a blank screen with a back button.
 */
export default function DashboardError({
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
        description="This screen could not be loaded. Nothing was changed, so trying again is safe. If it keeps happening, quote the reference below."
        digest={error.digest}
        reset={reset}
      />
    </>
  )
}
